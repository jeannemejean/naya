import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB) mais on garde la vraie logique d'accès/limite.
vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getSubscription: vi.fn(),
    countProspectionOperationsSince: vi.fn(),
  },
}));

import { storage } from "../storage";
import {
  LINKEDIN_WEEKLY_LIMIT,
  PROSPECTION_USAGE_COSTS_CENTS,
  OPERATION_COST_CENTS,
} from "./prospection-config";
import {
  resolveProspectionPlan,
  assertPlanHasEnrichment,
  assertWithinLinkedInWeeklyLimit,
  linkedInWeekStart,
  buildProspectionStatus,
  hasProspectionEnrichment,
  getLinkedInRequestsThisWeek,
  assertEnrichmentAccess,
  ProspectionAccessError,
  LinkedInWeeklyLimitError,
} from "./prospection-access";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Config ───────────────────────────────────────────────────────────────────
describe("prospection-config", () => {
  it("expose une limite LinkedIn de 30", () => {
    expect(LINKEDIN_WEEKLY_LIMIT).toBe(30);
  });
  it("expose les coûts unitaires attendus (cents)", () => {
    expect(PROSPECTION_USAGE_COSTS_CENTS).toMatchObject({
      BRIGHT_DATA_SEARCH: 1,
      BRIGHT_DATA_LINKEDIN_ENRICH: 8,
      BRIGHT_DATA_INSTAGRAM: 1,
      BRIGHT_DATA_WEB_SCRAPE: 1,
      CLAUDE_AUDIT: 2,
      CLAUDE_MESSAGE: 1,
    });
    expect(OPERATION_COST_CENTS["bright_data_linkedin_enrich"]).toBe(8);
  });
});

// ─── resolveProspectionPlan (pur) ──────────────────────────────────────────────
describe("resolveProspectionPlan", () => {
  it("owner → enrichissement quel que soit l'abonnement", () => {
    expect(resolveProspectionPlan({ role: "owner" }, null)).toBe("enrichissement");
  });
  it("comped → enrichissement", () => {
    expect(resolveProspectionPlan({ role: "comped" }, null)).toBe("enrichissement");
  });
  it("user avec abonnement actif + flag enrichissement → enrichissement", () => {
    expect(
      resolveProspectionPlan(
        { role: "user" },
        { status: "active", prospectionPlan: "enrichissement", currentPeriodEnd: null },
      ),
    ).toBe("enrichissement");
  });
  it("user avec abonnement actif mais flag base → base", () => {
    expect(
      resolveProspectionPlan(
        { role: "user" },
        { status: "active", prospectionPlan: "base", currentPeriodEnd: null },
      ),
    ).toBe("base");
  });
  it("user avec flag enrichissement MAIS abonnement inactif → base (accès Naya requis)", () => {
    expect(
      resolveProspectionPlan(
        { role: "user" },
        { status: "canceled", prospectionPlan: "enrichissement", currentPeriodEnd: null },
      ),
    ).toBe("base");
  });
  it("user sans abonnement → base", () => {
    expect(resolveProspectionPlan({ role: "user" }, null)).toBe("base");
  });
});

// ─── Assertions pures ──────────────────────────────────────────────────────────
describe("assertPlanHasEnrichment", () => {
  it("plan base → throw ProspectionAccessError avec message clair", () => {
    expect(() => assertPlanHasEnrichment("base")).toThrow(ProspectionAccessError);
    try {
      assertPlanHasEnrichment("base");
    } catch (e: any) {
      expect(e.message).toMatch(/Enrichissement/i);
      expect(e.message).toMatch(/15/);
    }
  });
  it("plan enrichissement → ne throw pas", () => {
    expect(() => assertPlanHasEnrichment("enrichissement")).not.toThrow();
  });
});

