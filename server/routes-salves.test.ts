// Les routes des salves : la porte, pas seulement la règle posée à côté. `./storage` et
// `./auth` sont mockés : jamais de vraie base, jamais d'envoi.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));

const s = vi.hoisted(() => ({
  getProspectionCampaign: vi.fn(),
  getSequenceSteps: vi.fn(),
  getLeads: vi.fn(),
  getLeadSequenceState: vi.fn(),
  prospectsAyantRepondu: vi.fn(),
  getUserPreferences: vi.fn(),
  creerSalve: vi.fn(),
  supprimerSalve: vi.fn(),
  enrollLead: vi.fn(),
  salvesDeCampagne: vi.fn(),
  sequencesEnCoursDeSalve: vi.fn(),
  suspendreSequence: vi.fn(),
}));
vi.mock("./storage", () => ({ storage: s }));
vi.mock("./services/prospection-sender", () => ({
  hhmmToMin: (_v: unknown, repli: number) => repli,
  localNow: () => ({ nowMin: 9 * 60, dayAbbr: "tue" }),
}));

const { registerSalvesRoutes } = await import("./routes-salves");
const { RAISON_SALVE_ARRETEE } = await import("./services/prospection-salves");

const valide = new Date("2026-10-01T10:00:00Z");
const prospect = (id: number, over: Record<string, unknown> = {}) => ({
  id, prospectionCampaignId: 5, stage: "messages_ready", validatedAt: valide, priority: null, tags: [], createdAt: new Date(2026, 9, id), ...over,
});

describe("routes des salves", () => {
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    registerSalvesRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    s.getProspectionCampaign.mockResolvedValue({ id: 5, userId: "user-1", status: "active" });
    s.getSequenceSteps.mockResolvedValue([{ id: 1 }]);
    s.getLeads.mockResolvedValue([prospect(1), prospect(2), prospect(3, { validatedAt: null })]);
    s.getLeadSequenceState.mockResolvedValue(undefined);
    s.prospectsAyantRepondu.mockResolvedValue([]);
    s.getUserPreferences.mockResolvedValue({ timezone: "UTC" });
    s.creerSalve.mockResolvedValue({ id: 40 });
    s.enrollLead.mockResolvedValue({ id: 1 });
  });

  afterEach(() => { server.close(); });

  const lancer = (corps: unknown) => fetch(`${base}/api/prospection/campaigns/5/salves`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });

  it("ne programme que des prospects validés, à leur date", async () => {
    const res = await lancer({ nombre: 20, parJour: 1 });
    const r = await res.json();
    expect(res.status).toBe(200);
    expect(r).toMatchObject({ salveId: 40, programmes: 2, demandes: 20 });
    expect(s.creerSalve).toHaveBeenCalledWith("user-1", 5, 1);
    expect(s.enrollLead).toHaveBeenCalledTimes(2);
    const [, , , premier] = s.enrollLead.mock.calls[0];
    const [, , , second] = s.enrollLead.mock.calls[1];
    expect(s.enrollLead.mock.calls.map((c: any[]) => c[0])).toEqual([1, 2]);
    expect(second.nextRunAt.getTime()).toBeGreaterThan(premier.nextRunAt.getTime());
    expect(premier.salveId).toBe(40);
  });

  it("ne reprend pas une séquence en pause (ex-« Lancer pour tous »)", async () => {
    s.getLeadSequenceState.mockImplementation(async (id: number) => (id === 1 ? { status: "paused" } : undefined));
    const r = await (await lancer({ nombre: 20, parJour: 5 })).json();
    expect(r.programmes).toBe(1);
    expect(s.enrollLead.mock.calls.map((c: any[]) => c[0])).toEqual([2]);
  });

  it("laisse de côté le collègue de quelqu'un qui a répondu", async () => {
    s.getLeads.mockResolvedValue([prospect(1, { company: "Acme" }), prospect(2, { company: "Globex" })]);
    s.prospectsAyantRepondu.mockResolvedValue([{ company: "ACME SAS", email: null }]);
    const r = await (await lancer({ nombre: 20, parJour: 5 })).json();
    expect(r.programmes).toBe(1);
    expect(s.enrollLead.mock.calls.map((c: any[]) => c[0])).toEqual([2]);
  });

  it("refuse une demande illisible, sans rien créer", async () => {
    for (const corps of [{ nombre: 0, parJour: 5 }, { nombre: 20, parJour: 0 }, { nombre: 1000, parJour: 5 }, { nombre: "x", parJour: 5 }, {}]) {
      expect((await lancer(corps)).status, JSON.stringify(corps)).toBe(400);
    }
    expect(s.creerSalve).not.toHaveBeenCalled();
  });

  it("refuse la campagne d'une autre utilisatrice", async () => {
    s.getProspectionCampaign.mockResolvedValue({ id: 5, userId: "autre", status: "active" });
    expect((await lancer({ nombre: 2, parJour: 1 })).status).toBe(404);
    expect((await fetch(`${base}/api/prospection/campaigns/5/salves`)).status).toBe(404);
    expect(s.enrollLead).not.toHaveBeenCalled();
  });

  it("refuse une campagne en pause ou sans séquence", async () => {
    s.getProspectionCampaign.mockResolvedValue({ id: 5, userId: "user-1", status: "paused" });
    expect((await lancer({ nombre: 2, parJour: 1 })).status).toBe(409);
    s.getProspectionCampaign.mockResolvedValue({ id: 5, userId: "user-1", status: "active" });
    s.getSequenceSteps.mockResolvedValue([]);
    expect((await lancer({ nombre: 2, parJour: 1 })).status).toBe(400);
    expect(s.enrollLead).not.toHaveBeenCalled();
  });

  it("rend le bilan calculé depuis les séquences", async () => {
    s.salvesDeCampagne.mockResolvedValue([{
      salve: { id: 40, parJour: 5, createdAt: valide },
      etats: [{ status: "active", lastStepSentAt: valide, repliedAt: null, nextRunAt: null }],
    }]);
    const [salve] = await (await fetch(`${base}/api/prospection/campaigns/5/salves`)).json();
    expect(salve).toMatchObject({ id: 40, prevus: 1, partis: 1, reponses: 0 });
  });

  it("arrêter met en pause les séquences de cette utilisatrice, raison visible", async () => {
    s.sequencesEnCoursDeSalve.mockResolvedValue([1, 2]);
    const res = await fetch(`${base}/api/prospection/salves/40/arreter`, { method: "POST" });
    expect(await res.json()).toEqual({ arretes: 2 });
    expect(s.sequencesEnCoursDeSalve).toHaveBeenCalledWith(40, "user-1");
    expect(s.suspendreSequence).toHaveBeenCalledWith(1, RAISON_SALVE_ARRETEE);
  });
});
