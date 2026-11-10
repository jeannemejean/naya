// Veille AO : ce qui est déjà connu ne repasse pas par l'IA.
// Trois façons d'être déjà là : même (source, id) ; ligne importée de Notion dont la référence
// ou le lien porte le même numéro BOAMP / TED ; avis repris d'une source à l'autre (même objet
// avec même acheteur ou date limite proche, ou même acheteur avec la même date limite).
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
  const a = cleAcheteur(acheteur);
  if (!a || !dateLimite) return null;
  const d = new Date(dateLimite);
  if (Number.isNaN(d.getTime())) return null;
  return `${a}|${d.toISOString()}`;
}

/** Acheteur réduit à ses lettres et chiffres ; null s'il est trop court pour être distinctif. */
export function cleAcheteur(acheteur: string | null | undefined): string | null {
  if (!acheteur) return null;
  const a = acheteur.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return a.length >= 3 ? a : null;
}

const UN_JOUR_MS = 86_400_000;
const instant = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

export interface Classement {
  /** À qualifier puis insérer. */
  nouveaux: AvisCollecte[];
  /** Déjà en base : rafraîchir les faits de cette ligne (jamais statut ni notes). `source` : celle de la ligne. */
  aRafraichir: Array<{ id: number; source: string; avis: AvisCollecte }>;
  /** Même avis vu par une autre source : ignoré. */
  doublons: AvisCollecte[];
}

interface Trace { source: string; acheteur: string | null; limite: number | null }

/**
 * Le même avis repris par une autre source. Un intitulé identique ne suffit pas (deux acheteurs
 * publient souvent « Marché de communication ») : il faut une AUTRE source ET le même acheteur
 * ou une date limite à moins d'un jour. Même acheteur + même date limite à la minute, d'une autre
 * source, suffit aussi (intitulés différents au BOAMP et au JOUE).
 */
function estReprise(a: AvisCollecte, traces: Trace[]): boolean {
  const ach = cleAcheteur(a.acheteur);
  const lim = instant(a.dateLimite);
  return traces.some((t) => t.source !== a.source && (
    (!!ach && t.acheteur === ach) || (lim !== null && t.limite !== null && Math.abs(lim - t.limite) <= UN_JOUR_MS)
  ));
}

export function classer(avis: AvisCollecte[], existants: Existant[], maintenant: Date = new Date()): Classement {
  const parSource = new Map<string, Existant>();
  const notionBoamp = new Map<string, Existant>();
  const notionTed = new Map<string, Existant>();
  const parObjet = new Map<string, Trace[]>();
  const acheteursDates = new Map<string, string>(); // clé acheteur|date → source
  const ajouter = (k: string | null, t: Trace) => { if (k) parObjet.set(k, [...(parObjet.get(k) ?? []), t]); };
  for (const e of existants) {
    if (e.sourceId) parSource.set(`${e.source}:${e.sourceId}`, e);
    if (e.source === "notion_import") {
      for (const n of numerosBoamp(e.reference, e.lienAvis)) if (!notionBoamp.has(n)) notionBoamp.set(n, e);
      for (const n of numerosTed(e.reference, e.lienAvis)) if (!notionTed.has(n)) notionTed.set(n, e);
    }
    // Une ligne dont la date limite est passée ne fait plus doublon avec rien.
    const lim = instant(e.dateLimite);
    if (lim !== null && lim < maintenant.getTime()) continue;
    const kd = cleAcheteurDate(e.acheteur, e.dateLimite);
    if (kd) acheteursDates.set(kd, e.source);
    ajouter(cleObjet(e.objet), { source: e.source, acheteur: cleAcheteur(e.acheteur), limite: lim });
  }
  const r: Classement = { nouveaux: [], aRafraichir: [], doublons: [] };
  const vus = new Set<string>();
  for (const a of avis) {
    const cle = `${a.source}:${a.sourceId}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const meme = parSource.get(cle) ?? (a.source === "boamp" ? notionBoamp.get(a.sourceId) : notionTed.get(a.sourceId));
    if (meme) { r.aRafraichir.push({ id: meme.id, source: meme.source, avis: a }); continue; }
    const k = cleObjet(a.objet);
    const kd = cleAcheteurDate(a.acheteur, a.dateLimite);
    const autreSource = kd ? acheteursDates.get(kd) : undefined;
    if ((k && estReprise(a, parObjet.get(k) ?? [])) || (autreSource && autreSource !== a.source)) { r.doublons.push(a); continue; }
    ajouter(k, { source: a.source, acheteur: cleAcheteur(a.acheteur), limite: instant(a.dateLimite) });
    if (kd && !acheteursDates.has(kd)) acheteursDates.set(kd, a.source);
    r.nouveaux.push(a);
  }
  return r;
}
