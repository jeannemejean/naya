// La génération quotidienne vise SON jour et reçoit ce qui est déjà posé dans la semaine
// (12 nov. 2026, toutes les utilisatrices) : avant, chaque journée recevait des tâches
// « pour la semaine à venir », et les sept journées générées se répétaient.
import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = {
  getActiveUserIds: vi.fn(),
  getUserPreferences: vi.fn(),
  getTasksInRange: vi.fn(),
  getBrandDna: vi.fn(),
  getDayAvailability: vi.fn(),
  getProjects: vi.fn(),
  getProject: vi.fn(),
  getActiveGoalsForProject: vi.fn(),
  getProjectStrategyProfile: vi.fn(),
  getMilestones: vi.fn(),
  getTaskDependenciesForIds: vi.fn(),
  getContent: vi.fn(),
  getOutreachMessages: vi.fn(),
  getUserOperatingProfile: vi.fn(),
  checkSlotAvailability: vi.fn(),
  createTask: vi.fn(),
  createTaskDependency: vi.fn(),
  fixOverlappingTasks: vi.fn(),
  saveCompanionMessage: vi.fn(),
};
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
vi.mock("./google-calendar", () => ({ getCalendarBlockedRanges: vi.fn(async () => []) }));
vi.mock("./naya-context", () => ({ buildNayaContext: vi.fn(async () => "") }));
vi.mock("./claude", () => ({ CLAUDE_MODELS: { fast: "f", smart: "s" }, callClaude: vi.fn(async () => "") }));
vi.mock("./ritual-materialize", () => ({ materializeRituals: vi.fn(async () => {}) }));
vi.mock("./task-intelligence", () => ({ handleTaskDeferral: vi.fn(async () => {}) }));

const generateDailyTasksMock = vi.fn();
vi.mock("./openai", () => ({ generateDailyTasks: generateDailyTasksMock }));

const { runDailyAutoPlanner } = await import("./auto-planner");

const LUNDI = "2026-10-12";
const posees: any[] = [];

describe("auto-planner — une journée pour son jour, sans doublon dans la semaine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
    posees.length = 0;
    storageMock.getTasksInRange.mockImplementation(async (_u: string, debut: string, fin: string) =>
      posees.filter((t) => t.scheduledDate >= debut && t.scheduledDate <= fin));
    storageMock.getBrandDna.mockResolvedValue({ businessName: "Agence JMD" });
    storageMock.getDayAvailability.mockResolvedValue(null);
    storageMock.getProjects.mockResolvedValue([{ id: 7, name: "Agence JMD", dailyTimeBudgetHours: 4 }]);
    storageMock.getProject.mockImplementation(async (id: number) => ({ id, name: id === 7 ? "Agence JMD" : "Encore Merci" }));
    storageMock.getActiveGoalsForProject.mockResolvedValue([]);
    storageMock.getProjectStrategyProfile.mockResolvedValue(null);
    storageMock.getMilestones.mockResolvedValue([]);
    storageMock.getContent.mockResolvedValue([]);
    storageMock.getOutreachMessages.mockResolvedValue([]);
    storageMock.getUserOperatingProfile.mockResolvedValue(null);
    storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
    storageMock.createTask.mockImplementation(async (t: any) => {
      const c = { id: posees.length + 1, ...t };
      posees.push(c);
      return c;
    });
    storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: null,
      workDays: "mon,tue,wed,thu,fri",
      workDayStart: "09:00",
      workDayEnd: "18:00",
      lunchBreakEnabled: true,
      lunchBreakStart: "12:00",
      lunchBreakEnd: "13:00",
      currentEnergyLevel: "high",
      activeProjectId: 7, // filtre de la barre latérale : NE DOIT PAS restreindre la génération
    });
    generateDailyTasksMock.mockImplementation(async (req: any) => ({
      tasks: [{ title: `Tâche du ${req.date}`, estimatedDuration: 30, type: "planning", priority: 1 }],
      dependencies: [],
    }));
  });

  it("passe à chaque appel la date du jour généré", async () => {
    await runDailyAutoPlanner(LUNDI);
    const dates = generateDailyTasksMock.mock.calls.map((c: any[]) => c[0].date);
    expect(dates.slice(0, 5)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  });

  it("passe les titres déjà posés dans la même semaine, pas ceux de la semaine suivante", async () => {
    await runDailyAutoPlanner(LUNDI);
    const appel = (date: string) => generateDailyTasksMock.mock.calls.map((c: any[]) => c[0]).find((r: any) => r.date === date);
    expect(appel("2026-10-12").dejaPlanifieesSemaine).toEqual([]);
    expect(appel("2026-10-14").dejaPlanifieesSemaine).toEqual(["Tâche du 2026-10-12", "Tâche du 2026-10-13"]);
    // Lundi suivant : nouvelle semaine, rien de la précédente.
    expect(appel("2026-10-19").dejaPlanifieesSemaine).toEqual([]);
  });
});
