// Routes /api/savoir/index : réservées au propriétaire, sonde + comptage, rattrapage.
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
const storageMock = { getUser: vi.fn() };
vi.mock("./storage", () => ({ storage: storageMock }));

const indexMock = {
  indexerManquants: vi.fn(),
  sonderEmbeddings: vi.fn(),
  compterManquants: vi.fn(),
  invaliderSonde: vi.fn(),
  depsReelles: {},
};
vi.mock("./services/memory/indexer-manquants", () => indexMock);

const { registerRoutes } = await import("./routes");

describe("/api/savoir/index", () => {
  let server: http.Server;
  let port: number;
  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue({ id: "user-1", role: "owner" });
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as any).port;
  });
  afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

  const url = () => `http://127.0.0.1:${port}/api/savoir/index`;

  it("GET et POST : 403 pour un non-propriétaire, sans rien exécuter", async () => {
    storageMock.getUser.mockResolvedValue({ id: "user-1", role: "user" });
    expect((await fetch(url())).status).toBe(403);
    expect((await fetch(url(), { method: "POST" })).status).toBe(403);
    expect(indexMock.sonderEmbeddings).not.toHaveBeenCalled();
    expect(indexMock.indexerManquants).not.toHaveBeenCalled();
  });

  it("GET : renvoie disponibilité, raison et manquants", async () => {
    indexMock.sonderEmbeddings.mockResolvedValue({ disponible: false, raison: "credit_balance_exhausted" });
    indexMock.compterManquants.mockResolvedValue(80);
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disponible: false, raison: "credit_balance_exhausted", manquants: 80 });
    expect(indexMock.compterManquants).toHaveBeenCalledWith("user-1");
  });

  it("POST : lance l'indexation pour l'utilisateur et invalide la sonde", async () => {
    indexMock.indexerManquants.mockResolvedValue({ traites: 3, indexes: 3, echecs: 0 });
    const res = await fetch(url(), { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ traites: 3, indexes: 3, echecs: 0 });
    expect(indexMock.indexerManquants.mock.calls[0][1]).toBe("user-1");
    expect(indexMock.invaliderSonde).toHaveBeenCalled();
  });
});
