// Routes du fil conducteur. Auth, stockage, dépôt, propositions et services du fil sont mockés :
// aucun test ne touche une vraie base ni le réseau.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  filActifPour: vi.fn(), isAiBlocked: vi.fn(),
  propositionsEnAttente: vi.fn(), getProposition: vi.fn(),
  annulerProposition: vi.fn(), proposerHorsConversation: vi.fn(),
  proposerEtapesPour: vi.fn(), proposerRattachements: vi.fn(),
  getProjectGoal: vi.fn(), getProject: vi.fn(),
}));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
vi.mock("./services/usage", () => ({ isAiBlocked: h.isAiBlocked }));
vi.mock("./services/agent/depot", () => ({ depot: { propositionsEnAttente: h.propositionsEnAttente, getProposition: h.getProposition } }));
vi.mock("./services/agent/propositions", () => ({ annulerProposition: h.annulerProposition, proposerHorsConversation: h.proposerHorsConversation }));
vi.mock("./services/fil/interrupteur", () => ({ filActifPour: h.filActifPour }));
vi.mock("./services/fil/etapes", () => ({
  OUTILS_FIL_PROPOSITIONS: ["proposer_etapes", "rattacher_chaine"],
  proposerEtapesPour: h.proposerEtapesPour, proposerRattachements: h.proposerRattachements,
  objectifDe: async (userId: string, id: number) => {
    const objectif = await h.getProjectGoal(id);
    return objectif && (await h.getProject(objectif.projectId, userId)) ? { objectif, etapes: [] } : undefined;
  },
}));

const { registerFilRoutes } = await import("./routes-fil");
const app = express();
app.use(express.json());
registerFilRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (methode: string, chemin: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: methode, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.filActifPour.mockReturnValue(true);
  h.isAiBlocked.mockResolvedValue(false);
  h.getProjectGoal.mockImplementation(async (id: number) => (id === 1 ? { id: 1, projectId: 10, title: "3 clients" } : null));
  h.getProject.mockImplementation(async (id: number, userId: string) => (id === 10 && userId === "u1" ? { id: 10 } : undefined));
});

describe("routes du fil", () => {
  it("hors interrupteur : 404 partout", async () => {
    h.filActifPour.mockReturnValue(false);
    expect((await appel("GET", "/api/fil/propositions")).status).toBe(404);
    expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", {})).status).toBe(404);
    expect((await appel("POST", "/api/fil/rattachements")).status).toBe(404);
    expect(h.proposerEtapesPour).not.toHaveBeenCalled();
  });

  it("GET : propositions en attente des deux outils, avec l'objectif", async () => {
    h.propositionsEnAttente.mockResolvedValue([{ id: 5, outil: "proposer_etapes", arguments: { objectifId: 1 }, changements: [], expireA: new Date() }]);
    const r = await appel("GET", "/api/fil/propositions");
    expect(h.propositionsEnAttente).toHaveBeenCalledWith("u1", ["proposer_etapes", "rattacher_chaine"], expect.any(Date));
    expect((await r.json())[0]).toMatchObject({ id: 5, objectif: { id: 1, titre: "3 clients" } });
  });

  it("proposer-etapes : objectif d'une autre → 404 ; note transmise", async () => {
    expect((await appel("POST", "/api/fil/objectifs/2/proposer-etapes", {})).status).toBe(404);
    h.proposerEtapesPour.mockResolvedValue({ id: 7, resume: "x", changements: [], expireA: "" });
    const r = await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { note: "plus court" });
    expect(r.status).toBe(200);
    expect(h.proposerEtapesPour).toHaveBeenCalledWith("u1", 1, expect.any(Date), "plus court");
  });

  it("ajuster : crée la nouvelle (sans IA) puis annule l'ancienne", async () => {
    h.getProposition.mockResolvedValue({ id: 5, outil: "proposer_etapes", statut: "en_attente", arguments: { objectifId: 1 } });
    h.proposerHorsConversation.mockResolvedValue({ id: 6, resume: "x", changements: [], expireA: "" });
    h.annulerProposition.mockResolvedValue({ ok: true });
    const etapes = [{ titre: "A", pourquoi: "", etat: "a_venir" }];
    const r = await appel("POST", "/api/fil/propositions/5/ajuster", { etapes });
    expect(r.status).toBe(200);
    expect(h.proposerHorsConversation).toHaveBeenCalledWith("u1", "proposer_etapes", { objectifId: 1, etapes }, expect.any(Date));
    expect(h.annulerProposition).toHaveBeenCalledWith("u1", 5);
    expect(h.proposerEtapesPour).not.toHaveBeenCalled();
  });

  it("ajuster refusé (nombre d'étapes) : l'ancienne reste en attente", async () => {
    h.getProposition.mockResolvedValue({ id: 5, outil: "proposer_etapes", statut: "en_attente", arguments: { objectifId: 1 } });
    h.proposerHorsConversation.mockResolvedValue({ erreur: "nombre_etapes" });
    const r = await appel("POST", "/api/fil/propositions/5/ajuster", { etapes: [] });
    expect(r.status).toBe(400);
    expect(h.annulerProposition).not.toHaveBeenCalled();
  });
});
