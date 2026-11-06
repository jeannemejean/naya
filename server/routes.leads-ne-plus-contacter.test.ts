// « Ne plus contacter » aux portes d'entrée des prospects (création, import CSV) : une
// personne désinscrite puis supprimée n'est jamais recréée. L'enrôlement passe par
// isLeadUnsubscribed (voir routes.enroll-validation.test.ts et storage.suppression.test.ts).
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
  createLead: vi.fn(),
  estProspectBloque: vi.fn(),
  getProspectsBloques: vi.fn(),
  getProspectionCampaign: vi.fn(),
  desinscrireProspect: vi.fn(),
  getLatestOutreachByLead: vi.fn(),
  updateLeadSequenceState: vi.fn(),
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


describe("« ne plus contacter » — création et import de prospects", () => {
  let server: http.Server;
  let port: number;
  const poster = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.getLeads.mockResolvedValue([]);
    storageMock.createLead.mockImplementation(async (l: any) => ({ id: 1, ...l }));
    storageMock.estProspectBloque.mockResolvedValue(false);
    storageMock.getProspectsBloques.mockResolvedValue({ emails: new Set(["marie@ex.fr"]), linkedinIds: new Set(["paul-durand"]) });
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("création d'une personne désinscrite puis supprimée : 409, aucune fiche créée", async () => {
    storageMock.estProspectBloque.mockResolvedValue(true);
    const res = await poster("/api/leads", { name: "Marie", email: " Marie@Ex.fr" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("ne_plus_contacter");
    expect(storageMock.estProspectBloque).toHaveBeenCalledWith("user-1", expect.objectContaining({ email: " Marie@Ex.fr" }));
    expect(storageMock.createLead).not.toHaveBeenCalled();
  });

  it("création d'une personne libre : passe", async () => {
    const res = await poster("/api/leads", { name: "Claire", email: "claire@ex.fr" });
    expect(res.status).toBe(200);
    expect(storageMock.createLead).toHaveBeenCalledTimes(1);
  });

  it("import CSV : les personnes bloquées (email normalisé ou profil LinkedIn) sont écartées", async () => {
    const csv = [
      "name,email,linkedin",
      "Marie, MARIE@ex.fr ,",
      "Paul,,https://www.linkedin.com/in/paul-durand/",
      "Claire,claire@ex.fr,",
    ].join("\n");
    const res = await poster("/api/leads/import", { csv });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1, skipped: 2, blocked: 2, total: 3 });
    expect(storageMock.createLead).toHaveBeenCalledTimes(1);
    expect(storageMock.createLead).toHaveBeenCalledWith(expect.objectContaining({ email: "claire@ex.fr" }));
  });
});

describe("webhook SendGrid — désinscription d'un prospect supprimé", () => {
  let server: http.Server;
  let port: number;
  const webhook = (events: unknown[]) => fetch(`http://127.0.0.1:${port}/api/sendgrid/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(events),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.desinscrireProspect.mockResolvedValue("supprime");
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("unsubscribe / spamreport : prospect, utilisatrice (custom_args) et adresse de l'événement transmis", async () => {
    const res = await webhook([
      { event: "unsubscribe", leadId: "7", userId: "user-1", email: "marie@ex.fr" },
      { event: "spamreport", leadId: "8", email: "paul@ex.fr" },
    ]);
    expect(res.status).toBe(200);
    expect(storageMock.desinscrireProspect).toHaveBeenCalledWith(7, { userId: "user-1", email: "marie@ex.fr" });
    expect(storageMock.desinscrireProspect).toHaveBeenCalledWith(8, { userId: null, email: "paul@ex.fr" });
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });

  it("sans leadId mais avec utilisatrice + adresse : la désinscription est quand même tentée", async () => {
    storageMock.desinscrireProspect.mockResolvedValue("email");
    await webhook([{ event: "group_unsubscribe", userId: "user-1", email: "x@y.fr" }]);
    expect(storageMock.desinscrireProspect).toHaveBeenCalledWith(null, { userId: "user-1", email: "x@y.fr" });
  });

  it("rien de connu : journalisé bruyamment, le webhook répond quand même", async () => {
    storageMock.desinscrireProspect.mockResolvedValue("inconnu");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await webhook([{ event: "unsubscribe", leadId: "9" }]);
    expect(res.status).toBe(200);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("NON ENREGISTRÉE"));
  });
});
