import { describe, it, expect } from "vitest";
import { receivedVsIntentScore, type ScoreInput } from "./score";

const base: ScoreInput = {
  intent: "awareness", saves: 0, shares: 0, comments: 0,
  reach: 1000, sentimentScore: null, conversionsInWindow: 0,
};

describe("receivedVsIntentScore", () => {
  it("awareness bien reçu : beaucoup de partages → score haut", () => {
    const r = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, saves: 20, comments: 10 });
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThan(0.7);
    expect(r.rationale).toContain("awareness");
  });

  it("consideration bien reçu : saves et commentaires forts → score haut", () => {
    const r = receivedVsIntentScore({ ...base, intent: "consideration", saves: 25, comments: 12, shares: 8 });
    expect(r.score!).toBeGreaterThan(0.7);
  });

  // LE cas littéral de la spec : la triangulation Fil 1 × Fil 3.
  it("conversion avec saves élevés et ZÉRO conversion → score bas", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "conversion", saves: 40, comments: 15, shares: 12, conversionsInWindow: 0,
    });
    expect(r.score!).toBeLessThan(0.4);
    expect(r.rationale).toContain("conversion");
  });

  it("les mêmes saves sur awareness valent bien mieux que sur conversion", () => {
    const signals = { saves: 40, comments: 15, shares: 12, conversionsInWindow: 0 };
    const aw = receivedVsIntentScore({ ...base, intent: "awareness", ...signals });
    const cv = receivedVsIntentScore({ ...base, intent: "conversion", ...signals });
    expect(aw.score!).toBeGreaterThan(cv.score!);
  });

  it("portée absente → null, jamais 0, et confiance nulle", () => {
    const r = receivedVsIntentScore({ ...base, reach: null, saves: 40 });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.rationale.toLowerCase()).toContain("portée");
  });

  it("portée à zéro → null aussi (on ne divise pas par zéro pour fabriquer un taux)", () => {
    expect(receivedVsIntentScore({ ...base, reach: 0, saves: 40 }).score).toBeNull();
  });

  it("sans intention, le contenu est exclu du scoring", () => {
    const r = receivedVsIntentScore({ ...base, intent: null, saves: 40 });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.rationale.toLowerCase()).toContain("intention");
  });

  it("une portée faible abaisse la confiance sans annuler le score", () => {
    const fort = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, reach: 1000 });
    const faible = receivedVsIntentScore({ ...base, intent: "awareness", shares: 1, reach: 50 });
    expect(faible.confidence).toBeLessThan(fort.confidence);
    expect(faible.score).not.toBeNull();
  });

  it("un sentiment négatif dégrade le score sans le renverser", () => {
    const neutre = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, sentimentScore: null });
    const hostile = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, sentimentScore: -1 });
    expect(hostile.score!).toBeLessThan(neutre.score!);
    expect(hostile.score!).toBeGreaterThan(neutre.score! * 0.85);
  });

  it("le score reste borné à [0,1] même avec un sentiment maximal", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "awareness", shares: 100, saves: 100, comments: 100, sentimentScore: 1,
    });
    expect(r.score!).toBeLessThanOrEqual(1);
    expect(r.score!).toBeGreaterThanOrEqual(0);
  });

  it("un signal absent (null) n'est pas traité comme un zéro : il baisse la confiance", () => {
    const complet = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: 10, shares: 5 });
    const partiel = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: null, shares: 5 });
    expect(partiel.confidence).toBeLessThan(complet.confidence);
  });

  it("la conversion est ignorée pour awareness", () => {
    const sans = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, conversionsInWindow: 0 });
    const avec = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, conversionsInWindow: 50 });
    expect(avec.score).toBe(sans.score);
  });

  // Régression : quand "la conversion" (singulier) est le signal dominant, le verdict ne doit
  // jamais employer une forme verbale plurale du type "la conversion ne suivent pas" —
  // c'est la faute d'accord repérée en revue sur le gabarit initial.
  it("le verdict sur la conversion ne porte aucune forme verbale plurale fautive", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "conversion", saves: 40, comments: 15, shares: 12, conversionsInWindow: 0,
    });
    expect(r.rationale).not.toMatch(/\b(suivent|portent|restent)\b/);
  });
});
