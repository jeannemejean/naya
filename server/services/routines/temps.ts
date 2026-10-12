/** Calcul du prochain passage d'une routine. PUR (l'heure entre par la signature). */
export type Cadence = "quotidienne" | "hebdomadaire";

export function prochainPassageApres(cadence: Cadence | string, heureUtc: number, maintenant: Date): Date {
  const h = Math.min(23, Math.max(0, Math.round(Number.isFinite(heureUtc) ? heureUtc : 5)));
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate(), h, 0, 0, 0));
  if (cadence === "hebdomadaire") {
    // Une semaine après le passage courant, à l'heure dite.
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (d.getTime() <= maintenant.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
