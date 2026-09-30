// Tests d'intégration des endpoints de déclaration des liens entre marques.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL de .env pointe vers une base réelle — consigne projet : aucun test
// n'exécute de requête réelle). Le mock de `db` capture les clauses `where` qu'on
// lui passe : on les rend en SQL avec le dialecte Postgres de drizzle, hors
// connexion, ce qui permet d'affirmer ce que les requêtes bornent RÉELLEMENT.
//
// Motif repris tel quel de server/routes.reading.test.ts — ne pas réinventer
// l'échafaudage.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Articulation } from "./services/brand-links/links";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  sets: [] as any[],
  inserts: [] as any[],
  // Mocks au niveau route : interceptent les TROIS étapes de génération pour
  // inspecter l'objet `CampaignGenerationRequest` réellement construit par
  // routes.ts (présence/absence du champ `articulation`, valeur de `weekContext`)
  // sans jamais appeler le réseau.
  generateCampaignStrategy: vi.fn(),
  generateCampaignContent: vi.fn(),
  generateCampaignTasks: vi.fn(),
  // Références vers les VRAIES implémentations (capturées via importOriginal),
  // pour tester l'assemblage réel du prompt (tests 3 et 4) sans passer par HTTP.
  generateCampaignStrategyReel: undefined as any,
  generateCampaignContentReel: undefined as any,
  // Mock du seul point de sortie réseau : permet d'appeler les VRAIES fonctions
  // de génération ci-dessus sans jamais contacter un modèle.
  callClaudeDetailed: vi.fn(),
}));

vi.mock("./db", () => {
  // Une chaîne de constructeur de requête « tout accepte » : chaque méthode rend la
  // même chaîne, et l'objet est attendable (thenable) — il rend le prochain résultat
  // de la file. Suffisant pour les quelques requêtes exercées ici, sans simuler
  // drizzle en entier.
  const chaine = (): any => {
    const suite: any = {
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
    };
    const methodes = ["from", "where", "orderBy", "limit", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate", "set", "innerJoin", "leftJoin", "groupBy"];
    for (const m of methodes) {
      suite[m] = (...args: any[]) => {
        if (m === "where") hoisted.wheres.push(args[0]);
        if (m === "set") hoisted.sets.push(args[0]);
        if (m === "values") hoisted.inserts.push(args[0]);
        return suite;
      };
    }
    return suite;
  };
  return {
    db: { select: () => chaine(), update: () => chaine(), insert: () => chaine(), delete: () => chaine() },
    pool: { query: vi.fn(), on: vi.fn() },
  };
});

vi.mock("./services/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/openai")>();
  // On garde les vraies implémentations de côté (pour les tests 3 et 4, qui
  // appellent directement la fonction réelle) et on remplace seulement les trois
  // étapes de génération de campagne pour les tests au niveau route.
  hoisted.generateCampaignStrategyReel = actual.generateCampaignStrategy;
  hoisted.generateCampaignContentReel = actual.generateCampaignContent;
  return {
    ...actual,
    generateCampaignStrategy: hoisted.generateCampaignStrategy,
    generateCampaignContent: hoisted.generateCampaignContent,
    generateCampaignTasks: hoisted.generateCampaignTasks,
  };
});

vi.mock("./services/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/claude")>();
  // Seul point de sortie réseau des vraies fonctions de génération : mocké pour
  // que les tests directs (3 et 4) n'appellent jamais un modèle réel.
  return { ...actual, callClaudeDetailed: hoisted.callClaudeDetailed };
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

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

let server: http.Server;
let port = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  hoisted.resultats = [];
  hoisted.wheres = [];
  hoisted.sets = [];
  hoisted.inserts = [];
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

