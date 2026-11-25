// Évaluation des réseaux de fin de séance : prévu contre publié (Naya + Metricool, sans doublon),
// et les chiffres disponibles (Instagram). Rien n'est inventé : un chiffre absent reste null, et
// « limites » dit pourquoi.
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import type { ConnexionMc, PostMc, RefusMc } from "../metricool/client";

export interface ReseauEvalue {
  reseau: string; prevus: number; publies: number; manques: { texte: string; prevuLe: string }[];
  portee: number | null; abonnesGagnes: number | null; meilleurs: { texte: string; portee: number | null }[];
  source: "metricool" | "instagram" | "naya";
}
export interface EvaluationReseaux { depuis: string; parReseau: ReseauEvalue[]; limites: string[] }

export interface LectureInstagram {
  posts: { texte: string; publieLe: string; portee: number | null }[];
  abonnesGagnes: number | null;
  limite?: "portee_manquante" | "instagram_expire";
}

export interface DepsEvaluation {
  postsNaya(userId: string, depuis: Date, maintenant: Date): Promise<any[]>;
  connexionMetricool(userId: string): Promise<ConnexionMc | null>;
  postsMetricool(cx: ConnexionMc, debut: Date, fin: Date): Promise<{ ok: true; posts: PostMc[] } | RefusMc>;
  marquerMetricoolRefuse(userId: string): Promise<void>;
  compteInstagram(userId: string): Promise<{ jeton: string } | null>;
  lireInstagram(compte: { jeton: string }, debut: Date, fin: Date): Promise<LectureInstagram>;
}

const GRAPH_IG = "https://graph.instagram.com";
const MEILLEURS_MAX = 3;

const normReseau = (r: string) => r.toLowerCase().replace(/[^a-z]/g, "");
/** Un même post vu dans Naya et Metricool : même réseau, même minute, mêmes 40 premiers caractères. */
export function cleDoublon(reseau: string, quand: string | Date, texte: string): string {
  const d = new Date(quand);
  const minute = Number.isNaN(d.getTime()) ? String(quand).slice(0, 16) : d.toISOString().slice(0, 16);
  return `${normReseau(reseau)}|${minute}|${texte.trim().slice(0, 40)}`;
}

const codeErreur = async (res: Response) => ((await res.json().catch(() => null)) as any)?.error?.code;

export async function lireInstagram(compte: { jeton: string }, debut: Date, fin: Date, f: typeof fetch = fetch): Promise<LectureInstagram> {
  const q = new URLSearchParams({ fields: "id,caption,timestamp", limit: "50", access_token: compte.jeton });
  const res = await f(`${GRAPH_IG}/me/media?${q}`);
  if (!res.ok) {
    const code = await codeErreur(res);
    return { posts: [], abonnesGagnes: null, limite: code === 190 ? "instagram_expire" : "portee_manquante" };
  }
  const medias = (((await res.json()) as any)?.data ?? []) as any[];
  const periode = medias.filter((m) => { const t = new Date(m.timestamp).getTime(); return t >= debut.getTime() && t <= fin.getTime(); });
  let limite: LectureInstagram["limite"];
  const posts: LectureInstagram["posts"] = [];
  for (const m of periode) {
    let portee: number | null = null;
    if (!limite) {
      const r = await f(`${GRAPH_IG}/${m.id}/insights?${new URLSearchParams({ metric: "reach", access_token: compte.jeton })}`);
      if (r.ok) {
        const v = ((await r.json()) as any)?.data?.find((x: any) => x.name === "reach")?.values?.[0]?.value;
        portee = typeof v === "number" ? v : null;
      } else {
        limite = "portee_manquante"; // permission statistiques absente : on n'insiste pas
      }
    }
    posts.push({ texte: String(m.caption ?? "").slice(0, 120), publieLe: m.timestamp, portee });
  }
  return { posts, abonnesGagnes: null, ...(limite ? { limite } : {}) };
}

