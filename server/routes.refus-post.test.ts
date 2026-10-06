// Test d'intégration HTTP de POST /api/content/:id/refuser (le service est mocké).
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

const refuserPost = vi.fn();
vi.mock("./services/refus-post/service", () => ({ refuserPost }));
vi.mock("./services/refus-post/deps", () => ({ refusPostDeps: { marqueur: "deps-post" } }));

const { registerRoutes } = await import("./routes");

describe("POST /api/content/:id/refuser", () => {
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
    fetch(`http://127.0.0.1:${port}/api/content/${id}/refuser`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("400 pour un id non numérique ou négatif", async () => {
    for (const id of ["abc", "-3"]) {
      const res = await post(id, { reason: "other" });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("invalid_content_id");
    }
    expect(refuserPost).not.toHaveBeenCalled();
  });

  it("400 pour une raison invalide (y compris celles des tâches)", async () => {
    for (const reason of ["nope", "not_useful", undefined]) {
      const res = await post("5", { reason });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("invalid_reason");
    }
    expect(refuserPost).not.toHaveBeenCalled();
  });

  it("400 pour un freeText de mauvais type", async () => {
    const res = await post("5", { reason: "other", freeText: 12 });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("invalid_free_text");
  });

  it("400 pour remplacer non booléen", async () => {
    for (const remplacer of ["true", 1, null]) {
      const res = await post("5", { reason: "other", remplacer });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("invalid_replace");
    }
    expect(refuserPost).not.toHaveBeenCalled();
  });

  it("404 si le post est introuvable", async () => {
    refuserPost.mockResolvedValue({ statut: "introuvable" });
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(404);
  });

  it("409 already_published", async () => {
    refuserPost.mockResolvedValue({ statut: "deja_publie" });
    const res = await post("5", { reason: "wrong_tone" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("already_published");
  });

  it("200 avec remplacement, explication nettoyée, remplacer par défaut true", async () => {
    refuserPost.mockResolvedValue({ statut: "refuse", remplacement: { id: 9, title: "Autre" } });
    const res = await post("5", { reason: "wrong_tone", freeText: "  trop froid  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refuse: true, remplacement: { id: 9, title: "Autre" } });
    expect(refuserPost).toHaveBeenCalledWith(
      { marqueur: "deps-post" },
      { userId: "user-1", contentId: 5, raison: "wrong_tone", explication: "trop froid", remplacer: true },
    );
  });

  it("remplacer false transmis", async () => {
    refuserPost.mockResolvedValue({ statut: "refuse", remplacement: null });
    await post("5", { reason: "other", remplacer: false });
    expect(refuserPost.mock.calls[0][1].remplacer).toBe(false);
  });

  it("explication vide devient null", async () => {
    refuserPost.mockResolvedValue({ statut: "refuse", remplacement: null });
    await post("5", { reason: "other", freeText: "   " });
    expect(refuserPost.mock.calls[0][1].explication).toBeNull();
  });

  it("200 sans remplacement, avec la raison generation_failed", async () => {
    refuserPost.mockResolvedValue({ statut: "refuse", remplacement: null, raison: "generation_failed" });
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refuse: true, remplacement: null, raison: "generation_failed" });
  });

  it("500 si le service jette", async () => {
    refuserPost.mockRejectedValue(new Error("boom"));
    const res = await post("5", { reason: "other" });
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("refus_failed");
  });
});
