/**
 * Le libellé de la ligne d'appel du dashboard — ou `null` quand il n'y a rien à dire.
 *
 * Pourquoi une fonction à part, et pourquoi elle ne voit QUE les fiches du jour :
 * `/api/reading/today` rend deux listes, les fiches du jour et les fiches gardées. Compter
 * les deux (ce que faisait `cards.length`) transforme cette ligne en compteur de dette
 * permanent : une fiche gardée reste gardée indéfiniment, donc le dashboard annoncerait
 * « 4 choses à lire sur ton marché » chaque matin, y compris les matins où la revue n'a
 * rien produit. Un compteur qui ne redescend jamais est exactement ce que le spec
 * interdit. Les gardées sont un rayonnage volontaire, pas un retard : elles ne comptent
 * jamais ici, et zéro fiche du jour rend `null`, donc aucune ligne du tout.
 */
export function libelleAppelRevue(donnees: { duJour?: unknown[] } | undefined): string | null {
  const n = donnees?.duJour?.length ?? 0;
  if (n === 0) return null;
  return n === 1 ? 'Une chose à lire sur ton marché' : `${n} choses à lire sur ton marché`;
}
