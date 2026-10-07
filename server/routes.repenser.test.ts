// Routes « repenser la campagne » : propriété, validation de la consigne, mapping des
// erreurs, et câblage de la génération (marque, préférences, savoir, consigne).
//
// Le service réel tourne ; seuls la base (`./db`, `repenser-db`), `storage`, les
// générateurs d'`openai.ts` et la mémoire sont remplacés. Jamais de vraie base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  generateCampaignStrategy: vi.fn(),
  generateCampaignContent: vi.fn(),
  generateCampaignTasks: vi.fn(),
  preferencesDeLaMarque: vi.fn(),
  retrieve: vi.fn(),
  lireContenus: vi.fn(),
  lireTaches: vi.fn(),
  transaction: vi.fn(),
  ops: {
    verrouillerCampagne: vi.fn(),
    lireContenus: vi.fn(),
    lireTaches: vi.fn(),
    mettreAJourCampagne: vi.fn(),
    supprimerContenus: vi.fn(),
    supprimerTaches: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })), transaction: vi.fn() },
  pool: { query: vi.fn(), on: vi.fn() },
}));

vi.mock("./services/campagne/repenser-db", () => ({
  lecturesRepenser: { lireContenus: h.lireContenus, lireTaches: h.lireTaches },
  transactionRepenser: h.transaction,
}));

vi.mock("./services/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/openai")>();
  return {
    ...actual,
    generateCampaignStrategy: h.generateCampaignStrategy,
    generateCampaignContent: h.generateCampaignContent,
    generateCampaignTasks: h.generateCampaignTasks,
  };
});

vi.mock("./services/campaign-reject/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/campaign-reject/preferences")>();
  return { ...actual, preferencesDeLaMarque: h.preferencesDeLaMarque };
});

vi.mock("./services/memory/retrieve", () => ({ retrieveMemories: (...a: any[]) => h.retrieve(...a) }));
vi.mock("./services/memory/extract", () => ({ extractToMemory: vi.fn(async () => undefined) }));

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
  getCampaign: vi.fn(),
  getProject: vi.fn(),
  getBrandDna: vi.fn(),
  getBrandDnaForProject: vi.fn(),
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  createProspectionCampaign: vi.fn(),
  fixOverlappingTasks: vi.fn(),
  getUserPreferences: vi.fn(),
  getDayAvailabilityRange: vi.fn(),
  getTasksInRange: vi.fn(),
  checkSlotAvailability: vi.fn(),
  createTask: vi.fn(),
  createContent: vi.fn(),
  deleteCampaignFutureTasks: vi.fn(),
  deleteCampaignFutureContent: vi.fn(),
  deleteAllIncompleteCampaignTasks: vi.fn(),
  deleteCampaignContentItems: vi.fn(),
  getContent: vi.fn(),
  updateCampaign: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port = 0;

const campagne = (over: Record<string, unknown> = {}) => ({
  id: 5, userId: "user-1", projectId: 2, name: "Lancement", objective: "Remplir l'atelier",
  duration: "1_month", status: "active", startDate: "2026-10-01", endDate: "2026-12-31",
  articuleAvecCampaignId: null, articulationIndependante: false, ...over,
});
const strategie = {
  name: "Autre nom", campaignType: "visibility", coreMessage: "m", targetAudience: "a", audienceSegment: "s",
  insights: [], messagingFramework: {}, phases: [{ number: 1, name: "P", duration: "W1", objective: "o", keyActions: [] }],
  channels: [], kpis: [], prospection: { needed: true },
};
const plan = [{ phase: 1, week: "Week 1", platform: "linkedin", format: "post", angle: "x", pillar: "p", goal: "g", copyDirections: "c" }];
const taches = [{ title: "Plan review", description: "d", type: "planning", category: "planning", priority: 1, estimatedDuration: 30, taskEnergyType: "admin", phase: 1 }];

