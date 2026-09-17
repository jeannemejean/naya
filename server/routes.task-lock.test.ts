// Test d'intégration : on ne coche pas une tâche dont l'étape précédente ne l'est pas.
//
// Pourquoi au niveau HTTP. `task-lock.ts` est couvert par 10 tests, mais ils prouvent que la
// FONCTION dit « verrouillée » — pas que les routes l'appellent. Retirer la garde de
// `routes.ts` ne ferait tomber aucun de ces 10 tests. Et il y a DEUX portes, `/complete` et
// `/toggle` : oublier l'une des deux laisserait le verrou entièrement contournable.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
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
  getTaskDependencies: vi.fn(),
  getTask: vi.fn(),
  completeTask: vi.fn(),
  toggleTaskCompletion: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));

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

const PUBLIER = 344; // « Publier le brouillon LinkedIn »
const REDIGER = 422; // « Rédiger le post LinkedIn »

describe("le verrou de séquence tient sur les DEUX portes", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.completeTask.mockResolvedValue({ id: PUBLIER, completed: true });
    storageMock.toggleTaskCompletion.mockResolvedValue({ id: PUBLIER, completed: true });
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  /** « Publier » dépend de « Rédiger », qui n'est pas cochée. */
  function chaineBloquee() {
    storageMock.getTaskDependencies.mockResolvedValue([{ dependsOnTaskId: REDIGER }]);
    storageMock.getTask.mockImplementation(async (id: number) =>
      id === REDIGER
        ? { id: REDIGER, title: "Rédiger le post LinkedIn", completed: false }
        : { id: PUBLIER, title: "Publier le brouillon", completed: false },
    );
  }

  it("/complete refuse une tâche verrouillée et NE LA COCHE PAS", async () => {
    chaineBloquee();

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/complete`, {
      method: "POST",
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toBe("task_locked");
    expect(body.bloqueePar).toEqual([{ id: REDIGER, titre: "Rédiger le post LinkedIn" }]);
    expect(storageMock.completeTask).not.toHaveBeenCalled();
  });

  it("/toggle refuse aussi — la seconde porte n'est pas oubliée", async () => {
    chaineBloquee();

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/toggle`, {
      method: "POST",
    });

    expect(res.status).toBe(409);
    expect(storageMock.toggleTaskCompletion).not.toHaveBeenCalled();
  });

  it("DÉCOCHER reste toujours possible, même sur une tâche verrouillée", async () => {
    // Sans cette exception, une coche donnée par erreur deviendrait définitive — et
    // débloquerait une suite que l'utilisatrice n'a pas faite.
    storageMock.getTaskDependencies.mockResolvedValue([{ dependsOnTaskId: REDIGER }]);
    storageMock.getTask.mockImplementation(async (id: number) =>
      id === REDIGER
        ? { id: REDIGER, title: "Rédiger", completed: false }
        : { id: PUBLIER, title: "Publier", completed: true }, // déjà cochée
    );
    storageMock.toggleTaskCompletion.mockResolvedValue({ id: PUBLIER, completed: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/toggle`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(storageMock.toggleTaskCompletion).toHaveBeenCalled();
  });

  it("une fois le prérequis coché, la tâche se coche", async () => {
    storageMock.getTaskDependencies.mockResolvedValue([{ dependsOnTaskId: REDIGER }]);
    storageMock.getTask.mockImplementation(async (id: number) =>
      id === REDIGER
        ? { id: REDIGER, title: "Rédiger", completed: true }
        : { id: PUBLIER, title: "Publier", completed: false },
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/complete`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(storageMock.completeTask).toHaveBeenCalledWith(PUBLIER);
  });

  it("une tâche sans dépendance n'est jamais verrouillée", async () => {
    // Le cas des 58 tâches actuelles : task_dependencies est vide.
    storageMock.getTaskDependencies.mockResolvedValue([]);
    storageMock.getTask.mockResolvedValue({ id: PUBLIER, title: "Publier", completed: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/complete`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
  });

  it("une lecture de dépendances en échec ne verrouille pas", async () => {
    // On ne bloque pas le travail de quelqu'un parce qu'une requête a raté. Le verrou est une
    // aide à la séquence, pas un péage.
    storageMock.getTaskDependencies.mockRejectedValue(new Error("base indisponible"));
    storageMock.getTask.mockResolvedValue({ id: PUBLIER, title: "Publier", completed: false });

    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${PUBLIER}/complete`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
  });
});
