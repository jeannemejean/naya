// Veille AO : les deux sources publiques, sans clé.
// - BOAMP : jeu open data de la DILA (Opendatasoft, API Explore v2.1, syntaxe ODSQL).
// - TED : API de recherche v3 du Journal officiel de l'UE (requête « expert »).
// Le fetch est injecté (tests sans réseau). Requêtes séquentielles, délai d'expiration,
// nombre de pages plafonné : on reste poli avec des services publics.
import { mapperBoamp, mapperTed, type AvisCollecte } from "./mapping";

export const BOAMP_URL = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
export const TED_URL = "https://api.ted.europa.eu/v3/notices/search";

/**
 * CPV des consignes de veille (communication, création, contenus, événementiel, audiovisuel),
 * vérifiés dans la nomenclature CPV 2008 : 79340000 publicité et marketing, 79341000 publicité,
 * 79341400 campagnes publicitaires, 79342000 marketing, 79413000 conseil en marketing,
 * 79416000 relations publiques, 79822500 conception graphique, 79950000 organisation
 * d'expositions/foires/congrès, 79952000 organisation d'événements, 92111000 production de
 * films et vidéos, 92312000 services artistiques, 72413000 conception de sites web.
 * 79000000 (trop large) n'est pas interrogé : les consignes ne le gardent que si l'objet est bien
 * de la communication, ce que couvrent déjà les descripteurs et mots clés.
 */
export const CPV_VEILLE = [
  "79340000", "79341000", "79341400", "79342000", "79413000", "79416000",
  "79822500", "79950000", "79952000", "92111000", "92312000", "72413000",
] as const;

/** Descripteurs du thésaurus BOAMP (champ descripteur_libelle) qui recoupent le périmètre. */
export const DESCRIPTEURS_BOAMP = [
  "Publicité, Communication", "Evénementiel", "Audiovisuel", "Vidéo, cinéma", "Edition", "Film",
] as const;

/**
 * Mots cherchés dans l'objet. Un mot par terme : la recherche ODSQL `search()` ne sait pas
 * chercher une expression (« identité visuelle » ne renvoie rien).
 */
export const MOTS_OBJET = [
  "communication", "audiovisuel", "audiovisuelle", "graphique", "attractivité",
  "campagne", "marketing", "influence", "contenus", "photographique",
] as const;

export interface FenetreVeille {
  /** Premier jour de publication interrogé (AAAA-MM-JJ). */
  depuis: string;
  /** Aujourd'hui (AAAA-MM-JJ) : les avis dont la date limite est passée sont exclus. */
  aujourdhui: string;
}

const echapper = (s: string) => s.replace(/"/g, '\\"');

export function clauseBoamp(f: FenetreVeille): string {
  const desc = `descripteur_libelle in (${DESCRIPTEURS_BOAMP.map((d) => `"${echapper(d)}"`).join(",")})`;
  const cpv = CPV_VEILLE.map((c) => `search(donnees,"${c}")`).join(" OR ");
  const mots = MOTS_OBJET.map((m) => `search(objet,"${echapper(m)}")`).join(" OR ");
  return [
    `dateparution>=date'${f.depuis}'`,
    // Avis de marché seulement : ni attribution, ni rectificatif, ni annulation.
    `nature='APPEL_OFFRE'`,
    `(datelimitereponse is null OR datelimitereponse>=date'${f.aujourdhui}')`,
    `(${desc} OR ${cpv} OR ${mots})`,
  ].join(" AND ");
}

export function urlBoamp(f: FenetreVeille, offset: number, limit: number): string {
  const p = new URLSearchParams({
    where: clauseBoamp(f),
    order_by: "dateparution desc",
    limit: String(limit),
    offset: String(offset),
  });
  return `${BOAMP_URL}?${p.toString()}`;
}

export const CHAMPS_TED = [
  "publication-number", "title-proc", "notice-title", "buyer-name", "buyer-country", "notice-type", "procedure-type",
  "deadline-receipt-tender-date-lot", "deadline-receipt-tender-time-lot", "deadline-receipt-request-date-lot",
  "classification-cpv", "estimated-value-proc", "estimated-value-cur-proc", "estimated-value-lot",
  "description-proc", "description-lot", "award-criterion-name-lot", "award-criterion-number-lot",
  "award-criterion-type-lot", "selection-criterion-description-lot", "document-url-lot",
  "place-of-performance-subdiv-lot", "contract-duration-period-lot", "publication-date", "links",
] as const;

export function corpsTed(f: FenetreVeille, page: number, limit: number) {
  const depuis = f.depuis.replace(/-/g, "");
  return {
    // Acheteurs français, avis de marché (standard, social, concours), publiés depuis `depuis`.
    query: `classification-cpv IN (${CPV_VEILLE.join(" ")}) AND buyer-country IN (FRA) AND publication-date>=${depuis} AND notice-type IN (cn-standard cn-social cn-desg)`,
    fields: [...CHAMPS_TED],
    limit,
    page,
    scope: "ACTIVE",
  };
}

export type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface OptionsCollecte {
  timeoutMs?: number;
  pagesMax?: number;
  parPage?: number;
}

const ENTETES = { Accept: "application/json", "User-Agent": "Naya veille appels d'offres (hellonaya.app)" };

async function lireJson(fetch: Fetch, url: string, init: any, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(minuteur);
  }
}

export async function collecterBoamp(fetch: Fetch, f: FenetreVeille, o: OptionsCollecte = {}): Promise<AvisCollecte[]> {
  const parPage = o.parPage ?? 100, pagesMax = o.pagesMax ?? 3, timeoutMs = o.timeoutMs ?? 20_000;
  const avis: AvisCollecte[] = [];
  for (let page = 0; page < pagesMax; page++) {
    const d = await lireJson(fetch, urlBoamp(f, page * parPage, parPage), { headers: ENTETES }, timeoutMs);
    const res: unknown[] = Array.isArray(d?.results) ? d.results : [];
    for (const r of res) { const a = mapperBoamp(r as any); if (a) avis.push(a); }
    if (res.length < parPage || (page + 1) * parPage >= (Number(d?.total_count) || 0)) break;
  }
  return avis;
}

export async function collecterTed(fetch: Fetch, f: FenetreVeille, o: OptionsCollecte = {}): Promise<AvisCollecte[]> {
  const parPage = o.parPage ?? 100, pagesMax = o.pagesMax ?? 2, timeoutMs = o.timeoutMs ?? 20_000;
  const avis: AvisCollecte[] = [];
  for (let page = 1; page <= pagesMax; page++) {
    const d = await lireJson(fetch, TED_URL, {
      method: "POST",
      headers: { ...ENTETES, "Content-Type": "application/json" },
      body: JSON.stringify(corpsTed(f, page, parPage)),
    }, timeoutMs);
    const res: unknown[] = Array.isArray(d?.notices) ? d.notices : [];
    for (const n of res) { const a = mapperTed(n as any); if (a) avis.push(a); }
    if (res.length < parPage || page * parPage >= (Number(d?.totalNoticeCount) || 0)) break;
  }
  return avis;
}
