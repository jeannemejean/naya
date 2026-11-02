import { describe, it, expect } from "vitest";
import { EVENT_MIN_GAP_MS, INVITE_ACCEPT_WAIT_DAYS, evaluateCondition, decideNextStep, planAfterStep, stepOrderFromMessageType } from "./sequence-engine";
import type { LeadSignals } from "./sequence-signals";

const NONE: LeadSignals = { opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false, inviteAcceptedAt: null };

const DAY = 86_400_000;
const EVENT_GAP = EVENT_MIN_GAP_MS;
const T0 = new Date("2026-11-02T10:00:00Z");
const at = (days: number, extraMs = 0) => new Date(T0.getTime() + days * DAY + extraMs);
const tm = (days: number, anchor = T0) => ({ anchorAt: anchor, now: at(days) });

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
  it("if_clicked", () => {
    expect(evaluateCondition("if_clicked", NONE)).toBe(false);
    expect(evaluateCondition("if_clicked", { ...NONE, clicked: true })).toBe(true);
  });
  it("if_invite_accepted / not_accepted", () => {
    expect(evaluateCondition("if_invite_accepted", { ...NONE, inviteAccepted: true })).toBe(true);
    expect(evaluateCondition("if_invite_accepted", NONE)).toBe(false);
    expect(evaluateCondition("if_invite_not_accepted", NONE)).toBe(true);
    expect(evaluateCondition("if_invite_not_accepted", { ...NONE, inviteAccepted: true })).toBe(false);
  });
});

describe("decideNextStep", () => {
  const steps = [
    { delayDays: 0, condition: "always" },
    { delayDays: 3, condition: "if_not_opened" },
    { delayDays: 3, condition: "if_opened" },
  ];
  it("séquence terminée", () => {
    expect(decideNextStep(3, steps, NONE, tm(10))).toEqual({ action: "done" });
  });
  it("attend si le délai n'est pas écoulé", () => {
    expect(decideNextStep(1, steps, NONE, tm(1))).toEqual({ action: "wait", until: at(3) });
  });
  it("envoie l'étape 0 (always) immédiatement", () => {
    expect(decideNextStep(0, steps, NONE, tm(0))).toEqual({ action: "send", index: 0, done: false });
  });
  it("condition vraie → send après délai", () => {
    expect(decideNextStep(1, steps, NONE, tm(3))).toEqual({ action: "send", index: 1, done: false });
  });
  it("condition fausse → skip", () => {
    // à l'étape 1, si l'email a été ouvert, l'étape if_not_opened est sautée
    expect(decideNextStep(1, steps, { ...NONE, opened: true }, tm(3))).toEqual({ action: "skip", index: 1 });
  });
  it("dernière étape marque done", () => {
    expect(decideNextStep(2, steps, { ...NONE, opened: true }, tm(3))).toEqual({ action: "send", index: 2, done: true });
  });
});

describe("planAfterStep", () => {
  const signals = NONE;
  const now = new Date("2026-10-30T10:00:00Z");
  it("programme l'étape suivante à partir de maintenant, avec son délai", () => {
    const r = planAfterStep(0, [{ delayDays: 0, condition: "always" }, { delayDays: 2, condition: "always" }], signals, now);
    expect(r).toEqual({ currentStep: 1, lastStepSentAt: now, delayAnchorAt: now, status: "active", nextRunAt: new Date(now.getTime() + 2 * 86_400_000) });
  });
  it("dernière étape → terminée", () => {
    expect(planAfterStep(0, [{ delayDays: 0, condition: "always" }], signals, now)).toMatchObject({ status: "completed", nextRunAt: null });
  });
});

describe("délais depuis l'événement", () => {
  const acc = { delayDays: 2, condition: "if_invite_accepted" };
  it("acceptée au jour 3, délai 2 j → wait jusqu'au jour 5, jamais envoyé au jour 3", () => {
    const sig = { ...NONE, inviteAccepted: true, inviteAcceptedAt: at(3) };
    expect(decideNextStep(0, [acc], sig, tm(3))).toEqual({ action: "wait", until: at(5) });
    expect(decideNextStep(0, [acc], sig, tm(4.9))).toMatchObject({ action: "wait" });
    expect(decideNextStep(0, [acc], sig, tm(5))).toEqual({ action: "send", index: 0, done: true });
  });
  it("délai 0 après acceptation → wait jusqu'à acceptation + 2 h", () => {
    const sig = { ...NONE, inviteAccepted: true, inviteAcceptedAt: at(1) };
    const step = [{ delayDays: 0, condition: "if_invite_accepted" }];
    expect(decideNextStep(0, step, { ...sig }, { anchorAt: T0, now: at(1, 3_600_000) }))
      .toEqual({ action: "wait", until: at(1, EVENT_GAP) });
    expect(decideNextStep(0, step, sig, { anchorAt: T0, now: at(1, EVENT_GAP) })).toMatchObject({ action: "send" });
  });
  it("non acceptée au jour 13 → wait ; au jour 14 → skip avec newAnchorAt = invitation + 14 j", () => {
    expect(decideNextStep(0, [acc], NONE, tm(13))).toEqual({ action: "wait", until: at(INVITE_ACCEPT_WAIT_DAYS) });
    expect(decideNextStep(0, [acc], NONE, tm(14))).toEqual({ action: "skip", index: 0, newAnchorAt: at(14) });
  });
  it("if_invite_not_accepted délai 3 j après expiration → envoyé au jour 17, pas avant", () => {
    const steps = [acc, { delayDays: 3, condition: "if_invite_not_accepted" }];
    expect(decideNextStep(1, steps, NONE, tm(16, at(14)))).toEqual({ action: "wait", until: at(17) });
    expect(decideNextStep(1, steps, NONE, tm(17, at(14)))).toEqual({ action: "send", index: 1, done: true });
  });
  it("if_invite_not_accepted isolée : attend 14 j + délai depuis l'ancre ; acceptée → skip", () => {
    const steps = [{ delayDays: 3, condition: "if_invite_not_accepted" }];
    expect(decideNextStep(0, steps, NONE, tm(16))).toEqual({ action: "wait", until: at(17) });
    expect(decideNextStep(0, steps, NONE, tm(17))).toMatchObject({ action: "send" });
    expect(decideNextStep(0, steps, { ...NONE, inviteAccepted: true, inviteAcceptedAt: at(2) }, tm(5)))
      .toEqual({ action: "skip", index: 0 });
  });
  it("étape always après une étape if_invite_accepted en attente → rien ne part (séquentiel)", () => {
    const steps = [acc, { delayDays: 0, condition: "always" }];
    expect(decideNextStep(0, steps, NONE, tm(5))).toMatchObject({ action: "wait" });
  });
  it("planAfterStep pose delayAnchorAt = now", () => {
    expect(planAfterStep(0, [{ delayDays: 0, condition: "always" }, acc], NONE, T0).delayAnchorAt).toEqual(T0);
  });
  it("planAfterStep : prochaine étape d'invitation en attente → nextRunAt = limite d'acceptation", () => {
    expect(planAfterStep(0, [{ delayDays: 0, condition: "always" }, acc], NONE, T0).nextRunAt).toEqual(at(14));
  });
});

describe("stepOrderFromMessageType", () => {
  it("lit le rang de l'étape", () => {
    expect(stepOrderFromMessageType("step_2")).toBe(2);
    expect(stepOrderFromMessageType("step_3_invitation")).toBe(3);
    expect(stepOrderFromMessageType("manual")).toBeNull();
  });
});
