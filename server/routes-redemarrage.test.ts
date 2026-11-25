import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
const { registerRedemarrageRoutes } = await import("./routes-redemarrage");

const seance = { id: 1, userId: "u1", statut: "en_cours", projetCourant: 2, projets: [{ projectId: 2, etat: "en_cours" }], bilan: { depuis: "x", projets: [{ projectId: 2, nom: "Agence" }] } };
let deps: any; let server: http.Server; let port: number;
beforeEach(async () => {
  deps = {
    actif: vi.fn(() => true),
    synchroniser: vi.fn(async () => ({ seance: undefined, termineeMaintenant: false })),
    lire: vi.fn(async () => ({ seance: undefined, termineeMaintenant: false })),
    demarrer: vi.fn(async () => seance),
    abandonner: vi.fn(async () => true),
    derniereActivite: vi.fn(async () => new Date("2026-11-10T00:00:00Z")),
    maintenant: () => new Date("2026-11-25T09:00:00Z"),
  };
  const app = express(); app.use(express.json());
  registerRedemarrageRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });
const req = (m: string, p: string) => fetch(`http://127.0.0.1:${port}${p}`, { method: m });

describe("routes de la séance de redémarrage", () => {
  it("hors interrupteur : 404 partout", async () => {
    deps.actif.mockReturnValue(false);
    for (const [m, p] of [["GET", "/api/redemarrage"], ["POST", "/api/redemarrage/demarrer"], ["POST", "/api/redemarrage/abandonner"]]) {
      expect((await req(m, p)).status).toBe(404);
    }
    expect(deps.demarrer).not.toHaveBeenCalled();
  });
  it("GET sans séance : propose une séance après 7 jours d'absence", async () => {
    expect(await (await req("GET", "/api/redemarrage")).json()).toEqual({ seance: null, proposer: true });
    deps.derniereActivite.mockResolvedValue(new Date("2026-11-22T00:00:00Z"));
    expect(await (await req("GET", "/api/redemarrage")).json()).toEqual({ seance: null, proposer: false });
  });
  it("GET ne fait jamais avancer la séance (sinon le récap de fin se perd)", async () => {
    deps.lire.mockResolvedValue({ seance, termineeMaintenant: false });
    await req("GET", "/api/redemarrage");
    expect(deps.synchroniser).not.toHaveBeenCalled();
    expect(deps.lire).toHaveBeenCalledWith("u1", expect.any(Date));
  });
  it("GET avec séance en cours : la vue", async () => {
    deps.lire.mockResolvedValue({ seance, termineeMaintenant: false });
    const j: any = await (await req("GET", "/api/redemarrage")).json();
    expect(j.seance).toMatchObject({ id: 1, position: 1, total: 1, projetCourant: { projectId: 2, nom: "Agence" } });
    expect(j.proposer).toBe(false);
  });
  it("démarrer : la vue de la séance", async () => {
    const j: any = await (await req("POST", "/api/redemarrage/demarrer")).json();
    expect(j.seance.id).toBe(1);
    expect(deps.demarrer).toHaveBeenCalledWith("u1", expect.any(Date));
  });
  it("abandonner", async () => {
    expect(await (await req("POST", "/api/redemarrage/abandonner")).json()).toEqual({ ok: true });
  });
});
