import { describe, it, expect } from "vitest";
import { resumeSourcing } from "./sourcing-message";

describe("resumeSourcing", () => {
  it("cible atteinte", () => {
    expect(resumeSourcing({ imported: 20, skipped: 3, cible: 20, reserve: 0, cibleAtteinte: true })).toEqual({
      title: "20 prospects importés",
      description: "Objectif des deux prochaines semaines atteint (20). 3 déjà présents écartés.",
    });
  });

  it("cible non atteinte : dit ce qui manque", () => {
    expect(resumeSourcing({ imported: 12, skipped: 0, cible: 40, reserve: 10, cibleAtteinte: false })).toEqual({
      title: "12 prospects importés",
      description: "22 sur un objectif de 40 avec ta réserve. Relance la recherche plus tard pour de nouveaux angles.",
    });
  });

  it("réserve suffisante : rien recherché", () => {
    expect(resumeSourcing({ imported: 0, skipped: 0, cible: 30, reserve: 32, reserveSuffisante: true, cibleAtteinte: true })).toEqual({
      title: "Ta réserve suffit",
      description: "32 prospects attendent déjà d'être contactés, pour un objectif de 30 sur deux semaines.",
    });
  });

  it("singulier", () => {
    expect(resumeSourcing({ imported: 1, skipped: 1, cible: 1, reserve: 0, cibleAtteinte: true }).title).toBe("1 prospect importé");
  });
});
