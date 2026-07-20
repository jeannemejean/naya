import { describe, it, expect } from "vitest";
import { planNextStep, withinSendingWindow, daysBetween } from "./prospection-sender";

describe("daysBetween", () => {
  it("compte les jours pleins écoulés", () => {
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-04T09:00:00Z"))).toBe(3);
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-01T20:00:00Z"))).toBe(0);
  });
});

describe("withinSendingWindow", () => {
  const opts = { startMin: 9 * 60, endMin: 18 * 60, workDays: new Set(["mon", "tue", "wed", "thu", "fri"]) };
  it("jour ouvré + dans les heures → true", () => {
    expect(withinSendingWindow(10 * 60, "tue", opts)).toBe(true);
  });
  it("avant l'ouverture → false", () => {
    expect(withinSendingWindow(8 * 60, "tue", opts)).toBe(false);
  });
  it("après la fermeture → false", () => {
    expect(withinSendingWindow(18 * 60, "tue", opts)).toBe(false);
  });
  it("week-end → false même en pleine journée", () => {
    expect(withinSendingWindow(11 * 60, "sat", opts)).toBe(false);
    expect(withinSendingWindow(11 * 60, "sun", opts)).toBe(false);
  });
});

const steps = [
  { delayDays: 0 }, // étape 1 (index 0)
  { delayDays: 3 }, // étape 2
  { delayDays: 4 }, // étape 3
];

describe("planNextStep", () => {
  it("currentStep=0 → envoie l'étape 0, programme l'étape 1 à +3j", () => {
    expect(planNextStep(0, steps)).toEqual({ sendIndex: 0, done: false, nextDelayDays: 3 });
  });
  it("currentStep=1 → envoie l'étape 1, programme l'étape 2 à +4j", () => {
    expect(planNextStep(1, steps)).toEqual({ sendIndex: 1, done: false, nextDelayDays: 4 });
  });
  it("currentStep=2 (dernière) → envoie l'étape 2 puis termine", () => {
    expect(planNextStep(2, steps)).toEqual({ sendIndex: 2, done: true, nextDelayDays: null });
  });
  it("currentStep au-delà → plus rien à envoyer (terminé)", () => {
    expect(planNextStep(3, steps)).toEqual({ sendIndex: null, done: true, nextDelayDays: null });
  });
  it("séquence vide → terminé", () => {
    expect(planNextStep(0, [])).toEqual({ sendIndex: null, done: true, nextDelayDays: null });
  });
});
