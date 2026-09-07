import { describe, it, expect } from "vitest";
import { unansweredStreak, shouldReduceFrequency, type PromptRecord } from "./throttle";

const NOW = new Date("2026-09-07T12:00:00Z");
const PAST = new Date("2026-09-07T10:00:00Z");
const FUTURE = new Date("2026-09-07T14:00:00Z");

const p = (answered: boolean, scheduledFor: Date = PAST): PromptRecord => ({
  answeredAt: answered ? new Date("2026-09-07T10:05:00Z") : null,
  scheduledFor,
});

describe("unansweredStreak", () => {
  it("compte les notifications ignorées les plus récentes", () => {
    // Ordre : de la plus récente à la plus ancienne.
    expect(unansweredStreak([p(false), p(false), p(true), p(false)], NOW)).toBe(2);
  });

  it("une réponse remet le compteur à zéro", () => {
    expect(unansweredStreak([p(true), p(false), p(false), p(false)], NOW)).toBe(0);
  });

  it("aucune notification = aucune série", () => {
    expect(unansweredStreak([], NOW)).toBe(0);
  });

  it("une seule notification ignorée entre deux réponses ne fait pas basculer la série", () => {
    // Scénario nommé dans la consigne : ignorée-répondue-ignorée-ignorée -> reste à 1.
    expect(unansweredStreak([p(false), p(true), p(false), p(false)], NOW)).toBe(1);
  });

  it("une alarme future sans réponse en tête de liste ne compte pas", () => {
    expect(unansweredStreak([p(false, FUTURE), p(false), p(false)], NOW)).toBe(2);
  });

  it("une alarme future sans réponse, seule dans la liste, ne déclenche jamais la soupape", () => {
    const streak = unansweredStreak([p(false, FUTURE)], NOW);
    expect(streak).toBe(0);
    expect(shouldReduceFrequency(streak)).toBe(false);
  });

  it("trois alarmes futures sans réponse ne déclenchent pas la soupape", () => {
    // Le scénario exact du défaut critique : triées de la plus récente à la plus
    // ancienne par scheduledFor, trois alarmes pas encore arrivées se retrouvent en
    // tête — elles ne doivent pas être comptées comme ignorées.
    const streak = unansweredStreak([p(false, FUTURE), p(false, FUTURE), p(false, FUTURE)], NOW);
    expect(streak).toBe(0);
    expect(shouldReduceFrequency(streak)).toBe(false);
  });

  it("une alarme exactement à l'instant présent compte comme échue", () => {
    // Inclusif aux deux bornes, comme la fenêtre d'attribution ailleurs dans ce dépôt.
    expect(unansweredStreak([p(false, NOW)], NOW)).toBe(1);
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
