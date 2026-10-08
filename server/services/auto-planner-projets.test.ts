// Test d'intégration : une journée n'est plus liée à un seul projet (9 octobre 2026).
//
// Constaté : aujourd'hui = projet 1, demain = projet 2. L'auto-planner ne traitait que le
// projet sélectionné dans la barre latérale (`activeProjectId`, simple filtre de vue),
// sautait toute journée qui contenait déjà une tâche, et chaque projet plaçait ses tâches à
// la suite. Il traite désormais tous les projets actifs, complète une journée entamée, et
// entrelace les projets ; il écarte aussi les tâches de contenu et de prospection.
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

const tachesProjet = (nom: string) => ({
  tasks: [
    { title: `${nom} — clarifier l'offre`, estimatedDuration: 30, type: "planning", priority: 1 },
    { title: `${nom} — chiffrer le pilote`, estimatedDuration: 30, type: "planning", priority: 2 },
    { title: `${nom} — Draft 3-part carousel`, estimatedDuration: 30, type: "content", priority: 3 },
    { title: `${nom} — Send the 3 personalized DMs`, estimatedDuration: 30, type: "outreach", priority: 3 },
    { title: `${nom} — préparer le point client`, estimatedDuration: 30, type: "admin", priority: 4 },
  ],
  dependencies: [],
});

/** Créations pour un jour donné, dans l'ordre. */
const creees = (date = LUNDI) =>
  storageMock.createTask.mock.calls.map((c: any[]) => c[0]).filter((t: any) => t.scheduledDate === date);

describe("auto-planner — tous les projets, journée entamée complétée, projets entrelacés", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
    storageMock.getTasksInRange.mockResolvedValue([]);
    storageMock.getBrandDna.mockResolvedValue({ businessName: "Agence JMD" });
    storageMock.getDayAvailability.mockResolvedValue(null);
    storageMock.getProjects.mockResolvedValue([
      { id: 7, name: "Agence JMD", dailyTimeBudgetHours: 4 },
      { id: 8, name: "Encore Merci", dailyTimeBudgetHours: 2 },
    ]);
    storageMock.getProject.mockImplementation(async (id: number) => ({ id, name: id === 7 ? "Agence JMD" : "Encore Merci" }));
    storageMock.getActiveGoalsForProject.mockResolvedValue([]);
    storageMock.getProjectStrategyProfile.mockResolvedValue(null);
    storageMock.getMilestones.mockResolvedValue([]);
    storageMock.getContent.mockResolvedValue([]);
    storageMock.getOutreachMessages.mockResolvedValue([]);
    storageMock.getUserOperatingProfile.mockResolvedValue(null);
    storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
    storageMock.createTask.mockImplementation(async (t: any) => ({ id: Math.floor(Math.random() * 1e9), ...t }));
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
    generateDailyTasksMock.mockImplementation(async (req: any) =>
      tachesProjet(req.projectContext?.projectId === 7 ? "JMD" : "EM"),
    );
  });

  it("génère pour tous les projets actifs, pas seulement celui de la barre latérale", async () => {
    await runDailyAutoPlanner(LUNDI);
    const projets = new Set(creees().map((t: any) => t.projectId));
    expect(projets).toEqual(new Set([7, 8]));
  });

  it("entrelace les projets au fil de la journée", async () => {
    await runDailyAutoPlanner(LUNDI);
    const ordre = creees().map((t: any) => t.projectId);
    expect(ordre.slice(0, 2).sort()).toEqual([7, 8]);
    // Jamais toute la journée d'un projet avant l'autre.
    const premierEM = ordre.indexOf(8);
    expect(premierEM).toBeLessThanOrEqual(1);
  });

  it("n'écrit aucune tâche de contenu ni de prospection", async () => {
    await runDailyAutoPlanner(LUNDI);
    for (const t of storageMock.createTask.mock.calls.map((c: any[]) => c[0])) {
      expect(t.title).not.toMatch(/carousel|DMs/i);
      expect(["content", "outreach"]).not.toContain(t.type);
    }
  });

  it("complète une journée entamée au lieu de la sauter", async () => {
    storageMock.getTasksInRange.mockImplementation(async (_u: string, debut: string) =>
      debut === LUNDI
        ? [{ id: 1, title: "Rituel du matin", source: "ritual", type: "admin", scheduledDate: LUNDI, scheduledTime: "09:00", estimatedDuration: 15 }]
        : [],
    );
    await runDailyAutoPlanner(LUNDI);
    expect(creees().length).toBeGreaterThan(0);
  });

  it("ne regénère pas une journée déjà planifiée par l'auto-planner", async () => {
    storageMock.getTasksInRange.mockImplementation(async (_u: string, debut: string) =>
      debut === LUNDI
        ? [{ id: 1, title: "Clarifier l'offre", source: "auto", type: "planning", scheduledDate: LUNDI, scheduledTime: "09:00", estimatedDuration: 30 }]
        : [],
    );
    await runDailyAutoPlanner(LUNDI);
    expect(creees()).toHaveLength(0);
  });
});
