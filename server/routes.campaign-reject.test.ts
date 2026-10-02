// Tests d'intégration des endpoints de rejet d'une campagne générée (tâche 4).
//
// `./db`, `./storage` et `./auth` sont mockés — motif repris de
// server/routes.brand-links.test.ts et server/routes.reading.test.ts — pour ne
// JAMAIS toucher la vraie base (DATABASE_URL de .env pointe vers une base réelle).
//
// Le mock de `./db` va plus loin que la chaîne « tout accepte » des deux fichiers
// cités : chaque opération TOP-LEVEL (`select`/`update`/`insert`/`delete`/
// `transaction`) est un `vi.fn()` DISTINCT et exposé via `hoisted`. C'est ce qui
// permet au test de l'aperçu d'affirmer qu'AUCUNE écriture n'est émise — pas
// seulement que la réponse est correcte, ce qu'une assertion sur le corps JSON ne
// prouverait jamais.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  dbInsert: vi.fn(),
  dbDelete: vi.fn(),
  dbTransaction: vi.fn(),
  // Mock du SERVICE (tâche 2), verrouillé par mutation sur trois rounds — ce
  // fichier ne le ré-teste pas, il teste ce que ROUTES.TS fait de son résultat et
  // de ses erreurs.
  rejeterCampagne: vi.fn(),
  // Mock du SERVICE (tâche 3) de lecture des préférences.
  preferencesDeLaMarque: vi.fn(),
  // Mocks des trois fonctions de génération — motif identique à
  // routes.brand-links.test.ts : on inspecte l'objet `CampaignGenerationRequest`
  // réellement construit par routes.ts, sans jamais appeler le réseau.
  generateCampaignStrategy: vi.fn(),
  generateCampaignContent: vi.fn(),
  generateCampaignTasks: vi.fn(),
}));

vi.mock("./db", () => {
  const chaine = (): any => {
    const suite: any = {
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
    };
    const methodes = ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin", "groupBy", "set", "values", "returning"];
    for (const m of methodes) {
      suite[m] = (...args: any[]) => {
        if (m === "where") hoisted.wheres.push(args[0]);
        return suite;
      };
    }
    return suite;
  };
  hoisted.dbSelect.mockImplementation(() => chaine());
  hoisted.dbUpdate.mockImplementation(() => chaine());
  hoisted.dbInsert.mockImplementation(() => chaine());
  hoisted.dbDelete.mockImplementation(() => chaine());
  // Jamais exercé par ce fichier (rejeterCampagne est mocké en entier plus bas),
  // mais présent pour que l'import du module réel ne casse pas et que l'assertion
  // « transaction jamais ouverte » par l'aperçu ait un sens.
  hoisted.dbTransaction.mockImplementation(async (cb: any) =>
    cb({ select: hoisted.dbSelect, update: hoisted.dbUpdate, insert: hoisted.dbInsert, delete: hoisted.dbDelete }),
  );
  return {
    db: {
      select: hoisted.dbSelect,
      update: hoisted.dbUpdate,
      insert: hoisted.dbInsert,
      delete: hoisted.dbDelete,
      transaction: hoisted.dbTransaction,
    },
    pool: { query: vi.fn(), on: vi.fn() },
  };
});

// `importOriginal` garde les vraies `CampagneIntrouvable` (classe) et `trierContenus`/
// `trierTaches` (pures) — seule `rejeterCampagne` (l'orchestration transactionnelle)
// est remplacée. Importer `CampagneIntrouvable` depuis CE module mocké, plus bas,
// rend donc la MÊME classe que celle que routes.ts reconnaît par `instanceof`.
vi.mock("./services/campaign-reject/rejeter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/campaign-reject/rejeter")>();
  return { ...actual, rejeterCampagne: hoisted.rejeterCampagne };
});

vi.mock("./services/campaign-reject/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/campaign-reject/preferences")>();
  return { ...actual, preferencesDeLaMarque: hoisted.preferencesDeLaMarque };
});

