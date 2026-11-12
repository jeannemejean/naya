// Branchement du fil conducteur dans le passage du matin : pour une utilisatrice derrière
// l'interrupteur, runDailyAutoPlanner appelle miseEnRoute, et lance proposerRattachements
// (détaché) seulement quand CET appel vient de poser la date. Tout est mocké (aucune base).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T08:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

const storageMock = {
  getActiveUserIds: vi.fn(), getUserPreferences: vi.fn(), getTasksInRange: vi.fn(), getBrandDna: vi.fn(),
  getDayAvailability: vi.fn(), getProjects: vi.fn(), updateTask: vi.fn(), fixOverlappingTasks: vi.fn(),
  saveCompanionMessage: vi.fn(), findFirstFreeSlot: vi.fn(),
};
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("./reprise", () => ({ reprendreTaches: vi.fn().mockResolvedValue({ replacees: 0, modifiees: 0, archivees: 0, creees: 0 }) }));
vi.mock("./reprise/deps", () => ({ depsReprise: vi.fn().mockResolvedValue({}) }));
vi.mock("../db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
const fil = vi.hoisted(() => ({ filActifPour: vi.fn(), miseEnRoute: vi.fn(), proposerRattachements: vi.fn(), chargerCarte: vi.fn() }));
vi.mock("./fil/interrupteur", () => ({ filActifPour: fil.filActifPour, miseEnRoute: fil.miseEnRoute }));
vi.mock("./fil/etapes", () => ({ proposerRattachements: fil.proposerRattachements }));
vi.mock("./fil/carte", async (orig) => ({ ...(await orig<any>()), chargerCarte: fil.chargerCarte }));

const { runDailyAutoPlanner } = await import("./auto-planner");

const DEPUIS = new Date("2026-11-01T06:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getActiveUserIds.mockResolvedValue(["u1"]);
  storageMock.getUserPreferences.mockResolvedValue({ planningStatus: "active", workDays: "mon,tue,wed,thu,fri", filConducteurDepuis: null });
  storageMock.getTasksInRange.mockResolvedValue([]);
  storageMock.getBrandDna.mockResolvedValue(null);
  storageMock.getProjects.mockResolvedValue([]);
  storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
  fil.filActifPour.mockReturnValue(true);
  fil.proposerRattachements.mockResolvedValue([]);
  fil.chargerCarte.mockResolvedValue({ objectifs: [], chainesSansObjectif: new Map(), depuis: null });
});

describe("runDailyAutoPlanner — mise en route du fil", () => {
  it("première mise en route : proposerRattachements est lancé, la carte part de la date posée", async () => {
    fil.miseEnRoute.mockResolvedValue({ depuis: DEPUIS, nouveau: true });
    await runDailyAutoPlanner("2026-11-12");
    expect(fil.miseEnRoute).toHaveBeenCalledWith("u1", expect.any(Date));
    expect(fil.proposerRattachements).toHaveBeenCalledTimes(1);
    expect(fil.proposerRattachements).toHaveBeenCalledWith("u1", expect.any(Date));
    expect(fil.chargerCarte).toHaveBeenCalledWith("u1", DEPUIS);
  });

  it("date déjà posée : aucun rattachement proposé", async () => {
    fil.miseEnRoute.mockResolvedValue({ depuis: DEPUIS, nouveau: false });
    await runDailyAutoPlanner("2026-11-12");
    expect(fil.miseEnRoute).toHaveBeenCalledTimes(1);
    expect(fil.proposerRattachements).not.toHaveBeenCalled();
  });

  it("hors interrupteur : ni mise en route ni rattachement", async () => {
    fil.filActifPour.mockReturnValue(false);
    await runDailyAutoPlanner("2026-11-12");
    expect(fil.miseEnRoute).not.toHaveBeenCalled();
    expect(fil.proposerRattachements).not.toHaveBeenCalled();
  });

  it("un rattachement qui échoue ne casse pas le passage", async () => {
    fil.miseEnRoute.mockResolvedValue({ depuis: DEPUIS, nouveau: true });
    fil.proposerRattachements.mockRejectedValue(new Error("panne IA"));
    const r = await runDailyAutoPlanner("2026-11-12");
    expect(r.errors).toBe(0);
    expect(r.processed).toBe(1);
  });
});
