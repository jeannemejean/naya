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

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  sets: [] as any[],
  inserts: [] as any[],
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
