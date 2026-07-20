import { describe, it, expect } from "vitest";
import { evaluateCondition, decideNextStep } from "./sequence-engine";
import type { LeadSignals } from "./sequence-signals";

const NONE: LeadSignals = { opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false };

describe("evaluateCondition", () => {
  it("always → toujours vrai", () => expect(evaluateCondition("always", NONE)).toBe(true));
  it("if_opened", () => {
    expect(evaluateCondition("if_opened", NONE)).toBe(false);
    expect(evaluateCondition("if_opened", { ...NONE, opened: true })).toBe(true);
  });
  it("if_not_opened", () => {
    expect(evaluateCondition("if_not_opened", NONE)).toBe(true);
    expect(evaluateCondition("if_not_opened", { ...NONE, opened: true })).toBe(false);
  });
  it("if_invite_accepted / not_accepted", () => {
    expect(evaluateCondition("if_invite_accepted", { ...NONE, inviteAccepted: true })).toBe(true);
    expect(evaluateCondition("if_invite_not_accepted", NONE)).toBe(true);
  });
});

describe("decideNextStep", () => {
  const steps = [
    { delayDays: 0, condition: "always" },
    { delayDays: 3, condition: "if_not_opened" },
    { delayDays: 3, condition: "if_opened" },
  ];
  it("séquence terminée", () => {
    expect(decideNextStep(3, steps, NONE, 10)).toEqual({ action: "done" });
  });
  it("attend si le délai n'est pas écoulé", () => {
    expect(decideNextStep(1, steps, NONE, 1)).toEqual({ action: "wait" });
  });
  it("envoie l'étape 0 (always) immédiatement", () => {
    expect(decideNextStep(0, steps, NONE, 0)).toEqual({ action: "send", index: 0, done: false });
  });
  it("condition vraie → send après délai", () => {
    expect(decideNextStep(1, steps, NONE, 3)).toEqual({ action: "send", index: 1, done: false });
  });
  it("condition fausse → skip", () => {
    // à l'étape 1, si l'email a été ouvert, l'étape if_not_opened est sautée
    expect(decideNextStep(1, steps, { ...NONE, opened: true }, 3)).toEqual({ action: "skip", index: 1 });
  });
  it("dernière étape marque done", () => {
    expect(decideNextStep(2, steps, { ...NONE, opened: true }, 3)).toEqual({ action: "send", index: 2, done: true });
  });
});
