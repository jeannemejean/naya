import { describe, it, expect } from "vitest";
import { unansweredStreak, shouldReduceFrequency, type PromptRecord } from "./throttle";

const p = (answered: boolean): PromptRecord => ({
  answeredAt: answered ? new Date("2026-09-07T10:00:00Z") : null,
});

describe("unansweredStreak", () => {
  it("compte les notifications ignorées les plus récentes", () => {
    // Ordre : de la plus récente à la plus ancienne.
    expect(unansweredStreak([p(false), p(false), p(true), p(false)])).toBe(2);
  });

  it("une réponse remet le compteur à zéro", () => {
    expect(unansweredStreak([p(true), p(false), p(false), p(false)])).toBe(0);
  });

  it("aucune notification = aucune série", () => {
    expect(unansweredStreak([])).toBe(0);
  });
});

describe("shouldReduceFrequency", () => {
  it("ne se déclenche pas à deux", () => {
    expect(shouldReduceFrequency(2)).toBe(false);
  });

  it("se déclenche à trois — le seuil décidé avec Jeanne", () => {
    expect(shouldReduceFrequency(3)).toBe(true);
  });

  it("reste déclenchée au-delà", () => {
    expect(shouldReduceFrequency(7)).toBe(true);
  });
});
