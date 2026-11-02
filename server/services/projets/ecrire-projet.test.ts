// Tests de l'écriture de projet / jalons partagée par les routes et l'agent. Stockage et moteur
// de jalons mockés : aucun test ne touche une vraie base (consigne projet). Ils figent le
// comportement des trois routes d'avant le déplacement (statuts et messages).
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getProjects: vi.fn(), createProject: vi.fn(), upsertUserPreferences: vi.fn(), getProject: vi.fn(), getMilestone: vi.fn(),
}));
const m = vi.hoisted(() => ({ createMilestoneChain: vi.fn(), confirmMilestone: vi.fn() }));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("../milestone-engine", () => m);

const { creerProjet, creerChaineJalons, confirmerJalon } = await import("./ecrire-projet");

beforeEach(() => {
  vi.clearAllMocks();
  s.createProject.mockImplementation(async (row: any) => ({ id: 8, ...row }));
});

describe("creerProjet", () => {
  it("le premier projet devient principal et actif", async () => {
    s.getProjects.mockResolvedValue([]);
    const r = await creerProjet("u1", { name: "Garance" });
    expect(s.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: "Garance", userId: "u1", isPrimary: true, priorityLevel: "primary" }));
    expect(s.upsertUserPreferences).toHaveBeenCalledWith("u1", { activeProjectId: 8 });
    expect(r.projet.id).toBe(8);
  });

  it("les suivants ne touchent ni au principal ni au projet actif ; userId du corps ignoré", async () => {
    s.getProjects.mockResolvedValue([{ id: 1 }]);
    await creerProjet("u1", { name: "Tour de main", userId: "u2" });
    expect(s.createProject.mock.calls[0][0].userId).toBe("u1");
    expect(s.createProject.mock.calls[0][0].isPrimary).toBeUndefined();
    expect(s.upsertUserPreferences).not.toHaveBeenCalled();
  });

  it("un corps invalide lève (la route en fait une 500)", async () => {
    s.getProjects.mockResolvedValue([]);
    await expect(creerProjet("u1", {})).rejects.toThrow();
  });
});

describe("creerChaineJalons", () => {
  it("400 / 404 avec les messages de la route", async () => {
    expect(await creerChaineJalons("u1", NaN, undefined)).toEqual({ ok: false, status: 400, message: "projectId invalide" });
    expect(await creerChaineJalons("u1", 5, {})).toEqual({ ok: false, status: 400, message: "milestones[] requis" });
    expect(await creerChaineJalons("u1", 5, { milestones: [{ title: " " }] })).toEqual({ ok: false, status: 400, message: "Chaque jalon doit avoir un title" });
    s.getProject.mockResolvedValue(undefined);
    expect(await creerChaineJalons("u1", 5, { milestones: [{ title: "A" }] })).toEqual({ ok: false, status: 404, message: "Projet introuvable" });
    expect(m.createMilestoneChain).not.toHaveBeenCalled();
  });

  it("crée la chaîne pour un projet à elle", async () => {
    s.getProject.mockResolvedValue({ id: 5 });
    m.createMilestoneChain.mockResolvedValue([{ id: 1 }]);
    expect(await creerChaineJalons("u1", 5, { milestones: [{ title: "A" }] })).toEqual({ ok: true, jalons: [{ id: 1 }] });
    expect(s.getProject).toHaveBeenCalledWith(5, "u1");
    expect(m.createMilestoneChain).toHaveBeenCalledWith(5, "u1", [{ title: "A" }]);
  });
});

describe("confirmerJalon", () => {
  it("le jalon d'une autre : 404 Jalon introuvable, rien n'est confirmé", async () => {
    s.getMilestone.mockResolvedValue({ id: 3, userId: "u2" });
    expect(await confirmerJalon("u1", 3)).toEqual({ ok: false, status: 404, message: "Jalon introuvable" });
    expect(m.confirmMilestone).not.toHaveBeenCalled();
  });

  it("confirme le sien", async () => {
    s.getMilestone.mockResolvedValue({ id: 3, userId: "u1" });
    m.confirmMilestone.mockResolvedValue({ id: 3, status: "completed" });
    expect(await confirmerJalon("u1", 3)).toEqual({ ok: true, jalon: { id: 3, status: "completed" } });
  });
});
