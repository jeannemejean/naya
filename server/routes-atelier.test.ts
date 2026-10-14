// Routes de l'atelier : ce que les services ne voient pas (semaine invalide, post d'un autre
// compte, URL de visuel étrangère, post validé non modifiable).
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  storage: {
    getContentById: vi.fn(),
    getPostsEntre: vi.fn(async () => [] as any[]),
    getTachesAtelier: vi.fn(async () => [] as any[]),
    getProject: vi.fn(async () => ({ name: "Projet" })),
  },
  db: { update: vi.fn(() => ({ set: () => ({ where: async () => {} }) })), execute: vi.fn(async () => ({})) },
}));
vi.mock("./db", () => ({ db: h.db, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: h.storage }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); } }));
vi.mock("./services/atelier/deps", () => ({
  depsRedaction: {}, depsValidation: {}, mediasDuPost: vi.fn(async () => []), compteDuPost: vi.fn(async () => null),
}));
vi.mock("./services/livrables/deps", () => ({ livrablesDeps: {} }));
vi.mock("./services/livrables/service", () => ({ creerLivrable: vi.fn(async () => ({ mediaId: 3 })) }));

const { registerAtelierRoutes } = await import("./routes-atelier");

let server: http.Server;
let port: number;
beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  registerAtelierRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

describe("routes de l'atelier", () => {
  it("une semaine qui n'est pas un lundi, ou illisible : 400", async () => {
    expect((await req("GET", "/api/atelier/2026-10-20")).status).toBe(400);
    expect((await req("GET", "/api/atelier/semaine")).status).toBe(400);
    expect((await req("GET", "/api/atelier/2026-10-19")).status).toBe(200);
  });

  it("la semaine ne montre que les posts de cette semaine", async () => {
    h.storage.getPostsEntre.mockResolvedValueOnce([
      { id: 1, title: "a", body: "x", platform: "linkedin", postFormat: "text", scheduledFor: new Date("2026-10-19T09:00:00Z"), contentStatus: "draft", campaignId: 3 },
      { id: 2, title: "b", body: "x", platform: "linkedin", postFormat: "text", scheduledFor: new Date("2026-10-26T09:00:00Z"), contentStatus: "draft", campaignId: 3 },
    ]);
    const json: any = await (await req("GET", "/api/atelier/2026-10-19")).json();
    expect(json.posts.map((p: any) => p.id)).toEqual([1]);
    expect(json.posts[0]).toMatchObject({ etat: "brouillon", genre: "texte", compteConnecte: false });
  });

  it("un post issu d'une tendance expose tendanceProjetId (le client le fait rédiger à l'ouverture)", async () => {
    h.storage.getPostsEntre.mockResolvedValueOnce([
      { id: 3, title: "t", body: "Format : …", platform: "instagram", postFormat: "carousel", scheduledFor: new Date("2026-10-21T08:00:00Z"), contentStatus: "idea", campaignId: null, tendanceProjetId: 12 },
    ]);
    const json: any = await (await req("GET", "/api/atelier/2026-10-19")).json();
    expect(json.posts[0]).toMatchObject({ id: 3, campaignId: null, tendanceProjetId: 12 });
  });

  it("le post d'un autre compte est introuvable partout", async () => {
    h.storage.getContentById.mockResolvedValue(undefined);
    expect((await req("PATCH", "/api/atelier/posts/9", { body: "x" })).status).toBe(404);
    expect((await req("POST", "/api/atelier/posts/9/visuels", { url: "x" })).status).toBe(404);
    expect((await req("DELETE", "/api/atelier/posts/9/visuels/3")).status).toBe(404);
    expect((await req("PATCH", "/api/atelier/posts/abc", { body: "x" })).status).toBe(404);
  });

  it("un post validé ne se modifie pas (on le dévalide d'abord)", async () => {
    h.storage.getContentById.mockResolvedValue({ id: 9, contentStatus: "ready", postStatus: "pending" });
    expect((await req("PATCH", "/api/atelier/posts/9", { body: "x" })).status).toBe(409);
    expect(h.db.update).not.toHaveBeenCalled();
  });

  it("un visuel qui n'est pas un envoi de ce compte est refusé", async () => {
    h.storage.getContentById.mockResolvedValue({ id: 9, contentStatus: "draft", postStatus: "pending" });
    const r = await req("POST", "/api/atelier/posts/9/visuels", { url: "https://ailleurs.example/a.png" });
    expect(r.status).toBe(400);
    expect(h.db.execute).not.toHaveBeenCalled();
  });

  it("écrire soi-même un post « à rédiger » en fait un brouillon et met la consigne de côté", async () => {
    let ecrit: any = null;
    h.db.update.mockReturnValueOnce({ set: (p: any) => { ecrit = p; return { where: async () => {} }; } } as any);
    h.storage.getContentById.mockResolvedValue({ id: 9, body: "L'idée", campaignId: 3, contentStatus: "idea", autoPost: false, consigne: null, postStatus: "pending" });
    expect((await req("PATCH", "/api/atelier/posts/9", { body: "Mon texte" })).status).toBe(200);
    expect(ecrit).toMatchObject({ body: "Mon texte", contentStatus: "draft", consigne: "L'idée" });
  });

  it("format inconnu : 400", async () => {
    h.storage.getContentById.mockResolvedValue({ id: 9, contentStatus: "draft", postStatus: "pending" });
    expect((await req("PATCH", "/api/atelier/posts/9", { postFormat: "hologramme" })).status).toBe(400);
  });
});
