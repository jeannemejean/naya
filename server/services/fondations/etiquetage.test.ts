import { describe, it, expect } from "vitest";
import { lireEtiquettes } from "./etiquetage";

describe("lireEtiquettes", () => {
  const ids = new Set([1, 2, 3]);
  const cles = new Set(["efficacite", "cadeau"]);

  it("garde les étiquettes valides, format inconnu → null", () => {
    const r = lireEtiquettes('ok {"etiquettes":[{"id":1,"angle":"efficacite","format":"demonstration"},{"id":2,"angle":"aucun","format":"danse"}]}', ids, cles);
    expect(r).toEqual([
      { id: 1, angle: "efficacite", formatCreatif: "demonstration" },
      { id: 2, angle: "aucun", formatCreatif: null },
    ]);
  });

  it("ignore les ids inconnus, les angles inconnus et les doublons", () => {
    const r = lireEtiquettes('{"etiquettes":[{"id":9,"angle":"cadeau"},{"id":3,"angle":"inventee"},{"id":1,"angle":"cadeau"},{"id":1,"angle":"efficacite"}]}', ids, cles);
    expect(r).toEqual([{ id: 1, angle: "cadeau", formatCreatif: null }]);
  });

  it("null si la réponse est illisible", () => {
    expect(lireEtiquettes("désolée", ids, cles)).toBeNull();
    expect(lireEtiquettes('{"autre":1}', ids, cles)).toBeNull();
  });
});
