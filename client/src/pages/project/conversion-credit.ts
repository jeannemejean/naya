// Fil 3 / LOT 3B — mise en forme de la restitution d'une conversion.
//
// Le §5.3 du brief interdit explicitement « ce post a converti X » : la restitution est
// TOUJOURS une part de fenêtre (un `creditWeight` fractionnaire, somme à 1 par conversion),
// jamais un compte entier. Ce fichier ne fait que deux choses pures : arrondir un poids en
// pourcentage lisible, et ordonner les lignes à afficher SANS jamais trier par poids — un tri
// par poids décroissant serait un classement (« ce contenu a le mieux performé »), exactement
// ce que la doctrine « pas de scoreboard » (héritée de la restitution Réception de LOT 3A)
// interdit. L'ordre retenu est neutre : par identifiant de contenu croissant.

export interface ConversionCreditInput {
  contentId: number;
  creditWeight: number;
  /**
   * Titre du contenu crédité, résolu CÔTÉ SERVEUR (voir
   * server/services/attribution/credits-view.ts). `null` = contenu réellement introuvable,
   * et c'est le seul cas où le repli « supprimé depuis » dit la vérité. Cet écran lisait
   * auparavant les titres dans `/api/content`, plafonné aux 50 contenus les plus récents :
   * tout contenu crédité au-delà s'affichait comme supprimé alors qu'il était vivant.
   */
  contentTitle?: string | null;
}

export interface ConversionCreditRow {
  contentId: number;
  title: string;
  sharePercent: number;
}

/** Un poids fractionnaire (0..1) en pourcentage entier lisible. Pas d'arrondi "plus grand
 * reste" pour forcer une somme à 100 % : ce serait de la précision fabriquée sur un nombre
 * qui n'a cette vocation nulle part ailleurs dans l'app (même logique que le score de
 * réception, cf. contentCalendar.reception.scoreLine). */
export function formatCreditSharePercent(creditWeight: number): number {
  return Math.round(creditWeight * 100);
}

/** Construit les lignes de restitution : titre du contenu (ou repli si le contenu a depuis
 * été supprimé) + part du crédit, triées par contentId croissant — jamais par poids. */
export function buildConversionCreditRows(
  attributions: ConversionCreditInput[],
  fallbackTitle: string,
): ConversionCreditRow[] {
  return [...attributions]
    .sort((a, b) => a.contentId - b.contentId)
    .map((a) => ({
      contentId: a.contentId,
      // Le repli n'est utilisé que si le SERVEUR n'a pas trouvé le contenu : à ce
      // moment-là seulement, « supprimé depuis » est vrai.
      title: a.contentTitle ?? fallbackTitle,
      sharePercent: formatCreditSharePercent(a.creditWeight),
    }));
}
