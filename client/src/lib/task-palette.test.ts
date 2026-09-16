import { describe, it, expect } from "vitest";
import { NAYA_TASK_PALETTES, taskPaletteFor } from "./task-palette";

/**
 * Une seule palette de tâches pour toute l'application.
 *
 * Le dashboard et le planning peignaient les mêmes tâches avec deux jeux de couleurs
 * différents. Les deux indexaient pourtant de la même façon — `projectId % longueur` — donc
 * un projet tombait bien toujours sur la même CASE ; seul le contenu des cases différait.
 *
 * Pire : `todays-tasks` choisissait entre une variante claire et une variante sombre selon
 * `theme === 'dark'`, et le thème par défaut est 'dark' alors qu'aucun vrai mode sombre
 * n'existe en CSS. Le dashboard peignait donc des teintes sombres et sourdes sur un fond
 * clair, pendant que le planning utilisait les couleurs de marque.
 *
 * Décision de Jeanne : les couleurs de marque Naya font référence.
 */
describe("taskPaletteFor", () => {
  it("un même projet reçoit toujours la même couleur", () => {
    // LE test. C'est la propriété que les deux vues doivent partager, et qu'elles
    // partageaient déjà dans leur principe — mais pas dans leurs valeurs.
    expect(taskPaletteFor(7)).toEqual(taskPaletteFor(7));
    expect(taskPaletteFor(7)).toBe(taskPaletteFor(7));
  });

  it("deux projets voisins reçoivent des couleurs différentes", () => {
    // Bug visé : un index constant, qui peindrait tout de la même teinte.
    expect(taskPaletteFor(7)).not.toEqual(taskPaletteFor(8));
  });

  it("la rotation revient au même endroit après un tour complet", () => {
    const n = NAYA_TASK_PALETTES.length;
    expect(taskPaletteFor(3)).toBe(taskPaletteFor(3 + n));
  });

  it("l'absence de projet ne fait pas tomber la fonction", () => {
    // Bug visé : `undefined % 7` donne NaN, et `palettes[NaN]` donne undefined — donc une
    // tâche sans couleur du tout, sans la moindre erreur. C'est le motif d'absence traitée
    // comme une valeur qu'on corrige partout dans ce dépôt.
    for (const sansProjet of [null, undefined, 0]) {
      const p = taskPaletteFor(sansProjet as number | null | undefined);
      expect(p, `projectId = ${String(sansProjet)}`).toBeDefined();
      expect(typeof p.bg).toBe("string");
      expect(p.bg.length).toBeGreaterThan(0);
    }
  });

  it("un identifiant négatif reste dans les bornes", () => {
    // Bug visé : en JS, -1 % 7 vaut -1, et palettes[-1] est undefined.
    const p = taskPaletteFor(-1);
    expect(p).toBeDefined();
    expect(NAYA_TASK_PALETTES).toContain(p);
  });

  it("toute sortie appartient à la palette de marque", () => {
    for (const id of [0, 1, 2, 3, 5, 8, 13, 21, 100, 1001]) {
      expect(NAYA_TASK_PALETTES, `projectId ${id}`).toContain(taskPaletteFor(id));
    }
  });

  it("la palette est celle de la marque, pas des pastels génériques", () => {
    // Garde la décision : les couleurs Naya sont exprimées en rgba() sur les tokens de
    // marque. Un retour aux pastels hexadécimaux (#F5F2FF, #FFFBEB…) ferait tomber ce test.
    for (const p of NAYA_TASK_PALETTES) {
      expect(p.bg, `bg ${p.bg}`).toMatch(/^rgba\(/);
    }
  });

  it("aucune couleur n'apparaît deux fois", () => {
    // L'ancienne palette du dashboard contenait deux fois le même ambre : deux projets
    // distincts recevaient exactement la même teinte, ce qui annule l'intérêt du code
    // couleur par projet.
    const bgs = NAYA_TASK_PALETTES.map((p) => p.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });
});
