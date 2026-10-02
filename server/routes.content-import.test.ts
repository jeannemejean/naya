// Tests d'intégration de POST /api/content/import — l'endpoint qui expose le
// découpage de texte collé (tâches 1-3) en posts du calendrier éditorial.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL pointe vers une base Neon réelle — consigne projet : aucun test
// n'exécute de requête réelle). `./services/content-import/import` et
// `./services/brand-links/collision` sont mockés comme des boîtes noires : ce
// qu'on teste ici n'est pas leur fonctionnement interne (déjà testé dans leurs
// propres fichiers), c'est ce que routes.ts fait de leur résultat — y compris
// quand ils lèvent.
//
// Motif repris de server/routes.brand-links.test.ts et server/routes.reading.test.ts.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const hoisted = vi.hoisted(() => ({
  importerTexte: vi.fn(),
  detecterCollisionLot: vi.fn(),
  detecterCollision: vi.fn(),
  isAiBlocked: vi.fn(),
}));

vi.mock("./db", () => {
  const chaine = (): any => {
    const suite: any = { then: (ok: any, ko: any) => Promise.resolve([]).then(ok, ko) };
    const methodes = ["from", "where", "orderBy", "limit", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate", "set", "innerJoin", "leftJoin", "groupBy"];
    for (const m of methodes) suite[m] = (..._args: any[]) => suite;
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

vi.mock("./services/usage", () => ({ isAiBlocked: hoisted.isAiBlocked }));

vi.mock("./services/content-import/import", () => ({
  importerTexte: hoisted.importerTexte,
  // Vraie classe (pas un mock) : routes.ts fait `error instanceof ReponseIllisible`,
  // qui doit fonctionner avec l'instance que le test lève plus bas.
  ReponseIllisible: class ReponseIllisible extends Error {
    constructor() { super("le modèle n'a pas rendu de tableau de posts lisible"); }
  },
}));

vi.mock("./services/brand-links/collision", () => ({
  detecterCollisionLot: hoisted.detecterCollisionLot,
  detecterCollision: hoisted.detecterCollision,
}));

const extractToMemoryMock = vi.fn();
vi.mock("./services/memory/extract", () => ({ extractToMemory: extractToMemoryMock }));

const { registerRoutes } = await import("./routes");
const { ReponseIllisible } = await import("./services/content-import/import");

let server: http.Server;
let port = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  extractToMemoryMock.mockResolvedValue(undefined);
  hoisted.isAiBlocked.mockResolvedValue(false);
  storageMock.getProject.mockResolvedValue({ id: 1, userId: "user-1", name: "JMD" });
  hoisted.detecterCollisionLot.mockResolvedValue([]);
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

const poster = (body: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/content/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const resultatNominal = (over: Record<string, unknown> = {}) => ({
  // `title` et `body` DÉLIBÉRÉMENT distincts : un test plus bas prouve que c'est le
  // corps, pas le titre, qui est transmis à `detecterCollisionLot` comme `corps`.
  posts: [{ id: 10, title: "Un titre", body: "Un corps bien différent du titre.", scheduledFor: new Date("2026-10-10") }],
  ignores: 1,
  couverture: 0.5,
  tronque: false,
  ...over,
});

describe("POST /api/content/import", () => {
  it("1. un projectId qui n'appartient pas à l'utilisatrice → 404, jamais 403", async () => {
    storageMock.getProject.mockResolvedValue(undefined);

    const res = await poster({ projectId: 999, text: "Un texte à découper." });

    expect(res.status).toBe(404);
    expect(hoisted.importerTexte).not.toHaveBeenCalled();
  });

  it("un projectId non numérique → 400, sans toucher la base", async () => {
    const res = await poster({ projectId: "abc", text: "Un texte à découper." });

    expect(res.status).toBe(400);
    expect(storageMock.getProject).not.toHaveBeenCalled();
  });

  it("2. un texte vide → 400", async () => {
    const res = await poster({ projectId: 1, text: "" });

    expect(res.status).toBe(400);
    expect(hoisted.importerTexte).not.toHaveBeenCalled();
  });

  it("3. un texte de MAX_CARACTERES + 1 → 400, et le message nomme la limite ET la longueur reçue", async () => {
    const { MAX_CARACTERES } = await import("./services/content-import/parse");
    const texteTropLong = "a".repeat(MAX_CARACTERES + 1);

    const res = await poster({ projectId: 1, text: texteTropLong });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toContain(String(MAX_CARACTERES));
    expect(body.message).toContain(String(MAX_CARACTERES + 1));
    expect(hoisted.importerTexte).not.toHaveBeenCalled();
  });

  it("4. isAiBlocked vrai → 429, et importerTexte n'est jamais appelée", async () => {
    hoisted.isAiBlocked.mockResolvedValue(true);

    const res = await poster({ projectId: 1, text: "Un texte à découper." });

    expect(res.status).toBe(429);
    expect(hoisted.importerTexte).not.toHaveBeenCalled();
  });

  it("5. cas nominal → 200, et couverture est un entier entre 0 et 100", async () => {
    hoisted.importerTexte.mockResolvedValue(resultatNominal());

    const res = await poster({ projectId: 1, text: "Un texte à découper." });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Number.isInteger(body.couverture)).toBe(true);
    expect(body.couverture).toBeGreaterThanOrEqual(0);
    expect(body.couverture).toBeLessThanOrEqual(100);
    expect(body.couverture).toBe(50);
    expect(body.posts).toHaveLength(1);
    expect(body.ignores).toBe(1);
    expect(body.tronque).toBe(false);
    expect(body.collisions).toEqual([]);
  });

  it("6. une couverture brute de 1,4 est rendue comme 100, jamais 140", async () => {
    hoisted.importerTexte.mockResolvedValue(resultatNominal({ couverture: 1.4 }));

    const res = await poster({ projectId: 1, text: "Un texte à découper." });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.couverture).toBe(100);
  });

  it("7. detecterCollisionLot qui lève → la réponse reste 200 avec collisions: [] (une écriture réussie ne se présente jamais comme un échec)", async () => {
    hoisted.importerTexte.mockResolvedValue(resultatNominal());
    hoisted.detecterCollisionLot.mockRejectedValue(new Error("panne du modèle"));

    const res = await poster({ projectId: 1, text: "Un texte à découper." });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.collisions).toEqual([]);
    // Les posts déjà écrits sont bien rendus malgré l'échec de la détection.
    expect(body.posts).toHaveLength(1);
  });

  it("la détection de collision du lot reçoit le CORPS du post, pas son titre — l'angle vit dans le corps (régression : le titre y était recopié faute de mieux)", async () => {
    hoisted.importerTexte.mockResolvedValue(resultatNominal());

    await poster({ projectId: 1, text: "Un texte à découper." });

    expect(hoisted.detecterCollisionLot).toHaveBeenCalledTimes(1);
    const appel = hoisted.detecterCollisionLot.mock.calls[0][0];
    expect(appel.posts).toHaveLength(1);
    expect(appel.posts[0].corps).toBe("Un corps bien différent du titre.");
    expect(appel.posts[0].corps).not.toBe("Un titre");
  });

  it("8. importerTexte qui lève une ReponseIllisible → 502, et aucun post rendu", async () => {
    hoisted.importerTexte.mockRejectedValue(new ReponseIllisible());

    const res = await poster({ projectId: 1, text: "Un texte à découper." });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.posts).toBeUndefined();
    expect(hoisted.detecterCollisionLot).not.toHaveBeenCalled();
  });
});
