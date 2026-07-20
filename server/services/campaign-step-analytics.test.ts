import { describe, it, expect } from "vitest";
import { parseStepNumber, aggregateStepAnalytics, type OutreachMessageRow } from "./campaign-step-analytics";

describe("parseStepNumber", () => {
  it("étape email simple: step_2 → 2", () => {
    expect(parseStepNumber("step_2")).toBe(2);
  });
  it("étape LinkedIn avec action: step_3_invitation → 3", () => {
    expect(parseStepNumber("step_3_invitation")).toBe(3);
  });
  it("étape à deux chiffres: step_12_followup → 12", () => {
    expect(parseStepNumber("step_12_followup")).toBe(12);
  });
  it("messageType malformé → null", () => {
    expect(parseStepNumber("bogus")).toBeNull();
    expect(parseStepNumber("stepX_2")).toBeNull();
    expect(parseStepNumber("")).toBeNull();
  });
});

describe("aggregateStepAnalytics", () => {
  const d = new Date();

  it("aucun message → tableaux vides", () => {
    expect(aggregateStepAnalytics([], new Set())).toEqual({ byStep: [], byChannel: [] });
  });

  it("regroupe par étape + canal, ignore les messageType non parsables", () => {
    const messages: OutreachMessageRow[] = [
      { leadId: 1, platform: "email", messageType: "step_1", sentAt: d, openedAt: d, clickedAt: null, bouncedAt: null },
      { leadId: 2, platform: "email", messageType: "step_1", sentAt: d, openedAt: null, clickedAt: null, bouncedAt: null },
      { leadId: 3, platform: "linkedin", messageType: "step_1_invitation", sentAt: d, openedAt: null, clickedAt: null, bouncedAt: null },
      { leadId: 4, platform: "linkedin", messageType: "junk", sentAt: d, openedAt: null, clickedAt: null, bouncedAt: null },
    ];
    const { byStep } = aggregateStepAnalytics(messages, new Set());
    expect(byStep).toEqual([
      { stepOrder: 1, channel: "email", sent: 2, opened: 1, clicked: 0, bounced: 0 },
      { stepOrder: 1, channel: "linkedin", sent: 1, opened: 0, clicked: 0, bounced: 0 },
    ]);
  });

  it("sent ne compte que sentAt non nul (brouillons LinkedIn exclus)", () => {
    const messages: OutreachMessageRow[] = [
      { leadId: 1, platform: "linkedin", messageType: "step_1", sentAt: null, openedAt: null, clickedAt: null, bouncedAt: null },
    ];
    const { byStep, byChannel } = aggregateStepAnalytics(messages, new Set());
    expect(byStep).toEqual([{ stepOrder: 1, channel: "linkedin", sent: 0, opened: 0, clicked: 0, bounced: 0 }]);
    expect(byChannel).toEqual([{ channel: "linkedin", sent: 0, replied: 0 }]);
  });

  it("byChannel: replied attribué au canal du DERNIER message réellement envoyé du lead", () => {
    const older = new Date(d.getTime() - 60_000);
    const messages: OutreachMessageRow[] = [
      { leadId: 1, platform: "email", messageType: "step_1", sentAt: older, openedAt: null, clickedAt: null, bouncedAt: null },
      { leadId: 1, platform: "linkedin", messageType: "step_2", sentAt: d, openedAt: null, clickedAt: null, bouncedAt: null },
    ];
    const { byChannel } = aggregateStepAnalytics(messages, new Set([1]));
    expect(byChannel).toEqual([
      { channel: "email", sent: 1, replied: 0 },
      { channel: "linkedin", sent: 1, replied: 1 },
    ]);
  });

  it("lead marqué répondu mais sans aucun message envoyé → ignoré (pas de canal à attribuer)", () => {
    const messages: OutreachMessageRow[] = [
      { leadId: 5, platform: "linkedin", messageType: "step_1", sentAt: null, openedAt: null, clickedAt: null, bouncedAt: null },
    ];
    const { byChannel } = aggregateStepAnalytics(messages, new Set([5]));
    expect(byChannel).toEqual([{ channel: "linkedin", sent: 0, replied: 0 }]);
  });
});