vi.mock("./services/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/openai")>();
  return {
    ...actual,
    generateCampaignStrategy: hoisted.generateCampaignStrategy,
    generateCampaignContent: hoisted.generateCampaignContent,
    generateCampaignTasks: hoisted.generateCampaignTasks,
  };
});

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
};
vi.mock("./storage", () => ({ storage: storageMock }));

const extractToMemoryMock = vi.fn();
vi.mock("./services/memory/extract", () => ({ extractToMemory: extractToMemoryMock }));

const { registerRoutes } = await import("./routes");
const { CampagneIntrouvable } = await import("./services/campaign-reject/rejeter");

let server: http.Server;
let port = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  hoisted.resultats = [];
  hoisted.wheres = [];
  extractToMemoryMock.mockResolvedValue(undefined);
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

const campagne = (over: Record<string, unknown> = {}) => ({
  id: 1, userId: "user-1", projectId: 1, name: "Campagne test",
  objective: "Vendre plus", coreMessage: "Message", ...over,
});

const RESULTAT_REJET_STUB = {
  contenusDetaches: 2, contenusSupprimes: 1, tachesDetachees: 0, tachesSupprimees: 3,
  preferenceEcrite: true, preferenceSansEmbedding: false, articulationsRompues: [],
};

// ─── GET /api/campaigns/:id/reject-preview ──────────────────────────────────

