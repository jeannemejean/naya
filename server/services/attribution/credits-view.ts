/**
 * L'assemblage de la restitution d'une conversion : ses crédits, chacun portant le TITRE du
 * contenu crédité. PUR — aucune base — donc testable isolément (voir credits-view.test.ts) ;
 * `storage.getBrandConversionsWithCredits` ne fait plus que lire les trois jeux de lignes et
 * les lui passer.
 *
 * Pourquoi le titre est résolu ICI, côté serveur (finding I3 de la revue finale) : l'écran
 * le lisait dans `/api/content?projectId=…`, une route que le serveur PLAFONNE aux 50
 * contenus les plus récents par `createdAt`. Tout contenu crédité au-delà de ce plafond
 * s'affichait alors « Contenu supprimé depuis » — une affirmation FAUSSE sur un contenu bien
 * vivant, atteignable en usage ordinaire avec la fenêtre de 60 jours de l'agence. Relever la
 * limite côté client n'aurait fait que déplacer la falaise ; ici les ids crédités sont tous
 * connus, la recherche est donc BORNÉE par construction.
 *
 * Le repli « supprimé depuis » n'est pas supprimé pour autant : un `contentTitle` à `null`
 * veut dire que le contenu est RÉELLEMENT introuvable, et c'est alors la vérité.
 */

export interface CreditRow {
  conversionId: number;
  contentId: number;
}

export type WithContentTitle<A> = A & { contentTitle: string | null };

export function assembleConversionsWithCredits<C extends { id: number }, A extends CreditRow>(
  conversions: C[],
  attributions: A[],
  titlesByContentId: Map<number, string>,
): Array<C & { attributions: Array<WithContentTitle<A>> }> {
  const parConversion = new Map<number, Array<WithContentTitle<A>>>();
  for (const a of attributions) {
    const liste = parConversion.get(a.conversionId) ?? [];
    // `null` = contenu réellement absent, jamais « pas encore chargé » : c'est ce qui rend
    // le repli « supprimé depuis » de l'écran à nouveau VRAI quand il s'affiche.
    liste.push({ ...a, contentTitle: titlesByContentId.get(a.contentId) ?? null });
    parConversion.set(a.conversionId, liste);
  }
  return conversions.map((c) => ({ ...c, attributions: parConversion.get(c.id) ?? [] }));
}
