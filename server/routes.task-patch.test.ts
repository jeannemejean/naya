// Test d'intégration : PATCH /api/tasks/:id ne modifie QUE ses propres tâches, et QUE les
// champs éditables. Avant, la route écrivait le corps tel quel sans vérifier le compte.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const storageMock = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  getUserPreferences: vi.fn(),
  findFirstFreeSlot: vi.fn(),
  checkSlotAvailability: vi.fn(),
  fixOverlappingTasks: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

async function startServer() {
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

const TACHE = {
  id: 42, userId: "user-1", title: "Écrire le post", description: "ancien",
  completed: false, scheduledDate: "2026-10-06", scheduledTime: "10:00", estimatedDuration: 30,
};

describe("PATCH /api/tasks/:id", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.getTask.mockResolvedValue({ ...TACHE });
    storageMock.updateTask.mockImplementation(async (id: number, u: any) => ({ ...TACHE, ...u, id }));
    storageMock.getUserPreferences.mockResolvedValue({ workDays: "mon,tue,wed,thu,fri" });
    storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
    storageMock.fixOverlappingTasks.mockResolvedValue(undefined);
    ({ server, port } = await startServer());
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const patch = (id: string | number, body: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("la tâche d'un autre compte → 404, rien n'est écrit", async () => {
    storageMock.getTask.mockResolvedValue({ ...TACHE, userId: "quelqu-un-d-autre" });
    const res = await patch(42, { title: "Piraté" });
    expect(res.status).toBe(404);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("tâche introuvable ou identifiant fictif → 404", async () => {
    storageMock.getTask.mockResolvedValue(undefined);
    expect((await patch(42, { title: "x" })).status).toBe(404);
    expect((await patch(-1000, { title: "x" })).status).toBe(404);
    expect((await patch("abc", { title: "x" })).status).toBe(404);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("liste blanche : userId, id, projectId sont ignorés ; titre et description passent", async () => {
    const res = await patch(42, {
      title: "  Nouveau titre  ", description: "nouvelle", userId: "autre", id: 999, projectId: 7,
    });
    expect(res.status).toBe(200);
    expect(storageMock.updateTask).toHaveBeenCalledWith(42, { title: "Nouveau titre", description: "nouvelle" });
  });

  it("titre vide ou trop long → 400, rien n'est écrit", async () => {
    expect((await patch(42, { title: "   " })).status).toBe(400);
    expect((await patch(42, { title: "x".repeat(201) })).status).toBe(400);
    expect((await patch(42, { title: 12 })).status).toBe(400);
    expect((await patch(42, { description: "x".repeat(5001) })).status).toBe(400);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("corps sans aucun champ éditable → 400", async () => {
    const res = await patch(42, { userId: "autre" });
    expect(res.status).toBe(400);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("cocher : completedAt est forcé en Date", async () => {
    const res = await patch(42, { completed: true, completedAt: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    const [, u] = storageMock.updateTask.mock.calls[0];
    expect(u.completed).toBe(true);
    expect(u.completedAt).toBeInstanceOf(Date);
    expect(storageMock.fixOverlappingTasks).not.toHaveBeenCalled();
  });

  it("replanifier : comportement inchangé (heure de fin dérivée, filet anti-chevauchement)", async () => {
    const res = await patch(42, { scheduledDate: "2026-10-07", scheduledTime: "14:00" });
    expect(res.status).toBe(200);
    expect(storageMock.checkSlotAvailability).toHaveBeenCalledWith("user-1", "2026-10-07", "14:00", 30, 42);
    expect(storageMock.updateTask).toHaveBeenCalledWith(42, {
      scheduledDate: "2026-10-07", scheduledTime: "14:00", scheduledEndTime: "14:30",
    });
    expect(storageMock.fixOverlappingTasks).toHaveBeenCalledWith("user-1", expect.any(String));
  });

  it("replanifier un jour non travaillé → 400 (inchangé)", async () => {
    const res = await patch(42, { scheduledDate: "2026-10-10" }); // samedi
    expect(res.status).toBe(400);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });
});
