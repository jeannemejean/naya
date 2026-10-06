// Un contenu n'est publiable automatiquement que sur demande EXPLICITE.
// Le 6 oct. 2026, 19 posts de campagne étaient prêts à partir seuls sur Instagram et
// LinkedIn : la colonne `auto_post` vaut « oui » par défaut. Ce test verrouille la création
// manuelle (POST /api/content) ; les autres chemins posent `autoPost: false` en dur.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
  hashPassword: vi.fn(), verifyPassword: vi.fn(), generateUserId: vi.fn(), generateJWT: vi.fn(),
}));
const storageMock = {
  createContent: vi.fn(async (c: any) => ({ id: 1, ...c })),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port: number;
beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

const creer = (body: any) =>
  fetch(`http://127.0.0.1:${port}/api/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const base = { title: "Post", body: "Texte", platform: "instagram", contentType: "post", pillar: "education", goal: "awareness", scheduledFor: "2026-10-08T09:00:00.000Z" };

describe("POST /api/content — publication automatique sur demande explicite seulement", () => {
  it("sans autoPost → autoPost false, même avec une date", async () => {
    await creer(base);
    expect(storageMock.createContent).toHaveBeenCalledWith(expect.objectContaining({ autoPost: false }));
  });
  it("autoPost: \"true\" (chaîne) ou 1 → false", async () => {
    await creer({ ...base, autoPost: "true" });
    await creer({ ...base, autoPost: 1 });
    for (const call of storageMock.createContent.mock.calls) expect(call[0].autoPost).toBe(false);
  });
  it("autoPost: true explicite → true", async () => {
    await creer({ ...base, autoPost: true });
    expect(storageMock.createContent).toHaveBeenCalledWith(expect.objectContaining({ autoPost: true }));
  });
});
