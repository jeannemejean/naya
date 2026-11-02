import { describe, it, expect } from "vitest";
import { linkedinGapMs, LINKEDIN_FENETRE } from "./linkedin-rythme";

const MIN = 60_000;

describe("linkedinGapMs", () => {
  it("est toujours >= 15 min et <= 25 + 120 min", () => {
    for (let i = 0; i < 600; i++) {
      const g = linkedinGapMs(new Date(1_700_000_000_000 + i * 7919_000), `u${i % 5}|utilisatrice`);
      expect(g).toBeGreaterThanOrEqual(15 * MIN);
      expect(g).toBeLessThanOrEqual(145 * MIN);
    }
  });
  it("sur 600 graines, entre 10 % et 25 % comportent une pause >= 60 min", () => {
    let pauses = 0;
    for (let i = 0; i < 600; i++) {
      if (linkedinGapMs(new Date(1_700_000_000_000 + i * 123_457), "u1|utilisatrice") >= 60 * MIN) pauses++;
    }
    expect(pauses / 600).toBeGreaterThanOrEqual(0.1);
    expect(pauses / 600).toBeLessThanOrEqual(0.25);
  });
  it("même entrée → même résultat", () => {
    const d = new Date("2026-06-10T07:00:00Z");
    expect(linkedinGapMs(d, "u1|x")).toBe(linkedinGapMs(d, "u1|x"));
  });
  it("fenêtre 8 h-18 h en semaine", () => {
    expect(LINKEDIN_FENETRE.startMin).toBe(480);
    expect(LINKEDIN_FENETRE.endMin).toBe(1080);
    expect(LINKEDIN_FENETRE.workDays.has("sat")).toBe(false);
  });
});
