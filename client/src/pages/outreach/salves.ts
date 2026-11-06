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