describe("GET /api/campaigns/:id/reject-preview", () => {
  it("une campagne d'autrui ou inexistante → 404, jamais 403", async () => {
    storageMock.getCampaign.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/999/reject-preview`);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("calcule les gardés/partants (contenus et tâches) et les articulations rompues", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.resultats = [
      // contenus : un publié (gardé), un brouillon (partant)
      [
        { id: 10, publishedAt: new Date("2026-01-01"), postStatus: null, contentStatus: null },
        { id: 11, publishedAt: null, postStatus: null, contentStatus: "idea" },
      ],
      // tâches : une faite (gardée), une non faite (partante)
      [
        { id: 20, completed: true },
        { id: 21, completed: false },
      ],
      // articulations rompues
      [{ campagneId: 7, campagneNom: "Autre campagne", marque: "Marque Liée" }],
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      contenusGardes: 1,
      contenusPartants: 1,
      tachesGardees: 1,
      tachesPartantes: 1,
      articulationsRompues: [{ campagneId: 7, campagneNom: "Autre campagne", marque: "Marque Liée" }],
    });
  });

  it("une marque introuvable pour l'articulation rend une chaîne vide, jamais null/undefined", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.resultats = [[], [], [{ campagneId: 7, campagneNom: "Autre", marque: null }]];
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);
    const body = await res.json();
    expect(body.articulationsRompues).toEqual([{ campagneId: 7, campagneNom: "Autre", marque: "" }]);
  });

  // ── Le point central de ce chantier pour cet endpoint : une LECTURE ne doit
  // jamais pouvoir, même par accident, se transformer en écriture. L'assertion
  // porte sur les opérations `./db` elles-mêmes, pas sur le corps de la réponse —
  // un bug qui écrirait en plus de lire laisserait quand même une réponse 200
  // correcte, donc seule l'inspection des appels le prouve.
  it("GARANTIE CENTRALE — l'aperçu ne modifie RIEN : ni update, ni insert, ni delete, ni transaction ne sont jamais appelés", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.resultats = [[], [], []];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);

    expect(res.status).toBe(200);
    expect(hoisted.dbSelect).toHaveBeenCalled(); // des lectures ont bien eu lieu
    expect(hoisted.dbUpdate).not.toHaveBeenCalled();
    expect(hoisted.dbInsert).not.toHaveBeenCalled();
    expect(hoisted.dbDelete).not.toHaveBeenCalled();
    expect(hoisted.dbTransaction).not.toHaveBeenCalled();
  });

  it("un identifiant non numérique ne fait pas planter l'endpoint (404, pas 500)", async () => {
    storageMock.getCampaign.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/abc/reject-preview`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/campaigns/:id/reject ──────────────────────────────────────────

describe("POST /api/campaigns/:id/reject", () => {
  it("une campagne d'autrui ou inexistante → 404, jamais 403, et le service n'est JAMAIS appelé", async () => {
    storageMock.getCampaign.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/999/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raison: "trop générique" }),
    });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(hoisted.rejeterCampagne).not.toHaveBeenCalled();
  });

  it("avec une raison : appelle rejeterCampagne(userId, campaignId, raison) et rend son résultat tel quel", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.rejeterCampagne.mockResolvedValue(RESULTAT_REJET_STUB);

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raison: "trop générique, pas notre ton" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(RESULTAT_REJET_STUB);
    expect(hoisted.rejeterCampagne).toHaveBeenCalledWith({
      userId: "user-1", campaignId: 1, raison: "trop générique, pas notre ton",
    });
  });

  // Décision 4 du spec : la raison est FACULTATIVE. Ni l'une ni l'autre absence ne
  // doit bloquer le rejet — c'est l'écran (tâche 5) qui informe de la conséquence
  // (`preferenceEcrite: false`), pas une validation 400 ici.
  it("raison absente du corps : le rejet se fait quand même, raison vide transmise au service (Décision 4, facultative)", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.rejeterCampagne.mockResolvedValue({ ...RESULTAT_REJET_STUB, preferenceEcrite: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(hoisted.rejeterCampagne).toHaveBeenCalledWith({ userId: "user-1", campaignId: 1, raison: "" });
    const body = await res.json();
    expect(body.preferenceEcrite).toBe(false);
  });

  it("raison blanche (espaces) : traitée comme une raison transmise telle quelle, pas rejetée par une validation inventée", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.rejeterCampagne.mockResolvedValue({ ...RESULTAT_REJET_STUB, preferenceEcrite: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raison: "   " }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.rejeterCampagne).toHaveBeenCalledWith({ userId: "user-1", campaignId: 1, raison: "   " });
  });

  // ── Le point central n°1 du chantier : CampagneIntrouvable doit être reconnue
  // par `instanceof`, jamais par son message. Les deux tests suivants forment une
  // paire : le premier prouve que la levée RÉELLE mappe bien sur 404 (scénario
  // concret : deux onglets, suppression entre-temps) ; le second prouve que ce
  // n'est PAS une reconnaissance par texte — une mutation qui remplacerait
  // `instanceof CampagneIntrouvable` par une comparaison de message serait
  // INVISIBLE au premier test mais ferait tomber le second.
  it("CampagneIntrouvable levée par le service (double onglet : supprimée entre l'ouverture et le clic) → 404", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.rejeterCampagne.mockRejectedValue(new CampagneIntrouvable(1));

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("VERROU — une Error ordinaire portant le MÊME texte que CampagneIntrouvable n'est PAS prise pour un 404 : la reconnaissance passe par instanceof, pas par le message", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    const texteIdentique = new CampagneIntrouvable(1).message;
    hoisted.rejeterCampagne.mockRejectedValue(new Error(texteIdentique));

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Si le mapping lisait le message, cette Error nue produirait aussi un 404.
    expect(res.status).toBe(500);
  });

  it("une erreur quelconque (ni CampagneIntrouvable, ni son texte) rend 500, pas 404", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.rejeterCampagne.mockRejectedValue(new Error("panne réseau"));

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
  });

  it("un identifiant non numérique ne fait pas planter l'endpoint (404, pas 500) et n'appelle pas le service", async () => {
    storageMock.getCampaign.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/abc/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(hoisted.rejeterCampagne).not.toHaveBeenCalled();
  });
});

