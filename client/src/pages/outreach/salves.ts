import { estPretAPartir, type ProspectValidable } from './validation-messages';
import { estLeadTest } from './mode-test';

/** Valeurs proposées à l'ouverture d'une salve. */
export const SALVE_NOMBRE_DEFAUT = 20;
export const SALVE_PAR_JOUR_DEFAUT = 5;
/** Plafond du serveur (`SALVE_PAR_JOUR_MAX`, server/services/prospection-salves.ts). */
export const SALVE_PAR_JOUR_MAX = 30;

/** Une saisie libre ramenée entre 0 et `max` : vide ou illisible vaut 0, le bouton se désactive. */
export function nombreBorne(saisie: string, max: number): number {
  const n = Math.floor(Number(saisie));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
}

export function joursNecessaires(nombre: number, parJour: number): number {
  return parJour > 0 ? Math.ceil(nombre / parJour) : 0;
}

export function dateCourte(iso: string, langue: string): string {
  return new Date(iso).toLocaleDateString(langue, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Plafond du serveur (`SALVE_NOMBRE_MAX`, server/services/prospection-salves.ts). */
export const SALVE_NOMBRE_MAX = 100;

/** Ce qu'une salve peut prendre : validés, jamais entrés en séquence, hors prospects test. */
export function compterPrets(
  prospects: (Pick<ProspectValidable, 'id' | 'stage' | 'validatedAt' | 'archivedAt'> & { tags?: string[] | null })[],
  dejaEnSequence: { has: (id: number) => boolean },
): number {
  return prospects.filter((l) => estPretAPartir(l) && !estLeadTest(l) && !dejaEnSequence.has(l.id)).length;
}

/** « Lancer en salve » : la salve proposée prend tous les prêts, dans la limite du serveur. */
export function nombrePrerempli(prets: number): number {
  return Math.max(0, Math.min(Math.floor(prets), SALVE_NOMBRE_MAX));
}

export type RaisonSalveImpossible = 'sansSequence' | 'aucunPret' | null;

/** Le bouton « Lancer en salve » est grisé, avec sa raison, quand rien ne peut partir. */
export function raisonSalveImpossible(e: { hasSequence: boolean; prets: number }): RaisonSalveImpossible {
  if (!e.hasSequence) return 'sansSequence';
  if (e.prets <= 0) return 'aucunPret';
  return null;
}
