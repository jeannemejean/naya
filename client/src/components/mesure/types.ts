// Types de la page « Mesure » (miroir de GET /api/mesure/:projectId).
import type { RoutineDTO } from "@/components/routines/RoutineCard";

export type Indicateur = "ca" | "nouveaux_clients" | "depense_totale" | "mer" | "cac" | "panier_moyen" | "part_ca_nouveaux" | "marge_contributive";
export type Evolution = { precedent: number | null; moyenne3: number | null };
export type Mois = {
  mois: string; ca: number | null; caNouveaux: number | null; nouveauxClients: number | null; commandes: number | null;
  coutsVariables: number | null; depenses: Record<string, number>; source: string; bilan: string | null; bilanLe: string | null;
  indicateurs: Record<Indicateur | "depense_acquisition", number | null>;
  evolutions: Record<Indicateur, Evolution>;
};
export type DonneesMesure = {
  mois: Mois[];
  catalogues: { canaux: Array<{ cle: string; acquisition: boolean }>; indicateurs: Indicateur[] };
  routine: RoutineDTO | null;
};

/** Comment afficher chaque indicateur. */
export const GENRE: Record<Indicateur, "euros" | "nombre" | "ratio" | "pourcent"> = {
  ca: "euros", nouveaux_clients: "nombre", depense_totale: "euros", mer: "ratio", cac: "euros",
  panier_moyen: "euros", part_ca_nouveaux: "pourcent", marge_contributive: "euros",
};
/** Pour le CAC et la dépense, une baisse est une bonne nouvelle. */
export const BAISSE_FAVORABLE: Partial<Record<Indicateur, true>> = { cac: true, depense_totale: true };

export function formater(v: number | null | undefined, genre: (typeof GENRE)[Indicateur], langue: string): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (genre === "euros") return new Intl.NumberFormat(langue, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  if (genre === "ratio") return new Intl.NumberFormat(langue, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
  if (genre === "pourcent") return new Intl.NumberFormat(langue, { style: "percent", maximumFractionDigits: 0 }).format(v);
  return new Intl.NumberFormat(langue, { maximumFractionDigits: 0 }).format(v);
}

export function formaterEcart(x: number | null, langue: string): string | null {
  if (x === null || !Number.isFinite(x)) return null;
  return new Intl.NumberFormat(langue, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(x);
}

export function libelleMois(mois: string, langue: string): string {
  const [a, m] = mois.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString(langue, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function corpsErreur(e: unknown): { message?: string } {
  const m = e instanceof Error ? e.message : String(e ?? "");
  try { return JSON.parse(m.replace(/^\d{3}:\s*/, "")); } catch { return {}; }
}
