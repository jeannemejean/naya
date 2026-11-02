import { describe, it, expect } from "vitest";
import { deriveSignals, planAcceptance } from "./sequence-signals";

const d = new Date();
describe("deriveSignals", () => {
  it("aucun signal par défaut", () => {
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: null, status: "active" }))
      .toEqual({ opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false, inviteAcceptedAt: null });
  });
  it("ouverture email détectée", () => {
    const s = deriveSignals(
      [{ platform: "email", openedAt: d, clickedAt: null, bouncedAt: null }],
      { linkedinConnectedAt: null }, { repliedAt: null, status: "active" });
    expect(s.opened).toBe(true);
  });
  it("clic implique ouverture; bounce détecté", () => {
    const s = deriveSignals(
      [{ platform: "email", openedAt: null, clickedAt: d, bouncedAt: null },
       { platform: "email", openedAt: null, clickedAt: null, bouncedAt: d }],
      { linkedinConnectedAt: null }, { repliedAt: null, status: "active" });
    expect(s.clicked).toBe(true);
    expect(s.opened).toBe(true);
    expect(s.bounced).toBe(true);
  });
  it("réponse via repliedAt ou status stopped_replied", () => {
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: d, status: "active" }).replied).toBe(true);
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: null, status: "stopped_replied" }).replied).toBe(true);
  });
  it("invitation acceptée via linkedinConnectedAt", () => {
    expect(deriveSignals([], { linkedinConnectedAt: d }, { repliedAt: null, status: "active" }).inviteAccepted).toBe(true);
  });
});

describe("planAcceptance", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 2 + n));
  it("acceptation au jour 3 sur séquence active → nextRunAt = now (re-décision avant la limite)", () => {
    const r = planAcceptance(null, day(3), "active", day(3));
    expect(r).toEqual({ linkedinConnectedAt: day(3), wakeSequenceAt: day(3) });
  });
  it("garde la date existante plus ancienne", () => {
    expect(planAcceptance(day(1), day(3), "active", day(3)).linkedinConnectedAt).toEqual(day(1));
  });
  it("une date donnée plus ancienne remplace l'existante", () => {
    expect(planAcceptance(day(3), day(1), "active", day(4)).linkedinConnectedAt).toEqual(day(1));
  });
  it("séquence non active → pas de réveil", () => {
    expect(planAcceptance(null, day(3), "completed", day(3)).wakeSequenceAt).toBeNull();
    expect(planAcceptance(null, day(3), null, day(3)).wakeSequenceAt).toBeNull();
  });
});
