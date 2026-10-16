import { describe, it, expect } from "vitest";
import { assainirPatchPreferences } from "./apparence";

describe("assainirPatchPreferences", () => {
  it("normalise une apparence malformée", () =>
    expect(assainirPatchPreferences({ apparence: { saison: "noel", decor: "oui" } })).toEqual({ apparence: { saison: "auto", decor: true } }));
  it("laisse passer les autres champs sans les toucher", () =>
    expect(assainirPatchPreferences({ timezone: "Europe/Paris" })).toEqual({ timezone: "Europe/Paris" }));
  it("garde une apparence valide", () =>
    expect(assainirPatchPreferences({ apparence: { saison: "hiver", decor: false } })).toEqual({ apparence: { saison: "hiver", decor: false } }));
  it.each([null, "x", 42])("corps %j → objet vide", (c) => expect(assainirPatchPreferences(c)).toEqual({}));
});
