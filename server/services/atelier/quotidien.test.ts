import { describe, it, expect, vi } from "vitest";
import { basculerVersAteliers, rappelVeille, preRediger } from "./quotidien";

const post = (id: number, jour: string, over: any = {}) => ({
  id, userId: "u", campaignId: 3, title: `Post ${id}`, postFormat: "feed_image", autoPost: false,
  scheduledFor: new Date(`${jour}T07:00:00Z`), publishedAt: null, postStatus: "pending", contentStatus: "idea", consigne: null, body: "idée", ...over,
});
const t = (id: number, contentId: number, title: string, over: any = {}) => ({ id, contentId, title, completed: false, archivedAt: null, ...over });

function fabrique(posts: any[], taches: any[] = [], over: any = {}) {
  return {
    postsEntre: vi.fn(async () => posts),
    tachesDesPosts: vi.fn(async () => taches),
    archiverTaches: vi.fn(async () => {}),
    desarchiverTaches: vi.fn(async () => {}),
    placer: vi.fn(async () => ({ creees: 2 })),
    tachesAtelier: vi.fn(async () => [] as any[]),
    rediger: vi.fn(async () => ({ statut: "redige", body: "x" } as any)),
    notifier: vi.fn(async () => {}),
    ...over,
  };
}

describe("basculerVersAteliers", () => {
  it("un post à venir dont aucune étape n'est faite : ses étapes d'écran sont archivées, il rejoint l'atelier", async () => {
    const posts = [post(1, "2026-10-22")];
    const taches = [t(10, 1, "Rédiger le texte — Post 1"), t(11, 1, "Publier — Post 1"), t(12, 1, "Tourner — Post 1")];
    const deps = fabrique(posts, taches);
    const r = await basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: true });
    expect(r).toEqual({ convertis: [1], archivees: [10, 11], creees: 2 });
    expect(deps.archiverTaches).toHaveBeenCalledWith("u", [10, 11]);
    expect(deps.placer).toHaveBeenCalledWith("u", posts);
    expect(deps.archiverTaches.mock.invocationCallOrder[0]).toBeLessThan(deps.placer.mock.invocationCallOrder[0]);
  });

  it("jamais : un post dont une étape est faite, un post validé ou publié, un post d'aujourd'hui ou passé, un post sans anciennes étapes", async () => {
    const posts = [
      post(1, "2026-10-22"), post(2, "2026-10-22", { contentStatus: "ready" }), post(3, "2026-10-19"),
      post(4, "2026-10-22", { postStatus: "posted" }), post(5, "2026-10-23"),
    ];
    const taches = [
      t(10, 1, "Rédiger le texte — Post 1", { completed: true }), t(11, 1, "Publier — Post 1"),
      t(20, 2, "Publier — Post 2"), t(30, 3, "Publier — Post 3"), t(40, 4, "Publier — Post 4"),
    ];
    const deps = fabrique(posts, taches);
    const r = await basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: true });
    expect(r.convertis).toEqual([]);
    expect(deps.archiverTaches).not.toHaveBeenCalled();
    expect(deps.placer).not.toHaveBeenCalled();
  });

  it("à blanc : dit ce qui serait fait, n'écrit rien", async () => {
    const deps = fabrique([post(1, "2026-10-22")], [t(10, 1, "Rédiger le texte — Post 1")]);
    const r = await basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: false });
    expect(r).toEqual({ convertis: [1], archivees: [10], creees: 0 });
    expect(deps.archiverTaches).not.toHaveBeenCalled();
    expect(deps.placer).not.toHaveBeenCalled();
  });

  it("une étape vidéo faite (Tourner) compte aussi : le post garde son parcours", async () => {
    const deps = fabrique([post(1, "2026-10-22", { postFormat: "reel" })], [t(10, 1, "Écrire le script — Post 1"), t(11, 1, "Tourner — Post 1", { completed: true })]);
    expect((await basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: true })).convertis).toEqual([]);
    expect(deps.archiverTaches).not.toHaveBeenCalled();
  });

  it("la pose de l'atelier échoue : les étapes archivées sont rendues (le post n'est jamais laissé sans rien)", async () => {
    const deps = fabrique([post(1, "2026-10-22")], [t(10, 1, "Rédiger le texte — Post 1")], { placer: vi.fn(async () => { throw new Error("db"); }) });
    await expect(basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: true })).rejects.toThrow("db");
    expect(deps.desarchiverTaches).toHaveBeenCalledWith("u", [10]);
  });

  it("les étapes archivées ne comptent plus (bascule déjà faite → rien)", async () => {
    const deps = fabrique([post(1, "2026-10-22")], [t(10, 1, "Rédiger le texte — Post 1", { archivedAt: new Date() })]);
    expect((await basculerVersAteliers(deps, "u", { aujourdhui: "2026-10-19", appliquer: true })).convertis).toEqual([]);
  });
});

describe("rappelVeille", () => {
  const maintenant = new Date("2026-10-21T06:00:00Z"); // mercredi 8 h à Paris
  it("des posts de demain non validés : un message avec le lien vers l'atelier de leur semaine", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-22", { contentStatus: "draft" }), post(3, "2026-10-22", { contentStatus: "ready" }), post(4, "2026-10-23")];
    const deps = fabrique(posts);
    const n = await rappelVeille(deps, "u", maintenant, "fr");
    expect(n).toBe(2);
    expect(deps.notifier).toHaveBeenCalledWith("u", "2 posts de demain ne sont pas validés : ils ne partiront pas. Ouvre l'atelier pour les valider.", "/atelier?semaine=2026-10-19");
  });
  it("un seul post, en anglais", async () => {
    const deps = fabrique([post(1, "2026-10-22")]);
    await rappelVeille(deps, "u", maintenant, "en");
    expect(deps.notifier).toHaveBeenCalledWith("u", "1 post scheduled for tomorrow isn't approved: it won't go out. Open the workshop to approve it.", "/atelier?semaine=2026-10-19");
  });
  it("tout est validé : aucun message", async () => {
    const deps = fabrique([post(1, "2026-10-22", { autoPost: true })]);
    expect(await rappelVeille(deps, "u", maintenant, "fr")).toBe(0);
    expect(deps.notifier).not.toHaveBeenCalled();
  });
});

describe("preRediger", () => {
  it("rédige les posts « à rédiger » des ateliers d'aujourd'hui et de demain, s'arrête au refus de dépense", async () => {
    const atelier = { id: 7, taskType: "atelier_contenu", completed: false, scheduledDate: "2026-10-20", actionData: { semaine: "2026-10-26" } };
    const loin = { id: 8, taskType: "atelier_contenu", completed: false, scheduledDate: "2026-10-23", actionData: { semaine: "2026-11-02" } };
    const posts = [post(1, "2026-10-27"), post(2, "2026-10-28", { contentStatus: "draft", consigne: "x" }), post(3, "2026-10-29"), post(4, "2026-10-30")];
    const rediger = vi.fn()
      .mockResolvedValueOnce({ statut: "redige", body: "x" })
      .mockResolvedValueOnce({ statut: "refus" });
    const deps = fabrique(posts, [], {
      tachesAtelier: vi.fn(async (_u: string, s: string) => (s === "2026-10-26" ? [atelier] : s === "2026-11-02" ? [loin] : [])),
      rediger,
    });
    const n = await preRediger(deps, "u", "2026-10-19", (d) => !["2026-10-24", "2026-10-25"].includes(d));
    expect(n).toBe(1);
    expect(rediger.mock.calls.map((c: any[]) => c[1])).toEqual([1, 3]);
    expect(deps.postsEntre).toHaveBeenCalledTimes(1);
  });
});
