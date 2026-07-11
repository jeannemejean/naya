import { describe, it, expect } from "vitest";
import { headerCheckboxState, toggleId, setSelection, countSelectedIn } from "./bulk-selection";

describe("headerCheckboxState — état de la checkbox « Tout sélectionner »", () => {
  it("'none' quand rien n'est sélectionné", () => {
    expect(headerCheckboxState(0, 5)).toBe("none");
  });
  it("'all' quand tout le visible est sélectionné", () => {
    expect(headerCheckboxState(5, 5)).toBe("all");
  });
  it("'some' (INDÉTERMINÉ) quand la sélection est partielle", () => {
    expect(headerCheckboxState(3, 5)).toBe("some");
    expect(headerCheckboxState(1, 5)).toBe("some");
  });
  it("'none' quand il n'y a aucune ligne visible", () => {
    expect(headerCheckboxState(0, 0)).toBe("none");
  });

  it("condition 3 : Tout sélectionner puis désélectionner un → état indéterminé", () => {
    const visibleIds = [10, 20, 30];
    // « Tout sélectionner »
    let sel = setSelection(new Set<number>(), visibleIds, true);
    expect(headerCheckboxState(countSelectedIn(sel, visibleIds), visibleIds.length)).toBe("all");
    // On décoche un prospect
    sel = toggleId(sel, 20);
    expect(headerCheckboxState(countSelectedIn(sel, visibleIds), visibleIds.length)).toBe("some");
  });
});

describe("toggleId / setSelection / countSelectedIn (immutables)", () => {
  it("toggleId ajoute puis retire un id sans muter l'original", () => {
    const a = new Set<number>([1]);
    const b = toggleId(a, 2);
    expect([...b].sort()).toEqual([1, 2]);
    expect([...a]).toEqual([1]); // original intact
    const c = toggleId(b, 1);
    expect([...c]).toEqual([2]);
  });

  it("setSelection sélectionne / désélectionne un lot", () => {
    const on = setSelection(new Set<number>(), [1, 2, 3], true);
    expect([...on].sort()).toEqual([1, 2, 3]);
    const off = setSelection(on, [2], false);
    expect([...off].sort()).toEqual([1, 3]);
  });

  it("countSelectedIn ne compte que les ids visibles", () => {
    const sel = new Set<number>([1, 2, 99]);
    expect(countSelectedIn(sel, [1, 2, 3])).toBe(2); // 99 hors visible
  });
});
