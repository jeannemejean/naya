// Tests d'intégration du plafond de GET /api/content — avant ce chantier,
// `getContent` rendait 50 lignes au maximum (les plus récemment créées) sans que
// rien ne le dise à l'appelante : coller un lot de posts dans une marque qui en
// compte déjà 40 faisait disparaître de la vue des posts anciens, dont certains
// programmés pour les semaines à venir. Le plafond serveur est maintenant explicite
// (200) et refusé — pas recadré en silence — au-delà.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL pointe vers une base Neon réelle — consigne projet : aucun test
// n'exécute de requête réelle). Motif repris de server/routes.reading.test.ts.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

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
  getContent: vi.fn(),
  getContentByStatus: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const extractToMemoryMock = vi.fn();
vi.mock("./services/memory/extract", () => ({ extractToMemory: extractToMemoryMock }));

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  extractToMemoryMock.mockResolvedValue(undefined);
  storageMock.getContent.mockResolvedValue([]);
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

const poste = (n: number) => ({ id: n, title: `Post ${n}` });

describe("GET /api/content — le plafond de chargement s'annonce (tâche 5)", () => {
  it("1. ?limit=200 transmet 200 à storage.getContent et rend jusqu'à 200 lignes", async () => {
    storageMock.getContent.mockResolvedValue(Array.from({ length: 200 }, (_, i) => poste(i)));

    const res = await fetch(`http://127.0.0.1:${port}/api/content?limit=200`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(200);
    expect(storageMock.getContent).toHaveBeenCalledWith("user-1", 200, undefined, undefined);
  });

  it("2a. limit non numérique → 400, storage.getContent jamais appelée", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/content?limit=abc`);
    expect(res.status).toBe(400);
    expect(storageMock.getContent).not.toHaveBeenCalled();
  });

  it("2b. limit nul (0) → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/content?limit=0`);
    expect(res.status).toBe(400);
    expect(storageMock.getContent).not.toHaveBeenCalled();
  });

  it("2c. limit négatif → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/content?limit=-5`);
    expect(res.status).toBe(400);
    expect(storageMock.getContent).not.toHaveBeenCalled();
  });

  it("2d. limit au-delà du plafond accepté (201) → 400, pas recadré en silence à 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/content?limit=201`);
    expect(res.status).toBe(400);
    expect(storageMock.getContent).not.toHaveBeenCalled();
  });

  it("sans limit, le défaut (50) est inchangé", async () => {
    await fetch(`http://127.0.0.1:${port}/api/content`);
    expect(storageMock.getContent).toHaveBeenCalledWith("user-1", 50, undefined, undefined);
  });
});
