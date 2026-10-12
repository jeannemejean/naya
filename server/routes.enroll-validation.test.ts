// Test d'intégration : POST /api/leads/:id/enroll ne doit JAMAIS enrôler un prospect que
// l'utilisatrice n'a pas explicitement validé.
//
// Pourquoi au niveau HTTP et pas seulement sur le module. `prospection-validation.ts` est
// couvert par 19 tests, mais ils prouvent que la FONCTION dit non — pas que la route
// l'appelle. Retirer la garde de `routes.ts` ne ferait tomber aucun de ces 19 tests. Ce
// fichier ferme cet écart : il teste la porte, pas la serrure posée à côté.
//
// `./db`, `./storage` et `./auth` sont mockés pour ne JAMAIS toucher la vraie base
// (DATABASE_URL pointe vers une base réelle — consigne projet).
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
  getLeads: vi.fn(),
  enrollLead: vi.fn(),
  updateLead: vi.fn(),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const aRevoir = vi.hoisted(() => ({ liste: [] as any[] }));
vi.mock("./services/prospection/edition-lead", () => ({
  tracerEditionMessages: vi.fn(async () => {}),
  tracerValidation: vi.fn(async () => {}),
  messagesARevoir: vi.fn(async () => aRevoir.liste),
  accepterMessagesARevoir: vi.fn(async () => aRevoir.liste.length),
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

const LEAD_ID = 101;
const CAMPAGNE = 5;

function prospect(overrides: Record<string, unknown>) {
  return {
    id: LEAD_ID,
    userId: "user-1",
    prospectionCampaignId: CAMPAGNE,
    stage: "messages_ready",
    validatedAt: null,
    ...overrides,
  };
}

async function enroler(port: number) {
  return fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId: CAMPAGNE }),
  });
}

describe("POST /api/leads/:id/enroll — la validation humaine est exigée", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.enrollLead.mockResolvedValue({ leadId: LEAD_ID, status: "active" });
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("refuse un prospect NON validé, et n'enrôle pas", async () => {
    // Le cas des 41 prospects qui attendent aujourd'hui en production : message rédigé,
    // personne ne l'a encore approuvé.
    storageMock.getLeads.mockResolvedValue([prospect({ validatedAt: null })]);

    const res = await enroler(port);

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("not_validated");
    // LE point : la garde ne se contente pas de répondre une erreur, elle empêche l'action.
    expect(storageMock.enrollLead).not.toHaveBeenCalled();
  });

  it("accepte un prospect validé", async () => {
    storageMock.getLeads.mockResolvedValue([
      prospect({ validatedAt: new Date("2026-09-17T08:00:00Z") }),
    ]);

    const res = await enroler(port);

    expect(res.status).toBe(200);
    expect(storageMock.enrollLead).toHaveBeenCalledWith(LEAD_ID, CAMPAGNE, "user-1");
  });

  it("refuse une validation portée par une date INVALIDE", async () => {
    // `new Date("n'importe quoi")` est un objet Date réel dont le temps vaut NaN. Une garde
    // qui testerait seulement la présence le prendrait pour une validation.
    storageMock.getLeads.mockResolvedValue([prospect({ validatedAt: new Date("pas une date") })]);

    const res = await enroler(port);

    expect(res.status).toBe(409);
    expect(storageMock.enrollLead).not.toHaveBeenCalled();
  });

  it("refuse un prospect validé mais qui n'est plus à l'étape des messages prêts", async () => {
    // Une validation ancienne ne doit pas autoriser un contact sur un prospect qui a depuis
    // change d'etape.
    storageMock.getLeads.mockResolvedValue([
      prospect({ stage: "identified", validatedAt: new Date("2026-09-17T08:00:00Z") }),
    ]);

    const res = await enroler(port);

    expect(res.status).toBe(409);
    expect(storageMock.enrollLead).not.toHaveBeenCalled();
  });

  it("un prospect inexistant reste un 404, pas un 409", async () => {
    // Bug visé : une garde placée avant la vérification d'existence transformerait
    // « ce prospect n'existe pas » en « ce prospect n'est pas validé ».
    storageMock.getLeads.mockResolvedValue([]);

    const res = await enroler(port);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/leads/:id/validate", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("messages encore à revoir : 409 avec les raisons, rien n'est validé", async () => {
    aRevoir.liste = [{ stepId: 11, canal: "linkedin", defauts: [{ code: "tic", raison: "Formule d'IA" }] }];
    (storageMock as any).getLead = vi.fn(async () => prospect({}));
    const res = await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("messages_a_revoir");
    expect(storageMock.updateLead).not.toHaveBeenCalled();
    aRevoir.liste = [];
  });

  it("« valider quand même » accepte les messages à revoir puis valide", async () => {
    aRevoir.liste = [{ stepId: 11, canal: "linkedin", defauts: [] }];
    (storageMock as any).getLead = vi.fn(async () => prospect({}));
    storageMock.updateLead.mockResolvedValue(prospect({ validatedAt: new Date() }));
    const res = await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forcer: true }),
    });
    expect(res.status).toBe(200);
    expect(storageMock.updateLead).toHaveBeenCalled();
    aRevoir.liste = [];
  });

  it("inscrit un INSTANT, pas un booléen", async () => {
    storageMock.updateLead.mockResolvedValue(prospect({ validatedAt: new Date() }));

    const res = await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const [, , updates] = storageMock.updateLead.mock.calls[0];
    expect(updates.validatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(updates.validatedAt.getTime())).toBe(false);
  });

  it("dévalider remet à null, pas à une date passée", async () => {
    // Un accord donné par erreur doit pouvoir être retiré tant que rien n'est parti. Écrire
    // une date ancienne au lieu de null laisserait le prospect « validé », donc contactable.
    storageMock.updateLead.mockResolvedValue(prospect({ validatedAt: null }));

    await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/unvalidate`, { method: "POST" });

    const [, , updates] = storageMock.updateLead.mock.calls[0];
    expect(updates.validatedAt).toBeNull();
  });

  it("un prospect inexistant renvoie 404", async () => {
    storageMock.updateLead.mockResolvedValue(null);

    const res = await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