describe("assertWithinLinkedInWeeklyLimit", () => {
  it("count < limite → ok", () => {
    expect(() => assertWithinLinkedInWeeklyLimit(0)).not.toThrow();
    expect(() => assertWithinLinkedInWeeklyLimit(29)).not.toThrow();
  });
  it("count == limite → throw avec message '(30/30) — recommence lundi'", () => {
    try {
      assertWithinLinkedInWeeklyLimit(30);
      throw new Error("aurait dû throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(LinkedInWeeklyLimitError);
      expect(e.message).toContain("(30/30)");
      expect(e.message).toMatch(/recommence lundi/i);
    }
  });
});

// ─── linkedInWeekStart (pur, Europe/Paris) ─────────────────────────────────────
describe("linkedInWeekStart", () => {
  it("un mercredi de juillet → lundi minuit heure de Paris (UTC+2)", () => {
    const now = new Date("2026-07-15T10:00:00Z"); // mercredi
    const start = linkedInWeekStart(now);
    // Lundi 2026-07-13 00:00 Paris = 2026-07-12T22:00:00Z
    expect(start.toISOString()).toBe("2026-07-12T22:00:00.000Z");
  });
  it("le lundi même → début de CE lundi (borne <= now)", () => {
    const now = new Date("2026-07-13T08:00:00Z");
    const start = linkedInWeekStart(now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(start.toISOString()).toBe("2026-07-12T22:00:00.000Z");
  });
});

// ─── buildProspectionStatus (pur) ──────────────────────────────────────────────
describe("buildProspectionStatus", () => {
  it("plan enrichissement → payload complet", () => {
    expect(
      buildProspectionStatus({ plan: "enrichissement", linkedinRequestsThisWeek: 7 }),
    ).toEqual({
      plan: "enrichissement",
      enrichment_available: true,
      linkedin_requests_this_week: 7,
      linkedin_weekly_limit: 30,
      reset_day: "monday",
    });
  });
  it("plan base → enrichment_available false", () => {
    expect(
      buildProspectionStatus({ plan: "base", linkedinRequestsThisWeek: 0 }),
    ).toEqual({
      plan: "base",
      enrichment_available: false,
      linkedin_requests_this_week: 0,
      linkedin_weekly_limit: 30,
      reset_day: "monday",
    });
  });
});

// ─── DB-facing (storage mocké) ─────────────────────────────────────────────────
function mockUserSub(role: string, sub: any) {
  (storage.getUser as any).mockResolvedValue({ id: "u1", role });
  (storage.getSubscription as any).mockResolvedValue(sub);
}

describe("hasProspectionEnrichment", () => {
  it("user base → false", async () => {
    mockUserSub("user", { status: "active", prospectionPlan: "base", currentPeriodEnd: null });
    expect(await hasProspectionEnrichment("u1")).toBe(false);
  });
  it("user enrichissement → true", async () => {
    mockUserSub("user", { status: "active", prospectionPlan: "enrichissement", currentPeriodEnd: null });
    expect(await hasProspectionEnrichment("u1")).toBe(true);
  });
  it("owner → true", async () => {
    mockUserSub("owner", null);
    expect(await hasProspectionEnrichment("u1")).toBe(true);
  });
});

describe("getLinkedInRequestsThisWeek", () => {
  it("délègue le comptage au storage sur les ops LinkedIn de la semaine", async () => {
    (storage.countProspectionOperationsSince as any).mockResolvedValue(12);
    const n = await getLinkedInRequestsThisWeek("u1", new Date("2026-07-15T10:00:00Z"));
    expect(n).toBe(12);
    const call = (storage.countProspectionOperationsSince as any).mock.calls[0];
    expect(call[0]).toBe("u1");
    expect(call[1]).toContain("bright_data_linkedin_enrich");
    expect((call[2] as Date).toISOString()).toBe("2026-07-12T22:00:00.000Z");
  });
});

// ─── CONDITIONS DE VALIDATION 1-3 ──────────────────────────────────────────────
describe("assertEnrichmentAccess (conditions de validation)", () => {
  it("Condition 1 — plan base → throw message clair (option Enrichissement)", async () => {
    mockUserSub("user", { status: "active", prospectionPlan: "base", currentPeriodEnd: null });
    await expect(assertEnrichmentAccess("u1")).rejects.toBeInstanceOf(ProspectionAccessError);
    await expect(assertEnrichmentAccess("u1")).rejects.toThrow(/Enrichissement/i);
    expect(storage.countProspectionOperationsSince).not.toHaveBeenCalled();
  });

  it("Condition 2 — plan enrichissement, 0 demande LinkedIn → accès accordé", async () => {
    mockUserSub("user", { status: "active", prospectionPlan: "enrichissement", currentPeriodEnd: null });
    (storage.countProspectionOperationsSince as any).mockResolvedValue(0);
    await expect(assertEnrichmentAccess("u1")).resolves.toBeUndefined();
  });

  it("Condition 3 — plan enrichissement, 30 demandes LinkedIn → throw '(30/30) — recommence lundi'", async () => {
    mockUserSub("user", { status: "active", prospectionPlan: "enrichissement", currentPeriodEnd: null });
    (storage.countProspectionOperationsSince as any).mockResolvedValue(30);
    await expect(assertEnrichmentAccess("u1")).rejects.toBeInstanceOf(LinkedInWeeklyLimitError);
    await expect(assertEnrichmentAccess("u1")).rejects.toThrow(/\(30\/30\).*recommence lundi/i);
  });

  it("owner sans abonnement, sous la limite → accès accordé", async () => {
    mockUserSub("owner", null);
    (storage.countProspectionOperationsSince as any).mockResolvedValue(5);
    await expect(assertEnrichmentAccess("u1")).resolves.toBeUndefined();
  });
});
