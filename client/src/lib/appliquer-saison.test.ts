import { describe, it, expect } from "vitest";
import { PALETTES } from "@shared/saisons";
import { variablesDeSaison } from "./appliquer-saison";

describe("variablesDeSaison", () => {
  it("donne les cinq variables de la saison", () =>
    expect(variablesDeSaison("hiver")).toEqual({
      "--fond": "#F1EEE8",
      "--fond-rgb": "241 238 232",
      "--touche-1": "#5F7189",
      "--touche-2": "#C9D3DF",
      "--motif": PALETTES.hiver.motif,
    }));

  it("calcule les canaux de l'automne depuis le fond", () =>
    expect(variablesDeSaison("automne")["--fond-rgb"]).toBe("243 234 219"));
});
