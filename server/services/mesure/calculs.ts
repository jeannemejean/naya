/**
 * Indicateurs du registre mensuel. PUR. Une donnée absente ou une division par zéro donne
 * null : jamais un 0 inventé, jamais Infinity.
 */
import { CLES_CANAUX, CANAUX_ACQUISITION, type Indicateur } from "./catalogues";

export type LigneMesure = {
  mois: string; ca?: number | null; caNouveaux?: number | null; nouveauxClients?: number | null;
  commandes?: number | null; coutsVariables?: number | null; depenses?: unknown;
};
export type Indicateurs = Record<Indicateur | "depense_acquisition", number | null>;

const nb = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);

export function indicateurs(l: LigneMesure): Indicateurs {
  const dep = (l.depenses && typeof l.depenses === "object" ? l.depenses : {}) as Record<string, unknown>;
  let total: number | null = null;
  let acquisition: number | null = null;
  for (const cle of CLES_CANAUX) {
    const v = nb(dep[cle]);
    if (v === null || v < 0) continue;
    total = (total ?? 0) + v;
    if (CANAUX_ACQUISITION.has(cle)) acquisition = (acquisition ?? 0) + v;
  }
  const ca = nb(l.ca);
  const nouveaux = nb(l.nouveauxClients);
  const couts = nb(l.coutsVariables);
  return {
    ca, nouveaux_clients: nouveaux, depense_totale: total, depense_acquisition: acquisition,
    mer: div(ca, total),
    cac: div(acquisition, nouveaux),
    panier_moyen: div(ca, nb(l.commandes)),
    part_ca_nouveaux: div(nb(l.caNouveaux), ca),
    marge_contributive: ca === null || couts === null || total === null ? null : ca - couts - total,
  };
}

export function moisPrecedent(mois: string, n = 1): string {
  const [a, m] = mois.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function libelleMois(mois: string, langue = "fr-FR"): string {
  const [a, m] = mois.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString(langue, { month: "long", year: "numeric", timeZone: "UTC" });
}

export type Evolution = { precedent: number | null; moyenne3: number | null };

/** Écart relatif avec le mois calendaire précédent et avec la moyenne des 3 mois précédents disponibles. */
export function evolutions(serie: Array<{ mois: string; valeur: number | null }>, mois: string): Evolution {
  const val = new Map(serie.map((s) => [s.mois, s.valeur]));
  const cur = val.get(mois) ?? null;
  if (cur === null) return { precedent: null, moyenne3: null };
  const prec = val.get(moisPrecedent(mois)) ?? null;
  const base = [1, 2, 3].map((n) => val.get(moisPrecedent(mois, n)) ?? null).filter((x): x is number => x !== null);
  const moy = base.length ? base.reduce((a, b) => a + b, 0) / base.length : null;
  // Écart rapporté à la valeur absolue : de −1000 à +500, c'est +150 %, pas −150 %.
  const ecart = (b: number | null) => (b === null || b === 0 ? null : (cur - b) / Math.abs(b));
  return { precedent: ecart(prec), moyenne3: ecart(moy) };
}

/** Série chronologique d'un indicateur (pour les KPI reliés des Fondations). */
export function serieIndicateur(lignes: LigneMesure[], ind: Indicateur): Array<{ date: string; valeur: number }> {
  return [...lignes].sort((a, b) => a.mois.localeCompare(b.mois))
    .map((l) => ({ date: `${l.mois}-01T00:00:00.000Z`, valeur: indicateurs(l)[ind] }))
    .filter((x): x is { date: string; valeur: number } => x.valeur !== null);
}

/** Mêmes chiffres saisis (ordre des canaux indifférent) : rien à réécrire, rien à refaire. */
export function memesChiffres(a: Partial<LigneMesure> | undefined, b: Partial<LigneMesure>): boolean {
  if (!a) return false;
  const norme = (l: Partial<LigneMesure>) => JSON.stringify([
    l.ca ?? null, l.caNouveaux ?? null, l.nouveauxClients ?? null, l.commandes ?? null, l.coutsVariables ?? null,
    Object.entries((l.depenses as Record<string, number>) || {}).sort(([x], [y]) => x.localeCompare(y)),
  ]);
  return norme(a) === norme(b);
}