export const depsEvaluation: DepsEvaluation = {
  postsNaya: (userId, depuis, maintenant) => db.select().from(content).where(and(
    eq(content.userId, userId), isNull(content.supprimeLe), gte(content.scheduledFor, depuis), lte(content.scheduledFor, maintenant),
  )),
  connexionMetricool: async (userId) => (await import("../metricool/store")).lireConnexionMetricool(userId),
  postsMetricool: async (cx, d, f) => (await import("../metricool/client")).postsMetricool(cx, d, f),
  marquerMetricoolRefuse: async (userId) => (await import("../metricool/store")).marquerEtat(userId, "refuse"),
  compteInstagram: async (userId) => {
    const { storage } = await import("../../storage");
    const { decryptToken } = await import("../token-crypto");
    const comptes = (await storage.getSocialAccounts(userId)) as any[];
    const ig = comptes.find((c) => c.userId === userId && String(c.platform).toLowerCase() === "instagram" && c.isActive !== false && c.projectId == null)
      ?? comptes.find((c) => c.userId === userId && String(c.platform).toLowerCase() === "instagram" && c.isActive !== false);
    const jeton = ig ? decryptToken(ig.accessToken) : null;
    return jeton ? { jeton } : null;
  },
  lireInstagram: (compte, d, f) => lireInstagram(compte, d, f),
};

function reseauVide(reseau: string, source: ReseauEvalue["source"]): ReseauEvalue {
  return { reseau, prevus: 0, publies: 0, manques: [], portee: null, abonnesGagnes: null, meilleurs: [], source };
}

export async function evaluationReseaux(deps: DepsEvaluation, userId: string, depuis: Date, maintenant: Date): Promise<EvaluationReseaux> {
  const limites = new Set<string>(["linkedin_profil_non_lisible"]);
  const parReseau = new Map<string, ReseauEvalue>();
  const vus = new Set<string>();
  const ligne = (r: string, source: ReseauEvalue["source"]) => {
    const k = normReseau(r);
    if (!parReseau.has(k)) parReseau.set(k, reseauVide(k, source));
    return parReseau.get(k)!;
  };

  // 1. Posts programmés dans Naya.
  for (const c of (await deps.postsNaya(userId, depuis, maintenant)).filter((x) => x.userId === undefined || x.userId === userId)) {
    const texte = String(c.body ?? c.title ?? "");
    vus.add(cleDoublon(c.platform, c.scheduledFor, texte));
    const l = ligne(c.platform, "naya");
    l.prevus++;
    if (c.postStatus === "posted" || c.publishedAt) l.publies++;
    else l.manques.push({ texte: texte.slice(0, 120), prevuLe: new Date(c.scheduledFor).toISOString() });
  }

  // 2. Posts programmés dans Metricool (l'agence y programme ses actus).
  const cx = await deps.connexionMetricool(userId);
  if (!cx) limites.add("metricool_absent");
  else {
    const r = await deps.postsMetricool(cx, depuis, maintenant);
    if (!r.ok) {
      if (r.raison === "refuse") { limites.add("metricool_refuse"); await deps.marquerMetricoolRefuse(userId).catch(() => {}); }
      else limites.add("metricool_indisponible");
    } else {
      for (const p of r.posts) {
        const cle = cleDoublon(p.reseau, p.prevuLe, p.texte);
        if (vus.has(cle)) { ligne(p.reseau, "metricool").source = "metricool"; continue; }
        vus.add(cle);
        const l = ligne(p.reseau, "metricool");
        l.source = "metricool";
        l.prevus++;
        if (p.publie) l.publies++;
        else l.manques.push({ texte: p.texte.slice(0, 120), prevuLe: p.prevuLe });
      }
    }
  }

  // 3. Instagram lu directement : ce qui est réellement sorti, et la portée si la permission est là.
  const ig = await deps.compteInstagram(userId);
  if (ig) {
    const lu = await deps.lireInstagram(ig, depuis, maintenant);
    if (lu.limite) limites.add(lu.limite);
    if (lu.limite !== "instagram_expire") {
      const l = ligne("instagram", "instagram");
      l.source = "instagram";
      l.publies = Math.max(l.publies, lu.posts.length);
      l.prevus = Math.max(l.prevus, l.publies);
      const avecPortee = lu.posts.filter((p) => p.portee != null);
      l.portee = avecPortee.length ? avecPortee.reduce((s, p) => s + (p.portee ?? 0), 0) : null;
      l.abonnesGagnes = lu.abonnesGagnes;
      l.meilleurs = [...avecPortee].sort((a, b) => (b.portee ?? 0) - (a.portee ?? 0)).slice(0, MEILLEURS_MAX)
        .map((p) => ({ texte: p.texte, portee: p.portee }));
    }
  }

  return { depuis: depuis.toISOString(), parReseau: [...parReseau.values()], limites: [...limites] };
}
