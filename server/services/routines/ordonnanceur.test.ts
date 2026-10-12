import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = {
  getDueRoutines: vi.fn(),
  claimRoutine: vi.fn(async () => true),
  addRoutineRun: vi.fn(async (r: any) => ({ id: 1, ...r })),
  updateRoutine: vi.fn(async () => null),
  getAllActiveProspectionCampaigns: vi.fn(async () => []),
  ensureRoutine: vi.fn(async (r: any) => ({ id: 9, ...r })),
};
vi.mock("../../storage", () => ({ storage: storageMock }));
const notif = vi.hoisted(() => ({ ajouter: vi.fn(async () => {}) }));
vi.mock("./notifier", () => ({ notifierRoutine: notif.ajouter }));

const { executerRoutinesDues, assurerRoutinesSourcing } = await import("./ordonnanceur");

const MAINTENANT = new Date("2026-10-13T05:10:00Z");
const routine = (id: number, over: any = {}) => ({ id, userId: "u1", kind: "sourcing_prospects", cible: { campaignId: id }, cadence: "quotidienne", heureUtc: 5, actif: true, prochainPassage: new Date("2026-10-13T05:00:00Z"), ...over });

beforeEach(() => vi.clearAllMocks());

describe("executerRoutinesDues", () => {
  it("avance prochainPassage AVANT d'exécuter, puis consigne le passage", async () => {
    storageMock.getDueRoutines.mockResolvedValue([routine(1)]);
    const ordre: string[] = [];
    storageMock.claimRoutine.mockImplementation(async () => { ordre.push("verrou"); return true; });
    const exec = vi.fn(async () => { ordre.push("exec"); return { statut: "ok" as const, resume: "6 prospects ajoutés.", notifier: true }; });
    await executerRoutinesDues(MAINTENANT, { sourcing_prospects: exec });
    expect(ordre).toEqual(["verrou", "exec"]);
    expect(storageMock.claimRoutine).toHaveBeenCalledWith(1, new Date("2026-10-13T05:00:00Z"), new Date("2026-10-14T05:00:00Z"));
    expect(storageMock.addRoutineRun).toHaveBeenCalledWith(expect.objectContaining({ routineId: 1, statut: "ok", resume: "6 prospects ajoutés." }));
    expect(notif.ajouter).toHaveBeenCalledTimes(1);
  });

  it("une routine déjà prise par une autre instance n'est pas exécutée", async () => {
    storageMock.getDueRoutines.mockResolvedValue([routine(1)]);
    storageMock.claimRoutine.mockResolvedValue(false);
    const exec = vi.fn();
    await executerRoutinesDues(MAINTENANT, { sourcing_prospects: exec });
    expect(exec).not.toHaveBeenCalled();
    expect(storageMock.addRoutineRun).not.toHaveBeenCalled();
  });

  it("l'erreur d'une routine n'empêche pas la suivante, et elle est consignée", async () => {
    storageMock.getDueRoutines.mockResolvedValue([routine(1), routine(2)]);
    storageMock.claimRoutine.mockResolvedValue(true);
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ statut: "rien_a_faire", resume: "rien" });
    await executerRoutinesDues(MAINTENANT, { sourcing_prospects: exec });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(storageMock.addRoutineRun).toHaveBeenCalledWith(expect.objectContaining({ routineId: 1, statut: "erreur" }));
    expect(storageMock.updateRoutine).toHaveBeenCalledWith(1, "u1", expect.objectContaining({ derniereErreur: expect.stringContaining("boom") }));
    expect(storageMock.addRoutineRun).toHaveBeenCalledWith(expect.objectContaining({ routineId: 2, statut: "rien_a_faire" }));
  });

  it("type inconnu : ignoré sans planter", async () => {
    storageMock.getDueRoutines.mockResolvedValue([routine(1, { kind: "inconnu" })]);
    storageMock.claimRoutine.mockResolvedValue(true);
    await expect(executerRoutinesDues(MAINTENANT, {})).resolves.toBe(0);
  });

  it("une cible disparue désactive la routine", async () => {
    storageMock.getDueRoutines.mockResolvedValue([routine(1)]);
    storageMock.claimRoutine.mockResolvedValue(true);
    await executerRoutinesDues(MAINTENANT, { sourcing_prospects: async () => ({ statut: "rien_a_faire", resume: "x", desactiver: true }) });
    expect(storageMock.updateRoutine).toHaveBeenCalledWith(1, "u1", expect.objectContaining({ actif: false }));
  });
});

describe("assurerRoutinesSourcing", () => {
  it("crée une routine quotidienne active pour chaque campagne active", async () => {
    storageMock.getAllActiveProspectionCampaigns.mockResolvedValue([{ id: 5, userId: "u1", projectId: 7 }]);
    await assurerRoutinesSourcing(MAINTENANT);
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", projectId: 7, kind: "sourcing_prospects", cible: { campaignId: 5 }, cibleCle: "campaign:5",
      cadence: "quotidienne", heureUtc: 5, actif: true, prochainPassage: new Date("2026-10-14T05:00:00Z"),
    }));
  });
});
