// Test d'intégration : POST /api/task-prompts/:taskId/answer ne doit JAMAIS faire
// échouer la réponse de l'utilisatrice à cause de l'écriture en mémoire
// (`rememberObservations`). La réponse HTTP doit rester 200 avec la réponse
// enregistrée même quand `rememberObservations` rejette.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL de .env pointe vers une base réelle — voir consignes projet : ne
// jamais exécuter de requête réelle depuis un test). Seul `rememberObservations` est
// le point qu'on observe : c'est lui qu'on fait rejeter pour vérifier le garde-fou.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const hoisted = vi.hoisted(() => ({
  selectResults: [] as any[][],
}));

vi.mock("./db", () => ({
  db: {
    select: vi.fn(() => {
      const result = hoisted.selectResults.shift() ?? [];
      return {
        from: () => ({
          where: () => Promise.resolve(result),
        }),
      };
    }),
  },
  pool: { query: vi.fn(), on: vi.fn() },
}));

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
  getTask: vi.fn(),
  answerTaskPrompt: vi.fn(),
  updateTask: vi.fn(),
  getRecentTaskPrompts: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

const rememberObservationsMock = vi.fn();
vi.mock("./services/result-capture/observation-writer", () => ({
  rememberObservations: rememberObservationsMock,
}));

const { registerRoutes } = await import("./routes");

async function startServer() {
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port };
}

const TASK_ID = 42;
const PROMPT_ID = 7;
const SCHEDULED_FOR = new Date("2026-09-16T09:00:00.000Z");

describe("POST /api/task-prompts/:taskId/answer — la mémoire ne doit jamais faire échouer la réponse", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.selectResults = [];

    storageMock.getTask.mockResolvedValue({ id: TASK_ID, userId: "user-1", completedAt: null });
    storageMock.answerTaskPrompt.mockResolvedValue({ id: PROMPT_ID });
    storageMock.updateTask.mockResolvedValue({ id: TASK_ID });
    // Fenêtre de réponses récentes réutilisée par la route pour l'insight ET pour la
    // mémoire — aucune n'est ignorée (toutes répondues), donc `buildRecentAnsweredTaskAnswers`
    // ne relit rien d'autre que cette liste.
    storageMock.getRecentTaskPrompts.mockResolvedValue([]);

    // 1er select : la recherche du `task_prompts` correspondant à (taskId, userId, scheduledFor).
    hoisted.selectResults = [[{ id: PROMPT_ID, taskId: TASK_ID, userId: "user-1", scheduledFor: SCHEDULED_FOR }]];

    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("renvoie 200 avec la réponse enregistrée même quand rememberObservations rejette", async () => {
    rememberObservationsMock.mockRejectedValue(new Error("service d'embedding indisponible"));

    const res = await fetch(`http://127.0.0.1:${port}/api/task-prompts/${TASK_ID}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "done", scheduledFor: SCHEDULED_FOR.toISOString() }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("insight");

    // La réponse de l'utilisatrice reste enregistrée quoi qu'il arrive — c'est l'invariant.
    expect(storageMock.answerTaskPrompt).toHaveBeenCalledTimes(1);
    expect(storageMock.answerTaskPrompt).toHaveBeenCalledWith(PROMPT_ID, "user-1", "done", expect.any(Date));
    expect(storageMock.updateTask).toHaveBeenCalledTimes(1);

    // Laisse le temps au `.catch()` (attaché de façon synchrone) de s'exécuter avant la
    // fin du test, pour ne jamais laisser une rejection non gérée fuiter vers un autre test.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rememberObservationsMock).toHaveBeenCalledTimes(1);
    expect(rememberObservationsMock).toHaveBeenCalledWith("user-1", []);
  });
});
