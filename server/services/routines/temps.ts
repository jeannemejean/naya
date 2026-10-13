/** Calcul du prochain passage d'une routine. PUR (l'heure entre par la signature). */
export type Cadence = "quotidienne" | "hebdomadaire" | "mensuelle";

/** Jour du mois des routines mensuelles : le 2, pour que le mois précédent soit clos. */
export const JOUR_MENSUEL = 2;

export function prochainPassageApres(cadence: Cadence | string, heureUtc: number, maintenant: Date): Date {
  const h = Math.min(23, Math.max(0, Math.round(Number.isFinite(heureUtc) ? heureUtc : 5)));
  if (cadence === "mensuelle") {
    const ce = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), JOUR_MENSUEL, h, 0, 0, 0));
    if (ce.getTime() > maintenant.getTime()) return ce;
    return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, JOUR_MENSUEL, h, 0, 0, 0));
  }
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate(), h, 0, 0, 0));
  if (cadence === "hebdomadaire") {
    // Une semaine après le passage courant, à l'heure dite.
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (d.getTime() <= maintenant.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
