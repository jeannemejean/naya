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
  prospectionSupprimee: [],
};

// ─── GET /api/campaigns/:id/reject-preview ──────────────────────────────────

describe("GET /api/campaigns/:id/reject-preview", () => {
  it("une campagne d'autrui ou inexistante → 404, jamais 403, et AUCUNE opération base n'est émise", async () => {
    storageMock.getCampaign.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/999/reject-preview`);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    // Symétrique au test POST équivalent (qui affirme `rejeterCampagne` jamais
    // appelé) : la vérification de propriété doit précéder TOUT accès base, pas
    // seulement produire le bon code HTTP. Verrou contre un futur déplacement du
    // `return` après une des lectures (content/tasks/articulations).
    expect(hoisted.dbSelect).not.toHaveBeenCalled();
    expect(hoisted.dbUpdate).not.toHaveBeenCalled();
    expect(hoisted.dbInsert).not.toHaveBeenCalled();
    expect(hoisted.dbDelete).not.toHaveBeenCalled();
    expect(hoisted.dbTransaction).not.toHaveBeenCalled();
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
      prospectionLiee: [],
      prospectsAArchiver: 0,
    });
  });

  // Point 1 (revue finale, volet serveur) : l'ancien bouton Supprimer cascadait vers
  // la prospection liée ; le rejet doit le dire D'AVANCE, pas le faire en silence.
  // Au minimum le(s) nom(s) de la prospection concernée et le nombre de prospects qui
  // seraient ARCHIVÉS (jamais supprimés — le mot compte, c'est lui que lit l'écran).
  it("annonce la prospection liée (lien direct campaigns.linkedProspectionCampaignId) et le nombre de prospects qui seraient archivés", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ linkedProspectionCampaignId: 55 }));
    hoisted.resultats = [
      [], // contenus
      [], // tâches
      [], // articulations rompues
      [{ id: 55, name: "Prospection vignerons bio" }], // prospection liée (lien direct)
      [{ total: 7 }], // prospects pas encore archivés, dans cette prospection
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);
    const body = await res.json();

    expect(body.prospectionLiee).toEqual([{ id: 55, name: "Prospection vignerons bio" }]);
    expect(body.prospectsAArchiver).toBe(7);
  });

  // Le lien INVERSE (prospectionCampaigns.linkedCampaignId) doit être lu lui aussi —
  // c'est la deuxième moitié de « les deux sens », sans laquelle une campagne de
  // prospection créée APRÈS la campagne marketing (lien posé seulement côté
  // prospection) resterait invisible à cet aperçu.
  it("annonce aussi la prospection liée par le lien INVERSE (prospectionCampaigns.linkedCampaignId), sans lien direct sur la campagne", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne()); // pas de linkedProspectionCampaignId
    hoisted.resultats = [
      [], [], [],
      [{ id: 56, name: "Prospection liée en retour" }],
      [{ total: 0 }],
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);
    const body = await res.json();

    expect(body.prospectionLiee).toEqual([{ id: 56, name: "Prospection liée en retour" }]);
    expect(body.prospectsAArchiver).toBe(0);
  });

  it("aucune prospection liée : prospectionLiee est vide et prospectsAArchiver vaut 0, sans requête de comptage superflue", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    hoisted.resultats = [[], [], [], []]; // pas de ligne de prospection liée

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/1/reject-preview`);
    const body = await res.json();

    expect(body.prospectionLiee).toEqual([]);
    expect(body.prospectsAArchiver).toBe(0);
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

  // Nommé pour ce qu'il prouve RÉELLEMENT, pas plus : `storage.getCampaign` est
  // mocké et rend `undefined` quels que soient ses arguments — ce test exerce
  // seulement le ROUTAGE Express d'un segment non numérique jusqu'à ce handler et
  // la branche « campagne introuvable » qui suit. Il ne prouve RIEN sur ce que
  // `parseInt("abc")` (→ NaN) produirait réellement face à une colonne `integer`
  // en SQL — ça n'est pas mocké ici, et ce chantier ne l'introduit pas : les
  // endpoints voisins (`DELETE`/`PATCH /api/campaigns/:id`) ne le gardent pas
  // davantage.
  it("un segment d'URL non numérique route bien vers ce handler et rend 404 quand storage.getCampaign ne trouve rien (ne teste PAS le comportement réel d'un NaN en SQL)", async () => {
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

  // Même remarque que son jumeau côté GET : nommé pour ce qu'il prouve
  // réellement (routage + branche « introuvable »), pas pour un comportement de
  // NaN en SQL que `storage.getCampaign` mocké ne peut pas exercer.
  it("un segment d'URL non numérique route bien vers ce handler, rend 404 et n'appelle pas le service (ne teste PAS le comportement réel d'un NaN en SQL)", async () => {
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

  it("generate/tasks : les préférences de la marque sont transmises (les tâches honorent aussi ce qui a été rejeté)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, strategy: STRATEGY_STUB }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.preferencesDeLaMarque).toHaveBeenCalled();
    const requeteEnvoyee = hoisted.generateCampaignTasks.mock.calls[0][0];
    expect(requeteEnvoyee.preferences).toBe(PREFS_STUB);
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

  // DÉCISION DÉLIBÉRÉE, pas un oubli : `resolvePreferences` (routes.ts) n'a
  // AUCUN try/catch. Si la lecture des préférences échoue (panne base,
  // timeout...), toute la génération échoue en 500 — elle ne continue JAMAIS
  // silencieusement sans elles.
  //
  // L'alternative (avaler l'erreur, générer quand même) semblerait plus
  // tolérante, mais serait en réalité plus dangereuse : une génération qui
  // continue sans les préférences après une panne pourrait reproduire EXACTEMENT
  // ce que l'utilisatrice a rejeté, sans aucun signal pour elle ni pour nous.
  // Échouer franc vaut mieux qu'échouer en silence sur CE chemin précis.
  //
  // Si quelqu'un ajoute un try/catch autour de `resolvePreferences` en le jugeant
  // fragile, ce test tombe — c'est voulu : il protège la décision, pas juste le
  // code actuel.
  it("GARANTIE DÉLIBÉRÉE — si preferencesDeLaMarque lève, la génération échoue en 500, jamais une génération silencieuse sans préférences", async () => {
    hoisted.preferencesDeLaMarque.mockRejectedValue(new Error("panne base simulée"));

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1 }),
    });

    expect(res.status).toBe(500);
    // Pas de génération « de secours » sans préférences : le modèle n'est jamais
    // appelé quand leur lecture a échoué.
    expect(hoisted.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("savoir : la récupération échoue (db sans execute) → la génération a quand même lieu, sans champ savoir", async () => {
    for (const etape of ["strategy", "content"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/${etape}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, strategy: STRATEGY_STUB }),
      });
      expect(res.status).toBe(200);
    }
    expect(hoisted.generateCampaignStrategy.mock.calls[0][0].savoir).toBeUndefined();
    expect(hoisted.generateCampaignContent.mock.calls[0][0].savoir).toBeUndefined();
  });
});
