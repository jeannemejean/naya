import { describe, it, expect } from "vitest";
import { assembleConversionsWithCredits } from "./credits-view";

const conv = (id: number) => ({ id, projectId: 7, convertedAt: new Date("2026-08-01"), attributionWindowDays: 30 });
const attr = (id: number, conversionId: number, contentId: number, creditWeight: number) =>
  ({ id, conversionId, contentId, creditWeight });

describe("assembleConversionsWithCredits", () => {
  it("regroupe chaque crédit sous SA conversion", () => {
    const out = assembleConversionsWithCredits(
      [conv(1), conv(2)],
      [attr(10, 1, 100, 0.5), attr(11, 2, 200, 1), attr(12, 1, 101, 0.5)],
      new Map([[100, "A"], [101, "B"], [200, "C"]]),
    );
    expect(out.map((c) => c.id)).toEqual([1, 2]);
    expect(out[0].attributions.map((a) => a.contentId)).toEqual([100, 101]);
    expect(out[1].attributions.map((a) => a.contentId)).toEqual([200]);
  });

  it("une conversion sans aucun crédit garde un tableau vide — état normal, pas une erreur", () => {
    const out = assembleConversionsWithCredits([conv(1)], [], new Map());
    expect(out[0].attributions).toEqual([]);
  });

  /**
   * I3 (revue finale) — le titre est résolu ICI, côté serveur, à partir des ids de contenu
   * crédités (une recherche BORNÉE : ils sont tous connus). L'écran le lisait auparavant
   * dans `/api/content?projectId=…`, plafonné aux 50 contenus les plus récents par le
   * serveur : tout contenu crédité au-delà de ce plafond s'affichait « Contenu supprimé
   * depuis » — une affirmation FAUSSE sur un contenu bien vivant, atteignable en usage
   * ordinaire avec la fenêtre de 60 jours de l'agence.
   */
  it("résout le titre de chaque contenu crédité", () => {
    const out = assembleConversionsWithCredits(
      [conv(1)],
      [attr(10, 1, 100, 1)],
      new Map([[100, "Post de lancement"]]),
    );
    expect(out[0].attributions[0].contentTitle).toBe("Post de lancement");
  });

  it("titre null UNIQUEMENT pour un contenu réellement absent — le repli « supprimé depuis » reste possible", () => {
    const out = assembleConversionsWithCredits(
      [conv(1)],
      [attr(10, 1, 100, 0.5), attr(11, 1, 999, 0.5)],
      new Map([[100, "Vivant"]]),
    );
    expect(out[0].attributions.map((a) => a.contentTitle)).toEqual(["Vivant", null]);
  });

  it("ne perd ni ne réordonne les champs du crédit lui-même", () => {
    const out = assembleConversionsWithCredits([conv(1)], [attr(10, 1, 100, 0.25)], new Map([[100, "A"]]));
    expect(out[0].attributions[0]).toEqual({
      id: 10, conversionId: 1, contentId: 100, creditWeight: 0.25, contentTitle: "A",
    });
  });

  it("ignore un crédit orphelin (conversion absente de la liste) sans planter", () => {
    const out = assembleConversionsWithCredits([conv(1)], [attr(10, 42, 100, 1)], new Map());
    expect(out[0].attributions).toEqual([]);
  });
});
