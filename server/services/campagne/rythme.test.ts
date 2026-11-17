import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../memory/embed", () => ({ embedText: vi.fn() }));

import { lireRythme, PREFIXE_RYTHME, rythmeValide, texteRythme } from "./rythme";

describe("texteRythme", () => {
  it("un post par semaine, au singulier", () => {
    expect(texteRythme(1)).toBe("Rythme de publication dans Naya : 1 post par semaine.");
  });
  it("au pluriel, avec la précision", () => {
    expect(texteRythme(3, "x")).toContain("3 posts par semaine. x");
    expect(texteRythme(3, "x").startsWith(PREFIXE_RYTHME)).toBe(true);
  });
  it("décimales à la française", () => {
    expect(texteRythme(0.5)).toContain("0,5 post par semaine");
  });
});

describe("lireRythme", () => {
  it("relit le nombre écrit", () => {
    expect(lireRythme(texteRythme(0.5))).toBe(0.5);
    expect(lireRythme(texteRythme(1))).toBe(1);
  });
  it("la précision ne compte pas", () => {
    expect(lireRythme(texteRythme(3, "2 reels et 1 carrousel par semaine"))).toBe(3);
    expect(lireRythme(texteRythme(1, "les news JMD sortent 3 fois par jour hors Naya"))).toBe(1);
  });
  it("une autre préférence n'est pas un rythme", () => {
    expect(lireRythme("Ton direct")).toBeNull();
  });
});

describe("rythmeValide", () => {
  it.each([0, -1, 50, NaN, Infinity, "2", null])("%s refusé", (n) => {
    expect(rythmeValide(n)).toBe(false);
  });
  it.each([0.25, 1, 3, 14])("%s accepté", (n) => {
    expect(rythmeValide(n)).toBe(true);
  });
});
