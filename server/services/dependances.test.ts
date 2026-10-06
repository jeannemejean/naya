import { describe, it, expect } from "vitest";
import { creeraitUnCycle } from "./dependances";

describe("creeraitUnCycle", () => {
  const a = (t: number, d: number) => ({ taskId: t, dependsOnTaskId: d });
  it("auto-référence = cycle", () => expect(creeraitUnCycle([], 5, 5)).toBe(true));
  it("cycle direct : B dépend de A, on ajoute A dépend de B", () => expect(creeraitUnCycle([a(2, 1)], 1, 2)).toBe(true));
  it("cycle indirect : C→B→A, on ajoute A dépend de C", () => expect(creeraitUnCycle([a(2, 1), a(3, 2)], 1, 3)).toBe(true));
  it("chaîne normale acceptée", () => expect(creeraitUnCycle([a(2, 1)], 3, 2)).toBe(false));
  it("graphe vide accepté", () => expect(creeraitUnCycle([], 2, 1)).toBe(false));
  it("graphe déjà cyclique : pas de boucle infinie", () =>
    expect(creeraitUnCycle([a(2, 3), a(3, 2)], 1, 2)).toBe(false));
});
