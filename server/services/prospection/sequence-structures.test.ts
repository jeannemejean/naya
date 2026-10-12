import { describe, it, expect } from "vitest";
import { structurePour, emplacements, ajusterDelais, verifierStructure, type NomStructure } from "./sequence-structures";

const NOMS: NomStructure[] = ["linkedin_first", "email_first", "linkedin_only"];

describe("structures de séquence", () => {
  it("les trois structures sont valides", () => {
    for (const n of NOMS) expect(verifierStructure(emplacements(n))).toEqual([]);
  });

  it("aucune ne dépend de l'ouverture ou du clic d'un mail", () => {
    for (const n of NOMS) {
      for (const e of emplacements(n)) expect(["if_opened", "if_not_opened", "if_clicked"]).not.toContain(e.condition);
    }
  });

  it("toute touche LinkedIn autre que l'invitation exige une invitation acceptée", () => {
    for (const n of NOMS) {
      for (const e of emplacements(n)) {
        if (e.channel === "linkedin" && e.role !== "invitation") expect(e.condition).toBe("if_invite_accepted");
      }
    }
  });

  it("la vérification rejette un message LinkedIn envoyé sans connexion", () => {
    const casse = [
      { channel: "linkedin" as const, delayDays: 0, condition: "always" as const, role: "invitation" as const },
      { channel: "linkedin" as const, delayDays: 3, condition: "if_invite_not_accepted" as const, role: "relance" as const },
    ];
    expect(verifierStructure(casse).length).toBeGreaterThan(0);
  });

  it("chaque branche compte 5 touches au plus et se termine par une clôture", () => {
    for (const n of NOMS) {
      const e = emplacements(n);
      const acceptee = e.filter((x) => x.condition !== "if_invite_not_accepted");
      const refusee = e.filter((x) => x.condition !== "if_invite_accepted");
      expect(acceptee.length).toBeLessThanOrEqual(5);
      expect(refusee.length).toBeLessThanOrEqual(5);
      expect(e.some((x) => x.role === "cloture")).toBe(true);
    }
  });

  it("choisit la structure selon le canal de la campagne", () => {
    expect(structurePour("email")).toBe("email_first");
    expect(structurePour("linkedin")).toBe("linkedin_only");
    expect(structurePour("both")).toBe("linkedin_first");
    expect(structurePour(null)).toBe("linkedin_first");
  });

  it("ajuste les délais dans des bornes raisonnables", () => {
    const base = emplacements("email_first");
    const ajuste = ajusterDelais(base, [0, 40, 0, undefined]);
    expect(ajuste[0].delayDays).toBe(0);
    expect(ajuste[1].delayDays).toBeLessThanOrEqual(Math.ceil(base[1].delayDays * 1.5));
    expect(ajuste[2].delayDays).toBeGreaterThanOrEqual(1);
    expect(ajuste[3].delayDays).toBe(base[3].delayDays);
  });
});
