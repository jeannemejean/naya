/**
 * Géométrie horizontale d'une tâche dans la grille horaire, en CSS relatif.
 *
 * Pourquoi cette fonction existe, et pourquoi elle ne mesure rien.
 *
 * La largeur venait d'une lecture du DOM faite PENDANT le rendu :
 *
 *     columnWidth={gridRefs.current[date]?.clientWidth || 120}
 *
 * Une ref n'est attachée qu'APRÈS le rendu. Au premier passage elle valait donc `null` et le
 * repli à 120 px s'appliquait : les tâches étaient peintes étroites et collées à gauche, puis
 * sautaient à leur vraie largeur au rendu suivant.
 *
 * Passer par un ResizeObserver n'y changerait rien : lui aussi ne mesure qu'après la première
 * peinture. La seule façon de supprimer le saut est de ne pas mesurer — le navigateur connaît
 * déjà la largeur du parent, on le laisse faire le calcul. Bénéfice secondaire : la grille
 * suit un redimensionnement de fenêtre sans code ni écouteur.
 */

/** Marge entre le bord de la colonne et la première lane. */
export const GRID_LANE_INSET_PX = 3;

/** Espace laissé à droite de chaque tâche pour séparer deux lanes voisines. */
export const GRID_LANE_GAP_PX = 2;

export interface LaneGeometry {
  /** Valeur CSS de `left`. */
  left: string;
  /** Valeur CSS de `width`. */
  width: string;
}

/**
 * `lane` est l'indice de la colonne de chevauchement, `totalLanes` leur nombre.
 * `fullWidth` correspond à la vue Jour, où une tâche occupe toute la colonne.
 *
 * `totalLanes <= 1` est ramené au cas pleine largeur : sans ce garde, `totalLanes = 0`
 * produirait une division par zéro, donc une déclaration CSS invalide que le navigateur
 * ignore en silence — la tâche prendrait une largeur arbitraire sans la moindre erreur.
 */
export function laneGeometry(lane: number, totalLanes: number, fullWidth: boolean): LaneGeometry {
  const inset = GRID_LANE_INSET_PX;
  const gap = GRID_LANE_GAP_PX;
  const utile = `100% - ${inset * 2}px`;

  if (fullWidth || totalLanes <= 1) {
    return { left: `${inset}px`, width: `calc(100% - ${inset * 2 + gap}px)` };
  }

  return {
    left: lane === 0 ? `${inset}px` : `calc(${inset}px + (${utile}) * ${lane} / ${totalLanes})`,
    width: `calc((${utile}) / ${totalLanes} - ${gap}px)`,
  };
}
