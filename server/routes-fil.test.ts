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
  etapesObjectif: vi.fn(() => [] as any[]), tacheDeReprise: vi.fn(), creerTache: vi.fn(), fixOverlappingTasks: vi.fn(),
  construireMatin: vi.fn(), oublierClotureDe: vi.fn(), modifierTache: vi.fn(), archiverTache: vi.fn(), fusionnerActionData: vi.fn(), getTask: vi.fn(),
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
    return objectif && (await h.getProject(objectif.projectId, userId)) ? { objectif, etapes: h.etapesObjectif() } : undefined;
  },
}));
vi.mock("./services/fil/oublis", () => ({ tacheDeReprise: h.tacheDeReprise, REPRISE_MIN: 15, REPRISE_MAX: 30 }));
vi.mock("./services/fil/matin", () => ({ construireMatin: h.construireMatin }));
vi.mock("./services/taches/ecrire-tache", () => ({ creerTache: h.creerTache, modifierTache: h.modifierTache, archiverTache: h.archiverTache, fusionnerActionData: h.fusionnerActionData }));
vi.mock("./storage", () => ({ storage: { fixOverlappingTasks: h.fixOverlappingTasks, getTask: h.getTask } }));
// La clôture est pure (aucune base) ; ses vraies sources ne sont jamais chargées ici.
vi.mock("./services/fil/cloture-deps", () => ({ depsCloture: {}, depsReconciliation: {} }));
vi.mock("./services/fil/cloture", async (orig) => ({ ...(await orig<any>()), oublierClotureDe: h.oublierClotureDe }));

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
  h.getProjectGoal.mockImplementation(async (id: number) => (id === 1 ? { id: 1, projectId: 10, title: "3 clients", status: "active" } : null));
  h.etapesObjectif.mockReturnValue([]);
  h.fixOverlappingTasks.mockResolvedValue(undefined);
  h.getProject.mockImplementation(async (id: number, userId: string) => (id === 10 && userId === "u1" ? { id: 10 } : undefined));
});

