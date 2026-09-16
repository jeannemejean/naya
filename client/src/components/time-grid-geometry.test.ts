import { describe, it, expect } from "vitest";
import { laneGeometry, GRID_LANE_INSET_PX, GRID_LANE_GAP_PX } from "./time-grid-geometry";

/**
 * Géométrie horizontale d'une tâche dans la grille horaire.
 *
 * Pourquoi cette fonction existe. La largeur était calculée en pixels à partir d'une mesure
 * du DOM lue PENDANT le rendu :
 *
 *     columnWidth={gridRefs.current[date]?.clientWidth || 120}
 *
 * Une ref n'est attachée qu'APRÈS le rendu. Au premier passage elle vaut donc null, et le
 * repli à 120 px s'appliquait : les tâches étaient peintes étroites, collées à gauche, avant
 * de sauter à leur vraie largeur au rendu suivant. C'est le clignotement constaté au
 * chargement de la page.
 *
 * La correction ne consiste pas à mieux mesurer — un ResizeObserver aurait le même défaut au
 * premier rendu — mais à ne plus mesurer. Le navigateur connaît la largeur du parent ; on la
 * lui laisse calculer.
 */
describe("laneGeometry", () => {
  it("une tâche pleine largeur occupe la colonne moins les marges", () => {
    expect(laneGeometry(0, 1, true)).toEqual({
      left: "3px",
      width: "calc(100% - 8px)",
    });
  });

  it("une seule lane équivaut à la pleine largeur", () => {
    // Bug visé : diviser par totalLanes sans traiter le cas 1 donnerait une expression
    // inutilement compliquée, et surtout différente, pour un résultat identique.
    expect(laneGeometry(0, 1, false)).toEqual(laneGeometry(0, 1, true));
  });

  it("deux lanes : la première commence à la marge", () => {
    expect(laneGeometry(0, 2, false)).toEqual({
      left: "3px",
      width: "calc((100% - 6px) / 2 - 2px)",
    });
  });

  it("deux lanes : la seconde est décalée d'exactement une lane", () => {
    // Bug visé : oublier le décalage, et empiler les deux tâches l'une sur l'autre.
    expect(laneGeometry(1, 2, false)).toEqual({
      left: "calc(3px + (100% - 6px) * 1 / 2)",
      width: "calc((100% - 6px) / 2 - 2px)",
    });
  });

  it("trois lanes : la troisième est décalée de deux lanes", () => {
    expect(laneGeometry(2, 3, false).left).toBe("calc(3px + (100% - 6px) * 2 / 3)");
  });

  it("totalLanes à 0 ne produit pas de division par zéro", () => {
    // Bug visé : `(100% - 6px) / 0` donne une déclaration CSS invalide, que le navigateur
    // ignore en silence — la tâche prend alors la largeur par défaut, sans erreur visible.
    const g = laneGeometry(0, 0, false);

    expect(g).toEqual(laneGeometry(0, 1, true));
    expect(g.width).not.toContain("/ 0");
  });

  it("aucune sortie ne dépend d'une mesure du DOM", () => {
    // LE test qui garde la correction. Toute géométrie doit rester relative au parent :
    // si quelqu'un réintroduit un calcul en pixels mesurés, le clignotement revient.
    for (const [lane, total, full] of [
      [0, 1, true],
      [0, 2, false],
      [1, 3, false],
      [2, 4, false],
    ] as [number, number, boolean][]) {
      const g = laneGeometry(lane, total, full);
      expect(g.width, `width pour lane ${lane}/${total}`).toContain("100%");
      expect(g.left).toMatch(/^3px$|100%/);
    }
  });

  it("les marges sont des constantes exportées, pas des nombres au milieu du calcul", () => {
    expect(GRID_LANE_INSET_PX).toBe(3);
    expect(GRID_LANE_GAP_PX).toBe(2);
  });
});
