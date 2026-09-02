import { describe, it, expect } from "vitest";
import { formatCreditSharePercent, buildConversionCreditRows } from "./conversion-credit";

describe("formatCreditSharePercent", () => {
  it("100 % pour un seul contenu crédité", () => {
    expect(formatCreditSharePercent(1)).toBe(100);
  });

  it("arrondit un tiers à 33", () => {
    expect(formatCreditSharePercent(1 / 3)).toBe(33);
  });

  it("0 % pour un poids nul", () => {
    expect(formatCreditSharePercent(0)).toBe(0);
  });

  it("arrondit une part minuscule à 0 plutôt que d'afficher des décimales", () => {
    expect(formatCreditSharePercent(0.004)).toBe(0);
  });
});

describe("buildConversionCreditRows", () => {
  it("renvoie [] quand la conversion n'a crédité personne (fenêtre vide)", () => {
    expect(buildConversionCreditRows([], new Map(), "Inconnu")).toEqual([]);
  });

  it("résout le titre depuis la table de contenus", () => {
    const rows = buildConversionCreditRows(
      [{ contentId: 1, creditWeight: 1 }],
      new Map([[1, "Post A"]]),
      "Inconnu",
    );
    expect(rows).toEqual([{ contentId: 1, title: "Post A", sharePercent: 100 }]);
  });

  it("retombe sur le titre de repli si le contenu a été supprimé depuis", () => {
    const rows = buildConversionCreditRows(
      [{ contentId: 42, creditWeight: 0.5 }],
      new Map(),
      "Contenu supprimé",
    );
    expect(rows).toEqual([{ contentId: 42, title: "Contenu supprimé", sharePercent: 50 }]);
  });

  it(
    "ordonne par contentId croissant — JAMAIS par poids : un contenu à petit poids listé en " +
      "premier ne doit pas remonter en tête (pas de classement)",
    () => {
      const rows = buildConversionCreditRows(
        [
          { contentId: 30, creditWeight: 0.7 }, // le plus gros poids, mais id le plus grand
          { contentId: 10, creditWeight: 0.1 }, // le plus petit poids, mais id le plus petit
          { contentId: 20, creditWeight: 0.2 },
        ],
        new Map([
          [10, "Post 10"],
          [20, "Post 20"],
          [30, "Post 30"],
        ]),
        "Inconnu",
      );
      expect(rows.map((r) => r.contentId)).toEqual([10, 20, 30]);
    },
  );
});
