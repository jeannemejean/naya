// Veille AO : ce qui est déjà connu ne repasse pas par l'IA.
// Trois façons d'être déjà là : même (source, id) ; ligne importée de Notion dont la référence
// ou le lien porte le même numéro BOAMP / TED ; avis repris d'une source à l'autre (même objet,
// ou même acheteur avec la même date limite à la minute près).
import type { AvisCollecte } from "./mapping";

export interface Existant {
  id: number;
  source: string;
  sourceId: string | null;
  reference: string | null;
  lienAvis: string | null;
  objet: string;
  acheteur?: string | null;
  dateLimite?: Date | string | null;
}

/** Numéros BOAMP (« 26-96260 ») cités dans une référence Notion ou un lien France Marchés. */
export function numerosBoamp(...textes: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const t of textes) {
    if (!t) continue;
    // « BOAMP 26-91021, rectificatif 26-101261 » : tous les numéros d'une référence BOAMP.
    if (/boamp/i.test(t) && !/^https?:/i.test(t)) for (const m of t.matchAll(/(?<![\d-])(\d{2})-(\d{4,6})(?![\d-])/g)) out.add(`${m[1]}-${m[2]}`);
    // France Marchés : …/appel-offre/3boamp2696260-2026-… → 26-96260.
    for (const m of t.matchAll(/boamp(\d{2})(\d{4,6})(?!\d)/gi)) out.add(`${m[1]}-${m[2]}`);
  }
  return Array.from(out);
}

/** Numéros TED / JOUE (« 684030-2026 »). */
export function numerosTed(...textes: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const t of textes) {
    if (!t) continue;
    for (const m of t.matchAll(/(?:TED|JOUE)\s*(?:n°\s*)?(\d{5,8})-(\d{4})(?!\d)/gi)) out.add(`${Number(m[1])}-${m[2]}`);
    // France Marchés : …/13joue006635422026-… → 663542-2026.
    for (const m of t.matchAll(/joue(\d{8})(\d{4})(?!\d)/gi)) out.add(`${Number(m[1])}-${m[2]}`);
  }
  return Array.from(out);
}

const OBJET_MIN = 25;

/** Objet normalisé (sans accents ni ponctuation) ; null s'il est trop court pour être distinctif. */
export function cleObjet(objet: string | null | undefined): string | null {
  if (!objet) return null;
  const k = objet.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  return k.length >= OBJET_MIN ? k : null;
}

/**
 * Acheteur (lettres et chiffres seuls : « C N S A » = « CNSA ») + date limite exacte. Sert à
 * reconnaître le même avis publié au BOAMP et au JOUE sous deux intitulés différents.
 */
export function cleAcheteurDate(acheteur: string | null | undefined, dateLimite: Date | string | null | undefined): string | null {
  if (!acheteur || !dateLimite) return null;
  const a = acheteur.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const d = new Date(dateLimite);
  if (a.length < 3 || Number.isNaN(d.getTime())) return null;
  return `${a}|${d.toISOString()}`;
}

export interface Classement {
  /** À qualifier puis insérer. */
  nouveaux: AvisCollecte[];
  /** Déjà en base : rafraîchir les faits de cette ligne (jamais statut ni notes). */
  aRafraichir: Array<{ id: number; avis: AvisCollecte }>;
  /** Même avis vu par une autre source (même objet, ou même acheteur et même date limite) : ignoré. */
  doublons: AvisCollecte[];
}

export function classer(avis: AvisCollecte[], existants: Existant[]): Classement {
  const parSource = new Map<string, Existant>();
  const notionBoamp = new Map<string, Existant>();
  const notionTed = new Map<string, Existant>();
  const objets = new Set<string>();
  const acheteursDates = new Map<string, string>(); // clé → source
  for (const e of existants) {
    const kd = cleAcheteurDate(e.acheteur, e.dateLimite);
    if (kd) acheteursDates.set(kd, e.source);
    if (e.sourceId) parSource.set(`${e.source}:${e.sourceId}`, e);
    if (e.source === "notion_import") {
      for (const n of numerosBoamp(e.reference, e.lienAvis)) if (!notionBoamp.has(n)) notionBoamp.set(n, e);
      for (const n of numerosTed(e.reference, e.lienAvis)) if (!notionTed.has(n)) notionTed.set(n, e);
    }
    const k = cleObjet(e.objet);
    if (k) objets.add(k);
  }
  const r: Classement = { nouveaux: [], aRafraichir: [], doublons: [] };
  const vus = new Set<string>();
  for (const a of avis) {
    const cle = `${a.source}:${a.sourceId}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const meme = parSource.get(cle) ?? (a.source === "boamp" ? notionBoamp.get(a.sourceId) : notionTed.get(a.sourceId));
    if (meme) { r.aRafraichir.push({ id: meme.id, avis: a }); continue; }
    const k = cleObjet(a.objet);
    const kd = cleAcheteurDate(a.acheteur, a.dateLimite);
    // Même acheteur, même date limite : doublon seulement s'il vient d'une AUTRE source (deux
    // avis distincts d'un même acheteur au BOAMP peuvent partager une date limite).
    const autreSource = kd ? acheteursDates.get(kd) : undefined;
    if ((k && objets.has(k)) || (autreSource && autreSource !== a.source)) { r.doublons.push(a); continue; }
    if (k) objets.add(k);
    if (kd && !acheteursDates.has(kd)) acheteursDates.set(kd, a.source);
    r.nouveaux.push(a);
  }
  return r;
}
