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
  isLeadUnsubscribed: vi.fn(),
  getLeadSequenceState: vi.fn(),
  updateLeadSequenceState: vi.fn(),
  setLeadSequenceGuard: vi.fn(),
  getLead: vi.fn(),
  getLatestOutreachByLead: vi.fn(),
  updateOutreachMessage: vi.fn(),
  colleguesEnSequence: vi.fn(),
  suspendreSequence: vi.fn(),
  markFeedbackReplied: vi.fn(),
  getProspectionCampaign: vi.fn(),
  bulkMoveLeads: vi.fn(),
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
const { RAISON_VALIDATION_MANQUANTE } = await import("./services/prospection-validation");
const { RAISON_PROSPECT_DEPLACE } = await import("./services/prospection-enrolement");

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
    storageMock.isLeadUnsubscribed.mockResolvedValue(false);
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

  it("refuse un prospect TEST (mode test), même validé : jamais de séquence", async () => {
    storageMock.getLeads.mockResolvedValue([
      prospect({ validatedAt: new Date("2026-09-17T08:00:00Z"), tags: ["naya_test"] }),
    ]);

    const res = await enroler(port);

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("lead_test");
    expect(storageMock.enrollLead).not.toHaveBeenCalled();
  });

  it("refuse un prospect validé mais désinscrit, et n'enrôle pas", async () => {
    storageMock.getLeads.mockResolvedValue([
      prospect({ validatedAt: new Date("2026-09-17T08:00:00Z") }),
    ]);
    storageMock.isLeadUnsubscribed.mockResolvedValue(true);

    const res = await enroler(port);

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("unsubscribed");
    expect(storageMock.enrollLead).not.toHaveBeenCalled();
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

  it("reprend un prospect déjà contacté dont la séquence est en pause", async () => {
    storageMock.getLeads.mockResolvedValue([prospect({ stage: "connection_sent", validatedAt: new Date("2026-10-01") })]);
    storageMock.getLeadSequenceState.mockResolvedValue({ userId: "user-1", status: "paused" });
    storageMock.isLeadUnsubscribed.mockResolvedValue(false);
    storageMock.enrollLead.mockResolvedValue({ id: 1 });

    const res = await enroler(port);

    expect(res.status).toBe(200);
    expect(storageMock.enrollLead).toHaveBeenCalled();
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

  it("valider de nouveau relance une séquence retenue faute de validation", async () => {
    storageMock.updateLead.mockResolvedValue(prospect({
      validatedAt: new Date(),
      enrichedProfile: { nayaSequence: { tropProcheConsecutifs: 1, stepId: 9, attention: RAISON_VALIDATION_MANQUANTE } },
    }));
    storageMock.getLeadSequenceState.mockResolvedValue({ userId: "user-1", status: "paused" });

    await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, { method: "POST" });

    expect(storageMock.updateLeadSequenceState).toHaveBeenCalledWith(LEAD_ID, expect.objectContaining({ status: "active" }));
    expect(storageMock.setLeadSequenceGuard).toHaveBeenCalledWith(LEAD_ID, { tropProcheConsecutifs: 1, stepId: 9, attention: null });
  });

  it("une pause décidée pour une autre raison ne se lève pas à la validation", async () => {
    storageMock.updateLead.mockResolvedValue(prospect({
      validatedAt: new Date(),
      enrichedProfile: { nayaSequence: { tropProcheConsecutifs: 0, stepId: 9, attention: "Cette personne a déjà répondu." } },
    }));
    storageMock.getLeadSequenceState.mockResolvedValue({ userId: "user-1", status: "paused" });

    await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, { method: "POST" });

    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });

  it("ne relance jamais la séquence d'une autre utilisatrice", async () => {
    storageMock.updateLead.mockResolvedValue(prospect({
      validatedAt: new Date(),
      enrichedProfile: { nayaSequence: { tropProcheConsecutifs: 0, stepId: 9, attention: RAISON_VALIDATION_MANQUANTE } },
    }));
    storageMock.getLeadSequenceState.mockResolvedValue({ userId: "autre", status: "paused" });

    await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, { method: "POST" });

    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });

  it("un prospect inexistant renvoie 404", async () => {
    storageMock.updateLead.mockResolvedValue(null);

    const res = await fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}/validate`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});

describe("les données restent justes après une action manuelle", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, port } = await startServer());
    storageMock.updateLead.mockResolvedValue(prospect({}));
    storageMock.getLeadSequenceState.mockResolvedValue(undefined);
    storageMock.markFeedbackReplied.mockResolvedValue(undefined);
    storageMock.colleguesEnSequence.mockResolvedValue([]);
  });

  afterAll(() => { server?.close(); });

  const changerStade = (stage: string) => fetch(`http://127.0.0.1:${port}/api/leads/${LEAD_ID}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
  });

  it("passer en discussion note la réponse et suspend les collègues", async () => {
    storageMock.getLead.mockResolvedValue(prospect({ stage: "connection_sent" }));
    storageMock.getLatestOutreachByLead.mockResolvedValue({ id: 40, responseReceived: false });
    storageMock.colleguesEnSequence.mockResolvedValue([102]);

    await changerStade("in_discussion");

    expect(storageMock.updateOutreachMessage).toHaveBeenCalledWith(40, expect.objectContaining({ responseReceived: true }));
    expect(storageMock.suspendreSequence).toHaveBeenCalledWith(102, expect.stringContaining("entreprise"));
  });

  it("« Signé » après la discussion n'est pas une nouvelle réponse", async () => {
    storageMock.getLead.mockResolvedValue(prospect({ stage: "in_discussion" }));
    storageMock.getLatestOutreachByLead.mockResolvedValue({ id: 40, responseReceived: false });

    await changerStade("signed");

    expect(storageMock.updateOutreachMessage).not.toHaveBeenCalled();
    expect(storageMock.suspendreSequence).not.toHaveBeenCalled();
  });

  it("déplacer un prospect met sa séquence en cours en pause", async () => {
    storageMock.getProspectionCampaign.mockResolvedValue({ id: 9, userId: "user-1" });
    storageMock.getLeadSequenceState.mockResolvedValue({ userId: "user-1", campaignId: CAMPAGNE, status: "active" });
    storageMock.bulkMoveLeads.mockResolvedValue(1);

    const res = await fetch(`http://127.0.0.1:${port}/api/leads/bulk-move`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [LEAD_ID], campaignId: 9 }),
    });

    expect(await res.json()).toEqual({ moved: 1 });
    expect(storageMock.suspendreSequence).toHaveBeenCalledWith(LEAD_ID, RAISON_PROSPECT_DEPLACE);
  });
});
