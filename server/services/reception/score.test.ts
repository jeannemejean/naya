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

  // Une portée SAISIE à 0 est une mesure, pas une absence : lui répondre « Portée inconnue »
  // ment à qui vient précisément de taper 0. Deux causes, deux phrases.
  it("distingue une portée inconnue d'une portée mesurée à zéro dans la raison donnée", () => {
    const inconnue = receivedVsIntentScore({ ...base, reach: null, saves: 40 });
    const zero = receivedVsIntentScore({ ...base, reach: 0, saves: 40 });

    expect(inconnue.score).toBeNull();
    expect(zero.score).toBeNull();
    expect(zero.rationale).not.toBe(inconnue.rationale);
    expect(inconnue.rationale.toLowerCase()).toContain("inconnue");
    expect(zero.rationale.toLowerCase()).not.toContain("inconnue");
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

  it("un signal absent (null) n'est pas traité comme un zéro : il baisse la confiance, jamais le score au même titre qu'un zéro mesuré", () => {
    const complet = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: 10, shares: 5 });
    const partielNull = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: null, shares: 5 });
    const partielZero = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: 0, shares: 5 });
    expect(partielNull.confidence).toBeLessThan(complet.confidence);
    // LE test qui aurait attrapé le bug : un signal manquant se retire du calcul (le score se
    // renormalise sur ce qui a été mesuré) — il ne doit jamais produire le même score qu'un
    // signal réellement mesuré à zéro.
    expect(partielNull.score).not.toBe(partielZero.score);
    expect(partielNull.score!).toBeGreaterThan(partielZero.score!);
  });

  // Second signal comptant : quand aucun signal pondéré n'est mesuré, il n'y a rien à juger —
  // pas un échec déguisé en zéro.
  it("tous les signaux pondérés absents → rien à juger : score null, confiance nulle", () => {
    const r = receivedVsIntentScore({ ...base, intent: "consideration", saves: null, shares: null, comments: null });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
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

  // La conversion NON MESURÉE (`null`) n'est pas la conversion mesurée à zéro : elle sort du
  // calcul comme n'importe quel signal absent, au lieu de plafonner le contenu à 0,30.
  it("une conversion non mesurée (null) est exclue du calcul, pas comptée comme un échec", () => {
    const signaux = { intent: "conversion" as const, saves: 40, comments: 15, shares: 12 };
    const zeroMesure = receivedVsIntentScore({ ...base, ...signaux, conversionsInWindow: 0 });
    const nonMesure = receivedVsIntentScore({ ...base, ...signaux, conversionsInWindow: null });

    expect(nonMesure.score).not.toBeNull();
    expect(nonMesure.score!).toBeGreaterThan(zeroMesure.score!);
    // L'incertitude pèse sur la confiance, jamais sur le score.
    expect(nonMesure.confidence).toBeLessThan(zeroMesure.confidence);
  });

  it("tous les signaux absents ET la conversion non mesurée → rien à juger", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "conversion", saves: null, shares: null, comments: null, conversionsInWindow: null,
    });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

/**
 * TOTALITÉ de la fonction sur son domaine RÉEL. `content.intent` est une colonne `text`
 * libre : `insertContentSchema` accepte n'importe quelle chaîne et `PATCH /api/content/:id`
 * ne blanchit rien. Une valeur hors vocabulaire arrivait donc jusqu'ici et faisait
 * `Object.keys(undefined)` — une TypeError, rattrapée par le best-effort de l'ingestion,
 * mais qui PERDAIT la mesure et la rapportait sous un message technique illisible.
 * La sortie légitime est un score `null` avec une raison en français.
 */
describe("receivedVsIntentScore — intention hors vocabulaire", () => {
  it("ne jette jamais sur une valeur inventée : score null et raison lisible", () => {
    const r = receivedVsIntentScore({ ...base, intent: "engagement" as any, saves: 40, shares: 10 });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.rationale.toLowerCase()).toContain("intention");
    // Une raison, pas une trace technique.
    expect(r.rationale).not.toMatch(/undefined|TypeError|Object\.keys/);
  });

  it("ne jette jamais sur une variante de casse — jamais de correction silencieuse non plus", () => {
    const r = receivedVsIntentScore({ ...base, intent: "Awareness" as any, saves: 40, shares: 10 });
    const bonneCasse = receivedVsIntentScore({ ...base, intent: "awareness", saves: 40, shares: 10 });
    expect(r.score).toBeNull();
    expect(bonneCasse.score).not.toBeNull();
  });

  it("ne jette pas non plus sur un type inattendu venu de la base", () => {
    for (const valeur of [42, {}, [], true, ""]) {
      const r = receivedVsIntentScore({ ...base, intent: valeur as any, saves: 40, shares: 10 });
      expect(r.score).toBeNull();
      expect(r.confidence).toBe(0);
    }
  });
});
