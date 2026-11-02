import { describe, it, expect } from "vitest";
import { decisionPublic, RAISON_EXCLUSION, normaliserPublic } from "./campagne-public";

describe("decisionPublic", () => {
  it("campagne froide : une relation est exclue, un inconnu continue", () => {
    expect(decisionPublic("froid", true)).toBe("exclure");
    expect(decisionPublic("froid", false)).toBe("continuer");
  });
  it("campagne relations : un inconnu est exclu, une relation continue", () => {
    expect(decisionPublic("relations", false)).toBe("exclure");
    expect(decisionPublic("relations", true)).toBe("continuer");
  });
  it("raisons d'exclusion", () => {
    expect(RAISON_EXCLUSION).toEqual({ froid: "deja_en_relation", relations: "pas_en_relation" });
  });
  it("normaliserPublic : défaut froid", () => {
    expect(normaliserPublic(undefined)).toBe("froid");
    expect(normaliserPublic("n'importe quoi")).toBe("froid");
    expect(normaliserPublic("relations")).toBe("relations");
  });
});
