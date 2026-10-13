// Routes de la mesure. `./storage`, `./auth` et l'exécution des routines sont mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const SEPT = { mois: "2026-09", ca: 10000, nouveauxClients: 20, commandes: null, caNouveaux: null, coutsVariables: null, depenses: { paid_social: 1000 } };
const storageMock = {
  getProject: vi.fn(),
  getMesures: vi.fn(async () => [SEPT] as any[]),
  upsertMesure: vi.fn(async (_u: string, _p: number, mois: string, data: any) => ({ mois, ...data })),
  deleteMesure: vi.fn(async () => true),
  getBrandConversionsWithCredits: vi.fn(async () => [{ convertedAt: new Date("2026-09-10"), conversionType: "vente", value: 90 }]),
  getRoutineByCible: vi.fn(async () => undefined),
  ensureRoutine: vi.fn(async (row: any) => ({ id: 9, ...row })),
  updateRoutine: vi.fn(async (_id: number, _u: string, patch: any) => ({ id: 9, ...patch })),
  getRoutineRuns: vi.fn(async () => []),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const exec = vi.hoisted(() => ({ executerUne: vi.fn(async () => ({ statut: "ok", resume: "Bilan prêt" })) }));
vi.mock("./services/routines/ordonnanceur", () => ({ executerUne: exec.executerUne, REGISTRE: { mesure_bilan: vi.fn() } }));

const { registerMesureRoutes } = await import("./routes-mesure");
const app = express();
app.use(express.json());
registerMesureRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getProject.mockImplementation(async (id: number, u: string) => (id === 7 && u === "user-1" ? { id: 7 } : undefined));
});

describe("routes de la mesure", () => {
  it("404 sur le projet d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/mesure/8")).status).toBe(404);
    expect((await appel("GET", "/api/mesure/8/suggestion?mois=2026-09")).status).toBe(404);
    expect((await appel("PUT", "/api/mesure/8/mois/2026-09", { ca: 1 })).status).toBe(404);
    expect((await appel("DELETE", "/api/mesure/8/mois/2026-09")).status).toBe(404);
    expect((await appel("POST", "/api/mesure/8/import", { texte: "mois;ca\n2026-09;1" })).status).toBe(404);
    expect((await appel("POST", "/api/mesure/8/routine/run")).status).toBe(404);
    expect(storageMock.upsertMesure).not.toHaveBeenCalled();
    expect(exec.executerUne).not.toHaveBeenCalled();
  });

  it("GET : indicateurs calculés, sans créer de routine", async () => {
    const j = await (await appel("GET", "/api/mesure/7")).json();
    expect(j.mois[0].indicateurs).toMatchObject({ mer: 10, cac: 50 });
    expect(j.mois[0].evolutions.mer).toEqual({ precedent: null, moyenne3: null });
    expect(j.catalogues.canaux.length).toBe(10);
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
  });

  it("suggestion depuis les ventes déclarées", async () => {
    expect((await appel("GET", "/api/mesure/7/suggestion?mois=bof")).status).toBe(400);
    const j = await (await appel("GET", "/api/mesure/7/suggestion?mois=2026-09")).json();
    expect(j.suggestion).toEqual({ ventes: 1, ca: 90, valeursManquantes: 0 });
  });

  it("enregistrer un mois : validé, routine de bilan créée", async () => {
    expect((await appel("PUT", "/api/mesure/7/mois/2099-01", { ca: 1 })).status).toBe(400);
    expect((await appel("PUT", "/api/mesure/7/mois/2026-09", { ca: -5 })).status).toBe(400);
    expect((await appel("PUT", "/api/mesure/7/mois/2026-09", {})).status).toBe(400);
    const r = await appel("PUT", "/api/mesure/7/mois/2026-09", { ca: "1 200,50", depenses: { paid_social: 100 } });
    expect(r.status).toBe(200);
    expect(storageMock.upsertMesure).toHaveBeenCalledWith("user-1", 7, "2026-09", expect.objectContaining({ ca: 1200.5, source: "manuel" }));
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ kind: "mesure_bilan", cadence: "mensuelle", actif: true }));
  });

  it("supprimer : 404 si le mois n'existe pas", async () => {
    storageMock.deleteMesure.mockResolvedValueOnce(false);
    expect((await appel("DELETE", "/api/mesure/7/mois/2026-09")).status).toBe(404);
    expect((await appel("DELETE", "/api/mesure/7/mois/2026-08")).status).toBe(200);
  });

  it("import : aperçu sans écrire, puis confirmation", async () => {
    const texte = "mois;ca\n2026-09;100\n2026-13;5";
    const apercu = await (await appel("POST", "/api/mesure/7/import", { texte })).json();
    expect(apercu.lignes).toHaveLength(1);
    expect(apercu.erreurs).toHaveLength(1);
    expect(storageMock.upsertMesure).not.toHaveBeenCalled();
    const ok = await (await appel("POST", "/api/mesure/7/import", { texte, confirmer: true })).json();
    expect(ok.ecrits).toBe(1);
    expect(storageMock.upsertMesure).toHaveBeenCalledWith("user-1", 7, "2026-09", expect.objectContaining({ ca: 100, source: "import" }));
    expect(storageMock.ensureRoutine).toHaveBeenCalled();
    expect((await appel("POST", "/api/mesure/7/import", { texte: "mois;ca\n2026-13;5", confirmer: true })).status).toBe(400);
    expect((await appel("POST", "/api/mesure/7/import", { texte: 3 })).status).toBe(400);
  });

  it("I1 : lancer sans aucun mois saisi ne crée pas de routine (elle restera activable)", async () => {
    storageMock.getMesures.mockResolvedValueOnce([]);
    const r = await (await appel("POST", "/api/mesure/7/routine/run")).json();
    expect(r.statut).toBe("rien_a_faire");
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
    expect(exec.executerUne).not.toHaveBeenCalled();
  });

  it("I2 : enregistrer un mois clos avance le prochain bilan d'une routine active", async () => {
    storageMock.getRoutineByCible.mockResolvedValueOnce({ id: 9, actif: true, prochainPassage: new Date("2099-01-01") } as any);
    await appel("PUT", "/api/mesure/7/mois/2026-09", { ca: 10 });
    const maj = storageMock.updateRoutine.mock.calls.at(-1) as any;
    expect(maj[0]).toBe(9);
    expect(new Date(maj[2].prochainPassage).getTime()).toBeLessThan(Date.now() + 60 * 60_000);
  });

  it("I4 : l'import confirmé fusionne avec le mois existant", async () => {
    storageMock.getMesures.mockResolvedValue([{ ...SEPT }]);
    await appel("POST", "/api/mesure/7/import", { texte: "mois;google ads\n2026-09;40", confirmer: true });
    expect(storageMock.upsertMesure).toHaveBeenCalledWith("user-1", 7, "2026-09", expect.objectContaining({ ca: 10000, nouveauxClients: 20, depenses: { paid_social: 1000, google_ads: 40 } }));
    storageMock.getMesures.mockResolvedValue([SEPT]);
  });

  it("routine : lancer (créée en pause si absente), basculer", async () => {
    await appel("POST", "/api/mesure/7/routine/run");
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ actif: false }));
    exec.executerUne.mockResolvedValueOnce({ dejaEnCours: true } as any);
    expect((await appel("POST", "/api/mesure/7/routine/run")).status).toBe(409);
    expect((await appel("PATCH", "/api/mesure/7/routine", {})).status).toBe(400);
    expect((await appel("PATCH", "/api/mesure/7/routine", { actif: true })).status).toBe(200);
  });
});