const lien = (over: Record<string, unknown> = {}) => ({
  id: 1, userId: "user-1", fromProjectId: 1, toProjectId: 2,
  roleAmont: null, roleAval: null, nature: null, audiencesRecoupent: false,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe("GET /api/projects/:id/links — sortants et entrants, filtrés par utilisateur", () => {
  it("rend deux listes distinctes, l'une bornée sur from_project_id, l'autre sur to_project_id", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    hoisted.resultats = [
      [lien({ id: 1, fromProjectId: 1, toProjectId: 2 })], // sortants
      [lien({ id: 2, fromProjectId: 3, toProjectId: 1 })], // entrants
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.sortants.map((l: any) => l.id)).toEqual([1]);
    expect(body.entrants.map((l: any) => l.id)).toEqual([2]);

    const [sortantsWhere, entrantsWhere] = hoisted.wheres.map(enSql);
    // C'est cette borne qui distingue sortants et entrants : sans elle, les deux
    // requêtes rendraient le même ensemble.
    expect(sortantsWhere.sql).toContain('"project_links"."from_project_id"');
    expect(sortantsWhere.sql).not.toContain('"project_links"."to_project_id"');
    expect(entrantsWhere.sql).toContain('"project_links"."to_project_id"');
    expect(entrantsWhere.sql).not.toContain('"project_links"."from_project_id"');

    // Les deux requêtes filtrent sur l'utilisateur courant.
    expect(sortantsWhere.sql).toContain('"project_links"."user_id"');
    expect(entrantsWhere.sql).toContain('"project_links"."user_id"');
    expect(sortantsWhere.params).toContain("user-1");
    expect(entrantsWhere.params).toContain("user-1");
  });

  it("un identifiant de projet non numérique rend 400, pas 500", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/abc/links`);
    expect(res.status).toBe(400);
    expect(storageMock.getProject).not.toHaveBeenCalled();
  });

  it("un projet d'autrui est introuvable (404), jamais interdit (403)", async () => {
    storageMock.getProject.mockResolvedValue(undefined);
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/999/links`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/links — validation et double appartenance", () => {
  it("refuse fromProjectId === toProjectId avec 400, sans toucher la base", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 1 }),
    });
    expect(res.status).toBe(400);
    // Ni vérification d'appartenance ni insertion : le rejet est purement structurel,
    // avant tout accès base.
    expect(storageMock.getProject).not.toHaveBeenCalled();
    expect(hoisted.inserts).toHaveLength(0);
  });

  it("vérifie l'appartenance des DEUX projets : si le second n'appartient pas à l'utilisateur, 404 et aucune insertion", async () => {
    storageMock.getProject.mockImplementation(async (id: number) => {
      if (id === 1) return { id: 1, userId: "user-1", name: "JMD" };
      return undefined; // le projet 2 n'appartient pas à l'utilisateur (ou n'existe pas)
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 2 }),
    });

    expect(res.status).toBe(404);
    expect(storageMock.getProject).toHaveBeenCalledWith(1, "user-1");
    expect(storageMock.getProject).toHaveBeenCalledWith(2, "user-1");
    expect(hoisted.inserts).toHaveLength(0);
  });

  it("rend 404 (et non 403) pour un projet d'autrui, avec le MÊME corps de réponse que pour un projet inexistant — indiscernables, sinon l'oracle d'énumération est rouvert", async () => {
    // Cas A : le projet de destination n'appartient pas à l'utilisatrice (existe pour quelqu'un d'autre).
    storageMock.getProject.mockImplementation(async (id: number) => {
      if (id === 1) return { id: 1, userId: "user-1", name: "JMD" };
      if (id === 2) return undefined; // appartient à un autre utilisateur
      return undefined;
    });
    const resAutrui = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 2 }),
    });
    const corpsAutrui = await resAutrui.json();

    // Cas B : le projet de destination n'existe pas du tout.
    storageMock.getProject.mockImplementation(async (id: number) => {
      if (id === 1) return { id: 1, userId: "user-1", name: "JMD" };
      if (id === 12345) return undefined; // n'existe pas
      return undefined;
    });
    const resInexistant = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 12345 }),
    });
    const corpsInexistant = await resInexistant.json();

    expect(resAutrui.status).toBe(404);
    expect(resInexistant.status).toBe(404);
    expect(corpsAutrui).toEqual(corpsInexistant);
  });

  it("les deux projets appartenant à l'utilisatrice → le lien est inséré", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    hoisted.resultats = [[lien({ id: 5, fromProjectId: 1, toProjectId: 2, nature: "même fondatrice" })]];

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/1/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 2, nature: "même fondatrice", audiencesRecoupent: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.link.id).toBe(5);
    expect(hoisted.inserts).toHaveLength(1);
    expect(hoisted.inserts[0]).toMatchObject({
      userId: "user-1", fromProjectId: 1, toProjectId: 2,
      nature: "même fondatrice", audiencesRecoupent: true,
    });
  });

  it("un identifiant non numérique rend 400, pas 500", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/abc/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toProjectId: 2 }),
    });
    expect(res.status).toBe(400);
    expect(storageMock.getProject).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/project-links/:id — filtre sur (id, userId)", () => {
  it("le SQL rendu contient les deux colonnes id et user_id", async () => {
    hoisted.resultats = [[lien({ id: 7, nature: "partenariat" })]];

    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/7`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nature: "partenariat" }),
    });
    expect(res.status).toBe(200);

    const [where] = hoisted.wheres.map(enSql);
    expect(where.sql).toContain('"project_links"."id"');
    expect(where.sql).toContain('"project_links"."user_id"');
    expect(where.params).toEqual(expect.arrayContaining([7, "user-1"]));
  });

  it("rend 404 si rien n'est mis à jour (id d'autrui ou inexistant)", async () => {
    hoisted.resultats = [[]];
    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/999`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nature: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("un identifiant non numérique rend 400, pas 500", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/abc`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nature: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/project-links/:id — filtre sur (id, userId), 404 si rien supprimé", () => {
  it("le SQL rendu contient id et user_id", async () => {
    hoisted.resultats = [[{ id: 7 }]];
    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/7`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const [where] = hoisted.wheres.map(enSql);
    expect(where.sql).toContain('"project_links"."id"');
    expect(where.sql).toContain('"project_links"."user_id"');
    expect(where.params).toEqual(expect.arrayContaining([7, "user-1"]));
  });

  it("rend 404 si rien n'est supprimé (id d'autrui ou inexistant)", async () => {
    hoisted.resultats = [[]];
    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/999`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("un identifiant non numérique rend 400, pas 500", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/project-links/abc`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

// ─── Tâche 5 — l'articulation entre dans la génération de campagne ───────────
//
// Deux niveaux de mock, pour deux natures de test différentes :
// - `hoisted.generateCampaignStrategy/Content/Tasks` (mocks) : testent ce que ROUTES.TS
//   construit comme `CampaignGenerationRequest` — présence/absence du champ `articulation`,
//   valeur exacte de `weekContext`. Ces mocks passent par HTTP (comme le reste du fichier).
// - `hoisted.generateCampaignStrategyReel/ContentReel` (vraies implémentations, capturées
//   via importOriginal) : testent ce qu'OPENAI.TS assemble RÉELLEMENT dans le prompt envoyé
//   au modèle (mocké lui, au niveau réseau via `callClaudeDetailed`). Appelées directement,
//   sans passer par HTTP — nécessaire car un `weekContext` pollué par concaténation produirait
//   un prompt texte quasi identique à un `articulation` correctement séparé : seule
//   l'inspection de l'objet `CampaignGenerationRequest` lui-même distingue les deux.

const STRATEGY_STUB: any = {
  name: "Campagne Stub", campaignType: "visibility", coreMessage: "Message stub",
  targetAudience: "Audience", audienceSegment: "Segment", insights: [],
  messagingFramework: { coreMessage: "", proofPoints: [], primaryCTA: "", secondaryCTA: "", toneKeywords: [], thingsToAvoid: [] },
  phases: [], channels: [], kpis: [], prospection: null,
};

describe("POST /api/campaigns/generate/strategy — l'articulation dans la requête de génération", () => {
  beforeEach(() => {
    storageMock.getBrandDna.mockResolvedValue(undefined);
    storageMock.getBrandDnaForProject.mockResolvedValue(undefined);
    storageMock.getCampaigns.mockResolvedValue([]);
    hoisted.generateCampaignStrategy.mockResolvedValue(STRATEGY_STUB);
  });

  it("1. sans articulationCampaignId, la requête de génération ne porte PAS de champ `articulation`", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month" }),
    });

    expect(res.status).toBe(200);
    expect(hoisted.generateCampaignStrategy).toHaveBeenCalledTimes(1);
    const requeteEnvoyee = hoisted.generateCampaignStrategy.mock.calls[0][0];
    // `in` teste la présence de la CLÉ, pas seulement sa valeur : un champ présent
    // avec la valeur `undefined` romprait déjà ce critère (aucun champ ajouté).
    expect("articulation" in requeteEnvoyee).toBe(false);
  });

  it("2. un articulationCampaignId absent des articulations proposables rend 400, et generateCampaignStrategy N'EST PAS appelée", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    hoisted.resultats = [[]]; // aucun lien déclaré pour ce projet → aucune articulation proposable

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, articulationCampaignId: 999 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe("Cette campagne n'est pas articulable avec cette marque");
    // La garantie centrale du chantier : un identifiant hors des articulations proposables
    // ne doit JAMAIS atteindre le générateur — sans ce contrôle, n'importe quel appelant
    // authentifié pourrait faire lire la campagne d'une marque NON liée.
    expect(hoisted.generateCampaignStrategy).not.toHaveBeenCalled();
  });

  it("avec un identifiant valide et proposable, `articulation` est passée au générateur avec la bonne campagne", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    const lienObj = { id: 10, userId: "user-1", fromProjectId: 1, toProjectId: 2, roleAmont: null, roleAval: null, nature: null };
    hoisted.resultats = [
      [lienObj],                                                                    // liens déclarés pour le projet 1
      [{ name: "Marque Liée" }],                                                    // projet lié (id 2)
      [{ id: 42, name: "Campagne Autre", objective: "Obj", coreMessage: "Msg", phases: [] }], // ses campagnes vivantes
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: "Vendre plus", duration: "1_month", projectId: 1, articulationCampaignId: 42 }),
    });

    expect(res.status).toBe(200);
    const requeteEnvoyee = hoisted.generateCampaignStrategy.mock.calls[0][0];
    expect(requeteEnvoyee.articulation.campagne.id).toBe(42);
    expect(requeteEnvoyee.articulation.campagne.marque).toBe("Marque Liée");
  });

  it("5. weekContext reçu du client arrive INCHANGÉ dans la requête de génération — l'articulation ne s'y mélange pas", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    const lienObj = { id: 10, userId: "user-1", fromProjectId: 1, toProjectId: 2, roleAmont: null, roleAval: null, nature: null };
    hoisted.resultats = [
      [lienObj],
      [{ name: "Marque Liée" }],
      [{ id: 42, name: "Campagne Autre", objective: "Obj", coreMessage: "Msg", phases: [] }],
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: "Vendre plus", duration: "1_month", projectId: 1, articulationCampaignId: 42,
        weekContext: "Semaine chargée, focus vente",
      }),
    });

    expect(res.status).toBe(200);
    const requeteEnvoyee = hoisted.generateCampaignStrategy.mock.calls[0][0];
    // La valeur exacte envoyée par le client, sans aucun texte d'articulation mélangé dedans.
    expect(requeteEnvoyee.weekContext).toBe("Semaine chargée, focus vente");
    expect(requeteEnvoyee.weekContext).not.toContain("ARTICULATION");
    expect(requeteEnvoyee.weekContext).not.toContain("Marque Liée");
    // L'articulation, elle, est bien passée — mais dans son PROPRE champ dédié.
    expect(requeteEnvoyee.articulation?.campagne?.marque).toBe("Marque Liée");
  });
});

