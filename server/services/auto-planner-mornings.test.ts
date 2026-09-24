// Test d'intégration : le planificateur utilise la MATINÉE.
//
// Défaut constaté le 24 septembre 2026, en regardant un plan réellement généré. Les sept
// journées commençaient toutes à 14 h, alors que la journée de travail de Jeanne commence à
// 10 h. Deux heures perdues chaque jour.
//
//     const latestEnd = blockedRanges.reduce((max, r) => Math.max(max, r.end), workDayStart);
//     let curSlot = latestEnd;
//
// Le curseur partait de la fin la plus TARDIVE de tous les créneaux bloqués. Avec une pause
// déjeuner 12 h–14 h, il démarrait à 14 h — et la matinée libre n'était jamais regardée.
//
// `findNextFreeSlot` savait pourtant déjà sauter par-dessus un bloc. C'est le point de
// départ qui la court-circuitait.
//
// Ce test existe parce que la correction est d'UNE LIGNE et qu'aucun des 1322 tests du dépôt
// ne la protégeait : la remettre à l'ancienne valeur passait tout.
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

/** Les heures de début réellement écrites en base, dans l'ordre. */
function heuresCreees(): string[] {
  return storageMock.createTask.mock.calls.map((c: any[]) => c[0]?.scheduledTime);
}

describe("runDailyAutoPlanner — la matinée est utilisée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
    storageMock.getTasksInRange.mockResolvedValue([]);
    storageMock.getBrandDna.mockResolvedValue({ businessName: "Agence JMD" });
    storageMock.getDayAvailability.mockResolvedValue(null);
    storageMock.getProjects.mockResolvedValue([{ id: 7, name: "Agence JMD", status: "active" }]);
    storageMock.getProject.mockResolvedValue({ id: 7, name: "Agence JMD" });
    storageMock.getActiveGoalsForProject.mockResolvedValue([]);
    storageMock.getProjectStrategyProfile.mockResolvedValue(null);
    storageMock.getMilestones.mockResolvedValue([]);
    storageMock.getTaskDependenciesForIds.mockResolvedValue([]);
    storageMock.getContent.mockResolvedValue([]);
    storageMock.getOutreachMessages.mockResolvedValue([]);
    storageMock.getUserOperatingProfile.mockResolvedValue(null);
    storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
    storageMock.createTask.mockImplementation(async (t: any) => ({ id: Math.random(), ...t }));
    storageMock.fixOverlappingTasks.mockResolvedValue(undefined);

    // Les réglages RÉELS de Jeanne : journée 10 h–18 h, déjeuner 12 h–14 h.
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: null,
      workDays: "mon,tue,wed,thu,fri",
      workDayStart: "10:00",
      workDayEnd: "18:00",
      lunchBreakEnabled: true,
      lunchBreakStart: "12:00",
      lunchBreakEnd: "14:00",
      currentEnergyLevel: "high",
    });

    generateDailyTasksMock.mockResolvedValue({
      tasks: [
        { title: "Tâche A", estimatedDuration: 45, type: "content", category: "visibility", priority: 1 },
        { title: "Tâche B", estimatedDuration: 45, type: "content", category: "visibility", priority: 2 },
      ],
      dependencies: [],
    });
  });

  it("place la PREMIÈRE tâche le matin, pas après le déjeuner", async () => {
    // LE test. Avec l'ancien curseur, tout démarrait à 14 h.
    await runDailyAutoPlanner("2026-09-28"); // un lundi

    const heures = heuresCreees();

    expect(heures.length, "au moins une tâche doit être créée").toBeGreaterThan(0);
    expect(heures[0], `première tâche à ${heures[0]}`).toBe("10:00");
    expect(heures).not.toContain("14:00");
  });

  it("n'empiète jamais sur la pause déjeuner", async () => {
    // Le pendant du test précédent : partir du matin ne doit pas faire oublier le déjeuner.
    // Sans cette vérification, on pourrait « corriger » le défaut en supprimant les blocs.
    generateDailyTasksMock.mockResolvedValue({
      tasks: Array.from({ length: 4 }, (_, i) => ({
        title: `Tâche ${i}`,
        estimatedDuration: 45,
        type: "content",
        category: "visibility",
        priority: i + 1,
      })),
      dependencies: [],
    });

    await runDailyAutoPlanner("2026-09-28");

    for (const h of heuresCreees()) {
      const [hh, mm] = h.split(":").map(Number);
      const debut = hh * 60 + mm;
      expect(
        debut < 12 * 60 || debut >= 14 * 60,
        `une tâche démarre à ${h}, en pleine pause déjeuner`,
      ).toBe(true);
    }
  });

  it("aucune tâche ne commence avant l'ouverture de la journée", async () => {
    // Bug visé par l'excès inverse : partir de zéro au lieu du début de journée.
    //
    // Ce test ne lançait PAS le planificateur : sa boucle ne s'exécutait jamais et il
    // passait sans rien vérifier. Creux, donc réparé.
    await runDailyAutoPlanner("2026-09-28");

    expect(heuresCreees().length).toBeGreaterThan(0);
    for (const h of heuresCreees()) {
      const [hh] = h.split(":").map(Number);
      expect(hh, `tâche à ${h}, avant 10 h`).toBeGreaterThanOrEqual(10);
    }
  });
});
