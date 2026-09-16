/**
 * Où part le travail d'une tâche, une fois « Enregistrer » cliqué.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  C'EST ICI QUE SE RÈGLENT LES DESTINATIONS. Une ligne par type de tâche.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Arbitrage de Jeanne (2026-09-16) : une table explicite, plutôt qu'une décision prise par
 * Naya au cas par cas. Une destination devinée est une destination qu'on ne peut ni prévoir
 * ni corriger — et le travail se retrouve dans un endroit où personne ne pense à le chercher.
 *
 * La clé est `tasks.type`, choisi parce qu'il est renseigné sur les 58 tâches de la
 * production. `workflowGroup` aurait été plus fin, mais il y est `null` partout : le prompt
 * ne l'a jamais demandé, défaut corrigé dans le lot A. Il pourra devenir une clé plus
 * précise quand les tâches générées après ce correctif l'auront rempli.
 */

export type Destination =
  /** Calendrier de contenu — un post rédigé, pas encore publié. */
  | "content"
  /** Campagne de prospection liée. */
  | "prospection"
  /** Aucune destination extérieure : la note reste dans l'espace de travail de la tâche. */
  | "espace_de_travail";

/**
 * Types observés en production : content (25), outreach (16), planning (9), admin (8).
 * `execution` figure dans l'énumération autorisée du prompt sans y apparaître encore.
 */
export const DESTINATION_PAR_TYPE: Readonly<Record<string, Destination>> = {
  content: "content",
  outreach: "prospection",
  admin: "espace_de_travail",
  planning: "espace_de_travail",
  execution: "espace_de_travail",
};

/**
 * Un type inconnu, mal casé, ou absent reste dans l'espace de travail. Jamais de repli vers
 * une destination extérieure « par défaut » : envoyer le travail dans un endroit que
 * l'utilisatrice n'attend pas revient à le perdre, avec en prime la conviction qu'il est
 * quelque part.
 *
 * Aucune tolérance à la casse ni aux espaces : « CONTENT » n'est pas « content ». La valeur
 * vient d'une énumération que le serveur contrôle ; l'assouplir masquerait une dérive de
 * données au lieu de la signaler.
 *
 * La consultation passe par `Object.hasOwn`, et non par un simple `TABLE[type] ?? repli`.
 * En JavaScript, `TABLE["constructor"]` ne vaut pas `undefined` mais la fonction héritée de
 * `Object.prototype` — que `??` laisse donc passer. `type` vient d'une colonne de base :
 * rien ne garantit qu'elle ne contiendra jamais l'une de ces valeurs, et la fonction aurait
 * alors renvoyé une fonction là où tout le reste attend une chaîne.
 */
export function destinationPourTache(type: string | null | undefined): Destination {
  if (typeof type !== "string") return "espace_de_travail";
  if (!Object.hasOwn(DESTINATION_PAR_TYPE, type)) return "espace_de_travail";
  return DESTINATION_PAR_TYPE[type];
}
