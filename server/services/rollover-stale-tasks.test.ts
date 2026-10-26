import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// rolloverStaleTasks ne déplace plus rien lui-même : il choisit le jour de reprise et confie
// les tâches à la reprise intelligente (services/reprise), testée à part.
vi.mock("../storage", () => ({ storage: { getUserPreferences: vi.fn() } }));
vi.mock("./reprise", () => ({ reprendreTaches: vi.fn() }));
vi.mock("./reprise/deps", () => ({ depsReprise: vi.fn().mockResolvedValue({}) }));

import { storage } from "../storage";
import { reprendreTaches } from "./reprise";
import { rolloverStaleTasks } from "./auto-planner";

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getUserPreferences as any).mockResolvedValue({ workDays: "mon,tue,wed,thu,fri", workDayEnd: "18:00" });
  (reprendreTaches as any).mockResolvedValue({ replacees: 3, modifiees: 2, archivees: 1, creees: 0 });
});
afterEach(() => vi.useRealTimers());

describe("rolloverStaleTasks", () => {
  it("le matin, reprend le retard sur aujourd'hui (aujourd'hui exclu du retard)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T06:00:00Z")); // mardi, 7 h à Paris
    const { moved } = await rolloverStaleTasks("u1", "2026-10-27");
    expect(moved).toBe(5);
    expect(reprendreTaches).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: "u1", aujourdhui: "2026-10-27", cible: "2026-10-27", inclureAujourdhui: false, reinitialiserReports: false,
    }));
  });

  it("en fin de journée, ce qui reste d'aujourd'hui part au prochain jour ouvré", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T16:30:00Z")); // vendredi, 17 h 30 à Paris
    await rolloverStaleTasks("u1", "2026-10-30");
    expect(reprendreTaches).toHaveBeenCalledWith({}, expect.objectContaining({ cible: "2026-11-02", inclureAujourdhui: true }));
  });

  it("un redémarrage remet les compteurs de reports à zéro", async () => {
    await rolloverStaleTasks("u1", "2026-10-27", { limit: Infinity, deferralMode: "reset" });
    expect(reprendreTaches).toHaveBeenCalledWith({}, expect.objectContaining({ reinitialiserReports: true }));
  });

  it("un jour non travaillé reprend au prochain jour ouvré", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T08:00:00Z")); // samedi
    await rolloverStaleTasks("u1", "2026-10-31");
    expect(reprendreTaches).toHaveBeenCalledWith({}, expect.objectContaining({ cible: "2026-11-02" }));
  });
});