// ─── Les préférences atteignent generateCampaignStrategy et generateCampaignContent,
//     JAMAIS generateCampaignTasks ───────────────────────────────────────────
//
// Relevé vérifié par énumération (pas par souvenir) : trois FONCTIONS de génération,
// chacune appelée UNE SEULE FOIS — `generateCampaignStrategy` (routes.ts, étape 1),
// `generateCampaignContent` (étape 2), toutes deux injectent déjà `articulation` et
// reçoivent donc les préférences au même endroit ; `generateCampaignTasks` (étape 3)
// n'injecte pas l'articulation et ne doit pas davantage recevoir les préférences —
// exécution opérationnelle, pas décision d'angle.

const STRATEGY_STUB: any = {
  name: "Campagne Stub", campaignType: "visibility", coreMessage: "Message stub",
  targetAudience: "Audience", audienceSegment: "Segment", insights: [],
  messagingFramework: { coreMessage: "", proofPoints: [], primaryCTA: "", secondaryCTA: "", toneKeywords: [], thingsToAvoid: [] },
  phases: [], channels: [], kpis: [], prospection: null,
};

const PREFS_STUB = [{ id: 1, content: "Pas de ton corporate", salience: 0.8, createdAt: new Date() }];

describe("Les préférences de la marque atteignent la génération de campagne (chantier « rejeter une campagne »)", () => {
  beforeEach(() => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    storageMock.getBrandDna.mockResolvedValue(undefined);
    storageMock.getBrandDnaForProject.mockResolvedValue(undefined);
    storageMock.getCampaigns.mockResolvedValue([]);
    storageMock.createCampaign.mockResolvedValue({ id: 1, name: "Campagne créée" });
    hoisted.preferencesDeLaMarque.mockResolvedValue(PREFS_STUB);
    hoisted.generateCampaignStrategy.mockResolvedValue(STRATEGY_STUB);
    hoisted.generateCampaignContent.mockResolvedValue([]);
    hoisted.generateCampaignTasks.mockResolvedValue([]);
  });

  it("generate/strategy : preferencesDeLaMarque(userId, projectId) est appelée UNE FOIS, et son résultat atteint la requête de génération", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1 }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.preferencesDeLaMarque).toHaveBeenCalledTimes(1);
    expect(hoisted.preferencesDeLaMarque).toHaveBeenCalledWith("user-1", 1);
    const requeteEnvoyee = hoisted.generateCampaignStrategy.mock.calls[0][0];
    expect(requeteEnvoyee.preferences).toBe(PREFS_STUB);
  });

  it("generate/content : idem — même champ, même source", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, strategy: STRATEGY_STUB }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.preferencesDeLaMarque).toHaveBeenCalledWith("user-1", 1);
    const requeteEnvoyee = hoisted.generateCampaignContent.mock.calls[0][0];
    expect(requeteEnvoyee.preferences).toBe(PREFS_STUB);
  });

  it("generate/tasks : AUCUNE préférence n'est demandée ni transmise — exécution opérationnelle, pas décision d'angle", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, strategy: STRATEGY_STUB }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.preferencesDeLaMarque).not.toHaveBeenCalled();
    const requeteEnvoyee = hoisted.generateCampaignTasks.mock.calls[0][0];
    // `in` teste la présence de la CLÉ : un champ présent avec `undefined` romprait
    // déjà ce critère (aucun champ ajouté), comme pour `articulation` au chantier précédent.
    expect('preferences' in requeteEnvoyee).toBe(false);
  });

  it("sans projectId (pas de marque sélectionnée) : preferencesDeLaMarque n'est pas appelée, et la requête de génération porte un tableau vide", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month" }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.preferencesDeLaMarque).not.toHaveBeenCalled();
    const requeteEnvoyee = hoisted.generateCampaignStrategy.mock.calls[0][0];
    expect(requeteEnvoyee.preferences).toEqual([]);
  });
});
