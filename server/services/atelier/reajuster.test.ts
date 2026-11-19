import { describe, it, expect, vi } from "vitest";
import { reajusterAteliers, type ReajusterDeps } from "./reajuster";

const deps = (posts: any[], taches: any[]): ReajusterDeps & Record<string, any> => ({
  postsEntre: vi.fn(async () => posts),
  tachesAtelier: vi.fn(async () => taches),
  archiverTaches: vi.fn(async () => {}),
  placer: vi.fn(async () => undefined),
});

describe("reajusterAteliers", () => {
  it("semaine sans post restant : les tâches d'atelier non faites sont archivées, la faite reste", async () => {
    const d = deps([], [{ id: 1, completed: false }, { id: 2, completed: false }, { id: 3, completed: true }]);
    await reajusterAteliers(d, "u1", ["2026-11-09"], "2026-11-02");
    expect(d.tachesAtelier).toHaveBeenCalledWith("u1", "2026-11-09");
    expect(d.archiverTaches).toHaveBeenCalledWith("u1", [1, 2]);
    expect(d.placer).not.toHaveBeenCalled();
  });

  it("semaine avec un post restant : le placement redimensionne l'atelier avec ce post", async () => {
    const reste = { id: 7, scheduledFor: new Date("2026-11-11T09:00:00Z"), publishedAt: null, postStatus: "pending" };
    const autreSemaine = { id: 8, scheduledFor: new Date("2026-11-16T09:00:00Z"), publishedAt: null };
    const d = deps([reste, autreSemaine], []);
    await reajusterAteliers(d, "u1", ["2026-11-09", "2026-11-09"], "2026-11-02");
    expect(d.placer).toHaveBeenCalledTimes(1);
    expect(d.placer).toHaveBeenCalledWith("u1", [reste]);
    expect(d.archiverTaches).not.toHaveBeenCalled();
  });

  it("un post du lundi tôt à Paris (dimanche soir UTC) compte dans sa semaine", async () => {
    const d = deps([], []);
    await reajusterAteliers(d, "u1", ["2026-11-09"], "2026-11-02");
    const [, debut] = (d.postsEntre as any).mock.calls[0];
    expect(debut.getTime()).toBeLessThanOrEqual(new Date("2026-11-08T23:00:00Z").getTime());
  });
});
