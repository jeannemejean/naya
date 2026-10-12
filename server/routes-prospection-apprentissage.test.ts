// Routes d'apprentissage de la rédaction : édition et écart d'un message, brief, règles
// apprises, messages collés. `./storage` et `./auth` sont mockés : aucune requête réelle.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));

const STEPS = [
  { id: 11, campaignId: 5, channel: "linkedin", condition: "always", role: "invitation" },
  { id: 12, campaignId: 5, channel: "linkedin", condition: "if_invite_accepted", role: "premier_message" },
];
const storageMock = {
  getLead: vi.fn(),
  getProspectionCampaign: vi.fn(async (id: number) => (id === 5 ? { id: 5, userId: "user-1", projectId: 7 } : null)),
  getSequenceSteps: vi.fn(async () => STEPS),
  getLeadStepMessage: vi.fn(async () => ({ body: "TEXTE DE NAYA", subject: null, edited: false })),
  upsertLeadStepMessage: vi.fn(async () => {}),
  deleteLeadStepMessage: vi.fn(async () => {}),
  purgeUneditedLeadStepMessages: vi.fn(async () => {}),
  updateLead: vi.fn(async (_id: number, _u: string, patch: any) => ({ id: 1, ...patch })),
  addMessageFeedback: vi.fn(async (row: any) => ({ id: 1, ...row })),
  getMessageFeedback: vi.fn(async () => []),
  getProject: vi.fn(async (id: number) => (id === 7 ? { id: 7 } : undefined)),
  getProjectProofs: vi.fn(async () => [{ id: 4, status: "validated" }]),
  getLearnedRules: vi.fn(async () => [{ id: 30, projectId: 7, texte: "R", statut: "proposee" }]),
  updateLearnedRule: vi.fn(async (id: number, _u: string, patch: any) => ({ id, ...patch })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./services/prospection/regles-apprises", async (io) => ({
  ...(await io<any>()), extraireSiPret: vi.fn(async () => 0),
}));

const { registerApprentissageRoutes } = await import("./routes-prospection-apprentissage");

const app = express();
app.use(express.json());
registerApprentissageRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());

const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getLead.mockImplementation(async (id: number) =>
    id === 1 ? { id: 1, userId: "user-1", prospectionCampaignId: 5, company: "Maison X", prospectBrief: null } : undefined);
});

describe("édition d'un message de séquence", () => {
  it("404 sur le prospect d'une autre utilisatrice, ou une étape d'une autre campagne", async () => {
    expect((await appel("PUT", "/api/leads/2/step-messages/11", { body: "x" })).status).toBe(404);
    expect((await appel("PUT", "/api/leads/1/step-messages/99", { body: "x" })).status).toBe(404);
  });

  it("enregistre le texte édité, garde la version de Naya comme « original », et recopie la première touche", async () => {
    const r = await appel("PUT", "/api/leads/1/step-messages/11", { body: "Mon texte à moi" });
    expect(r.status).toBe(200);
    expect(storageMock.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ leadId: 1, stepId: 11, body: "Mon texte à moi", edited: true }));
    expect(storageMock.addMessageFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: "modifie", original: "TEXTE DE NAYA", final: "Mon texte à moi", role: "invitation", projectId: 7,
    }));
    expect(storageMock.updateLead).toHaveBeenCalledWith(1, "user-1", expect.objectContaining({ linkedinMessage: "Mon texte à moi" }));
  });

  it("400 sur un corps vide", async () => {
    expect((await appel("PUT", "/api/leads/1/step-messages/11", { body: "  " })).status).toBe(400);
  });
});

describe("écarter un message", () => {
  it("400 sur une raison inconnue", async () => {
    expect((await appel("POST", "/api/leads/1/step-messages/12/ecarter", { raison: "bof" })).status).toBe(400);
  });
  it("trace l'écart et supprime le texte pour qu'il soit réécrit", async () => {
    const r = await appel("POST", "/api/leads/1/step-messages/12/ecarter", { raison: "pas_mon_ton" });
    expect(r.status).toBe(200);
    expect(storageMock.addMessageFeedback).toHaveBeenCalledWith(expect.objectContaining({ action: "ecarte", raison: "pas_mon_ton", role: "premier_message" }));
    expect(storageMock.deleteLeadStepMessage).toHaveBeenCalledWith(1, 12);
  });
});

describe("brief", () => {
  it("refuse une preuve qui n'est pas validée dans le projet", async () => {
    expect((await appel("PATCH", "/api/leads/1/brief", { preuveId: 99 })).status).toBe(400);
  });
  it("enregistre le brief édité et purge les messages non édités", async () => {
    const r = await appel("PATCH", "/api/leads/1/brief", { declencheur: { fait: "Vu au salon Cosmetic 360" } });
    expect(r.status).toBe(200);
    const patch = storageMock.updateLead.mock.calls[0][2];
    expect(patch.prospectBrief.declencheur.fait).toBe("Vu au salon Cosmetic 360");
    expect(patch.prospectBrief.edite).toBe(true);
    expect(storageMock.purgeUneditedLeadStepMessages).toHaveBeenCalledWith(1);
  });
});

describe("règles apprises et messages collés", () => {
  it("404 sur le projet d'une autre utilisatrice", async () => {
    expect((await appel("GET", "/api/projects/8/learned-rules")).status).toBe(404);
  });
  it("accepte une règle proposée", async () => {
    const r = await appel("PATCH", "/api/projects/7/learned-rules/30", { statut: "acceptee" });
    expect(r.status).toBe(200);
    expect(storageMock.updateLearnedRule).toHaveBeenCalledWith(30, "user-1", { statut: "acceptee" });
  });
  it("404 sur une règle qui n'appartient pas au projet", async () => {
    expect((await appel("PATCH", "/api/projects/7/learned-rules/31", { statut: "acceptee" })).status).toBe(404);
  });
  it("un message collé devient un exemple (modifié, sans original)", async () => {
    const r = await appel("POST", "/api/projects/7/example-messages", { role: "premier_message", body: "Bonjour Claire, je dirige JMD…" });
    expect(r.status).toBe(201);
    expect(storageMock.addMessageFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: "modifie", original: null, final: "Bonjour Claire, je dirige JMD…", role: "premier_message", projectId: 7,
    }));
  });
  it("400 sur un rôle inconnu", async () => {
    expect((await appel("POST", "/api/projects/7/example-messages", { role: "x", body: "y" })).status).toBe(400);
  });
});
