// Routes des fondations. `./storage`, `./auth`, la proposition et l'exécution des routines sont mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const FOND = {
  id: 1, userId: "user-1", projectId: 7,
  offre: { nom: "Essai", description: "", pourquoi: "", existe: false },
  motivations: [{ cle: "efficacite", nom: "Efficacité", description: "", angle: "", accroches: [], preuves: [], objections: [], formats: [] }],
  kpis: [
    { cle: "abonnes", nom: "Abonnés", etage: "business", definition: "", frequence: "mensuel" },
    { cle: "mer", nom: "MER", etage: "business", definition: "", frequence: "mensuel", source: "mer" },
  ],
  plan: null, kpiReleves: {}, statuts: { offre: "propose", motivations: "propose", kpis: "valide" },
};
const storageMock = {
  getProject: vi.fn(),
  getFondations: vi.fn(),
  upsertFondations: vi.fn(async (_u: string, _p: number, patch: any) => ({ ...FOND, ...patch })),
  getContenusEtiquetes: vi.fn(async () => [] as any[]),
  getScoresReception: vi.fn(async () => []),
  getMesures: vi.fn(async () => [{ mois: "2026-09", ca: 1000, depenses: { paid_social: 250 } }]),
  getContentById: vi.fn(),
  etiqueterContenuManuel: vi.fn(async (id: number, _u: string, e: any) => ({ id, ...e, etiquetage: "utilisatrice" })),
  getRoutineByCible: vi.fn(async () => undefined),
  ensureRoutine: vi.fn(async (row: any) => ({ id: 9, ...row })),
  updateRoutine: vi.fn(async (_id: number, _u: string, patch: any) => ({ id: 9, ...patch })),
  getRoutineRuns: vi.fn(async () => []),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const exec = vi.hoisted(() => ({ executerUne: vi.fn(async () => ({ statut: "ok", resume: "3 contenus étiquetés" })) }));
vi.mock("./services/routines/ordonnanceur", () => ({ executerUne: exec.executerUne, REGISTRE: { fondations_etiquetage: vi.fn() } }));
const prop = vi.hoisted(() => ({ proposerFondations: vi.fn(async () => ({ statut: "ok", fondations: { id: 1 } })) }));
vi.mock("./services/fondations/proposer", () => ({ proposerFondations: prop.proposerFondations }));
vi.mock("./services/fondations/deps", () => ({ depsProposer: {} }));

const { registerFondationsRoutes } = await import("./routes-fondations");
const app = express();
app.use(express.json());
registerFondationsRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getProject.mockImplementation(async (id: number, u: string) => (id === 7 && u === "user-1" ? { id: 7, name: "Lune" } : undefined));
  storageMock.getFondations.mockImplementation(async (_u: string, p: number) => (p === 7 ? structuredClone(FOND) : undefined));
  storageMock.getContentById.mockImplementation(async (id: number, u: string) => (id === 5 && u === "user-1" ? { id: 5, projectId: 7 } : undefined));
});

