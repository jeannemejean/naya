// Routes de gestion des posts : notes, historique, duplication, corbeille, actions groupées.
// Dépendances injectées, aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerGestionPostsRoutes } = await import("./routes-gestion-posts");

const POST = {
  id: 7, userId: "u1", projectId: 1, title: "T", body: "B", platform: "instagram", contentType: "post", pillar: "p",
  goal: "g", contentStatus: "draft", postStatus: "pending", autoPost: false, publishedAt: null,
  scheduledFor: new Date("2026-12-01T09:00:00Z"), mediaIds: [1], premierCommentaire: "pc", createdAt: new Date("2026-11-01T00:00:00Z"),
};

function fauxDeps() {
  let n = 100;
  return {
    post: vi.fn(async (id: number) => (id === 7 ? { ...POST } : undefined)),
    postMemeSupprime: vi.fn(async (id: number) => (id === 7 ? { ...POST } : id === 8 ? { ...POST, id: 8, supprimeLe: new Date() } : undefined)),
    posts: vi.fn(async (_u: string, ids: number[]) => ids.filter((i) => i < 50).map((id) => ({ ...POST, id }))),
    projet: vi.fn(async (id: number) => (id < 10 ? { id } : undefined)),
    creer: vi.fn(async (row: any) => ({ ...row, id: ++n })),
    deplacer: vi.fn(async () => true),
    mettreALaCorbeille: vi.fn(async () => true),
    restaurer: vi.fn(async () => true),
    corbeille: vi.fn(async () => [{ ...POST, id: 8 }]),
    supprimerDefinitivement: vi.fn(async () => {}),
    notes: vi.fn(async () => [{ id: 1, texte: "n" }]),
    ajouterNote: vi.fn(async (_u: string, contentId: number, texte: string) => ({ id: 2, contentId, texte })),
    supprimerNote: vi.fn(async (_u: string, _c: number, noteId: number) => noteId === 2),
    historique: vi.fn(async () => [] as any[]),
    journaliser: vi.fn(async () => {}),
  };
}

let deps: ReturnType<typeof fauxDeps>;
let server: http.Server;
let port: number;
beforeEach(async () => {
  deps = fauxDeps();
  const app = express();
  app.use(express.json());
  registerGestionPostsRoutes(app, deps as any);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

describe("notes internes", () => {
  it("liste, ajoute (journalisée), supprime ; post d'un autre compte : 404", async () => {
    expect((await req("GET", "/api/content/7/notes")).status).toBe(200);
    const r = await req("POST", "/api/content/7/notes", { texte: "  à revoir " });
    expect(r.status).toBe(201);
    expect(deps.ajouterNote).toHaveBeenCalledWith("u1", 7, "à revoir");
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 7, "note_ajoutee", null);
    expect((await req("DELETE", "/api/content/7/notes/2")).status).toBe(200);
    expect((await req("DELETE", "/api/content/7/notes/3")).status).toBe(404);
    expect((await req("GET", "/api/content/9/notes")).status).toBe(404);
    expect((await req("POST", "/api/content/9/notes", { texte: "x" })).status).toBe(404);
  });
  it("texte vide ou trop long : 400", async () => {
    expect((await req("POST", "/api/content/7/notes", { texte: " " })).status).toBe(400);
    expect((await req("POST", "/api/content/7/notes", { texte: "x".repeat(2001) })).status).toBe(400);
  });
});

describe("historique", () => {
  it("sans événement « créé » journalisé, il est déduit de la date de création", async () => {
    deps.historique.mockResolvedValueOnce([{ id: 3, evenement: "texte_modifie", createdAt: new Date(), details: null }]);
    const j: any = await (await req("GET", "/api/content/7/historique")).json();
    expect(j.map((e: any) => e.evenement)).toEqual(["texte_modifie", "cree"]);
    expect((await req("GET", "/api/content/9/historique")).status).toBe(404);
  });
});

describe("dupliquer", () => {
  it("vers une autre marque : brouillon non programmé, sans compte ; journalisé des deux côtés", async () => {
    const r = await req("POST", "/api/content/7/dupliquer", { projectId: 2 });
    expect(r.status).toBe(201);
    const j: any = await r.json();
    expect(j.crees).toHaveLength(1);
    expect(deps.creer).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 2, autoPost: false, platformPostId: null, socialAccountId: null, premierCommentaire: "pc", body: "B",
    }));
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 7, "duplique", { versProjetId: 2, nouveauId: 101 });
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 101, "cree", { depuis: 7 });
  });
  it("vers plusieurs marques d'un coup", async () => {
    const j: any = await (await req("POST", "/api/content/7/dupliquer", { projectIds: [2, 3] })).json();
    expect(j.crees.map((c: any) => c.projectId)).toEqual([2, 3]);
  });
  it("sans marque (null), et avec une date", async () => {
    await req("POST", "/api/content/7/dupliquer", { projectId: null, scheduledFor: "2027-01-05T10:00:00.000Z" });
    expect(deps.creer).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, scheduledFor: new Date("2027-01-05T10:00:00.000Z") }));
  });
  it("une marque qui n'est pas à elle : 404, rien de créé ; date illisible : 400", async () => {
    expect((await req("POST", "/api/content/7/dupliquer", { projectIds: [2, 42] })).status).toBe(404);
    expect((await req("POST", "/api/content/7/dupliquer", { projectId: 2, scheduledFor: "demain" })).status).toBe(400);
    expect((await req("POST", "/api/content/9/dupliquer", { projectId: 2 })).status).toBe(404);
    expect(deps.creer).not.toHaveBeenCalled();
  });
});

