// creerTache / modifierTache : la logique d'écriture partagée par les routes et l'agent.
// Aucun accès à une vraie base : `storage` et `db` sont mockés (règle du projet).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));

const storageMock = {
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getProject: vi.fn(),
  getMilestone: vi.fn(),
  getUserPreferences: vi.fn(),
  findFirstFreeSlot: vi.fn(),
  checkSlotAvailability: vi.fn(),
  fixOverlappingTasks: vi.fn(),
};
vi.mock("../../storage", () => ({ storage: storageMock }));

const { creerTache, modifierTache, archiverTache, fusionnerActionData } = await import("./ecrire-tache");

// Champs requis par insertTaskSchema.
const BASE = { title: "Nouvelle", type: "admin", category: "operations" };

const TACHE = {
  id: 42, userId: "user-1", title: "Écrire le post", description: "ancien",
  completed: false, scheduledDate: "2026-10-06", scheduledTime: "10:00", estimatedDuration: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTask.mockResolvedValue({ ...TACHE });
  storageMock.createTask.mockImplementation(async (d: any) => ({ id: 99, ...d }));
  storageMock.updateTask.mockImplementation(async (id: number, u: any) => ({ ...TACHE, ...u, id }));
  storageMock.getProject.mockResolvedValue(undefined);
  storageMock.getMilestone.mockResolvedValue(undefined);
  storageMock.getUserPreferences.mockResolvedValue({ workDays: "mon,tue,wed,thu,fri" });
  storageMock.findFirstFreeSlot.mockResolvedValue({ date: "2026-10-06", time: "09:00" });
  storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
  storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
});

