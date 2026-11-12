// Le mot du matin servi depuis le cache ne calcule plus le fil : le fil a sa propre route
// (GET /api/fil/matin) et le chemin cache rend exactement la réponse d'avant la branche.
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

const h = vi.hoisted(() => ({ construireMatin: vi.fn() }));
vi.mock("./services/fil/matin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/fil/matin")>()),
  construireMatin: h.construireMatin,
}));

const storageMock = { getBrandDna: vi.fn(), getUserPreferences: vi.fn() };
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port = 0;
afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("FIL_CONDUCTEUR_USERS", "user-1");
  if (!server) {
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as any).port;
  }
});

describe("POST /api/tasks/daily-brief — chemin cache", () => {
  it("rend {date, content, dismissed} sans calculer le fil, même sous interrupteur", async () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    storageMock.getBrandDna.mockResolvedValue({ id: 1 });
    storageMock.getUserPreferences.mockResolvedValue({ dailyBriefDate: todayStr, dailyBriefContent: "Bonjour", dailyBriefDismissed: false });
    h.construireMatin.mockResolvedValue({ tachesCles: [], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/daily-brief`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ date: todayStr, content: "Bonjour", dismissed: false });
    expect(h.construireMatin).not.toHaveBeenCalled();
  });
});
