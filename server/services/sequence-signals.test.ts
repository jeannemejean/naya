import { describe, it, expect } from "vitest";
import { deriveSignals } from "./sequence-signals";

const d = new Date();
describe("deriveSignals", () => {
  it("aucun signal par défaut", () => {
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: null, status: "active" }))
      .toEqual({ opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false });
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
