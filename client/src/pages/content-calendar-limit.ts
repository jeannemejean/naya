// Helper PUR pour le plafond de chargement du calendrier de contenu. Isolé de
// content-calendar.tsx pour rester testable en environnement node (le composant
// tire react-query, react-big-calendar, etc., côté navigateur) — même motif que
// ./project/ritual-format.ts.
//
// Tâche 5 (saisie manuelle) : avant ce chantier, le serveur rendait 50 lignes au
// maximum (les plus récentes) sans que rien ne le dise à la page — coller un lot de
// posts dans une marque qui en compte déjà 40 faisait disparaître de la vue des
// posts anciens, dont certains programmés pour les semaines à venir. La page
// demande désormais `limit=LIMITE_CONTENUS_PAGE`, et affiche une ligne quand la
// réponse en rend EXACTEMENT ce nombre — signe que le plafond a mordu, pas une
// estimation.
export const LIMITE_CONTENUS_PAGE = 200;

/**
 * `true` seulement quand le nombre de contenus rendus égale EXACTEMENT le plafond
 * demandé : au-delà n'arrive jamais (le serveur refuse un `limit` plus grand que
 * son propre plafond), et en dessous ne signifie rien — le plafond n'a simplement
 * pas mordu, la marque tient en entier dans la réponse.
 */
export function plafondAtteint(nombreDeContenus: number): boolean {
  return nombreDeContenus === LIMITE_CONTENUS_PAGE;
}