describe("corbeille", () => {
  it("liste, restaure, supprime définitivement (seulement depuis la corbeille)", async () => {
    expect(((await (await req("GET", "/api/content/corbeille")).json()) as any[]).map((p) => p.id)).toEqual([8]);
    expect((await req("POST", "/api/content/8/restaurer")).status).toBe(200);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 8, "restaure", null);
    expect((await req("POST", "/api/content/7/restaurer")).status).toBe(409);
    expect((await req("DELETE", "/api/content/7/definitif")).status).toBe(409);
    expect((await req("DELETE", "/api/content/8/definitif")).status).toBe(200);
    expect(deps.supprimerDefinitivement).toHaveBeenCalledWith(8);
    expect((await req("DELETE", "/api/content/9/definitif")).status).toBe(404);
  });
});

describe("actions groupées", () => {
  it("un id qui n'est pas à elle : 404, rien n'est touché", async () => {
    expect((await req("POST", "/api/content/actions-groupees", { ids: [7, 77], action: "supprimer" })).status).toBe(404);
    expect(deps.mettreALaCorbeille).not.toHaveBeenCalled();
  });
  it("corps illisible : 400", async () => {
    expect((await req("POST", "/api/content/actions-groupees", { ids: [7], action: "publier" })).status).toBe(400);
  });
  it("supprimer : les publiés et ceux en cours sont signalés, les autres vont à la corbeille", async () => {
    deps.posts.mockResolvedValueOnce([{ ...POST, id: 1 }, { ...POST, id: 2, postStatus: "posted", publishedAt: new Date() }, { ...POST, id: 3, postStatus: "processing" }]);
    const j: any = await (await req("POST", "/api/content/actions-groupees", { ids: [1, 2, 3], action: "supprimer" })).json();
    expect(j.traites).toEqual([1]);
    expect(j.ignores).toEqual([{ id: 2, raison: "deja_publie" }, { id: 3, raison: "en_cours" }]);
    expect(deps.mettreALaCorbeille).toHaveBeenCalledTimes(1);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 1, "supprime", expect.anything());
  });
  it("déplacer de n jours ; un post parti entre-temps est signalé", async () => {
    deps.deplacer.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const j: any = await (await req("POST", "/api/content/actions-groupees", { ids: [1, 2], action: "deplacer", jours: 1 })).json();
    expect(deps.deplacer).toHaveBeenCalledWith(1, "u1", new Date("2026-12-02T09:00:00Z"));
    expect(j.traites).toEqual([1]);
    expect(j.ignores).toEqual([{ id: 2, raison: "en_cours" }]);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 1, "date_modifiee", { avant: "2026-12-01T09:00:00.000Z", apres: "2026-12-02T09:00:00.000Z" });
  });
  it("dupliquer vers des marques : chaque post × chaque marque ; marque étrangère : 404", async () => {
    const j: any = await (await req("POST", "/api/content/actions-groupees", { ids: [1, 2], action: "dupliquer", projectIds: [2, 3] })).json();
    expect(j.crees).toHaveLength(4);
    expect((await req("POST", "/api/content/actions-groupees", { ids: [1], action: "dupliquer", projectIds: [42] })).status).toBe(404);
  });
});
