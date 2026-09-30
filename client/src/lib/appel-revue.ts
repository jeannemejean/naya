/**
 * Le libellé de la ligne d'appel du dashboard — ou `null` quand il n'y a rien à dire.
 *
 * Deux choses sont exclues du compte, pour deux raisons différentes.
 *
 * Les fiches GARDÉES. `/api/reading/today` rend deux listes, les fiches du jour et les
 * fiches gardées. Compter les deux (ce que faisait `cards.length`) transforme cette ligne
 * en compteur de dette permanent : une fiche gardée reste gardée indéfiniment, donc le
 * dashboard annoncerait « 4 choses à lire sur ton marché » chaque matin, y compris les
 * matins où la revue n'a rien produit. Un compteur qui ne redescend jamais est exactement
 * ce que le spec interdit. Les gardées sont un rayonnage volontaire, pas un retard.
 *
 * Les fiches DÉJÀ RÉPONDUES. Elles restent des fiches du jour — le contexte de Naya les
 * injecte, l'écran les garde pour « en faire un post » — mais la ligne du dashboard est un
 * DÉCLENCHEUR, pas un inventaire : « 3 choses à lire sur ton marché » quand les trois ont
 * reçu un avis est simplement faux. Ce n'est pas un compteur de dette pour autant, et la
 * nuance compte : le nombre porte sur la journée seule, il retombe à zéro chaque nuit, il
 * n'accumule rien et ne se souvient de rien.
 *
 * Reste donc le seul cas où il y a vraiment quelque chose à faire : les `proposed` du jour.
 */
export function libelleAppelRevue(
  donnees: { duJour?: Array<{ status?: string | null }> } | undefined,
): string | null {
  const n = (donnees?.duJour ?? []).filter((f) => f.status === 'proposed').length;
  if (n === 0) return null;
  return n === 1 ? 'Une chose à lire sur ton marché' : `${n} choses à lire sur ton marché`;
}
