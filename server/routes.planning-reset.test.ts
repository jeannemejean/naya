// Test d'intégration : POST /api/planning/reset.
//
// Deux défauts rapportés par Jeanne le 24 septembre 2026, après avoir lancé une
// replanification pour utiliser Naya en conditions réelles.
//
// 1. La question de Naya (« On repart de zéro. Avant de replanifier, dis-moi… ») s'est
//    affichée DANS LE CHAMP DE SAISIE, à la place de son propre texte. Le client faisait
//    `setInput(detail.message)` : il traitait une parole de Naya comme un brouillon à
//    envoyer. Elle passe désormais par les messages en attente, côté serveur — le même
//    chemin que les autres paroles de Naya.
//
// 2. La carte « Naya a remarqué » affichait encore 10 tâches récurrentes APRÈS la remise à
//    zéro. Le serveur n'y était pour rien — vérifié en production, il renvoie zéro. C'était
//    le cache client, que la remise à zéro n'invalidait pas.
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
  archiveIncompleteFutureTasks: vi.fn(),
  upsertUserPreferences: vi.fn(),
  createPendingMessage: vi.fn(),
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

async function reset(port: number, body: unknown) {
  return fetch(`http://127.0.0.1:${port}/api/planning/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planning/reset", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.archiveIncompleteFutureTasks.mockResolvedValue(12);
    storageMock.upsertUserPreferences.mockResolvedValue({});
    storageMock.createPendingMessage.mockResolvedValue({ id: 1 });
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("archive les tâches futures et enregistre la date de départ", async () => {
    const res = await reset(port, { fromDate: "2026-09-24" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ archived: 12, fromDate: "2026-09-24" });
    expect(storageMock.archiveIncompleteFutureTasks).toHaveBeenCalledWith("user-1", "2026-09-24");
  });

  it("dépose la question de Naya comme MESSAGE EN ATTENTE, pas comme brouillon", async () => {
    // LE test du premier défaut. La question doit exister côté serveur, sur le chemin des
    // paroles de Naya. Tant qu'elle n'était qu'un `detail.message` envoyé au client, elle
    // finissait dans le champ de saisie — et disparaissait au moindre rechargement.
    await reset(port, { fromDate: "2026-09-24" });

    expect(storageMock.createPendingMessage).toHaveBeenCalledTimes(1);
    const [arg] = storageMock.createPendingMessage.mock.calls[0];
    expect(arg.userId).toBe("user-1");
    expect(arg.message).toMatch(/objectifs|projets/i);
    expect(arg.triggerType).toBe("planning_reset");
  });

  it("une date invalide ne déclenche NI archivage NI message", async () => {
    for (const mauvais of [{}, { fromDate: "24-09-2026" }, { fromDate: "" }, { fromDate: 42 }]) {
      vi.clearAllMocks();
      const res = await reset(port, mauvais);

      expect(res.status, JSON.stringify(mauvais)).toBe(400);
      expect(storageMock.archiveIncompleteFutureTasks).not.toHaveBeenCalled();
      expect(storageMock.createPendingMessage).not.toHaveBeenCalled();
    }
  });

  it("un message en attente qui échoue ne fait PAS échouer la remise à zéro", async () => {
    // Les tâches sont déjà archivées quand le message est déposé. Faire échouer la requête
    // ici laisserait Jeanne croire que rien n'a été fait, alors que tout l'a été — et un
    // second clic archiverait une seconde fois.
    storageMock.createPendingMessage.mockRejectedValue(new Error("base indisponible"));

    const res = await reset(port, { fromDate: "2026-09-24" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ archived: 12 });
  });

  it("l'ordre est respecté : on archive AVANT de proposer d'en parler", async () => {
    // Bug visé : déposer la question puis échouer à archiver. Jeanne verrait Naya parler
    // d'une remise à zéro qui n'a pas eu lieu.
    const ordre: string[] = [];
    storageMock.archiveIncompleteFutureTasks.mockImplementation(async () => {
      ordre.push("archive");
      return 12;
    });
    storageMock.createPendingMessage.mockImplementation(async () => {
      ordre.push("message");
      return { id: 1 };
    });

    await reset(port, { fromDate: "2026-09-24" });

    expect(ordre).toEqual(["archive", "message"]);
  });
});
