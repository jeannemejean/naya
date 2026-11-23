// Validation client (lot 8) : une modification d'un post en validation le remet « à valider »
// DANS LA MÊME ÉCRITURE (jamais une fenêtre où le worker publierait le post modifié comme
// validé). PATCH /api/content/:id, programmation et enregistrement d'une note de tâche.
// Base, stockage et authentification simulés : aucune vraie base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  storage: {
    getContentById: vi.fn(),
    // Comme la base : rend la ligne écrite (les expressions SQL n'y figurent pas telles quelles).
    updateContent: vi.fn(async (id: number, u: any) => ({ id, ...Object.fromEntries(Object.entries(u).filter(([, v]: any) => !(v && typeof v === "object" && "queryChunks" in v))) })),
    createWorkspaceEntry: vi.fn(async (e: any) => ({ id: 1, ...e })),
    getTask: vi.fn(),
    getContentBySourceTask: vi.fn(),
    createContent: vi.fn(async (c: any) => ({ id: 77, ...c })),
    getMediaItemById: vi.fn(async () => undefined),
  },
  historique: { journaliser: vi.fn(async () => {}), journaliserChangement: vi.fn(async () => {}) },
  dbUpdate: vi.fn(),
}));

vi.mock("./db", () => {
  const chaine = (): any => {
    const suite: any = { then: (ok: any, ko: any) => Promise.resolve([]).then(ok, ko) };
    for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin", "groupBy", "set", "values", "returning", "onConflictDoUpdate", "onConflictDoNothing", "for"]) suite[m] = () => suite;
    return suite;
  };
  h.dbUpdate.mockImplementation(() => chaine());
  const db: any = { select: () => chaine(), update: h.dbUpdate, insert: () => chaine(), delete: () => chaine(), execute: async () => ({ rows: [] }) };
  db.transaction = async (cb: any) => cb(db);
  return { db, pool: { query: vi.fn(), on: vi.fn() } };
});
vi.mock("./storage", () => ({ storage: h.storage }));
vi.mock("./services/gestion-posts/historique", () => h.historique);
vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
  hashPassword: vi.fn(), verifyPassword: vi.fn(), generateUserId: vi.fn(), generateJWT: vi.fn(),
}));
vi.mock("./services/content-deduction", () => ({ deduireChampsContenu: vi.fn(async () => ({})) }));
vi.mock("./services/memory/retrieve", () => ({ retrieveMemories: vi.fn(async () => ({ savoir: [] })) }));
vi.mock("./services/memory/extract", () => ({ extractToMemory: vi.fn(async () => undefined) }));
vi.mock("./services/connexions/comptes", async (orig) => ({
  ...(await orig<any>()),
  compteDePublication: vi.fn(async () => ({ compte: { id: 5, platform: "instagram", accountName: "a", isActive: true, expiresAt: null } })),
}));

const { registerRoutes } = await import("./routes");
const sqlDe = (v: any) => new PgDialect().sqlToQuery(v).sql;

let server: http.Server;
let port = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  if (!server) {
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, r));
    const a = server.address();
    port = typeof a === "object" && a ? a.port : 0;
  }
});
afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});
const enValidation = (o: Record<string, unknown> = {}) => ({
  id: 9, userId: "user-1", title: "T", body: "Avant", platform: "instagram", projectId: null, scheduledFor: null,
  postStatus: "pending", autoPost: false, validationStatut: "validee", ...o,
});

describe("relance atomique de la validation client", () => {
  it("PATCH /api/content/:id : statut remis « à valider » dans la même mise à jour", async () => {
    h.storage.getContentById.mockResolvedValue(enValidation());
    expect((await req("PATCH", "/api/content/9", { body: "Après" })).status).toBe(200);
    expect(h.storage.updateContent).toHaveBeenCalledTimes(1);
    const maj = h.storage.updateContent.mock.calls[0][1] as any;
    expect(maj.body).toBe("Après");
    expect(sqlDe(maj.validationStatut)).toContain("then 'a_valider'");
    expect(h.dbUpdate).not.toHaveBeenCalled();
    expect(h.historique.journaliser).toHaveBeenCalledWith("user-1", 9, "validation_relancee", { avant: "validee" });
  });

  it("PATCH /api/content/:id : rien de ce qui part ne change → statut intact", async () => {
    h.storage.getContentById.mockResolvedValue(enValidation());
    await req("PATCH", "/api/content/9", { pillar: "x" });
    expect(h.storage.updateContent.mock.calls[0][1]).not.toHaveProperty("validationStatut");
  });

  it("programmation avec un texte modifié : relance dans l'écriture du texte", async () => {
    h.storage.getContentById.mockResolvedValue(enValidation());
    await req("POST", "/api/content/9/programmation", { body: "Après" });
    const maj = h.storage.updateContent.mock.calls[0][1] as any;
    expect(maj.body).toBe("Après");
    expect(sqlDe(maj.validationStatut)).toContain("then 'a_valider'");
    expect(h.dbUpdate).not.toHaveBeenCalled();
  });

  it("note de tâche qui réécrit le post : relance dans la même mise à jour", async () => {
    h.storage.getTask.mockResolvedValue({ id: 4, userId: "user-1", type: "content", title: "Post", projectId: null });
    h.storage.getContentBySourceTask.mockResolvedValue(enValidation());
    await req("POST", "/api/tasks/4/workspace", { title: "Post", content: "Nouveau texte" });
    expect(h.storage.updateContent).toHaveBeenCalledTimes(1);
    const maj = h.storage.updateContent.mock.calls[0][1] as any;
    expect(sqlDe(maj.validationStatut)).toContain("then 'a_valider'");
    expect(h.dbUpdate).not.toHaveBeenCalled();
  });
});
