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
    expect(await res.json()).toEqual({ postsRemplaces: 1, postsConserves: 1, tachesRemplacees: 1, tachesConservees: 1 });
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
    const res = await post(5, { consigne: "  Moins de promo, plus de coulisses  " });
    expect(res.status).toBe(200);
    const body = await res.json();
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
    const res = await post(5, { consigne: "    " });
    expect(res.status).toBe(200);
    expect("consigne" in h.generateCampaignStrategy.mock.calls[0][0]).toBe(false);
  });

  it("consigne > 1000 caractères → 400 consigne_trop_longue, rien n'est généré", async () => {
    const res = await post(5, { consigne: "x".repeat(1001) });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("consigne_trop_longue");
    expect(h.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("1000 caractères après trim → accepté", async () => {
    const res = await post(5, { consigne: "  " + "x".repeat(1000) + "  " });
    expect(res.status).toBe(200);
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

  it("échec du modèle → 502 generation_echouee, zéro écriture", async () => {
    h.generateCampaignTasks.mockRejectedValue(new Error("overloaded"));
    const res = await post(5, {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ message: "generation_echouee", etape: "taches" });
    rienEcrit();
  });

  it("plan de contenu vide → 502 generation_echouee, zéro écriture", async () => {
    h.generateCampaignContent.mockResolvedValue([]);
    const res = await post(5, {});
    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe("generation_echouee");
    rienEcrit();
  });

  it("savoir indisponible → la génération continue sans savoir", async () => {
    h.retrieve.mockRejectedValue(new Error("mémoire indisponible"));
    const res = await post(5, {});
    expect(res.status).toBe(200);
    expect("savoir" in h.generateCampaignStrategy.mock.calls[0][0]).toBe(false);
  });

  it("second appel concurrent → 409 deja_en_cours ; le premier aboutit", async () => {
    let relacher!: () => void;
    h.generateCampaignStrategy.mockImplementation(() => new Promise((r) => { relacher = () => r(strategie); }));
    const premier = post(5, {});
    await vi.waitFor(() => expect(h.generateCampaignStrategy).toHaveBeenCalled());
    const second = await post(5, {});
    expect(second.status).toBe(409);
    expect((await second.json()).message).toBe("deja_en_cours");
    relacher();
    expect((await premier).status).toBe(200);
  });

  it("échec du placement → 500 placement_echoue avec les suppressions faites", async () => {
    storageMock.createTask.mockRejectedValue(new Error("db"));
    const res = await post(5, {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "placement_echoue", postsSupprimes: 1, tachesSupprimees: 1 });
  });

  it("brouillon → aucun placement", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "draft", startDate: null, endDate: null }));
    const res = await post(5, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 1, tachesSupprimees: 1 });
    expect(storageMock.createTask).not.toHaveBeenCalled();
    expect(storageMock.fixOverlappingTasks).not.toHaveBeenCalled();
  });
});
