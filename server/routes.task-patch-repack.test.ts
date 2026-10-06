// Déplacer un prérequis (mardi → jeudi) doit relancer le filet depuis MARDI (min des deux
// dates), sinon son dépendant du mercredi n'est jamais chargé et reste devant lui.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { aujourdhuiParis, dateDeRetassage } from "./services/repack-from";

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
  getTask: vi.fn(),
  getUserPreferences: vi.fn(),
  updateTask: vi.fn(),
  fixOverlappingTasks: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

/** Jour ouvré (lun-ven) à +n jours de « aujourd'hui Paris », au format YYYY-MM-DD. */
function jourOuvre(offset: number): string {
  const d = new Date(aujourdhuiParis() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("PATCH /api/tasks/:id relance le filet depuis min(ancienne, nouvelle) date", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.getUserPreferences.mockResolvedValue(null);
    storageMock.fixOverlappingTasks.mockResolvedValue(0);
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as any).port;
  });
  afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

  async function patch(ancienne: string | null, nouvelle: string) {
    storageMock.getTask.mockResolvedValue({
      id: 1, userId: "user-1", scheduledDate: ancienne, scheduledTime: "09:00", estimatedDuration: 30,
    });
    storageMock.updateTask.mockResolvedValue({ id: 1, scheduledDate: nouvelle });
    return fetch(`http://127.0.0.1:${port}/api/tasks/1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledDate: nouvelle, scheduledTime: "09:00" }),
    });
  }

  it("mardi → jeudi : repart de MARDI", async () => {
    const mardi = jourOuvre(1);
    const jeudi = jourOuvre(3);
    // checkSlotAvailability / findFirstFreeSlot ne sont pas appelés (heure + durée fournies sans conflit)
    (storageMock as any).checkSlotAvailability = vi.fn().mockResolvedValue({ available: true });
    const res = await patch(mardi, jeudi);
    expect(res.status).toBe(200);
    expect(storageMock.fixOverlappingTasks).toHaveBeenCalledWith("user-1", mardi);
  });

  it("jeudi → mardi : repart aussi de MARDI", async () => {
    const mardi = jourOuvre(1);
    const jeudi = jourOuvre(3);
    (storageMock as any).checkSlotAvailability = vi.fn().mockResolvedValue({ available: true });
    await patch(jeudi, mardi);
    expect(storageMock.fixOverlappingTasks).toHaveBeenCalledWith("user-1", mardi);
  });
});

describe("dateDeRetassage", () => {
  it("min des deux, plancher aujourd'hui", () => {
    expect(dateDeRetassage("2030-01-08", "2030-01-10", "2030-01-01")).toBe("2030-01-08");
    expect(dateDeRetassage("2020-01-08", "2030-01-10", "2030-01-01")).toBe("2030-01-01");
  });
  it("dates nulles", () => {
    expect(dateDeRetassage(null, "2030-01-10", "2030-01-01")).toBe("2030-01-10");
    expect(dateDeRetassage("2030-01-10", null, "2030-01-01")).toBe("2030-01-10");
    expect(dateDeRetassage(null, null, "2030-01-01")).toBeNull();
  });
});
