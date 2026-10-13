// Placement des tâches du jour restées sans heure : il ne doit JAMAIS poser une tâche sur un
// créneau déjà pris — tâche terminée (affichée barrée), autre tâche ou rendez-vous.
import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getUserPreferences: vi.fn(),
  getTasksInRange: vi.fn(),
  updateTask: vi.fn(async () => ({})),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const agenda = vi.hoisted(() => ({ getCalendarBlockedRanges: vi.fn(async () => [] as Array<{ start: number; end: number }>) }));
vi.mock("./google-calendar", () => agenda);

const { runPlaceToday } = await import("./place-today-runner");
const JOUR = "2026-10-13";
const min = (h: number, m = 0) => h * 60 + m;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserPreferences.mockResolvedValue({ workDayStart: "09:00", workDayEnd: "18:00", lunchBreakEnabled: false, bufferMin: 0 });
});

describe("runPlaceToday", () => {
  it("une tâche terminée garde son créneau : rien ne se pose dessus", async () => {
    storageMock.getTasksInRange.mockResolvedValue([
      { id: 1, scheduledDate: JOUR, scheduledTime: "15:00", scheduledEndTime: "16:00", estimatedDuration: 60, completed: true },
      { id: 2, scheduledDate: JOUR, scheduledTime: null, estimatedDuration: 30, completed: false },
    ]);
    await runPlaceToday("u", JOUR, min(14, 45));
    const maj = storageMock.updateTask.mock.calls.find((c: any[]) => c[0] === 2)?.[1] as any;
    expect(maj).toBeTruthy();
    const debut = Number(maj.scheduledTime.slice(0, 2)) * 60 + Number(maj.scheduledTime.slice(3));
    expect(debut >= min(16) || debut + 30 <= min(15)).toBe(true);
  });

  it("un rendez-vous d'agenda bloque son créneau", async () => {
    agenda.getCalendarBlockedRanges.mockResolvedValue([{ start: min(10), end: min(11, 30) }]);
    storageMock.getTasksInRange.mockResolvedValue([{ id: 2, scheduledDate: JOUR, scheduledTime: null, estimatedDuration: 30, completed: false }]);
    await runPlaceToday("u", JOUR, min(9, 45));
    const maj = storageMock.updateTask.mock.calls[0][1] as any;
    expect(maj.scheduledTime).toBe("11:30");
  });
});