describe("generateCampaignStrategy / generateCampaignContent — assemblage RÉEL du prompt", () => {
  const articulationTest: Articulation = {
    lien: { roleAmont: "diffuse", roleAval: "capte", nature: "partenariat" },
    sens: "nourrit",
    campagne: {
      id: 42, marque: "Marque Test Liée", name: "Campagne Autre",
      objective: "Objectif de l'autre marque", coreMessage: "Message central de l'autre marque",
      angles: ["angle un"],
    },
  };

  const baseRequest: any = {
    userId: "user-1", projectId: 1, objective: "obj", duration: "1_month",
    brandDna: {},
  };

  beforeEach(() => {
    hoisted.callClaudeDetailed.mockResolvedValue({ text: JSON.stringify(STRATEGY_STUB), stopReason: "end_turn" });
  });

  it("3. avec une articulation, le bloc assemblé contient le nom de la marque liée (generateCampaignStrategy)", async () => {
    await hoisted.generateCampaignStrategyReel({ ...baseRequest, articulation: articulationTest });
    const prompt = hoisted.callClaudeDetailed.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Marque Test Liée");
    expect(prompt).toContain("ARTICULATION AVEC UNE MARQUE LIÉE");
  });

  it("sans articulation, AUCUN bloc n'est ajouté au prompt réel — génération identique à avant ce chantier", async () => {
    await hoisted.generateCampaignStrategyReel(baseRequest);
    const prompt = hoisted.callClaudeDetailed.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("ARTICULATION AVEC UNE MARQUE LIÉE");
  });

  it("4. le prompt assemblé ne contient AUCUN champ d'ADN de la marque liée — critère d'acceptation central", async () => {
    await hoisted.generateCampaignStrategyReel({ ...baseRequest, articulation: articulationTest });
    const prompt = hoisted.callClaudeDetailed.mock.calls[0][0].messages[0].content as string;
    // Aucun de ces champs n'existe sur `Articulation` / `CampagneLiee` — s'ils apparaissaient
    // dans le prompt, ce serait la preuve d'une fuite d'ADN de la marque liée. Garde-fou
    // structurel : ce test casse si `Articulation` est un jour étendu avec un champ d'ADN.
    for (const champDna of ["uniquePositioning", "brandVoiceKeywords", "editorialTerritory", "revenueTarget", "corePainPoint", "communicationStyle"]) {
      expect(prompt).not.toContain(champDna);
    }
  });

  it("le même bloc s'assemble dans generateCampaignContent", async () => {
    hoisted.callClaudeDetailed.mockResolvedValue({ text: JSON.stringify({ contentPlan: [] }), stopReason: "end_turn" });
    await hoisted.generateCampaignContentReel({ ...baseRequest, articulation: articulationTest }, STRATEGY_STUB);
    const prompt = hoisted.callClaudeDetailed.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Marque Test Liée");
  });
});

