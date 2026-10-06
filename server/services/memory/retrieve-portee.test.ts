import { describe, it, expect } from "vitest";
import { porteeFil, type Fil } from "./retrieve";

describe("porteeFil — portée de lecture par fil", () => {
  it("savoir + marque active → savoir sans marque OU de la marque", () => {
    expect(porteeFil("savoir", 15)).toBe("marque_ou_null");
  });
  it("savoir sans marque → project_id NULL seul", () => {
    expect(porteeFil("savoir", null)).toBe("null_seul");
  });
  it("founder reste transverse, quelle que soit la marque", () => {
    expect(porteeFil("founder", 15)).toBe("null_seul");
    expect(porteeFil("founder", null)).toBe("null_seul");
  });
  it("cap et reception restent strictement à la marque", () => {
    for (const fil of ["cap", "reception"] as Fil[]) {
      expect(porteeFil(fil, 15)).toBe("marque_exacte");
      expect(porteeFil(fil, null)).toBe("marque_exacte");
    }
  });
});
