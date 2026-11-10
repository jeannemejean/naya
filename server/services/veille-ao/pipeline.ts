// Veille AO : un passage complet pour une utilisatrice.
// Collecte (BOAMP puis TED) → délais → dédoublonnage → rafraîchissement des lignes connues →
// qualification IA des seuls nouveaux (plafonnée) → insertion. Une source qui échoue n'arrête
// pas l'autre ; une qualification qui échoue n'est pas insérée (elle sera retentée au passage
// suivant, la fenêtre couvrant plusieurs jours).
import type { FaitsVeille, LigneVeilleAO } from "../appels-offres-store";
import { joursAvant, estPasse } from "@shared/appels-offres";
import { collecterBoamp, collecterTed, type Fetch, type FenetreVeille } from "./sources";
import { classer, type Existant } from "./dedupe";
import { DELAI_MIN_JOURS, jourParis, ligneQualifiee, type Qualification } from "./qualification";
import type { AvisCollecte, SourceVeilleAO } from "./mapping";
import { passagesEnCours } from "./etat";

/** Champs factuels qu'un nouveau passage peut rafraîchir sur une ligne existante. */
export type FaitsVeilleAO = FaitsVeille;

export interface DepsVeilleAO {
  fetch: Fetch;
  existants(userId: string): Promise<Existant[]>;
  inserer(userId: string, lignes: LigneVeilleAO[]): Promise<unknown>;
  /** `seulementVides` : ne remplit que les champs vides (lignes importées de Notion). */
  rafraichir(userId: string, id: number, faits: FaitsVeilleAO, opts?: { seulementVides?: boolean }): Promise<unknown>;
  /** Extrait compact du contexte réel de l'utilisatrice (offres, positionnement). */
  contexte(userId: string): Promise<string>;
  qualifier(userId: string, avis: AvisCollecte, contexte: string): Promise<{ valeur: Qualification; coutEur: number }>;
  estBloquee(userId: string): Promise<boolean>;
}

export interface OptionsVeilleAO {
  maintenant?: Date;
  /** Jours de publication relus à chaque passage (rattrape un passage manqué). */
  joursFenetre?: number;
  plafondIA?: number;
  concurrence?: number;
  sources?: SourceVeilleAO[];
}

export interface BilanVeilleAO {
  examines: number;
  nouveaux: number;
  rafraichis: number;
  doublons: number;
  horsDelai: number;
  echecsQualification: number;
  reportesPlafond: number;
  /** Avis dont la qualification a déjà échoué ECHECS_MAX fois : plus retentés (pas refacturés). */
  abandonnes: number;
  iaBloquee: boolean;
  coutEur: number;
  erreursSources: string[];
  /** Les avis insérés (pour le journal et le rapport). */
  inseres: Array<{ sourceId: string; source: string; objet: string; score: string }>;
}

export const PLAFOND_IA = 40;
export const ECHECS_MAX = 2;

// Échecs de qualification par avis (« source:id » → nombre), en mémoire du processus : un avis
// que le modèle ne sait pas qualifier n'est pas refacturé à chaque passage. Un redémarrage
// lui redonne sa chance.
const echecs = new Map<string, number>();
export function _reinitialiserEchecs(): void { echecs.clear(); }

/** Faits non vides seulement : un passage ne blanchit jamais une valeur déjà connue. */
export function faitsDe(a: AvisCollecte): FaitsVeilleAO {
  const f: FaitsVeilleAO = {};
  if (a.dateLimite) f.dateLimite = a.dateLimite;
  if (a.procedure) f.procedure = a.procedure;
  if (a.departement) f.departement = a.departement;
  if (a.montantEstimeHt) f.montantEstimeHt = a.montantEstimeHt;
  if (a.lienDce) f.lienDce = a.lienDce;
  return f;
}

async function parLots<T>(elements: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const ouvrier = async () => { while (i < elements.length) { const x = elements[i++]; await f(x); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, elements.length)) }, ouvrier));
}

export function fenetre(maintenant: Date, jours: number): FenetreVeille {
  return { depuis: jourParis(new Date(maintenant.getTime() - jours * 86_400_000)), aujourdhui: jourParis(maintenant) };
}