beforeEach(async () => {
  vi.clearAllMocks();
  storageMock.getCampaign.mockImplementation(async (id: number, userId: string) =>
    id === 5 && userId === "user-1" ? campagne() : undefined);
  storageMock.getProject.mockResolvedValue({ id: 2, name: "Atelier" });
  storageMock.getBrandDnaForProject.mockResolvedValue({ businessType: "atelier céramique" });
  storageMock.getBrandDna.mockResolvedValue(null);
  storageMock.getCampaigns.mockResolvedValue([]);
  storageMock.fixOverlappingTasks.mockResolvedValue(0);
  storageMock.getUserPreferences.mockResolvedValue({ workDays: "mon,tue,wed,thu,fri" });
  storageMock.getDayAvailabilityRange.mockResolvedValue([]);
  storageMock.getTasksInRange.mockResolvedValue([]);
  storageMock.checkSlotAvailability.mockResolvedValue({ available: true });
  storageMock.createTask.mockImplementation(async (t: any) => t);
  storageMock.createContent.mockImplementation(async (c: any) => c);
  h.preferencesDeLaMarque.mockResolvedValue([{ id: 1, content: "Pas de jargon" }]);
  h.retrieve.mockResolvedValue({ savoir: [{ content: "Les ateliers du samedi se remplissent seuls" }] });
  h.generateCampaignStrategy.mockResolvedValue(strategie);
  h.generateCampaignContent.mockResolvedValue(plan);
  h.generateCampaignTasks.mockResolvedValue(taches);
  h.lireContenus.mockResolvedValue([
    { id: 1, publishedAt: new Date(), postStatus: "posted", contentStatus: "published" },
    { id: 2, publishedAt: null, postStatus: "pending", contentStatus: "idea" },
  ]);
  h.lireTaches.mockResolvedValue([{ id: 8, completed: true }, { id: 9, completed: false }]);
  h.ops.verrouillerCampagne.mockImplementation((userId: string, id: number) => storageMock.getCampaign(id, userId));
  h.ops.lireContenus.mockImplementation(() => h.lireContenus());
  h.ops.lireTaches.mockImplementation(() => h.lireTaches());
  h.ops.mettreAJourCampagne.mockResolvedValue(true);
  h.ops.supprimerContenus.mockImplementation(async (_u: string, _c: number, ids: number[]) => ids.length);
  h.ops.supprimerTaches.mockImplementation(async (_u: string, _c: number, ids: number[]) => ids.length);
  h.transaction.mockImplementation(async (fn: any) => fn(h.ops));
  if (!server) {
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const adresse = server.address();
    port = typeof adresse === "object" && adresse ? adresse.port : 0;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const url = (id: number | string, suffixe: string) => `http://127.0.0.1:${port}/api/campaigns/${id}/${suffixe}`;
const post = (id: number | string, body: unknown) =>
  fetch(url(id, "repenser"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function etat(id: number | string = 5) {
  const res = await fetch(url(id, "repenser-etat"));
  return { status: res.status, body: await res.json() };
}
/** POST puis attend la fin du travail en arrière-plan (interrogation de l'état). */
async function lancerEtAttendre(body: unknown, id = 5) {
  const res = await post(id, body);
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ etat: "en_cours" });
  for (let i = 0; i < 200; i++) {
    const e = await etat(id);
    if (e.body.etat !== "en_cours") return e.body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("le travail ne s'est pas terminé");
}

const rienEcrit = () => {
  expect(h.transaction).not.toHaveBeenCalled();
  expect(storageMock.createTask).not.toHaveBeenCalled();
  expect(storageMock.createContent).not.toHaveBeenCalled();
  expect(storageMock.createCampaign).not.toHaveBeenCalled();
  expect(storageMock.createProspectionCampaign).not.toHaveBeenCalled();
};

describe("GET /api/campaigns/:id/repenser-apercu", () => {
  it("rend les quatre comptes", async () => {
    const res = await fetch(url(5, "repenser-apercu"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postsRemplaces: 1, postsConserves: 1, tachesRemplacees: 1, tachesConservees: 1, placement: "maintenant" });
    expect(h.lireContenus).toHaveBeenCalledWith("user-1", 5);
  });

  it("campagne d'autrui ou absente → 404, rien n'est lu", async () => {
    const res = await fetch(url(999, "repenser-apercu"));
    expect(res.status).toBe(404);
    expect(h.lireContenus).not.toHaveBeenCalled();
  });
});

describe("POST /api/campaigns/:id/repenser", () => {
  it("succès : comptes rendus, savoir + préférences + marque + consigne transmis aux trois générateurs", async () => {
    const e = await lancerEtAttendre({ consigne: "  Moins de promo, plus de coulisses  " });
    expect(e.etat).toBe("termine");
    expect(typeof e.debut).toBe("string");
    const body = e.resultat;
    expect(body).toMatchObject({ postsSupprimes: 1, tachesSupprimees: 1, postsCrees: 1 });
    expect(Object.keys(body).sort()).toEqual(["postsCrees", "postsSupprimes", "tachesCreees", "tachesSupprimees"]);
    for (const f of [h.generateCampaignStrategy, h.generateCampaignContent, h.generateCampaignTasks]) {
      const req = f.mock.calls[0][0];
      expect(req).toMatchObject({
        userId: "user-1", projectId: 2, objective: "Remplir l'atelier", duration: "1_month",
        consigne: "Moins de promo, plus de coulisses",
        preferences: [{ id: 1, content: "Pas de jargon" }],
      });
      expect(req.brandDna.businessType).toBe("atelier céramique");
      expect(req.savoir).toContain("Les ateliers du samedi");
    }
    expect(h.preferencesDeLaMarque).toHaveBeenCalledWith("user-1", 2);
    // Le cadre est conservé et aucune campagne n'est créée.
    const champs = h.ops.mettreAJourCampagne.mock.calls[0][2];
    expect(champs).not.toHaveProperty("name");
    expect(storageMock.createCampaign).not.toHaveBeenCalled();
    expect(storageMock.createProspectionCampaign).not.toHaveBeenCalled();
    for (const [c] of storageMock.createContent.mock.calls as any[]) expect(c.autoPost).toBe(false);
    expect(storageMock.fixOverlappingTasks).toHaveBeenCalled();
  });

  it("consigne faite d'espaces → absente des requêtes", async () => {
    expect((await lancerEtAttendre({ consigne: "    " })).etat).toBe("termine");
    expect("consigne" in h.generateCampaignStrategy.mock.calls[0][0]).toBe(false);
  });

  it("consigne > 1000 caractères → 400 consigne_trop_longue, rien n'est généré", async () => {
    const res = await post(5, { consigne: "x".repeat(1001) });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("consigne_trop_longue");
    expect(h.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("1000 caractères après trim → accepté", async () => {
    expect((await lancerEtAttendre({ consigne: "  " + "x".repeat(1000) + "  " })).etat).toBe("termine");
  });

  it("consigne non textuelle → 400", async () => {
    const res = await post(5, { consigne: 12 });
    expect(res.status).toBe(400);
    expect(h.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("campagne d'autrui → 404, rien n'est généré", async () => {
    const res = await post(999, {});
    expect(res.status).toBe(404);
    expect(h.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("statut completed → 409 statut_incompatible", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "completed" }));
    const res = await post(5, {});
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("statut_incompatible");
    rienEcrit();
  });

  it("échec du modèle → état echec generation_echouee, zéro écriture, pas de détails internes", async () => {
    h.generateCampaignTasks.mockRejectedValue(new Error("overloaded at /srv/x.ts:12"));
    const e = await lancerEtAttendre({});
    expect(e).toMatchObject({ etat: "echec", erreur: { code: "generation_echouee", etape: "taches" } });
    expect(JSON.stringify(e)).not.toContain("overloaded");
    expect(e).not.toHaveProperty("resultat");
    rienEcrit();
  });

  it("plan de contenu vide → echec generation_echouee, zéro écriture", async () => {
    h.generateCampaignContent.mockResolvedValue([]);
    const e = await lancerEtAttendre({});
    expect(e.erreur).toEqual({ code: "generation_echouee", etape: "contenu" });
    rienEcrit();
  });

  it("savoir indisponible → la génération continue sans savoir", async () => {
    h.retrieve.mockRejectedValue(new Error("mémoire indisponible"));
    expect((await lancerEtAttendre({})).etat).toBe("termine");
    expect("savoir" in h.generateCampaignStrategy.mock.calls[0][0]).toBe(false);
  });

  it("pendant le travail : état en_cours, second appel → 409 deja_en_cours ; puis termine", async () => {
    let relacher!: () => void;
    h.generateCampaignStrategy.mockImplementation(() => new Promise((r) => { relacher = () => r(strategie); }));
    const premier = await post(5, {});
    expect(premier.status).toBe(202);
    await vi.waitFor(() => expect(h.generateCampaignStrategy).toHaveBeenCalled());
    expect((await etat()).body.etat).toBe("en_cours");
    const second = await post(5, {});
    expect(second.status).toBe(409);
    expect((await second.json()).message).toBe("deja_en_cours");
    relacher();
    await vi.waitFor(async () => expect((await etat()).body.etat).toBe("termine"));
  });

  it("état d'une campagne d'autrui → 404 ; campagne jamais repensée → aucun", async () => {
    expect((await etat(999)).status).toBe(404);
    storageMock.getCampaign.mockImplementation(async (id: number) => (id === 6 ? campagne({ id: 6 }) : undefined));
    expect(await etat(6)).toEqual({ status: 200, body: { etat: "aucun" } });
  });

  it("échec du placement → echec placement_echoue avec les suppressions faites", async () => {
    storageMock.createTask.mockRejectedValue(new Error("db"));
    const e = await lancerEtAttendre({});
    expect(e).toMatchObject({ etat: "echec", erreur: { code: "placement_echoue", postsSupprimes: 1, tachesSupprimees: 1 } });
  });

  it("brouillon → aucun placement", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "draft", startDate: null, endDate: null }));
    const e = await lancerEtAttendre({});
    expect(e.resultat).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 1, tachesSupprimees: 1 });
    expect(storageMock.createTask).not.toHaveBeenCalled();
    expect(storageMock.fixOverlappingTasks).not.toHaveBeenCalled();
  });
});

describe("campagne relue au moment d'écrire", () => {
  it("campagne terminée pendant la génération → echec statut_incompatible, rien n'est écrit", async () => {
    h.ops.verrouillerCampagne.mockResolvedValue(campagne({ status: "completed" }));
    const e = await lancerEtAttendre({});
    expect(e).toMatchObject({ etat: "echec", erreur: { code: "statut_incompatible" } });
    expect(h.ops.mettreAJourCampagne).not.toHaveBeenCalled();
    expect(h.ops.supprimerContenus).not.toHaveBeenCalled();
    expect(h.ops.supprimerTaches).not.toHaveBeenCalled();
    expect(storageMock.createTask).not.toHaveBeenCalled();
    expect(storageMock.createContent).not.toHaveBeenCalled();
  });

  it("en pause → aucun placement (la reprise placera) ; l'aperçu le dit", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "paused" }));
    const apercu = await (await fetch(url(5, "repenser-apercu"))).json();
    expect(apercu.placement).toBe("reprise");
    const e = await lancerEtAttendre({});
    expect(e.resultat).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 1, tachesSupprimees: 1 });
    expect(storageMock.createTask).not.toHaveBeenCalled();
    expect(storageMock.createContent).not.toHaveBeenCalled();
  });
});

