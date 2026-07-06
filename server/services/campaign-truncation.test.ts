import { describe, it, expect } from "vitest";
import { assertNotTruncated } from "./claude";

// Garde-fou : on ne DOIT jamais parser en JSON une réponse tronquée (budget de tokens atteint).
describe("assertNotTruncated — garde-fou anti-troncature (génération de campagne)", () => {
  it("lève une erreur explicite si la réponse Anthropic est coupée (stop_reason = max_tokens)", () => {
    expect(() => assertNotTruncated("max_tokens", "stratégie")).toThrow(/CAMPAIGN_TRUNCATED/);
    // le message nomme l'étape concernée
    expect(() => assertNotTruncated("max_tokens", "stratégie")).toThrow(/stratégie/);
  });

  it("lève une erreur si la réponse OpenAI est coupée (finish_reason = length)", () => {
    expect(() => assertNotTruncated("length", "plan de contenu")).toThrow(/CAMPAIGN_TRUNCATED/);
    expect(() => assertNotTruncated("length", "plan de contenu")).toThrow(/plan de contenu/);
  });

  it("ne lève RIEN sur une fin normale (end_turn / stop / undefined)", () => {
    expect(() => assertNotTruncated("end_turn", "tâches")).not.toThrow();
    expect(() => assertNotTruncated("stop", "tâches")).not.toThrow();
    expect(() => assertNotTruncated(undefined, "tâches")).not.toThrow();
  });
});