export async function passageVeilleAO(userId: string, deps: DepsVeilleAO, o: OptionsVeilleAO = {}): Promise<BilanVeilleAO> {
  const maintenant = o.maintenant ?? new Date();
  const plafond = o.plafondIA ?? PLAFOND_IA;
  const sources = o.sources ?? ["boamp", "ted"];
  const f = fenetre(maintenant, o.joursFenetre ?? 3);
  const bilan: BilanVeilleAO = {
    examines: 0, nouveaux: 0, rafraichis: 0, doublons: 0, horsDelai: 0, echecsQualification: 0,
    reportesPlafond: 0, abandonnes: 0, iaBloquee: false, coutEur: 0, erreursSources: [], inseres: [],
  };

  // BOAMP d'abord : un avis repris sur TED est alors reconnu comme doublon (même objet).
  const collectes: AvisCollecte[] = [];
  for (const s of sources) {
    try {
      collectes.push(...(s === "boamp" ? await collecterBoamp(deps.fetch, f) : await collecterTed(deps.fetch, f)));
    } catch (e: any) {
      bilan.erreursSources.push(`${s}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  bilan.examines = collectes.length;

  // Délais (consignes) : passé ou moins de 6 jours, écarté sans appel IA ; sans date, gardé.
  const jouables = collectes.filter((a) => {
    const j = joursAvant(a.dateLimite, maintenant);
    const ok = !estPasse(a.dateLimite, maintenant) && (j == null || j >= DELAI_MIN_JOURS);
    if (!ok) bilan.horsDelai++;
    return ok;
  });

  const { nouveaux, aRafraichir, doublons } = classer(jouables, await deps.existants(userId), maintenant);
  bilan.doublons = doublons.length;

  for (const { id, source, avis } of aRafraichir) {
    const faits = faitsDe(avis);
    if (Object.keys(faits).length === 0) continue;
    // Ligne importée de Notion : ce que Jeanne y a vérifié prime, on ne fait que compléter.
    try { await deps.rafraichir(userId, id, faits, { seulementVides: source === "notion_import" }); bilan.rafraichis++; } catch (e: any) {
      console.error(`[veille-ao] rafraîchissement ${avis.sourceId} :`, e?.message ?? e);
    }
  }

  const cleAvis = (a: AvisCollecte) => `${a.source}:${a.sourceId}`;
  const aQualifier = nouveaux.filter((a) => (echecs.get(cleAvis(a)) ?? 0) < ECHECS_MAX);
  bilan.abandonnes = nouveaux.length - aQualifier.length;
  if (aQualifier.length === 0) return bilan;
  if (await deps.estBloquee(userId)) {
    bilan.iaBloquee = true;
    bilan.reportesPlafond = aQualifier.length;
    return bilan;
  }

  // Les plus proches de leur date limite d'abord ; au-delà du plafond, au passage suivant.
  const temps = (a: AvisCollecte) => a.dateLimite?.getTime() ?? Number.POSITIVE_INFINITY;
  const ordonnes = [...aQualifier].sort((a, b) => temps(a) - temps(b));
  const choisis = ordonnes.slice(0, plafond);
  bilan.reportesPlafond = ordonnes.length - choisis.length;

  // Lu une fois par passage ; sans lui la qualification tourne quand même (profil du prompt).
  const contexte = await deps.contexte(userId).catch((e: any) => {
    console.error("[veille-ao] contexte :", e?.message ?? e);
    return "";
  });

  await parLots(choisis, o.concurrence ?? 4, async (avis) => {
    let ligne: LigneVeilleAO;
    // Le budget peut être atteint en cours de passage : revérifié avant chaque appel.
    if (bilan.iaBloquee || await deps.estBloquee(userId).catch(() => true)) {
      bilan.iaBloquee = true;
      bilan.reportesPlafond++;
      return;
    }
    try {
      const { valeur, coutEur } = await deps.qualifier(userId, avis, contexte);
      bilan.coutEur += coutEur;
      ligne = ligneQualifiee(avis, valeur, maintenant) as LigneVeilleAO;
    } catch (e: any) {
      bilan.echecsQualification++;
      echecs.set(cleAvis(avis), (echecs.get(cleAvis(avis)) ?? 0) + 1);
      console.error(`[veille-ao] qualification ${avis.source} ${avis.sourceId} :`, String(e?.message ?? e).slice(0, 200));
      return;
    }
    try {
      await deps.inserer(userId, [ligne]);
      bilan.nouveaux++;
      bilan.inseres.push({ sourceId: avis.sourceId, source: avis.source, objet: avis.objet, score: String(ligne.scoreAdequation) });
    } catch (e: any) {
      console.error(`[veille-ao] insertion ${avis.sourceId} :`, e?.message ?? e);
    }
  });
  return bilan;
}

// ─── Un seul passage à la fois par utilisatrice ──────────────────────────────

const enCours = passagesEnCours;

/** null si un passage est déjà en cours pour elle ; sinon le bilan. Ne lève jamais. */
export async function lancerVeilleAO(userId: string, deps: DepsVeilleAO, o: OptionsVeilleAO = {}): Promise<BilanVeilleAO | null> {
  if (enCours.has(userId)) return null;
  enCours.add(userId);
  try {
    return await passageVeilleAO(userId, deps, o);
  } catch (e: any) {
    console.error(`[veille-ao] passage ${userId} :`, e?.message ?? e);
    return {
      examines: 0, nouveaux: 0, rafraichis: 0, doublons: 0, horsDelai: 0, echecsQualification: 0, reportesPlafond: 0, abandonnes: 0,
      iaBloquee: false, coutEur: 0, erreursSources: [`passage: ${String(e?.message ?? e).slice(0, 120)}`], inseres: [],
    };
  } finally {
    enCours.delete(userId);
  }
}
