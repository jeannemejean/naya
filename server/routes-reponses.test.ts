import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
process.env.UNIPILE_WEBHOOK_SECRET = "webhook-secret";
const storageMock = {
  updateLeadSequenceState: vi.fn(async () => ({})),
  getLead: vi.fn(),
  setLeadLinkedinConnected: vi.fn(async () => {}),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const ingestion = vi.hoisted(() => ({
  normaliser: vi.fn((p: any) => ({ kind: "message", lu: p })),
  traiterEvenement: vi.fn(async () => {}),
  depsDepuisStorage: vi.fn(() => ({ deps: true })),
}));
vi.mock("./services/reponses/ingestion", () => ingestion);
vi.mock("./auth", () => ({ isAuthenticated: (q: any, _r: any, next: any) => { q.userId = "u1"; next(); } }));

const { registerReponsesRoutes, STADES_ENGAGES } = await import("./routes-reponses");
const { jetonDesinscription } = await import("./services/desinscription");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
registerReponsesRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string) => fetch(`http://127.0.0.1:${port}${path}`, { method });

beforeEach(() => vi.clearAllMocks());

describe("routes publiques de désinscription", () => {
  it("GET : page en français avec un formulaire POST, sans auth, et ne désinscrit JAMAIS", async () => {
    const r = await appel("GET", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Se désinscrire");
    expect(html).toContain('method="post"');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3)/);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });
  it("POST : état unsubscribed définitif + page de confirmation", async () => {
    const r = await appel("POST", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("désinscrit");
    expect(storageMock.updateLeadSequenceState).toHaveBeenCalledWith(9, { status: "unsubscribed", nextRunAt: null });
  });
  it("jeton invalide : 404 sur GET et POST, rien d'écrit", async () => {
    expect((await appel("GET", "/desinscription/bidon")).status).toBe(404);
    expect((await appel("POST", "/desinscription/9.bidon")).status).toBe(404);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
  });
});

describe("POST /api/unipile/webhook", () => {
  const poster = (headers: Record<string, string>, body: string) =>
    fetch(`http://127.0.0.1:${port}/api/unipile/webhook`, { method: "POST", headers, body });
  const corps = JSON.stringify({ event: "message_received", account_id: "acc" });

  it("mauvais secret ou secret absent : 401, rien traité", async () => {
    expect((await poster({ "content-type": "application/json", "Unipile-Auth": "faux" }, corps)).status).toBe(401);
    expect((await poster({ "content-type": "application/json" }, corps)).status).toBe(401);
    expect(ingestion.traiterEvenement).not.toHaveBeenCalled();
  });

  it("bon secret, corps en text/plain : 200 puis traiterEvenement avec le corps lu", async () => {
    const r = await poster({ "content-type": "text/plain", "Unipile-Auth": "webhook-secret" }, corps);
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(ingestion.traiterEvenement).toHaveBeenCalledTimes(1));
    expect(ingestion.normaliser).toHaveBeenCalledWith({ event: "message_received", account_id: "acc" });
    expect(ingestion.traiterEvenement).toHaveBeenCalledWith({ kind: "message", lu: { event: "message_received", account_id: "acc" } }, { deps: true });
  });

  it("événement non reconnu : 200, rien traité", async () => {
    ingestion.normaliser.mockReturnValueOnce(null as any);
    expect((await poster({ "content-type": "application/json", "Unipile-Auth": "webhook-secret" }, "{}")).status).toBe(200);
    expect(ingestion.traiterEvenement).not.toHaveBeenCalled();
  });

  it("secret non configuré : 503", async () => {
    const avant = process.env.UNIPILE_WEBHOOK_SECRET;
    delete process.env.UNIPILE_WEBHOOK_SECRET;
    try {
      expect((await poster({ "content-type": "application/json", "Unipile-Auth": "webhook-secret" }, corps)).status).toBe(503);
    } finally { process.env.UNIPILE_WEBHOOK_SECRET = avant; }
  });
});

describe("POST /api/leads/:id/invitation-acceptee", () => {
  const poster = (id: number | string) => fetch(`http://127.0.0.1:${port}/api/leads/${id}/invitation-acceptee`, { method: "POST" });

  it("lead d'un autre utilisateur (ou absent) : 404, rien d'écrit", async () => {
    storageMock.getLead.mockResolvedValueOnce(undefined);
    expect((await poster(5)).status).toBe(404);
    expect(storageMock.getLead).toHaveBeenCalledWith(5, "u1");
    expect(storageMock.setLeadLinkedinConnected).not.toHaveBeenCalled();
  });

  it("id invalide : 400", async () => {
    expect((await poster("abc")).status).toBe(400);
    expect(storageMock.setLeadLinkedinConnected).not.toHaveBeenCalled();
  });

  it("enregistre via setLeadLinkedinConnected(now) et renvoie la date relue", async () => {
    const ancienne = new Date("2026-10-01T10:00:00Z");
    storageMock.getLead
      .mockResolvedValueOnce({ id: 5, linkedinConnectedAt: ancienne })
      .mockResolvedValueOnce({ id: 5, linkedinConnectedAt: ancienne }); // date déjà plus ancienne : inchangée
    const r = await poster(5);
    expect(r.status).toBe(200);
    expect(storageMock.setLeadLinkedinConnected).toHaveBeenCalledWith(5, expect.any(Date));
    expect((await r.json()).linkedinConnectedAt).toBe(ancienne.toISOString());
  });
});

describe("stade « connected »", () => {
  it("n'arrête plus la séquence : seuls les stades d'échange réel l'arrêtent", () => {
    expect(STADES_ENGAGES).toEqual(["in_discussion", "proposal_sent", "signed"]);
    expect(STADES_ENGAGES).not.toContain("connected");
  });
});
