// Les créateurs de tâches hors auto-planner (atelier de contenu, campagne, validation de
// prospection, plan d'un objectif) passent par le rattachement SEULEMENT dans l'interrupteur,
// avec une carte chargée une fois par passage. Hors interrupteur : objet créé identique.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CarteFil, EtapeCarte } from "./carte";

const chargerCarteMock = vi.hoisted(() => vi.fn());
vi.mock("./carte", async (importOriginal) => ({ ...(await importOriginal<typeof import("./carte")>()), chargerCarte: chargerCarteMock }));
const storageMock = vi.hoisted(() => ({
  getProspectionCampaigns: vi.fn(),
  getLeads: vi.fn(),
  getTasksInRange: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  fixOverlappingTasks: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));

import { placerTachesProductionPosts, placerTachesCampagne } from "../campagne/placement";
import { synchroniserValidationsProspection } from "../prospection-verification";
import { etapeDuPlanObjectif } from "../goal-tasks";

const etape = (id: number, objectifId: number, projetId: number, statut: string): EtapeCarte =>
  ({ id, objectifId, projetId, titre: `E${id}`, pourquoi: null, statut, ordre: 0, faites: 0, prevues: 0 });
const CARTE: CarteFil = {
  objectifs: [
    { id: 1, projetId: 9, titre: "Signer", successMode: "revenue", goalType: "revenue", cible: null, dueDate: null, etapes: [etape(11, 1, 9, "active")] },
    { id: 2, projetId: 9, titre: "Visible", successMode: "visibility", goalType: "monthly", cible: null, dueDate: null, etapes: [etape(21, 2, 9, "unlocked")] },
    { id: 3, projetId: 9, titre: "Livrer", successMode: "consistency", goalType: "monthly", cible: null, dueDate: null, etapes: [etape(31, 3, 9, "locked")] },
  ],
  chainesSansObjectif: new Map(),
  depuis: null,
};

const post = (id: number, jour: string) => ({
  id, userId: "u1", projectId: 9, campaignId: 3, title: `Post ${id}`, postFormat: "feed_image", contentType: "post",
  autoPost: false, scheduledFor: new Date(`${jour}T09:00:00`), publishedAt: null, postStatus: "pending",
  contentStatus: "idea", consigne: null, createdAt: new Date("2026-10-01T10:00:00Z"),
});
function depsPlacement(posts: any[] = []) {
  let n = 1000;
  return {
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => []),
    getTasksInRange: vi.fn(async () => [] as any[]),
    checkSlotAvailability: vi.fn(async () => ({ available: true })),
    createTask: vi.fn(async (t: any) => ({ id: ++n, ...t })),
    updateTask: vi.fn(async (id: number, p: any) => ({ id, ...p })),
    getPostsEntre: vi.fn(async () => posts),
    getTachesAtelier: vi.fn(async () => [] as any[]),
    getTasksForContents: vi.fn(async () => [] as any[]),
  };
}
const creees = (deps: any) => deps.createTask.mock.calls.map(([t]: any[]) => t);
const campagne = {
  id: 3, projectId: 9, phases: [{ number: 1, name: "A", duration: "2 weeks" }],
  generatedTasks: [
    { title: "Plan review", description: "d", type: "other", category: "marketing", priority: 1, estimatedDuration: 30, taskEnergyType: "creative", phase: 1 },
    { title: "Wrap up", description: "d", type: "other", category: "marketing", priority: 1, estimatedDuration: 30, taskEnergyType: "creative", phase: 1 },
  ],
};
const d = (s: string) => new Date(s + "T00:00:00");

beforeEach(() => {
  vi.clearAllMocks();
  chargerCarteMock.mockResolvedValue(CARTE);
  storageMock.getProspectionCampaigns.mockResolvedValue([{ id: 5, name: "IN SCENA", projectId: 9, linkedCampaignId: 3, status: "active" }]);
  storageMock.getLeads.mockResolvedValue([{ id: 1, prospectionCampaignId: 5, stage: "messages_ready", validatedAt: null, archivedAt: null }]);
  storageMock.getTasksInRange.mockResolvedValue([]);
  storageMock.createTask.mockImplementation(async (t: any) => ({ id: 1, ...t }));
  storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("dans l'interrupteur", () => {
  beforeEach(() => { vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1"); });

  it("atelier de contenu : l'objectif visibility du projet des posts et son étape en cours, carte chargée une fois", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-23")];
    const deps = depsPlacement(posts);
    await placerTachesProductionPosts(deps as any, { userId: "u1", posts, aujourdhui: "2026-10-14" });
    const t = creees(deps);
    expect(t).toHaveLength(2);
    for (const x of t) expect(x).toMatchObject({ goalId: 2, milestoneId: 21 });
    expect(t[0].projectId).toBeUndefined(); // l'atelier reste sans projet, comme avant
    expect(chargerCarteMock).toHaveBeenCalledTimes(1);
  });

  it("tâches de campagne : l'unique objectif de classe visibility du projet de la campagne, jamais le premier objectif", async () => {
    const deps = depsPlacement();
    await placerTachesCampagne(deps as any, { userId: "u1", campaign: campagne, debut: d("2026-10-12"), fin: d("2026-10-26") });
    const t = creees(deps);
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toMatchObject({ goalId: 2, milestoneId: 21 });
    expect(chargerCarteMock).toHaveBeenCalledTimes(1);
  });

  it("validation de prospection : l'objectif revenue du projet", async () => {
    const r = await synchroniserValidationsProspection("u1", "2026-10-14");
    expect(r.creees).toBe(1);
    expect(storageMock.createTask.mock.calls[0][0]).toMatchObject({ taskType: "prospection_validation", goalId: 1, milestoneId: 11 });
  });

  it("plan d'un objectif : l'étape en cours ; une étape locked n'est jamais posée", async () => {
    expect(await etapeDuPlanObjectif("u1", { id: 1, projectId: 9 })).toEqual({ milestoneId: 11 });
    expect(await etapeDuPlanObjectif("u1", { id: 3, projectId: 9 })).toEqual({ milestoneId: null });
  });
});

describe("hors interrupteur (non-régression)", () => {
  beforeEach(() => { vi.stubEnv("FIL_CONDUCTEUR_USERS", ""); });

  it("aucun champ de rattachement ajouté, aucune carte chargée", async () => {
    const posts = [post(1, "2026-10-22")];
    const depsA = depsPlacement(posts);
    await placerTachesProductionPosts(depsA as any, { userId: "u1", posts, aujourdhui: "2026-10-14" });
    const depsC = depsPlacement();
    await placerTachesCampagne(depsC as any, { userId: "u1", campaign: campagne, debut: d("2026-10-12"), fin: d("2026-10-26") });
    await synchroniserValidationsProspection("u1", "2026-10-14");
    const toutes = [...creees(depsA), ...creees(depsC), ...storageMock.createTask.mock.calls.map((c: any[]) => c[0])];
    expect(storageMock.createTask).toHaveBeenCalledTimes(1);
    expect(toutes.length).toBeGreaterThan(2);
    for (const t of toutes) {
      expect(t).not.toHaveProperty("goalId");
      expect(t).not.toHaveProperty("milestoneId");
    }
    expect(await etapeDuPlanObjectif("u1", { id: 1, projectId: 9 })).toEqual({});
    expect(chargerCarteMock).not.toHaveBeenCalled();
  });
});
