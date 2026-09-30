// Tests d'intégration des endpoints de la revue du matin.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL de .env pointe vers une base réelle — consigne projet : aucun test
// n'exécute de requête réelle). Le mock de `db` capture les clauses `where` et les
// `set` qu'on lui passe : on les rend en SQL avec le dialecte Postgres de drizzle,
// hors connexion, ce qui permet d'affirmer ce que les requêtes bornent RÉELLEMENT —
// le défaut B1 était précisément une borne de date absente d'une branche du `or()`.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  sets: [] as any[],
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
  getBrandDna: vi.fn(),
  getSavedArticles: vi.fn(),
  createSavedArticle: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const extractToMemoryMock = vi.fn();
vi.mock("./services/memory/extract", () => ({ extractToMemory: extractToMemoryMock }));

const { registerRoutes } = await import("./routes");
const { statutApresReponse } = await import("./services/reading/statut");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

let server: http.Server;
let port = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  hoisted.resultats = [];
  hoisted.wheres = [];
  hoisted.sets = [];
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

const fiche = (over: Record<string, unknown> = {}) => ({
  id: 1, userId: "user-1", projectId: 7, url: "https://media.fr/a", urlHash: "h",
  title: "Un titre", question: "Et toi ?", status: "proposed", userAnswer: null, ...over,
});

describe("GET /api/reading/today — deux listes distinctes (B1)", () => {
  it("rend les fiches du jour et les gardées séparément, jamais un seul tableau mêlé", async () => {
    hoisted.resultats = [
      [fiche({ id: 1 })],                              // 1re requête : les fiches du jour
      [fiche({ id: 2, status: "kept" }), fiche({ id: 3, status: "kept" })], // 2e : les gardées
    ];

    const res = await fetch(`http://127.0.0.1:${port}/api/reading/today`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.duJour.map((c: any) => c.id)).toEqual([1]);
    expect(body.gardees.map((c: any) => c.id)).toEqual([2, 3]);
    // La clé `cards` a disparu : c'est elle que le dashboard comptait, et c'est ce
    // comptage mêlé qui fabriquait un compteur de dette permanent.
    expect(body.cards).toBeUndefined();
  });

  it("la requête du jour est bornée à minuit UTC, celle des gardées ne l'est pas", async () => {
    hoisted.resultats = [[], []];
    await fetch(`http://127.0.0.1:${port}/api/reading/today`);

    const [duJour, gardees] = hoisted.wheres.map(enSql);

    // Les fiches du jour : statuts du jour ET borne de date. Sans la borne, « Ce matin »
    // remonterait des fiches de la semaine dernière.
    expect(duJour.sql).toContain('"reading_cards"."created_at" >=');
    expect(duJour.sql).toContain('"reading_cards"."status" in');
    expect(duJour.params).toEqual(expect.arrayContaining(["proposed", "answered"]));

    // Les gardées : aucune borne de date — c'est leur raison d'être — mais elles sont
    // désormais dans une liste à part, donc plus jamais comptées comme « ce matin ».
    expect(gardees.sql).not.toContain("created_at");
    expect(gardees.params).toEqual(expect.arrayContaining(["kept"]));
  });
});

describe("POST /api/reading/cards/:id/answer — une fiche gardée reste gardée (B3)", () => {
  it("le statut écrit est une expression conditionnelle, jamais la chaîne 'answered'", async () => {
    hoisted.resultats = [[fiche({ status: "kept", userAnswer: "mon avis" })]];

    const res = await fetch(`http://127.0.0.1:${port}/api/reading/cards/1/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "mon avis" }),
    });
    expect(res.status).toBe(200);

    const [set] = hoisted.sets;
    // Le défaut fermé ici : `status: 'answered'` en dur faisait retomber une fiche
    // délibérément gardée dans le lot du jour, donc hors de l'écran au minuit suivant.
    expect(set.status).not.toBe("answered");
    expect(set.status).toBe(statutApresReponse);
    // L'avis et sa date sont enregistrés dans les deux cas — c'est tout l'intérêt.
    expect(set.userAnswer).toBe("mon avis");
    expect(set.answeredAt).toBeInstanceOf(Date);
  });

  it("l'expression rend 'kept' pour une fiche gardée et 'answered' pour les autres", () => {
    const { sql: texte } = enSql(statutApresReponse);
    // Lu et écrit dans le MÊME update : un « Garder » simultané ne peut pas être écrasé.
    expect(texte).toBe(`CASE WHEN "reading_cards"."status" = 'kept' THEN 'kept' ELSE 'answered' END`);
  });
});
