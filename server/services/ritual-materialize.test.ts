import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getActiveRituals: vi.fn(),
    getRitualTaskForDate: vi.fn(),
    createTask: vi.fn(),
  },
}));

import { storage } from "../storage";
import { materializeRituals } from "./ritual-materialize";

const RITUAL = {
  id: 1, userId: "u1", projectId: 3,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00",
  durationMinutes: 20,
  active: true,
  createdAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (storage.createTask as any).mockResolvedValue({ id: 99 });
});

describe("materializeRituals", () => {
  it("crée la tâche du jour pour un rituel actif", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-24"); // vendredi

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(1);
    expect((storage.createTask as any).mock.calls[0][0]).toMatchObject({
      userId: "u1",
      projectId: 3,
      ritualId: 1,
      title: "Brief news + posts JMD",
      scheduledDate: "2026-07-24",
      scheduledTime: "09:00",
      scheduledEndTime: "09:20",
      schedulingMode: "fixed",
    });
  });

  it("est idempotente : un second appel ne recrée rien", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue({ id: 99 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ne crée rien un jour non concerné", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-25"); // samedi

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ignore les rituels inactifs (getActiveRituals les exclut déjà)", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([]);

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("n'interrompt pas les autres rituels si l'un échoue", async () => {
    const second = { ...RITUAL, id: 2, title: "Revue du soir", startTime: "17:00" };
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL, second]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);
    (storage.createTask as any)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: 100 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(2);
  });
});
