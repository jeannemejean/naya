// Atelier de contenu — navigation pure (semaine dans l'URL, post suivant à valider).
import { lundiDe, type EtatPost } from "@shared/atelier";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** La semaine demandée par `?semaine=` (ramenée à son lundi), sinon la semaine en cours. */
export function semaineDepuisRecherche(search: string, aujourdhui: string): string {
  const v = new URLSearchParams(search).get("semaine") ?? "";
  return JOUR.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)) ? lundiDe(v) : lundiDe(aujourdhui);
}

/** Aujourd'hui à Paris (YYYY-MM-DD). */
export function aujourdhuiParis(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const aValider = (p: { etat: EtatPost }) => p.etat === "a_rediger" || p.etat === "brouillon";

/** Le prochain post à valider après `id` (en reprenant au début), ou null s'il n'y en a plus. */
export function postSuivant<P extends { id: number; etat: EtatPost }>(posts: P[], id: number): number | null {
  const i = posts.findIndex((x) => x.id === id);
  const ordre = [...posts.slice(i + 1), ...posts.slice(0, Math.max(i, 0))];
  return ordre.find(aValider)?.id ?? null;
}

export function progression(posts: Array<{ etat: EtatPost }>): { faits: number; total: number } {
  return { faits: posts.filter((x) => x.etat === "valide" || x.etat === "publie").length, total: posts.length };
}