describe("routes des fondations", () => {
  it("404 sur le projet ou le contenu d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/fondations/8")).status).toBe(404);
    expect((await appel("POST", "/api/fondations/8/proposer")).status).toBe(404);
    expect((await appel("PUT", "/api/fondations/8/sections/offre", { statut: "valide" })).status).toBe(404);
    expect((await appel("POST", "/api/fondations/8/kpis/abonnes/releves", { valeur: 3 })).status).toBe(404);
    expect((await appel("POST", "/api/fondations/8/routine/run")).status).toBe(404);
    expect((await appel("PATCH", "/api/fondations/contenus/6", { angle: "aucun" })).status).toBe(404);
    expect((await appel("GET", "/api/fondations/abc")).status).toBe(404);
    expect(storageMock.upsertFondations).not.toHaveBeenCalled();
    expect(prop.proposerFondations).not.toHaveBeenCalled();
    expect(exec.executerUne).not.toHaveBeenCalled();
  });

  it("GET : fondations, statuts complets, couverture ; ne crée aucune routine", async () => {
    storageMock.getContenusEtiquetes.mockResolvedValue([{ id: 1, title: "T", status: "draft", publishedAt: null, angle: "efficacite", formatCreatif: null, etiquetage: "naya", createdAt: new Date() }]);
    const r = await appel("GET", "/api/fondations/7");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.fondations.statuts).toEqual({ offre: "propose", motivations: "propose", kpis: "valide", plan: "vide" });
    expect(j.couverture.lignes[0]).toMatchObject({ cle: "efficacite", contenus: 1 });
    expect(j.catalogues.briques.length).toBeGreaterThan(10);
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
  });

  it("GET : les KPI reliés au registre reçoivent leur série calculée", async () => {
    const j = await (await appel("GET", "/api/fondations/7")).json();
    expect(j.kpiAuto).toEqual({ mer: [{ date: "2026-09-01T00:00:00.000Z", valeur: 4 }] });
  });

  it("relevé manuel refusé sur un KPI relié au registre", async () => {
    expect((await appel("POST", "/api/fondations/7/kpis/mer/releves", { valeur: 3 })).status).toBe(409);
  });

  it("GET sans fondations : sections vides", async () => {
    storageMock.getFondations.mockResolvedValue(undefined);
    const j = await (await appel("GET", "/api/fondations/7")).json();
    expect(j.fondations).toMatchObject({ offre: null, motivations: [], kpis: [], plan: null, statuts: { offre: "vide" } });
  });

  it("proposer : sections inconnues refusées, statuts traduits", async () => {
    expect((await appel("POST", "/api/fondations/7/proposer", { sections: ["offre", "bidon"] })).status).toBe(400);
    prop.proposerFondations.mockResolvedValueOnce({ statut: "refus", raison: "Budget" } as any);
    expect((await appel("POST", "/api/fondations/7/proposer")).status).toBe(409);
    prop.proposerFondations.mockResolvedValueOnce({ statut: "vide" } as any);
    expect((await appel("POST", "/api/fondations/7/proposer")).status).toBe(422);
    expect((await appel("POST", "/api/fondations/7/proposer", { sections: ["offre"] })).status).toBe(200);
    expect((prop.proposerFondations.mock.calls.at(-1) as any)[2]).toEqual(["offre"]);
  });

  it("modifier une section : validée par validerSection, statut conservé", async () => {
    expect((await appel("PUT", "/api/fondations/7/sections/inconnue", { statut: "valide" })).status).toBe(404);
    expect((await appel("PUT", "/api/fondations/7/sections/offre", { valeur: { description: "sans nom" } })).status).toBe(400);
    expect((await appel("PUT", "/api/fondations/7/sections/offre", { statut: "bof" })).status).toBe(400);
    const r = await appel("PUT", "/api/fondations/7/sections/offre", { valeur: { nom: "Coffret" } });
    expect(r.status).toBe(200);
    const patch = storageMock.upsertFondations.mock.calls[0][2] as any;
    expect(patch.offre.nom).toBe("Coffret");
    // Seul le statut de la section touchée est envoyé (écriture clé par clé côté stockage).
    expect(patch.statuts).toEqual({ offre: "propose" });
  });

  it("valider une section vide → 400", async () => {
    expect((await appel("PUT", "/api/fondations/7/sections/plan", { statut: "valide" })).status).toBe(400);
  });

  it("valider les motivations crée la routine d'étiquetage (active)", async () => {
    const r = await appel("PUT", "/api/fondations/7/sections/motivations", { statut: "valide" });
    expect(r.status).toBe(200);
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ kind: "fondations_etiquetage", cibleCle: "project:7", actif: true }));
  });

  it("valider une autre section ne crée pas de routine", async () => {
    await appel("PUT", "/api/fondations/7/sections/offre", { statut: "valide" });
    expect(storageMock.ensureRoutine).not.toHaveBeenCalled();
  });

  it("relevé de KPI : KPI inconnu 404, valeur non numérique 400, plafond de 24", async () => {
    expect((await appel("POST", "/api/fondations/7/kpis/inconnu/releves", { valeur: 3 })).status).toBe(404);
    expect((await appel("POST", "/api/fondations/7/kpis/abonnes/releves", { valeur: "beaucoup" })).status).toBe(400);
    expect((await appel("POST", "/api/fondations/7/kpis/abonnes/releves", { valeur: 3, date: "pas une date" })).status).toBe(400);
    expect((await appel("POST", "/api/fondations/7/kpis/abonnes/releves", { valeur: 3, date: null })).status).toBe(400);
    expect((await appel("POST", "/api/fondations/7/kpis/abonnes/releves", { valeur: 3, date: "2099-01-01" })).status).toBe(400);
    const plein = Array.from({ length: 24 }, (_, i) => ({ date: new Date(2026, 0, i + 1).toISOString(), valeur: i }));
    storageMock.getFondations.mockResolvedValue({ ...structuredClone(FOND), kpiReleves: { abonnes: plein } });
    expect((await appel("POST", "/api/fondations/7/kpis/abonnes/releves", { valeur: 99, date: "2026-10-01" })).status).toBe(200);
    const releves = (storageMock.upsertFondations.mock.calls[0][2] as any).kpiReleves.abonnes;
    expect(releves).toHaveLength(24);
    expect(releves.at(-1).valeur).toBe(99);
    expect(releves[0].valeur).toBe(1);
  });

  it("étiquette manuelle : angle connu ou « aucun », format du catalogue", async () => {
    expect((await appel("PATCH", "/api/fondations/contenus/5", { angle: "inventee" })).status).toBe(400);
    expect((await appel("PATCH", "/api/fondations/contenus/5", { angle: "efficacite", formatCreatif: "danse" })).status).toBe(400);
    const r = await appel("PATCH", "/api/fondations/contenus/5", { angle: "efficacite", formatCreatif: "demonstration" });
    expect(r.status).toBe(200);
    expect(storageMock.etiqueterContenuManuel).toHaveBeenCalledWith(5, "user-1", { angle: "efficacite", formatCreatif: "demonstration" });
    expect((await appel("PATCH", "/api/fondations/contenus/5", { angle: "aucun" })).status).toBe(200);
  });

  it("angle retiré des motivations : changer seulement le format reste possible ; choisir un autre angle inconnu, non", async () => {
    storageMock.getContentById.mockImplementation(async (id: number, u: string) => (id === 5 && u === "user-1" ? { id: 5, projectId: 7, angle: "ancienne" } : undefined));
    expect((await appel("PATCH", "/api/fondations/contenus/5", { angle: "ancienne", formatCreatif: "demonstration" })).status).toBe(200);
    expect((await appel("PATCH", "/api/fondations/contenus/5", { angle: "autre_inconnue" })).status).toBe(400);
  });

  it("lancer l'étiquetage : routine créée en pause si absente, 409 si déjà en cours", async () => {
    await appel("POST", "/api/fondations/7/routine/run");
    expect(storageMock.ensureRoutine).toHaveBeenCalledWith(expect.objectContaining({ actif: false }));
    exec.executerUne.mockResolvedValueOnce({ dejaEnCours: true } as any);
    expect((await appel("POST", "/api/fondations/7/routine/run")).status).toBe(409);
  });

  it("basculer la routine : actif requis", async () => {
    expect((await appel("PATCH", "/api/fondations/7/routine", {})).status).toBe(400);
    expect((await appel("PATCH", "/api/fondations/7/routine", { actif: false })).status).toBe(200);
    expect(storageMock.updateRoutine).toHaveBeenCalledWith(9, "user-1", { actif: false });
  });
});
