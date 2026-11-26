// Client de l'API publique Metricool (offres Advanced et Custom). Documentation lue le 25 nov. 2026 :
// https://help.metricool.com/basic-guide-for-api-integration-r97af
//   - base : https://app.metricool.com/api ;
//   - authentification : jeton dans l'en-tête X-Mc-Auth, userId et blogId en paramètres ;
//   - GET /v2/scheduler/posts : « liste les posts programmés entre deux dates » ; statut de
//     publication par réseau : PENDING, PUBLISHING, PUBLISHED, ERROR, AWAITING_CONFIRMATION.
// Les noms des paramètres de dates (start, end, timezone) viennent du Swagger lié depuis le compte,
// non public : ils sont vérifiés à la connexion (un refus de forme rend « indisponible »).
//   - GET /admin/simpleProfiles?userId= : liste les marques du compte (gérées ou partagées) ;
//     chaque entrée porte son id (= blogId) et son nom (label).
// Les statistiques ne sont PAS documentées publiquement : statsMetricool ne fait aucun appel.

export const URL_API_METRICOOL = "https://app.metricool.com/api";
export interface ConnexionMc { jeton: string; mcUserId: string; blogId: string }
export type RefusMc = { ok: false; raison: "refuse" | "indisponible" | "erreur" };
export interface MarqueMc { blogId: string; nom: string }
/** Connexion enregistrée : un jeton, un compte, plusieurs marques suivies. */
export interface ConnexionMarquesMc { jeton: string; mcUserId: string; marques: MarqueMc[] }
export interface PostMc { reseau: string; prevuLe: string; publie: boolean; texte: string }

import { wallClockToInstant } from "../../utils/timezone";

const FUSEAU = "Europe/Paris";
// Heure murale de Paris sans fuseau, comme l'attend le planificateur (AAAA-MM-JJTHH:MM:SS).
const local = (d: Date, fuseau = FUSEAU) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .format(d).replace(" ", "T");

/** « 2026-11-12T09:00:00 » + « Europe/Paris » → l'instant ISO (sans quoi un serveur en UTC décale d'une heure). */
function instantMc(dateTime: string, fuseau: string | undefined): string {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(dateTime)) return new Date(dateTime).toISOString();
  const [jour, heure = "00:00"] = dateTime.split("T");
  try {
    return wallClockToInstant(fuseau || FUSEAU, jour, heure.slice(0, 5)).toISOString();
  } catch {
    return dateTime;
  }
}

export async function postsMetricool(cx: ConnexionMc, debut: Date, fin: Date, f: typeof fetch = fetch): Promise<{ ok: true; posts: PostMc[] } | RefusMc> {
  const q = new URLSearchParams({
    userId: cx.mcUserId, blogId: cx.blogId, start: local(debut), end: local(fin), timezone: FUSEAU,
  });
  let res: Response;
  try {
    res = await f(`${URL_API_METRICOOL}/v2/scheduler/posts?${q}`, { headers: { "X-Mc-Auth": cx.jeton, Accept: "application/json" } });
  } catch {
    return { ok: false, raison: "erreur" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, raison: "refuse" };
  if (res.status === 400 || res.status === 404) return { ok: false, raison: "indisponible" };
  if (!res.ok) return { ok: false, raison: "erreur" };
  const corps: any = await res.json().catch(() => null);
  const liste = Array.isArray(corps?.data) ? corps.data : Array.isArray(corps) ? corps : null;
  if (!liste) return { ok: false, raison: "indisponible" };
  const posts: PostMc[] = [];
  for (const p of liste) {
    const prevuLe = instantMc(String(p?.publicationDate?.dateTime ?? ""), p?.publicationDate?.timezone);
    const texte = String(p?.text ?? "");
    for (const prov of Array.isArray(p?.providers) ? p.providers : []) {
      if (!prov?.network) continue;
      posts.push({ reseau: String(prov.network).toLowerCase(), prevuLe, publie: String(prov.status ?? "").toUpperCase() === "PUBLISHED", texte });
    }
  }
  return { ok: true, posts };
}

/** Les marques du compte : il suffit du jeton et du userId (les blogId en découlent). */
export async function marquesMetricool(jeton: string, mcUserId: string, f: typeof fetch = fetch): Promise<{ ok: true; marques: MarqueMc[] } | RefusMc> {
  let res: Response;
  try {
    res = await f(`${URL_API_METRICOOL}/admin/simpleProfiles?${new URLSearchParams({ userId: mcUserId })}`, { headers: { "X-Mc-Auth": jeton, Accept: "application/json" } });
  } catch {
    return { ok: false, raison: "erreur" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, raison: "refuse" };
  if (res.status === 400 || res.status === 404) return { ok: false, raison: "indisponible" };
  if (!res.ok) return { ok: false, raison: "erreur" };
  const corps: any = await res.json().catch(() => null);
  const liste = Array.isArray(corps) ? corps : Array.isArray(corps?.data) ? corps.data : null;
  if (!liste) return { ok: false, raison: "indisponible" };
  const marques: MarqueMc[] = [];
  for (const m of liste) {
    if (m?.id == null) continue;
    const blogId = String(m.id);
    marques.push({ blogId, nom: String(m.label ?? "").trim() || blogId });
  }
  return { ok: true, marques };
}

/** Statistiques Metricool : non documentées publiquement, donc jamais appelées. */
export async function statsMetricool(_cx: ConnexionMc, _debut: Date, _fin: Date, _f?: typeof fetch): Promise<RefusMc> {
  return { ok: false, raison: "indisponible" };
}