describe("routes de placement pendant un « repenser » en cours → 409 deja_en_cours", () => {
  it("/launch, /pause, /resume, /redeploy, /regenerate-content refusées, rien n'est touché ; libres après", async () => {
    let relacher!: () => void;
    h.generateCampaignStrategy.mockImplementation(() => new Promise((r) => { relacher = () => r(strategie); }));
    expect((await post(5, {})).status).toBe(202);
    await vi.waitFor(() => expect(h.generateCampaignStrategy).toHaveBeenCalled());
    for (const route of ["launch", "pause", "resume", "redeploy", "regenerate-content"]) {
      const res = await fetch(url(5, route), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(res.status, route).toBe(409);
      expect(await res.json(), route).toEqual({ message: "deja_en_cours" });
    }
    // Une campagne d'autrui reste un 404, pas un 409.
    const autrui = await fetch(url(999, "pause"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(autrui.status).toBe(404);
    for (const f of [
      storageMock.deleteCampaignFutureTasks, storageMock.deleteCampaignFutureContent,
      storageMock.deleteAllIncompleteCampaignTasks, storageMock.deleteCampaignContentItems,
      storageMock.updateCampaign, storageMock.createTask, storageMock.createContent,
    ]) expect(f).not.toHaveBeenCalled();
    relacher();
    await vi.waitFor(async () => expect((await etat()).body.etat).toBe("termine"));
    // Après : /pause n'est plus bloquée (campagne active).
    storageMock.deleteCampaignFutureTasks.mockResolvedValue(0);
    storageMock.deleteCampaignFutureContent.mockResolvedValue(0);
    storageMock.updateCampaign.mockResolvedValue(campagne({ status: "paused" }));
    const pause = await fetch(url(5, "pause"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(pause.status).toBe(200);
  });
});
