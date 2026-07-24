import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB). Le reste de rolloverStaleTasks est du vrai code.
vi.mock("../storage", () => ({
  storage: {
    getUserPreferences: vi.fn(),
    getTasksInRange: vi.fn(),
    findFirstFreeSlot: vi.fn(),
    updateTask: vi.fn(),
    fixOverlappingTasks: vi.fn(),
    createBehavioralSignal: vi.fn(),
    getTask: vi.fn(),
  },
}));
// L'arbitrage IA « cette tâche vaut-elle encore le coup ? » ne doit jamais partir
// en réseau depuis un test.
vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaude: vi.fn().mockResolvedValue("reschedule") };
});

import { storage } from "../storage";
import { rolloverStaleTasks } from "./auto-planner";

const TODAY = "2026-07-24";

/** 28 tâches en retard, comme le cas réel qui a motivé ce comportement. */
function staleTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Tâche en retard ${i + 1}`,
    completed: false,
    scheduledDate: "2026-07-21",
    estimatedDuration: 30,
    priority: (i % 5) + 1,
    learnedAdjustmentCount: 0,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getUserPreferences as any).mockResolvedValue({
    planningStatus: "active",
    workDays: "mon,tue,wed,thu,fri",
    workDayStart: "09:00",
    workDayEnd: "18:00",
  });
  (storage.findFirstFreeSlot as any).mockResolvedValue({ date: TODAY, time: "09:00" });
  (storage.updateTask as any).mockResolvedValue({});
  (storage.fixOverlappingTasks as any).mockResolvedValue(undefined);
});

describe("rolloverStaleTasks", () => {
  it("plafonne à 8 tâches par défaut (passage quotidien)", async () => {
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(28));

    const { moved } = await rolloverStaleTasks("u1", TODAY);

    expect(moved).toBe(8);
    expect(storage.updateTask).toHaveBeenCalledTimes(8);
  });

  it("reprend TOUTES les tâches en retard quand limit vaut Infinity (redémarrage)", async () => {
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(28));

    const { moved } = await rolloverStaleTasks("u1", TODAY, {
      limit: Infinity,
      countAsDeferral: false,
    });

    expect(moved).toBe(28);
    expect(storage.updateTask).toHaveBeenCalledTimes(28);
  });

  it("ne compte pas un redémarrage comme un report (pas de pénalité sur la tâche)", async () => {
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(3));

    await rolloverStaleTasks("u1", TODAY, { limit: Infinity, countAsDeferral: false });

    for (const call of (storage.updateTask as any).mock.calls) {
      expect(call[1]).not.toHaveProperty("learnedAdjustmentCount");
    }
  });

  it("compte bien un report lors du passage quotidien normal", async () => {
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(1));

    await rolloverStaleTasks("u1", TODAY);

    expect((storage.updateTask as any).mock.calls[0][1]).toMatchObject({
      learnedAdjustmentCount: 1,
    });
  });

  it("ne touche à rien si la planification est en pause", async () => {
    (storage.getUserPreferences as any).mockResolvedValue({ planningStatus: "paused" });
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(28));

    const { moved } = await rolloverStaleTasks("u1", TODAY, { limit: Infinity });

    expect(moved).toBe(0);
    expect(storage.updateTask).not.toHaveBeenCalled();
  });

  it("replanifie sur un créneau libre et repasse le filet anti-chevauchement", async () => {
    (storage.getTasksInRange as any).mockResolvedValue(staleTasks(2));

    await rolloverStaleTasks("u1", TODAY, { limit: Infinity, countAsDeferral: false });

    expect((storage.updateTask as any).mock.calls[0][1]).toMatchObject({
      scheduledDate: TODAY,
      scheduledTime: "09:00",
      scheduledEndTime: "09:30",
    });
    expect(storage.fixOverlappingTasks).toHaveBeenCalled();
  });
});
