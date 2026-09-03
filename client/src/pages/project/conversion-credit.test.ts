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
    expect(buildConversionCreditRows([], "Inconnu")).toEqual([]);
  });

  it("utilise le titre résolu par le serveur", () => {
    const rows = buildConversionCreditRows([{ contentId: 1, creditWeight: 1, contentTitle: "Post A" }], "Inconnu");
    expect(rows).toEqual([{ contentId: 1, title: "Post A", sharePercent: 100 }]);
  });

  /**
   * I3 (revue finale) — le repli ne doit plus JAMAIS être un artefact d'affichage. Il n'est
   * atteint que si le serveur, qui connaît tous les ids crédités, n'a pas retrouvé le
   * contenu : à ce moment-là seulement, « supprimé depuis » est vrai.
   */
  it("retombe sur le titre de repli UNIQUEMENT si le serveur n'a pas retrouvé le contenu", () => {
    expect(buildConversionCreditRows([{ contentId: 42, creditWeight: 0.5, contentTitle: null }], "Contenu supprimé"))
      .toEqual([{ contentId: 42, title: "Contenu supprimé", sharePercent: 50 }]);
    // Même repli si le champ est absent (ancienne réponse en cache) — jamais un titre vide.
    expect(buildConversionCreditRows([{ contentId: 42, creditWeight: 0.5 }], "Contenu supprimé"))
      .toEqual([{ contentId: 42, title: "Contenu supprimé", sharePercent: 50 }]);
  });

  /**
   * ANTI-CLASSEMENT. Les poids sont NON MONOTONES avec les contentId, et l'ordre d'entrée
   * diffère des trois : c'est ce qui rend le test complet. Des poids croissants avec l'id
   * (ou décroissants) ne distingueraient l'ordre attendu que d'UN des deux tris par poids —
   * une implémentation triant dans l'autre sens passerait au vert.
   *   ordre attendu (par id) : 10, 20, 30
   *   tri par poids croissant : 30, 10, 20   (0,1 / 0,2 / 0,7)
   *   tri par poids décroissant : 20, 10, 30
   *   ordre d'entrée du tableau : 20, 30, 10
   * Les quatre sont deux à deux différents : seul le tri par contentId croissant passe.
   */
  it("ordonne par contentId croissant — JAMAIS par poids, dans un sens ou dans l'autre", () => {
    const rows = buildConversionCreditRows(
      [
        { contentId: 20, creditWeight: 0.7, contentTitle: "Post 20" },
        { contentId: 30, creditWeight: 0.1, contentTitle: "Post 30" },
        { contentId: 10, creditWeight: 0.2, contentTitle: "Post 10" },
      ],
      "Inconnu",
    );
    expect(rows.map((r) => r.contentId)).toEqual([10, 20, 30]);
    // Et les parts suivent bien leur contenu, elles ne sont pas réattribuées par l'ordre.
    expect(rows.map((r) => r.sharePercent)).toEqual([20, 70, 10]);
  });
});
