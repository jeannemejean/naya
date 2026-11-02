// Lignes « réponses de prospects » du contexte du point du jour (fonction pure, sans base).

export type ComptesDeconnectes = Record<string, string> | null | undefined;

/**
 * Lignes ajoutées au contexte du brief : réponses qui attendent, puis un avertissement par canal
 * dont un compte a été retiré (périmètre de l'utilisatrice ou d'un projet client).
 */
export function lignesReponsesBrief(aTraiter: number, perimetres: ComptesDeconnectes[]): string[] {
  const lignes: string[] = [];
  if (aTraiter > 0) {
    lignes.push(`- ${aTraiter} réponse${aTraiter > 1 ? "s" : ""} de prospects attend${aTraiter > 1 ? "ent" : ""}`);
  }
  const canaux = new Set<string>();
  for (const p of perimetres) {
    if (p && typeof p === "object") for (const [canal, date] of Object.entries(p)) if (date) canaux.add(canal);
  }
  for (const [canal, nom] of [["email", "Gmail"], ["linkedin", "LinkedIn"]] as const) {
    if (canaux.has(canal)) lignes.push(`- Ton ${nom} est déconnecté de Naya : les envois sur ce canal sont en pause`);
  }
  return lignes;
}
