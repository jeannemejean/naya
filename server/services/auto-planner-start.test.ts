// Test d'intégration : une date de départ FUTURE déplace le point de départ du
// planificateur — elle ne fait plus sauter la planification.
//
// Pourquoi au niveau du planificateur et pas seulement sur la fonction pure.
// `debutEffectifDePlanification` est couverte par 7 tests, mais ils prouvent que la
// FONCTION calcule la bonne date — pas que le planificateur s'en sert. Remplacer
// `debutEffectifDePlanification(startDate, prefs?.planningStartDate)` par `startDate`,
// c'est-à-dire revenir exactement au comportement defectueux, passait les 1317 tests du
// dépôt sans en casser un seul.
//
// C'est le cinquième écart de ce type dans ce chantier : les fonctions disent juste, rien ne
// vérifie que l'appelant les écoute.
import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = {
  getActiveUserIds: vi.fn(),
  getUserPreferences: vi.fn(),
  getTasksInRange: vi.fn(),
  getBrandDna: vi.fn(),
  getDayAvailability: vi.fn(),
  getProjects: vi.fn(),
  updateTask: vi.fn(),
  fixOverlappingTasks: vi.fn(),
  saveCompanionMessage: vi.fn(),
  findFirstFreeSlot: vi.fn(),
};
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));

const { runDailyAutoPlanner } = await import("./auto-planner");

/** Fenêtre de rollover observée : son début est `targetDate - 30 jours`, deterministe. */
function debutsDeFenetreObserves(): string[] {
  return storageMock.getTasksInRange.mock.calls.map((c: any[]) => c[1]);
}

/**
 * Les dates pour lesquelles le planificateur a REELLEMENT tente de generer.
 *
 * `getDayAvailability(userId, dateStr)` porte la date generee, et c'est le premier appel
 * date-observable de generateForUser. Sans cette observation, une mutation remettant
 * `nextWorkingDates(startDate, ...)` — donc ne generant PAS le vendredi de Jeanne — passait
 * tous les tests.
 */
function datesGenerees(): string[] {
  return storageMock.getDayAvailability.mock.calls.map((c: any[]) => c[1]);
}

describe("runDailyAutoPlanner — date de départ future", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
    storageMock.getTasksInRange.mockResolvedValue([]);
    // Brand DNA present : generateForUser va donc jusqu'a getDayAvailability, qui porte la
    // date generee. Puis getProjects vide l'arrete — aucun modele n'est appele.
    storageMock.getBrandDna.mockResolvedValue({ businessName: "Agence JMD" });
    storageMock.getDayAvailability.mockResolvedValue(null);
    storageMock.getProjects.mockResolvedValue([]);
    storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
  });

  it("planifie À PARTIR de la date de départ, au lieu de ne rien faire", async () => {
    // LE test. Le cas de Jeanne : le 24 septembre, depart fixe au 25.
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: "2026-09-25",
      workDays: "mon,tue,wed,thu,fri",
    });

    await runDailyAutoPlanner("2026-09-24");

    // La fenetre de rollover part de `targetDate - 30 jours`. Depuis le 25 → 26 aout.
    // Depuis le 24 (l'ancien comportement) → 25 aout. Un jour d'ecart, donc discriminant.
    expect(debutsDeFenetreObserves()).toContain("2026-08-26");
    expect(debutsDeFenetreObserves()).not.toContain("2026-08-25");

    // ET la generation part bien du vendredi 25, sans repasser par le jeudi 24 — c'est la
    // moitie qui decide si Jeanne voit enfin quelque chose dans son planning du vendredi.
    expect(datesGenerees()).toContain("2026-09-25");
    expect(datesGenerees()).not.toContain("2026-09-24");
  });

  it("ne saute plus la planification quand le départ est dans le futur", async () => {
    // L'ancien code faisait `continue` : AUCUN appel n'etait emis pour cet utilisateur.
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: "2026-12-25",
      workDays: "mon,tue,wed,thu,fri",
    });

    await runDailyAutoPlanner("2026-09-24");

    expect(storageMock.getTasksInRange).toHaveBeenCalled();
  });

  it("une date de départ passée ne fait pas remonter le temps", async () => {
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: "2026-09-01",
      workDays: "mon,tue,wed,thu,fri",
    });

    await runDailyAutoPlanner("2026-09-24");

    // Depuis le 24 → 25 aout. Si la date passee etait prise, on partirait du 2 aout.
    expect(debutsDeFenetreObserves()).toContain("2026-08-25");
    expect(debutsDeFenetreObserves()).not.toContain("2026-08-02");
  });

  it("sans date de départ, on part d'aujourd'hui", async () => {
    storageMock.getUserPreferences.mockResolvedValue({
      planningStatus: "active",
      planningStartDate: null,
      workDays: "mon,tue,wed,thu,fri",
    });

    await runDailyAutoPlanner("2026-09-24");

    expect(debutsDeFenetreObserves()).toContain("2026-08-25");
  });
});
