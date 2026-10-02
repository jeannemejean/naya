import { describe, it, expect } from "vitest";
import { MAX_CARACTERES, texteTropLong } from "./import-calendrier-limite";

describe("texteTropLong", () => {
  it("faux à MAX_CARACTERES pile (la limite elle-même reste acceptée)", () => {
    expect(texteTropLong(MAX_CARACTERES)).toBe(false);
  });

  it("vrai à MAX_CARACTERES + 1", () => {
    expect(texteTropLong(MAX_CARACTERES + 1)).toBe(true);
  });

  it("faux sur un texte vide", () => {
    expect(texteTropLong(0)).toBe(false);
  });
});