describe("routes du fil", () => {
  it("hors interrupteur : 404 partout", async () => {
    h.filActifPour.mockReturnValue(false);
    expect((await appel("GET", "/api/fil/propositions")).status).toBe(404);
    expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", {})).status).toBe(404);
    expect((await appel("POST", "/api/fil/rattachements")).status).toBe(404);
    expect((await appel("POST", "/api/fil/objectifs/1/reprendre", {})).status).toBe(404);
    expect((await appel("GET", "/api/fil/matin")).status).toBe(404);
    expect((await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "abandonner" })).status).toBe(404);
    expect(h.construireMatin).not.toHaveBeenCalled();
    expect(h.archiverTache).not.toHaveBeenCalled();
    expect(h.proposerEtapesPour).not.toHaveBeenCalled();
    expect(h.creerTache).not.toHaveBeenCalled();
  });

  it("GET /api/fil/matin : le matin de l'utilisatrice de la session, jour de Paris, sans toucher au brief", async () => {
    const fil = { tachesCles: [], objectifsOublies: [], allegement: null, nonRattachees: 0, rienNeCloche: false };
    h.construireMatin.mockResolvedValue(fil);
    const r = await appel("GET", "/api/fil/matin");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(fil);
    expect(h.construireMatin).toHaveBeenCalledTimes(1);
    const [userId, jour, maintenant] = h.construireMatin.mock.calls[0];
    expect(userId).toBe("u1");
    expect(jour).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(maintenant).toBeInstanceOf(Date);
    h.construireMatin.mockRejectedValue(new Error("boum"));
    expect((await appel("GET", "/api/fil/matin")).status).toBe(500);
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

  describe("Refaire (remplace)", () => {
    const ancienne = { id: 5, outil: "proposer_etapes", statut: "en_attente", arguments: { objectifId: 1 } };

    it("succès : la nouvelle d'abord, puis l'ancienne annulée", async () => {
      h.getProposition.mockResolvedValue(ancienne);
      h.proposerEtapesPour.mockResolvedValue({ id: 8, resume: "x", changements: [], expireA: "" });
      h.annulerProposition.mockResolvedValue({ ok: true });
      const r = await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { note: "plus court", remplace: 5 });
      expect(r.status).toBe(200);
      expect((await r.json()).id).toBe(8);
      expect(h.getProposition).toHaveBeenCalledWith(5, "u1");
      expect(h.proposerEtapesPour).toHaveBeenCalledWith("u1", 1, expect.any(Date), "plus court", { ignorer: 5 });
      expect(h.annulerProposition).toHaveBeenCalledTimes(1);
      expect(h.annulerProposition).toHaveBeenCalledWith("u1", 5);
      expect(h.proposerEtapesPour.mock.invocationCallOrder[0]).toBeLessThan(h.annulerProposition.mock.invocationCallOrder[0]);
    });

    it("génération ratée ou plafond IA : l'ancienne reste en attente", async () => {
      h.getProposition.mockResolvedValue(ancienne);
      h.proposerEtapesPour.mockResolvedValue({ erreur: "generation_impossible" });
      const r = await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 });
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ message: "generation_impossible" });
      h.isAiBlocked.mockResolvedValue(true);
      expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 })).status).toBe(429);
      expect(h.annulerProposition).not.toHaveBeenCalled();
    });

    it("proposition d'une autre utilisatrice, d'un autre objectif ou d'un autre outil : refusée, rien généré", async () => {
      h.getProposition.mockResolvedValueOnce(undefined); // getProposition est borné à l'utilisatrice
      expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 99 })).status).toBe(404);
      h.getProposition.mockResolvedValueOnce({ ...ancienne, arguments: { objectifId: 2 } });
      expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 })).status).toBe(404);
      h.getProposition.mockResolvedValueOnce({ ...ancienne, outil: "rattacher_chaine" });
      expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 })).status).toBe(404);
      h.getProposition.mockResolvedValueOnce({ ...ancienne, statut: "annulee" });
      expect((await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 })).status).toBe(409);
      expect(h.proposerEtapesPour).not.toHaveBeenCalled();
      expect(h.annulerProposition).not.toHaveBeenCalled();
    });

    it("ancienne traitée entre-temps : la nouvelle est retirée", async () => {
      h.getProposition.mockResolvedValue(ancienne);
      h.proposerEtapesPour.mockResolvedValue({ id: 8, resume: "x", changements: [], expireA: "" });
      h.annulerProposition.mockResolvedValueOnce({ ok: false, raison: "deja_traitee" }).mockResolvedValueOnce({ ok: true });
      const r = await appel("POST", "/api/fil/objectifs/1/proposer-etapes", { remplace: 5 });
      expect(r.status).toBe(409);
      expect(h.annulerProposition).toHaveBeenLastCalledWith("u1", 8);
    });
  });

  it("ajuster refusé (nombre d'étapes) : l'ancienne reste en attente", async () => {
    h.getProposition.mockResolvedValue({ id: 5, outil: "proposer_etapes", statut: "en_attente", arguments: { objectifId: 1 } });
    h.proposerHorsConversation.mockResolvedValue({ erreur: "nombre_etapes" });
    const r = await appel("POST", "/api/fil/propositions/5/ajuster", { etapes: [] });
    expect(r.status).toBe(400);
    expect(h.annulerProposition).not.toHaveBeenCalled();
  });

  describe("reprendre un objectif oublié", () => {
    const reprise = { titre: "Relancer Margaux sur le devis", pourquoi: "Sans réponse au devis, l'étape « 1er client » reste bloquée.", duree: 20 };
    beforeEach(() => {
      h.tacheDeReprise.mockResolvedValue(reprise);
      h.creerTache.mockImplementation(async (_u: string, d: any) => ({ ok: true, tache: { id: 42, ...d } }));
      h.etapesObjectif.mockReturnValue([
        { id: 6, status: "locked", order: 2, projectId: 10, goalId: 1 },
        { id: 5, status: "active", order: 1, projectId: 10, goalId: 1 },
        { id: 4, status: "completed", order: 0, projectId: 10, goalId: 1 },
      ]);
    });

    it("crée la tâche aujourd'hui, rattachée à l'objectif et à son étape en cours, avec son pourquoi", async () => {
      const r = await appel("POST", "/api/fil/objectifs/1/reprendre", { clientToday: "2026-11-12" });
      expect(r.status).toBe(200);
      expect(h.tacheDeReprise).toHaveBeenCalledWith("u1", 1);
      expect(h.creerTache).toHaveBeenCalledWith("u1", expect.objectContaining({
        title: reprise.titre, pourquoi: reprise.pourquoi, estimatedDuration: 20,
        projectId: 10, goalId: 1, milestoneId: 5, scheduledDate: "2026-11-12",
      }));
      expect(h.fixOverlappingTasks).toHaveBeenCalledWith("u1", "2026-11-12");
      expect((await r.json()).id).toBe(42);
    });

    it("sans étape ouverte : rattachée à l'objectif seul, jamais à une étape verrouillée", async () => {
      h.etapesObjectif.mockReturnValue([{ id: 6, status: "locked", order: 0, projectId: 10, goalId: 1 }]);
      await appel("POST", "/api/fil/objectifs/1/reprendre", { clientToday: "2026-11-12" });
      expect(h.creerTache.mock.calls[0][1]).toMatchObject({ goalId: 1, milestoneId: null });
    });

    it("reprise déjà affichée (titre + pourquoi) : créée telle quelle, sans appel IA", async () => {
      const r = await appel("POST", "/api/fil/objectifs/1/reprendre", { clientToday: "2026-11-12", titre: "Appeler Margaux", pourquoi: reprise.pourquoi });
      expect(r.status).toBe(200);
      expect(h.tacheDeReprise).not.toHaveBeenCalled();
      expect(h.creerTache.mock.calls[0][1]).toMatchObject({ title: "Appeler Margaux", pourquoi: reprise.pourquoi });
    });

    it("objectif d'une autre ou inactif, plafond IA, génération ratée, jour non travaillé", async () => {
      expect((await appel("POST", "/api/fil/objectifs/2/reprendre", {})).status).toBe(404);
      h.getProjectGoal.mockResolvedValueOnce({ id: 1, projectId: 10, title: "x", status: "paused" });
      expect((await appel("POST", "/api/fil/objectifs/1/reprendre", {})).status).toBe(409);
      h.isAiBlocked.mockResolvedValueOnce(true);
      expect((await appel("POST", "/api/fil/objectifs/1/reprendre", {})).status).toBe(429);
      h.tacheDeReprise.mockResolvedValueOnce(null);
      const g = await appel("POST", "/api/fil/objectifs/1/reprendre", {});
      expect(g.status).toBe(409);
      expect(await g.json()).toEqual({ message: "generation_impossible" });
      expect(h.creerTache).not.toHaveBeenCalled();
      h.creerTache.mockResolvedValueOnce({ ok: false, status: 400, message: "Saturday is not one of your work days." });
      expect((await appel("POST", "/api/fil/objectifs/1/reprendre", { clientToday: "2026-11-14" })).status).toBe(400);
    });
  });

  describe("trancher une tâche ouverte (clôture du vendredi)", () => {
    const TACHE = { id: 5, userId: "u1", title: "Relancer Margaux", completed: false, archivedAt: null };
    beforeEach(() => {
      h.getTask.mockImplementation(async (id: number) => (id === 5 ? { ...TACHE } : id === 6 ? { ...TACHE, id: 6, userId: "u2" } : undefined));
      h.modifierTache.mockImplementation(async (_u: string, id: number, patch: any) => ({ ok: true, tache: { ...TACHE, id, ...patch }, avant: TACHE }));
      h.archiverTache.mockImplementation(async (_u: string, id: number) => ({ ok: true, tache: { ...TACHE, id, archivedAt: new Date().toISOString() } }));
      h.fusionnerActionData.mockResolvedValue({ ok: true, tache: TACHE });
    });

    it("faire : aujourd'hui (Paris) par modifierTache", async () => {
      const r = await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "faire" });
      expect(r.status).toBe(200);
      const [userId, id, patch] = h.modifierTache.mock.calls[0];
      expect([userId, id]).toEqual(["u1", 5]);
      expect(patch.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.archiverTache).not.toHaveBeenCalled();
      // Tranchée cette semaine : marquée dans actionData.cloture (lundi de la semaine de Paris).
      const [u, mid, cle, valeur] = h.fusionnerActionData.mock.calls[0];
      expect([u, mid, cle]).toEqual(["u1", 5, "cloture"]);
      expect(valeur.tranchee).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${valeur.tranchee}T12:00:00Z`).getUTCDay()).toBe(1);
    });

    it("déplacer : la date donnée", async () => {
      const r = await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "deplacer", date: "2099-01-05" });
      expect(r.status).toBe(200);
      expect(h.modifierTache).toHaveBeenCalledWith("u1", 5, { scheduledDate: "2099-01-05", scheduledTime: null, scheduledEndTime: null });
    });

    it("abandonner : archivée, jamais supprimée", async () => {
      const r = await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "abandonner" });
      expect(r.status).toBe(200);
      expect((await r.json()).archivedAt).toBeTruthy();
      expect(h.archiverTache).toHaveBeenCalledWith("u1", 5);
      expect(h.modifierTache).not.toHaveBeenCalled();
    });

    it("déjà tranchée ailleurs (cochée) : 409 deja_tranchee, et la liste du vendredi se relit", async () => {
      h.getTask.mockResolvedValue({ ...TACHE, completed: true });
      const r = await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "faire" });
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ message: "deja_tranchee" });
      expect(h.oublierClotureDe).toHaveBeenCalledWith("u1");
      expect(h.modifierTache).not.toHaveBeenCalled();
    });

    it("corps invalide : 400 ; tâche d'une autre : 404 ; date passée : 400 ; rien d'écrit", async () => {
      for (const corps of [{}, { tacheId: 5 }, { tacheId: 5, geste: "supprimer" }, { tacheId: "5", geste: "faire" }, { tacheId: 5, geste: "deplacer", date: "demain" }]) {
        expect((await appel("POST", "/api/fil/trancher", corps)).status).toBe(400);
      }
      expect((await appel("POST", "/api/fil/trancher", { tacheId: 6, geste: "abandonner" })).status).toBe(404);
      expect((await appel("POST", "/api/fil/trancher", { tacheId: 7, geste: "faire" })).status).toBe(404);
      const passee = await appel("POST", "/api/fil/trancher", { tacheId: 5, geste: "deplacer", date: "2000-01-03" });
      expect(passee.status).toBe(400);
      expect(await passee.json()).toEqual({ message: "date_passee" });
      expect(h.modifierTache).not.toHaveBeenCalled();
      expect(h.archiverTache).not.toHaveBeenCalled();
    });
  });
});
