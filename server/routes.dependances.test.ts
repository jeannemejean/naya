// Route POST /api/tasks/:id/dependencies : passe par `ajouterDependance` et répond 400 sur refus.
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

const ajouterDependance = vi.fn();
vi.mock("./services/dependances", () => ({ ajouterDependance }));

const storageMock = { getTaskDependencies: vi.fn() };
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

describe("POST /api/tasks/:id/dependencies", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const post = (body: any) =>
    fetch(`http://127.0.0.1:${port}/api/tasks/7/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refus (false) → 400 invalid_dependency", async () => {
    ajouterDependance.mockResolvedValue(false);
    const res = await post({ dependsOnTaskId: 7 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "invalid_dependency" });
    expect(ajouterDependance).toHaveBeenCalledWith("user-1", 7, 7, "blocked_by");
  });

  it("succès (true) → 201", async () => {
    ajouterDependance.mockResolvedValue(true);
    const res = await post({ dependsOnTaskId: 3, relationType: "follows" });
    expect(res.status).toBe(201);
    expect(ajouterDependance).toHaveBeenCalledWith("user-1", 7, 3, "follows");
  });
});
