// Fil conducteur dans l'auto-planner : rattachement explicite et « pourquoi » stocké.
// Dans l'interrupteur (FIL_CONDUCTEUR_USERS) : plus de repli sur le premier objectif, l'étape
// vient de etapeIndex (ou de l'étape en cours de l'objectif), le « pourquoi » creux est jeté.
// Hors interrupteur : comportement d'avant, à l'identique (non-régression).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getAvancementEtapes: vi.fn(),
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
const POURQUOI = "Sans ce devis signé, l'étape « 1er client IN SCENA » reste bloquée";

const OBJECTIFS = [
  { id: 1, projectId: 7, title: "Signer 3 clients", status: "active", successMode: "revenue", goalType: "revenue", targetValue: null, dueDate: null },
  { id: 2, projectId: 7, title: "Être visible", status: "active", successMode: "visibility", goalType: "monthly", targetValue: null, dueDate: null },
];
const JALONS = [
  { id: 10, projectId: 7, userId: "u1", goalId: 1, order: 0, status: "active", title: "Premier client IN SCENA", pourquoi: "Un client signé prouve l'offre" },
  { id: 11, projectId: 7, userId: "u1", goalId: 1, order: 1, status: "locked", title: "Trois clients", pourquoi: null },
  { id: 20, projectId: 7, userId: "u1", goalId: 2, order: 0, status: "locked", title: "Être visible sur LinkedIn", pourquoi: null },
];

const creees = () => storageMock.createTask.mock.calls.map((c: any[]) => c[0]).filter((t: any) => t.scheduledDate === LUNDI);
const parTitre = (titre: string) => creees().find((t: any) => t.title === titre);

describe("auto-planner — rattachement explicite et pourquoi (fil conducteur)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
    storageMock.getTasksInRange.mockResolvedValue([]);
    storageMock.getBrandDna.mockResolvedValue({ businessName: "Agence JMD" });
    storageMock.getDayAvailability.mockResolvedValue(null);
    storageMock.getProjects.mockResolvedValue([{ id: 7, name: "Agence JMD", dailyTimeBudgetHours: 6 }]);
    storageMock.getProject.mockImplementation(async (id: number) => ({ id, name: "Agence JMD" }));
    storageMock.getActiveGoalsForProject.mockResolvedValue(OBJECTIFS);
    storageMock.getProjectStrategyProfile.mockResolvedValue(null);
    storageMock.getMilestones.mockResolvedValue(JALONS);
    storageMock.getAvancementEtapes.mockImplementation(async () => new Map());
    storageMock.getContent.mockResolvedValue([]);
    storageMock.getOutreachMessages.mockResolvedValue([]);
    storageMock.getUserOperatingProfile.mockResolvedValue(null);
    storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
    storageMock.createTask.mockImplementation(async (t: any) => ({ id: Math.floor(Math.random() * 1e9), ...t }));
    storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active", planningStartDate: null, workDays: "mon,tue,wed,thu,fri",
      workDayStart: "09:00", workDayEnd: "18:00", lunchBreakEnabled: true, lunchBreakStart: "12:00",
      lunchBreakEnd: "13:00", currentEnergyLevel: "high", filConducteurDepuis: new Date("2026-11-12T08:00:00Z"),
    });
    generateDailyTasksMock.mockResolvedValue({
      tasks: [
        { title: "Chiffrer le devis IN SCENA", estimatedDuration: 30, type: "planning", priority: 1, goalIndex: 0, etapeIndex: 0, pourquoi: POURQUOI },
        { title: "Ranger le drive client", estimatedDuration: 30, type: "admin", priority: 2, pourquoi: "pour avancer ton objectif" },
        { title: "Relire la charte", estimatedDuration: 30, type: "planning", priority: 3, goalIndex: 9, pourquoi: POURQUOI },
        { title: "Choisir l'angle éditorial", estimatedDuration: 30, type: "planning", priority: 3, goalIndex: 1, etapeIndex: 0, pourquoi: POURQUOI },
      ],
      dependencies: [],
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe("dans l'interrupteur", () => {
    beforeEach(() => { vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1"); });

    it("goalIndex + etapeIndex valides : objectif, étape en cours et pourquoi stockés", async () => {
      await runDailyAutoPlanner(LUNDI);
      expect(parTitre("Chiffrer le devis IN SCENA")).toMatchObject({ goalId: 1, milestoneId: 10, pourquoi: POURQUOI });
    });

    it("sans goalIndex valide : goalId null (plus de repli activeGoals[0]), pourquoi creux → null", async () => {
      await runDailyAutoPlanner(LUNDI);
      expect(parTitre("Ranger le drive client")).toMatchObject({ goalId: null, milestoneId: null, pourquoi: null });
      expect(parTitre("Relire la charte")).toMatchObject({ goalId: null, milestoneId: null, pourquoi: POURQUOI });
    });

    it("objectif dont la seule étape est locked : goalId posé, milestoneId null", async () => {
      await runDailyAutoPlanner(LUNDI);
      expect(parTitre("Choisir l'angle éditorial")).toMatchObject({ goalId: 2, milestoneId: null });
    });

    it("le prompt reçoit l'étape en cours et son pourquoi, par objectif", async () => {
      await runDailyAutoPlanner(LUNDI);
      const req = generateDailyTasksMock.mock.calls[0][0];
      expect(req.filConducteur).toBe(true);
      expect(req.activeGoals[0].etapes).toEqual([{ titre: "Premier client IN SCENA", pourquoi: "Un client signé prouve l'offre" }]);
      expect(req.activeGoals[1].etapes).toEqual([]); // l'étape 20 est verrouillée : jamais proposée
    });

    it("la carte est chargée une seule fois pour tout le passage (7 jours)", async () => {
      await runDailyAutoPlanner(LUNDI);
      expect(generateDailyTasksMock.mock.calls.length).toBeGreaterThan(1);
      expect(storageMock.getAvancementEtapes).toHaveBeenCalledTimes(1);
    });
  });

  describe("hors interrupteur (non-régression)", () => {
    beforeEach(() => { vi.stubEnv("FIL_CONDUCTEUR_USERS", "quelqu-une-d-autre"); });

    it("repli activeGoals[0] conservé, ni étape ni pourquoi écrits, prompt inchangé, aucune carte", async () => {
      await runDailyAutoPlanner(LUNDI);
      expect(parTitre("Ranger le drive client").goalId).toBe(1);
      expect(parTitre("Relire la charte").goalId).toBe(1);
      expect(parTitre("Choisir l'angle éditorial").goalId).toBe(2);
      for (const t of creees()) {
        expect(t).not.toHaveProperty("milestoneId");
        expect(t).not.toHaveProperty("pourquoi");
      }
      const req = generateDailyTasksMock.mock.calls[0][0];
      expect(req).not.toHaveProperty("filConducteur");
      expect(req.activeGoals[0]).toEqual({ id: 1, title: "Signer 3 clients", successMode: "revenue", goalType: "revenue", dueDate: null });
      expect(storageMock.getAvancementEtapes).not.toHaveBeenCalled();
    });
  });
});
