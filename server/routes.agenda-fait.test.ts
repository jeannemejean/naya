// Test d'intégration HTTP des routes « événement d'agenda fait » (Naya seulement).
// La logique d'écriture vit dans services/agenda/faits.ts ; on vérifie ici que les routes
// l'appellent avec le BON compte et refusent un identifiant suspect.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));

vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generateUserId: vi.fn(),
  generateJWT: vi.fn(),
}));

vi.mock("./storage", () => ({ storage: {} }));

const fauxFaits = {
  marquerFait: vi.fn(async () => {}),
  retirerFait: vi.fn(async () => {}),
};
vi.mock("./services/agenda/faits", async (importOriginal) => {
  const reel = await importOriginal<typeof import("./services/agenda/faits")>();
  return { ...reel, marquerFait: fauxFaits.marquerFait, retirerFait: fauxFaits.retirerFait };
});

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port: number;

beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const url = (id: string) => `http://127.0.0.1:${port}/api/agenda/evenements/${encodeURIComponent(id)}/fait`;

describe("routes d'événements d'agenda faits", () => {
  it("POST marque fait pour le compte connecté, avec la date fournie", async () => {
    const res = await fetch(url("abc_20261006T090000Z"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-10-06" }),
    });
    expect(res.status).toBe(200);
    expect(fauxFaits.marquerFait).toHaveBeenCalledWith("user-1", "abc_20261006T090000Z", "2026-10-06");
  });

  it("POST ignore une date mal formée plutôt que de l'enregistrer", async () => {
    await fetch(url("abc"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "demain" }) });
    expect(fauxFaits.marquerFait).toHaveBeenCalledWith("user-1", "abc", null);
  });

  it("DELETE remet à faire pour le compte connecté", async () => {
    const res = await fetch(url("abc"), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(fauxFaits.retirerFait).toHaveBeenCalledWith("user-1", "abc");
  });

  it("refuse un identifiant suspect (400), sans rien écrire", async () => {
    const res = await fetch(url("a b"), { method: "POST" });
    expect(res.status).toBe(400);
    expect(fauxFaits.marquerFait).not.toHaveBeenCalled();
  });
});
