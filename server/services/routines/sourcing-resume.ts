/** Résumé lisible d'un passage de sourcing, et détection d'une panne de recherche. PURS. */
export type EtatEnrichissement = "ok" | "plan" | "limite" | "erreur";

const pl = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export function resumeSourcing(r: { importes: number; prepares: number; enrichissement: EtatEnrichissement }): string {
  if (r.importes === 0 && r.prepares === 0) return "Aucun nouveau prospect trouvé aujourd'hui.";
  const ajoutes = pl(r.importes, "prospect ajouté", "prospects ajoutés");
  switch (r.enrichissement) {
    case "plan": return `${ajoutes}. Préparation des messages non incluse dans ton offre.`;
    case "limite": return `${ajoutes}. Préparation en pause : limite LinkedIn de la semaine atteinte.`;
    case "erreur": return `${ajoutes}. La préparation des messages a échoué, elle sera retentée demain.`;
    default: return r.prepares > 0 ? `${ajoutes}, ${pl(r.prepares, "préparé", "préparés")} à valider.` : `${ajoutes}.`;
  }
}

/** Toutes les recherches du passage ont échoué : clé, zone ou service Bright Data en cause. */
export function rechercheEnPanne(appels: number, erreurs: number): boolean {
  return appels > 0 && erreurs >= appels;
}
