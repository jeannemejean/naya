// Limite de longueur du texte collé dans le dialogue d'import de calendrier (Tâche 6).
//
// Mirroir volontaire de `MAX_CARACTERES` dans `server/services/content-import/parse.ts`
// (même valeur, 40000) : le client n'importe jamais de code serveur (deux bundles
// distincts, Vite ne résoudrait pas un chemin hors de `client/`) — même motif de
// duplication assumée que `LIMITE_CONTENUS_PAGE` / `LIMITE_CONTENUS_MAX` entre
// `content-calendar-limit.ts` et `routes.ts` (tâche 5 de ce même chantier). Si la valeur
// serveur change, celle-ci doit être mise à jour à la main — aucun mécanisme ne les lie.
export const MAX_CARACTERES = 40000;

/**
 * `true` quand le texte dépasse la limite acceptée par le serveur. Vérifié côté client
 * AVANT l'envoi : faire attendre un appel modèle de plusieurs secondes pour un refus
 * déjà connu au moment de la frappe serait une faute de conception (voir le 400 que
 * POST /api/content/import rend dans ce cas, avec le même seuil).
 */
export function texteTropLong(longueur: number): boolean {
  return longueur > MAX_CARACTERES;
}
