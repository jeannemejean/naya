import { describe, it, expect } from "vitest";
import { preferencesDeFinOnboarding } from "./planning-start";

describe("preferencesDeFinOnboarding — terminer l'onboarding démarre le planning", () => {
  const p = preferencesDeFinOnboarding(42);

  it("retient la marque principale comme marque active", () => {
    expect(p.activeProjectId).toBe(42);
  });

  it("lève une pause héritée d'avant la réinitialisation", () => {
    expect(p.planningStatus).toBe("active");
    expect(p.planningPausedAt).toBeNull();
  });

  it("efface une date de démarrage future (le planning part aujourd'hui)", () => {
    expect(p.planningStartDate).toBeNull();
  });

  it("efface le brief du jour de l'ancien compte", () => {
    expect(p.dailyBriefDate).toBeNull();
    expect(p.dailyBriefContent).toBeNull();
    expect(p.dailyBriefDismissed).toBe(false);
  });

  it("ne touche pas aux vrais réglages (horaires, jours travaillés)", () => {
    expect(p).not.toHaveProperty("workDayStart");
    expect(p).not.toHaveProperty("workDayEnd");
    expect(p).not.toHaveProperty("workDays");
  });
});
