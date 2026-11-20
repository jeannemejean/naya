// Chef d'orchestre, étape 4 (un seul arbitre) : un chemin qui écrit des dates repasse par le
// re-tassage commun. Exemple : le report groupé d'une journée.
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
const storage = {
  getTasksInRange: vi.fn(async () => [
    { id: 1, completed: false, dueDate: new Date("2026-11-20T22:59:00Z") }, { id: 2, completed: true },
  ]),
  updateTask: vi.fn(async () => ({})),
  fixOverlappingTasks: vi.fn(async () => 0),
  getTask: vi.fn(async (id: number) => ({ id, userId: "user-1", title: "AO : déposer", source: id === 7 ? "appel_offres" : "manual" })),
  deleteTask: vi.fn(async () => {}),
};
vi.mock("./storage", () => ({ storage }));

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

const reporter = () => fetch(`http://127.0.0.1:${port}/api/tasks/bulk-reschedule`, {
  method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fromDate: "2026-11-20", toDate: "2026-11-23" }),
});

describe("un seul arbitre", () => {
  it("le report groupé repasse par le re-tassage commun", async () => {
    const r = await reporter();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ updated: 1 });
    expect(storage.fixOverlappingTasks).toHaveBeenCalledWith("user-1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("un report explicite repousse l'échéance souple avec lui (sinon le re-tassage ramènerait la tâche)", async () => {
    await reporter();
    expect(storage.updateTask).toHaveBeenCalledWith(1, { scheduledDate: "2026-11-23", dueDate: new Date("2026-11-23T22:59:00.000Z") });
  });

  it("un re-tassage en échec ne fait pas échouer le report (les dates sont déjà écrites)", async () => {
    storage.fixOverlappingTasks.mockRejectedValueOnce(new Error("base lente"));
    expect((await reporter()).status).toBe(200);
  });
});

describe("supprimer un jalon d'appel d'offres", () => {
  const supprimer = (id: number) => fetch(`http://127.0.0.1:${port}/api/tasks/${id}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  it("l'archive au lieu de l'effacer : la synchro des jalons ne le recrée pas", async () => {
    expect((await supprimer(7)).status).toBe(200);
    expect(storage.deleteTask).not.toHaveBeenCalled();
    expect(storage.updateTask).toHaveBeenCalledWith(7, expect.objectContaining({ archivedAt: expect.any(Date) }));
  });
  it("une autre tâche est effacée comme avant", async () => {
    expect((await supprimer(8)).status).toBe(200);
    expect(storage.deleteTask).toHaveBeenCalledWith(8);
  });
});
