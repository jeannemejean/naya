import { describe, it, expect } from "vitest";
import { LIMITE_CONTENUS_PAGE, plafondAtteint } from "./content-calendar-limit";

describe("plafondAtteint", () => {
  it("vrai quand la réponse rend exactement LIMITE_CONTENUS_PAGE éléments", () => {
    expect(plafondAtteint(LIMITE_CONTENUS_PAGE)).toBe(true);
  });

  it("faux à LIMITE_CONTENUS_PAGE - 1 : le plafond n'a pas mordu", () => {
    expect(plafondAtteint(LIMITE_CONTENUS_PAGE - 1)).toBe(false);
  });

  it("faux à zéro", () => {
    expect(plafondAtteint(0)).toBe(false);
  });
});
