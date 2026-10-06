// Test d'intégration HTTP de POST /api/tasks/:id/refuser (le service est mocké).
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

const refuserTache = vi.fn();
vi.mock("./services/refus/service", () => ({ refuserTache }));
vi.mock("./services/refus/deps", () => ({ refusDeps: { marqueur: "deps" } }));

const { registerRoutes } = await import("./routes");

describe("POST /api/tasks/:id/refuser", () => {
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

  const post = (id: string, body: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/tasks/${id}/refuser`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("400 pour un id non numérique ou négatif", async () => {
    for (const id of ["abc", "-3"]) {
      const res = await post(id, { reason: "other" });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("invalid_task_id");
    }
    expect(refuserTache).not.toHaveBeenCalled();
  });

  it("400 pour une raison invalide", async () => {
    const res = await post("5", { reason: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("invalid_reason");
    expect(refuserTache).not.toHaveBeenCalled();
  });

  it("400 pour un freeText de mauvais type", async () => {
    const res = await post("5", { reason: "other", freeText: 12 });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("invalid_free_text");
  });

  it("404 si la tâche est introuvable", async () => {
    refuserTache.mockResolvedValue({ statut: "introuvable" });
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(404);
  });

  it("409 si la tâche est déjà terminée", async () => {
    refuserTache.mockResolvedValue({ statut: "deja_terminee" });
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("task_already_completed");
  });

  it("200 avec remplacement, freeText nettoyé", async () => {
    refuserTache.mockResolvedValue({ statut: "refusee", remplacement: { id: 9, title: "Autre" } });
    const res = await post("5", { reason: "too_vague", freeText: "  trop flou  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refusee: true, remplacement: { id: 9, title: "Autre" } });
    expect(refuserTache).toHaveBeenCalledWith(
      { marqueur: "deps" },
      { userId: "user-1", taskId: 5, raison: "too_vague", freeText: "trop flou" },
    );
  });

  it("freeText vide devient null", async () => {
    refuserTache.mockResolvedValue({ statut: "refusee", remplacement: null });
    await post("5", { reason: "other", freeText: "   " });
    expect(refuserTache.mock.calls[0][1].freeText).toBeNull();
  });

  it("200 sans remplacement, avec la raison generation_failed", async () => {
    refuserTache.mockResolvedValue({ statut: "refusee", remplacement: null, raison: "generation_failed" });
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refusee: true, remplacement: null, raison: "generation_failed" });
  });

  it("500 si le service jette", async () => {
    refuserTache.mockRejectedValue(new Error("boom"));
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("refus_failed");
  });
});
