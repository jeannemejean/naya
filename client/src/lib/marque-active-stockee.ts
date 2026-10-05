// L'identifiant de la marque active, tel que le navigateur le retient entre deux
// chargements.
//
// Pourquoi ce module existe, et pas trois `localStorage.getItem` éparpillés :
//
// Le 5 octobre 2026, une réinitialisation de compte a laissé l'utilisatrice enfermée
// dans une boucle. Le serveur avait bien remis sa marque active à `null`, mais le
// navigateur gardait l'ancien identifiant. Au rechargement, il était relu de façon
// SYNCHRONE — avant que le serveur ait pu dire la vérité — les requêtes partaient avec
// une marque supprimée, l'erreur remontait à l'`ErrorBoundary`, et « Réessayer »
// rechargeait dans le même état. Le code qui aurait nettoyé existait pourtant : il
// vivait dans un `onSuccess` et dans un `useEffect`, c'est-à-dire dans des composants
// que l'`ErrorBoundary` venait de démonter. Un nettoyage qui dépend d'un composant
// vivant ne s'exécute pas quand c'est justement le composant qui est tombé.
//
// Ce module est donc délibérément SANS React : il s'appelle depuis un gestionnaire
// d'erreur, avant un rendu, ou depuis n'importe où. Et il prend son stockage en
// paramètre, pour être testable dans un environnement node qui n'a pas de
// `localStorage`.

export const CLE_MARQUE_ACTIVE = "naya_active_project_id";

/** Le minimum de `Storage` dont ce module a besoin — pour pouvoir le simuler en test. */
export interface StockageLecture { getItem(cle: string): string | null }
export interface StockageEcriture { removeItem(cle: string): void }

/**
 * Lit l'identifiant de marque retenu par le navigateur.
 *
 * Rend `null` pour tout ce qui n'est pas un entier positif — absent, vide, texte,
 * `NaN`, zéro, négatif. La version précédente faisait `stored ? parseInt(stored) : null`
 * sans garde : un stockage corrompu produisait `NaN`, qui partait tel quel dans les
 * requêtes (`projectId=NaN`) et faisait répondre 400 au serveur. Une valeur illisible
 * doit être traitée comme une absence, jamais propagée.
 *
 * Ne lève jamais : un `localStorage` inaccessible (navigation privée, réglage du
 * navigateur) rend `null` plutôt que de faire échouer le premier rendu.
 */
export function lireMarqueStockee(stockage: StockageLecture): number | null {
  let brut: string | null;
  try {
    brut = stockage.getItem(CLE_MARQUE_ACTIVE);
  } catch {
    return null;
  }
  if (!brut) return null;
  if (!/^\d+$/.test(brut.trim())) return null;
  const n = Number(brut.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Fait oublier la marque active au navigateur.
 *
 * Ne lève jamais : c'est appelé depuis un gestionnaire d'erreur et depuis le chemin de
 * réinitialisation. Un échec d'écriture ne doit pas empêcher la récupération qu'il est
 * censé servir.
 */
export function oublierMarqueStockee(stockage: StockageEcriture): void {
  try {
    stockage.removeItem(CLE_MARQUE_ACTIVE);
  } catch {
    /* sans effet : mieux vaut ne pas nettoyer que faire échouer la récupération */
  }
}