describe("POST /api/campaigns/generate/tasks — persistance du choix d'articulation à la création de la campagne", () => {
  beforeEach(() => {
    storageMock.getBrandDna.mockResolvedValue(undefined);
    storageMock.getBrandDnaForProject.mockResolvedValue(undefined);
    hoisted.generateCampaignTasks.mockResolvedValue([]);
  });

  it("persiste articuleAvecCampaignId à l'id de la campagne liée quand une articulation valide a été choisie", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    const lienObj = { id: 10, userId: "user-1", fromProjectId: 1, toProjectId: 2, roleAmont: null, roleAval: null, nature: null };
    hoisted.resultats = [
      [lienObj],
      [{ name: "Marque Liée" }],
      [{ id: 42, name: "Campagne Autre", objective: "Obj", coreMessage: "Msg", phases: [] }],
    ];
    storageMock.createCampaign.mockResolvedValue({ id: 1, name: "Campagne créée" });

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: "Vendre plus", duration: "1_month", projectId: 1, articulationCampaignId: 42,
        strategy: STRATEGY_STUB,
      }),
    });

    expect(res.status).toBe(200);
    expect(storageMock.createCampaign).toHaveBeenCalledTimes(1);
    const valeursInserees = storageMock.createCampaign.mock.calls[0][0];
    expect(valeursInserees.articuleAvecCampaignId).toBe(42);
    expect(valeursInserees.articulationIndependante).toBe(false);
  });

  it("articulationIndependante n'est vrai QUE si le client l'a explicitement demandé — ni champ ni booléen ne se devinent", async () => {
    storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
    storageMock.createCampaign.mockResolvedValue({ id: 2, name: "Campagne isolée" });

    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/generate/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: "Vendre plus", duration: "1_month", projectId: 1,
        articulationIndependante: true, strategy: STRATEGY_STUB,
      }),
    });

    expect(res.status).toBe(200);
    const valeursInserees = storageMock.createCampaign.mock.calls[0][0];
    expect(valeursInserees.articuleAvecCampaignId).toBeNull();
    expect(valeursInserees.articulationIndependante).toBe(true);
  });
});