describe("creerTache", () => {
  it("crée la tâche (date sans heure → premier créneau libre)", async () => {
    const r = await creerTache("user-1", { ...BASE, scheduledDate: "2026-10-06", estimatedDuration: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tache.userId).toBe("user-1");
    expect(r.tache.scheduledTime).toBe("09:00");
    expect(r.tache.scheduledEndTime).toBe("09:30");
  });

  it("refuse un projet qui n'appartient pas à l'utilisatrice → 404 project_not_found", async () => {
    storageMock.getProject.mockResolvedValue(undefined);
    const r = await creerTache("user-1", { ...BASE, projectId: 7 });
    expect(r).toEqual({ ok: false, status: 404, message: "project_not_found" });
    expect(storageMock.getProject).toHaveBeenCalledWith(7, "user-1");
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });

  it("accepte un projet de l'utilisatrice", async () => {
    storageMock.getProject.mockResolvedValue({ id: 7, userId: "user-1" });
    const r = await creerTache("user-1", { ...BASE, projectId: 7 });
    expect(r.ok).toBe(true);
  });

  it("refuse un jalon verrouillé → 409 milestone_locked", async () => {
    storageMock.getMilestone.mockResolvedValue({ id: 3, userId: "user-1", status: "locked" });
    const r = await creerTache("user-1", { ...BASE, milestoneId: 3 });
    expect(r).toEqual({ ok: false, status: 409, message: "milestone_locked" });
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });

  it("accepte un jalon actif", async () => {
    storageMock.getMilestone.mockResolvedValue({ id: 3, userId: "user-1", status: "active" });
    const r = await creerTache("user-1", { ...BASE, milestoneId: 3 });
    expect(r.ok).toBe(true);
  });

  it("refuse un jalon inexistant → 404 milestone_not_found, rien n'est créé", async () => {
    storageMock.getMilestone.mockResolvedValue(undefined);
    const r = await creerTache("user-1", { ...BASE, milestoneId: 3 });
    expect(r).toEqual({ ok: false, status: 404, message: "milestone_not_found" });
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });

  it("refuse le jalon d'une autre utilisatrice → 404 milestone_not_found (même s'il est actif)", async () => {
    storageMock.getMilestone.mockResolvedValue({ id: 3, userId: "user-2", status: "active" });
    const r = await creerTache("user-1", { ...BASE, milestoneId: 3 });
    expect(r).toEqual({ ok: false, status: 404, message: "milestone_not_found" });
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });

  it("refuse un jour non travaillé (400), comme aujourd'hui", async () => {
    // 2026-10-04 est un dimanche
    const r = await creerTache("user-1", { ...BASE, scheduledDate: "2026-10-04" });
    expect(r).toEqual({ ok: false, status: 400, message: "Sunday is not one of your work days." });
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });
});

describe("modifierTache", () => {
  it("la tâche d'une autre → 404 task_not_found, rien n'est écrit", async () => {
    storageMock.getTask.mockResolvedValue({ ...TACHE, userId: "quelqu-un-d-autre" });
    const r = await modifierTache("user-1", 42, { title: "Piraté" });
    expect(r).toEqual({ ok: false, status: 404, message: "task_not_found" });
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("tâche introuvable → 404 task_not_found", async () => {
    storageMock.getTask.mockResolvedValue(undefined);
    const r = await modifierTache("user-1", 4242, { completed: true });
    expect(r).toEqual({ ok: false, status: 404, message: "task_not_found" });
  });

  it("renvoie `avant`, l'état complet d'avant l'écriture", async () => {
    const r = await modifierTache("user-1", 42, { completed: true, scheduledDate: "2026-10-07" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avant).toEqual(TACHE);
    expect(r.tache.completed).toBe(true);
    expect(r.tache.scheduledDate).toBe("2026-10-07");
  });

  it("champ non éditable seul → 400 no_editable_fields", async () => {
    const r = await modifierTache("user-1", 42, { userId: "autre" });
    expect(r).toEqual({ ok: false, status: 400, message: "no_editable_fields" });
  });
});

describe("archiverTache", () => {
  it("pose archivedAt sur la tâche de l'utilisatrice, sans jamais la supprimer", async () => {
    const r = await archiverTache("user-1", 42);
    expect(r.ok).toBe(true);
    expect(storageMock.updateTask).toHaveBeenCalledTimes(1);
    const [id, patch] = storageMock.updateTask.mock.calls[0];
    expect(id).toBe(42);
    expect(Object.keys(patch)).toEqual(["archivedAt"]);
    expect(patch.archivedAt).toBeInstanceOf(Date);
  });

  it("tâche d'une autre, inconnue ou identifiant fictif : 404, rien d'écrit", async () => {
    expect(await archiverTache("user-2", 42)).toEqual({ ok: false, status: 404, message: "task_not_found" });
    storageMock.getTask.mockResolvedValue(undefined);
    expect(await archiverTache("user-1", 43)).toEqual({ ok: false, status: 404, message: "task_not_found" });
    expect(await archiverTache("user-1", -1)).toEqual({ ok: false, status: 404, message: "task_not_found" });
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });
});

describe("fusionnerActionData", () => {
  it("fusionne dans la clé demandée, le reste d'actionData intact", async () => {
    storageMock.getTask.mockResolvedValue({ ...TACHE, actionData: { lien: "/x", cloture: { autre: 1 } } });
    const r = await fusionnerActionData("user-1", 42, "cloture", { tranchee: "2026-11-09" });
    expect(r.ok).toBe(true);
    expect(storageMock.updateTask).toHaveBeenCalledTimes(1);
    expect(storageMock.updateTask).toHaveBeenCalledWith(42, { actionData: { lien: "/x", cloture: { autre: 1, tranchee: "2026-11-09" } } });
  });

  it("sans actionData : la crée ; tâche d'une autre : 404, rien d'écrit", async () => {
    storageMock.getTask.mockResolvedValue({ ...TACHE, actionData: null });
    await fusionnerActionData("user-1", 42, "cloture", { tranchee: "2026-11-09" });
    expect(storageMock.updateTask).toHaveBeenCalledWith(42, { actionData: { cloture: { tranchee: "2026-11-09" } } });
    storageMock.updateTask.mockClear();
    expect(await fusionnerActionData("user-2", 42, "cloture", { tranchee: "x" })).toEqual({ ok: false, status: 404, message: "task_not_found" });
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });
});
