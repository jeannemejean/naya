import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { bilanSilencieux } = await import("./bilan");

const M = new Date("2026-11-25T09:00:00Z");
const DEPUIS = new Date("2026-11-10T00:00:00Z");
const projets = [
  { id: 1, userId: "u1", name: "Pause", projectStatus: "paused", priorityLevel: 1, statusNote: null },
  { id: 2, userId: "u1", name: "Agence", projectStatus: "active", priorityLevel: 2, statusNote: "note" },
  { id: 3, userId: "u1", name: "Idée", projectStatus: "incubating", priorityLevel: 1, statusNote: null },
  { id: 4, userId: "u1", name: "Boutique", projectStatus: "active", priorityLevel: null, statusNote: null },
];
const deps = () => ({
  projets: vi.fn(async () => projets),
  tachesEnRetard: vi.fn(async () => [
    { id: 10, userId: "u1", projectId: 1, title: "Relire", scheduledDate: "2026-11-12" },
    { id: 11, userId: "u2", projectId: 2, title: "Pas à elle", scheduledDate: "2026-11-12" },
  ]),
  derniereTacheFaite: vi.fn(async (_u: string, pid: number) => (pid === 2 ? new Date("2026-11-08T10:00:00Z") : null)),
  posts: vi.fn(async () => [
    { userId: "u1", projectId: 2, scheduledFor: new Date("2026-11-15T09:00:00Z"), postStatus: "posted", publishedAt: new Date("2026-11-15T09:00:00Z") },
    { userId: "u1", projectId: 2, scheduledFor: new Date("2026-11-16T09:00:00Z"), postStatus: "failed", publishedAt: null },
  ]),
  rituels: vi.fn(async () => [{ id: 5, userId: "u1", projectId: 2, title: "Actus", days: "mon,tue,wed,thu,fri", intervalWeeks: 1, active: true }]),
  envois: vi.fn(async () => [{ id: 7, userId: "u1", projectId: 2, marque: "Sézane", objet: "X", statut: "envoye", prochaineRelance: "2026-11-27" }]),
});

describe("bilanSilencieux", () => {
  it("ordre : actifs (priorité, sans priorité en dernier), puis en pause ; incubation exclue", async () => {
    const b = await bilanSilencieux(deps(), "u1", DEPUIS, M);
    expect(b.projets.map((p) => p.nom)).toEqual(["Agence", "Boutique", "Pause"]);
    expect(b.depuis).toBe(DEPUIS.toISOString());
  });
  it("tâche en retard d'un projet en pause : présente ; celle d'une autre : jamais", async () => {
    const b = await bilanSilencieux(deps(), "u1", DEPUIS, M);
    expect(b.projets.find((p) => p.nom === "Pause")!.tachesEnRetard).toEqual([{ id: 10, titre: "Relire", date: "2026-11-12" }]);
    expect(b.projets.flatMap((p) => p.tachesEnRetard).map((t) => t.id)).not.toContain(11);
  });
  it("posts prévus/publiés, créneaux, envois, dernière tâche faite", async () => {
    const a = (await bilanSilencieux(deps(), "u1", DEPUIS, M)).projets.find((p) => p.nom === "Agence")!;
    expect(a).toMatchObject({
      postsPrevus: 2, postsPublies: 1, noteActuelle: "note", derniereTacheFaite: "2026-11-08T10:00:00.000Z",
      creneaux: [{ id: 5, titre: "Actus", rythme: "du lun au ven" }],
      envoisEnCours: [{ id: 7, marque: "Sézane", objet: "X", prochaineRelance: "2026-11-27" }],
    });
  });
});
