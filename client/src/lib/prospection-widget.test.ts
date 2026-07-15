import { describe, it, expect } from "vitest";
import { prospectionWidgetModel, type ProspectionStatusDTO } from "./prospection-widget";

const base: ProspectionStatusDTO = {
  plan: "base",
  enrichment_available: false,
  linkedin_requests_this_week: 0,
  linkedin_weekly_limit: 30,
  reset_day: "monday",
};

describe("prospectionWidgetModel", () => {
  it("plan enrichissement → mode compteur avec pourcentage", () => {
    const m = prospectionWidgetModel({
      ...base,
      plan: "enrichissement",
      enrichment_available: true,
      linkedin_requests_this_week: 15,
    });
    expect(m.mode).toBe("enrichment");
    expect(m.used).toBe(15);
    expect(m.limit).toBe(30);
    expect(m.percent).toBe(50);
    expect(m.atLimit).toBe(false);
  });

  it("plan enrichissement au plafond → atLimit true, percent plafonné à 100", () => {
    const m = prospectionWidgetModel({
      ...base,
      plan: "enrichissement",
      enrichment_available: true,
      linkedin_requests_this_week: 30,
    });
    expect(m.mode).toBe("enrichment");
    expect(m.percent).toBe(100);
    expect(m.atLimit).toBe(true);
  });

  it("dépassement éventuel → percent reste borné à 100", () => {
    const m = prospectionWidgetModel({
      ...base,
      plan: "enrichissement",
      enrichment_available: true,
      linkedin_requests_this_week: 42,
    });
    expect(m.percent).toBe(100);
    expect(m.atLimit).toBe(true);
  });

  it("plan base → mode upsell (bannière)", () => {
    const m = prospectionWidgetModel(base);
    expect(m.mode).toBe("upsell");
  });

  it("status absent (null) → mode caché", () => {
    const m = prospectionWidgetModel(null);
    expect(m.mode).toBe("hidden");
  });
});
