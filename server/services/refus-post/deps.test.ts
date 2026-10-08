// Le post de remplacement d'un post de campagne refusé arrive avec ses tâches de
// production (le refusé emporte les siennes à sa suppression, cf. storage.deleteContent).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  storage: {
    createContent: vi.fn(),
    deleteContent: vi.fn(),
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => []),
    getTasksInRange: vi.fn(async () => []),
    checkSlotAvailability: vi.fn(async () => ({ available: true })),
    createTask: vi.fn(async (t: any) => t),
  },
}));

vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("../../storage", () => ({ storage: h.storage }));
vi.mock("../memory/embed", () => ({ embedText: vi.fn() }));
vi.mock("./remplacement", () => ({ genererPostRemplacement: vi.fn() }));

const { refusPostDeps } = await import("./deps");

const ligne = (over: any = {}) => ({
  userId: "u1", projectId: 9, campaignId: 3, socialAccountId: null, platform: "linkedin", contentType: "post",
  pillar: "p", goal: "g", intent: null, scheduledFor: new Date(Date.now() + 5 * 86400000), postFormat: "feed_image",
  title: "Remplaçant", body: "b", status: "draft" as const, contentStatus: "idea" as const, postStatus: "pending" as const,
  autoPost: false as const, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("refusPostDeps.creerPost", () => {
  it("post de campagne : crée le post puis ses tâches de production reliées", async () => {
    h.storage.createContent.mockImplementation(async (c: any) => ({ id: 77, ...c }));
    const cree = await refusPostDeps.creerPost(ligne());
    expect(cree.id).toBe(77);
    const taches = h.storage.createTask.mock.calls.map(([t]: any[]) => t);
    expect(taches.length).toBeGreaterThan(0);
    expect(taches.every((t: any) => t.contentId === 77 && t.campaignId === 3)).toBe(true);
    expect(taches[taches.length - 1].title).toBe("Publier — Remplaçant");
  });

  it("post hors campagne : aucune tâche", async () => {
    h.storage.createContent.mockImplementation(async (c: any) => ({ id: 78, ...c }));
    await refusPostDeps.creerPost(ligne({ campaignId: null }));
    expect(h.storage.createTask).not.toHaveBeenCalled();
  });

  it("l'échec du placement des tâches ne fait pas échouer la création du remplaçant", async () => {
    h.storage.createContent.mockImplementation(async (c: any) => ({ id: 79, ...c }));
    h.storage.createTask.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(refusPostDeps.creerPost(ligne())).resolves.toMatchObject({ id: 79 });
    err.mockRestore();
  });
});
