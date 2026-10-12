// Routes de la routine de sourcing d'une campagne. `./storage` et `./auth` mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const ROUTINE = { id: 9, userId: "user-1", kind: "sourcing_prospects", cible: { campaignId: 5 }, actif: true, prochainPassage: null };
const storageMock = {
  getProspectionCampaign: vi.fn(async (id: number) => (id === 5 ? { id: 5, userId: "user-1", projectId: 7 } : id === 6 ? { id: 6, userId: "autre" } : null)),
  ensureRoutine: vi.fn(async () => ROUTINE),
  getRoutineRuns: vi.fn(async () => [{ id: 1, statut: "ok", resume: "6 prospects ajoutés." }]),
  updateRoutine: vi.fn(async (_id: number, _u: string, patch: any) => ({ ...ROUTINE, ...patch })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const exec = vi.hoisted(() => ({ executerUne: vi.fn(async () => ({ statut: "ok", resume: "3 prospects ajoutés." })) }));
vi.mock("./services/routines/ordonnanceur", async (io) => ({ ...(await io<any>()), executerUne: exec.executerUne }));

const { registerRoutinesRoutes } = await import("./routes-routines");
const app = express();
app.use(express.json());
registerRoutinesRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => vi.clearAllMocks());

describe("routine de sourcing d'une campagne", () => {
  it("404 sur la campagne d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/prospection/campaigns/6/routine")).status).toBe(404);
    expect((await appel("POST", "/api/prospection/campaigns/6/routine/run")).status).toBe(404);
    expect(exec.executerUne).not.toHaveBeenCalled();
  });
  it("renvoie la routine et ses derniers passages", async () => {
    const r = await appel("GET", "/api/prospection/campaigns/5/routine");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.routine.id).toBe(9);
    expect(j.derniersPassages).toHaveLength(1);
  });
  it("met en pause et réactive", async () => {
    const r = await appel("PATCH", "/api/prospection/campaigns/5/routine", { actif: false });
    expect(r.status).toBe(200);
    expect(storageMock.updateRoutine).toHaveBeenCalledWith(9, "user-1", { actif: false });
    expect((await appel("PATCH", "/api/prospection/campaigns/5/routine", { actif: "oui" })).status).toBe(400);
  });
  it("un passage déjà en cours (ordonnanceur ou autre instance) : 409", async () => {
    exec.executerUne.mockResolvedValueOnce({ statut: "rien_a_faire", resume: "Un passage est déjà en cours.", dejaEnCours: true } as any);
    expect((await appel("POST", "/api/prospection/campaigns/5/routine/run")).status).toBe(409);
  });

  it("lancer maintenant exécute la routine et renvoie le résumé", async () => {
    const r = await appel("POST", "/api/prospection/campaigns/5/routine/run");
    expect(r.status).toBe(200);
    expect((await r.json()).resume).toBe("3 prospects ajoutés.");
    expect(exec.executerUne).toHaveBeenCalledTimes(1);
  });
});
