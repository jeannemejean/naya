// Routes de la veille élargie. `./storage`, `./auth` et l'exécution des routines sont mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const ITEM = { id: 3, userId: "user-1", projectId: 7, type: "concurrent", libelle: "Soleil", valeur: null, statut: "propose", source: "naya" };
const storageMock = {
  getProject: vi.fn(),
  getVeilleItems: vi.fn(async () => [] as any[]),
  getVeilleItem: vi.fn(),
  createVeilleItems: vi.fn(async (rows: any[]) => rows.map((r, i) => ({ id: 20 + i, ...r }))),
  updateVeilleItem: vi.fn(async (id: number, _u: string, patch: any) => ({ ...ITEM, id, ...patch })),
  deleteVeilleItem: vi.fn(async () => true),
  getVeilleConstats: vi.fn(async () => []),
  updateVeilleConstat: vi.fn(async (id: number, _u: string, patch: any) => (id === 4 ? { id, ...patch } : null)),
  getDerniersReleves: vi.fn(async () => []),
  getRoutineByCible: vi.fn(async () => undefined),
  ensureRoutine: vi.fn(async (row: any) => ({ id: 9, ...row })),
  updateRoutine: vi.fn(async (_id: number, _u: string, patch: any) => ({ id: 9, ...patch })),
  getRoutineRuns: vi.fn(async () => []),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const exec = vi.hoisted(() => ({ executerUne: vi.fn(async () => ({ statut: "ok", resume: "2 nouveautés" })) }));
vi.mock("./services/routines/ordonnanceur", () => ({ executerUne: exec.executerUne, REGISTRE: { veille_geo: vi.fn(), veille_serp: vi.fn(), veille_concurrents: vi.fn(), veille_voix_client: vi.fn() } }));
const prop = vi.hoisted(() => ({ proposerListe: vi.fn(async () => ({ statut: "ok", crees: [{ id: 1 }] })) }));
vi.mock("./services/veille/proposer", () => ({ proposerListe: prop.proposerListe }));

const { registerVeilleRoutes } = await import("./routes-veille");
const app = express();
app.use(express.json());
registerVeilleRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getProject.mockImplementation(async (id: number, u: string) => (id === 7 && u === "user-1" ? { id: 7, userId: "user-1", name: "Lune" } : undefined));
  storageMock.getVeilleItem.mockImplementation(async (id: number) => (id === 3 ? ITEM : undefined));
  storageMock.getVeilleItems.mockResolvedValue([]);
});

describe("routes de la veille", () => {
  it("404 sur le projet, l'élément ou le constat d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/veille/8")).status).toBe(404);
    expect((await appel("POST", "/api/veille/8/items", { type: "mot_cle", libelle: "x" })).status).toBe(404);
    expect((await appel("PATCH", "/api/veille/items/99", { statut: "suivi" })).status).toBe(404);
    expect((await appel("PATCH", "/api/veille/constats/99", { statut: "vu" })).status).toBe(404);
    expect((await appel("POST", "/api/veille/8/routines/veille_geo/run")).status).toBe(404);
    expect(storageMock.createVeilleItems).not.toHaveBeenCalled();
    expect(exec.executerUne).not.toHaveBeenCalled();
  });

  it("l'ouverture de la page ne crée aucune routine", async () => {
    const r = await appel("GET", "/api/veille/7");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body.routines)).toEqual(["veille_concurrents", "veille_voix_client", "veille_serp", "veille_geo"]);
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
  });

  it("ajouter un élément à la main le suit, et crée la routine de son type", async () => {
    const r = await appel("POST", "/api/veille/7/items", { type: "prompt_geo", libelle: "Quelle bougie offrir ?" });
    expect(r.status).toBe(201);
    expect(storageMock.createVeilleItems).toHaveBeenCalledWith([expect.objectContaining({ userId: "user-1", projectId: 7, statut: "suivi", source: "manuel" })]);
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ kind: "veille_geo", cibleCle: "project:7" }));
  });

  it("la marque n'a pas de routine propre", async () => {
    await appel("POST", "/api/veille/7/items", { type: "marque", libelle: "Lune" });
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
  });

  it("refuse un doublon et le dépassement du plafond", async () => {
    storageMock.getVeilleItems.mockResolvedValue([{ ...ITEM, statut: "suivi" }]);
    expect((await appel("POST", "/api/veille/7/items", { type: "concurrent", libelle: "soleil" })).status).toBe(409);
    storageMock.getVeilleItems.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ ...ITEM, id: i + 10, libelle: `C${i}`, statut: "suivi" })));
    const r = await appel("POST", "/api/veille/7/items", { type: "concurrent", libelle: "Nouveau" });
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe("plafond");
  });

  it("400 sur un corps invalide", async () => {
    expect((await appel("POST", "/api/veille/7/items", { type: "espion", libelle: "x" })).status).toBe(400);
    expect((await appel("PATCH", "/api/veille/constats/4", { statut: "publie" })).status).toBe(400);
  });

  it("suivre un élément proposé crée la routine de son type", async () => {
    const r = await appel("PATCH", "/api/veille/items/3", { statut: "suivi" });
    expect(r.status).toBe(200);
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ kind: "veille_concurrents" }));
  });

  it("lancer maintenant : 409 si un passage est déjà en cours", async () => {
    exec.executerUne.mockResolvedValueOnce({ statut: "rien_a_faire", resume: "x", dejaEnCours: true } as any);
    expect((await appel("POST", "/api/veille/7/routines/veille_geo/run")).status).toBe(409);
    expect((await appel("POST", "/api/veille/7/routines/inconnu/run")).status).toBe(404);
  });

  it("proposition refusée (budget) : 409 avec la raison", async () => {
    prop.proposerListe.mockResolvedValueOnce({ statut: "refus", raison: "Budget du mois atteint" } as any);
    const r = await appel("POST", "/api/veille/7/proposer");
    expect(r.status).toBe(409);
    expect((await r.json()).raison).toBe("Budget du mois atteint");
  });
});
