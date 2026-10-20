import { describe, it, expect } from "vitest";
import { consigneMotDuMatin, phraseDeSecours, LONGUEUR_MAX_MOT } from "./brief-saison";

describe("consigneMotDuMatin", () => {
  it("nomme la saison et interdit la salutation", () => {
    const c = consigneMotDuMatin("hiver");
    expect(c).toMatch(/hiver/);
    expect(c).toMatch(/salutation/i);
    expect(c).toMatch(/2 phrases/);
  });
  it("fixe une longueur totale de 140 caractères au plus (l'accueil coupe à 3 lignes)", () => {
    expect(LONGUEUR_MAX_MOT).toBe(140);
    expect(consigneMotDuMatin("automne")).toMatch(/140 caractères au plus/);
  });
  it("écrit « été » avec son accent", () => expect(consigneMotDuMatin("ete")).toMatch(/été/));
});

describe("phraseDeSecours", () => {
  it.each(["automne", "hiver", "printemps", "ete"] as const)("secours %s : court, sans « Bonjour »", (s) => {
    for (const energie of ["high", "medium", "low", "depleted", null, undefined]) {
      const p = phraseDeSecours(energie, s);
      expect(p.length).toBeGreaterThan(0);
      expect(p.length).toBeLessThanOrEqual(LONGUEUR_MAX_MOT);
      expect(p).not.toMatch(/bonjour/i);
    }
  });
  it("énergie épuisée → phrase douce", () => expect(phraseDeSecours("depleted", "automne")).toMatch(/doucement|repos/i));
});
