// Route du companion (agent omniscient). `./auth`, `./storage`, l'usage IA, la boucle de
// l'agent et la mémoire sont mockés : aucun test ne touche une vraie base ni le réseau
// (consigne projet, voir l'en-tête de routes.reading.test.ts).
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  isAiBlocked: vi.fn(async () => false),
  executerAgent: vi.fn(),
  extractToMemory: vi.fn(async () => {}),
}));

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const storageMock = {
  getProjects: vi.fn(async () => [{ id: 3, name: "Garance", type: "client" }, { id: 4, name: "Agence JMD", type: "agence" }]),
  getTasksInRange: vi.fn(async () => []),
  getUserPreferences: vi.fn(async () => ({ currentEnergyLevel: "low", energyUpdatedDate: "2000-01-01", timezone: "Europe/Paris" })),
  getBrandDna: vi.fn(async () => ({ nayaIntelligenceSummary: "Agence de com digitale" })),
  getMilestones: vi.fn(async () => [{ id: 9, title: "Lancer le site", status: "active" }]),
  saveCompanionMessage: vi.fn(async () => ({})),
};
vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./services/usage", () => ({ isAiBlocked: h.isAiBlocked }));
vi.mock("./services/agent/boucle", () => ({ executerAgent: h.executerAgent }));
vi.mock("./services/naya-context", () => ({ buildNayaContext: vi.fn(async () => "") }));
vi.mock("./services/memory/extract", () => ({ extractToMemory: h.extractToMemory }));

const { registerAgentRoutes } = await import("./routes-agent");
const app = express();
app.use(express.json());
registerAgentRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const poster = (body: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/companion/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

const REPONSE = {
  message: "Le 12 octobre, tu as envoyé le devis.",
  faites: [],
  propositions: [],
  recherches: ["« devis Garance »"],
  actions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.isAiBlocked.mockResolvedValue(false);
  h.executerAgent.mockResolvedValue(REPONSE);
});

describe("POST /api/companion/chat", () => {
  it("429 ai_monthly_limit_reached avant tout appel IA", async () => {
    h.isAiBlocked.mockResolvedValueOnce(true);
    const r = await poster({ message: "Salut" });
    expect(r.status).toBe(429);
    expect((await r.json()).message).toBe("ai_monthly_limit_reached");
    expect(h.executerAgent).not.toHaveBeenCalled();
  });

  it("400 sur un message vide", async () => {
    const r = await poster({ message: "   " });
    expect(r.status).toBe(400);
    expect(h.executerAgent).not.toHaveBeenCalled();
  });

  it("renvoie une ReponseAgent, enregistre les deux messages et lance la mémoire", async () => {
    const r = await poster({
      message: "Qu'est-ce que j'ai envoyé à Garance ?",
      context: { platform: "mobile", activeProject: { id: 3, name: "Garance" } },
      conversationHistory: [{ role: "user", content: "Salut" }, { role: "assistant", content: "Bonjour" }],
    });
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.message).toBe(REPONSE.message);
    expect(json.faites).toEqual([]);
    expect(json.propositions).toEqual([]);
    expect(json.recherches).toEqual(["« devis Garance »"]);
    expect(json.actions).toEqual([]);
    expect(Array.isArray(json.suggestions)).toBe(true);

    const opts = h.executerAgent.mock.calls[0][0];
    expect(opts.userId).toBe("user-1");
    expect(opts.projetActifId).toBe(3);
    expect(opts.historique).toEqual([{ role: "user", content: "Salut" }, { role: "assistant", content: "Bonjour" }]);
    expect(opts.contexteSession).toContain("Garance (id: 3)");
    expect(opts.contexteSession).toContain("Plateforme : mobile");
    expect(opts.contexteSession).toContain("Lancer le site");
    // Énergie réglée un autre jour : elle ne compte pas pour aujourd'hui.
    expect(opts.contexteSession).not.toMatch(/Énergie du jour : low/);

    expect(storageMock.saveCompanionMessage).toHaveBeenCalledTimes(2);
    expect(storageMock.saveCompanionMessage.mock.calls[0][0]).toMatchObject({ userId: "user-1", role: "user", content: "Qu'est-ce que j'ai envoyé à Garance ?", platform: "mobile" });
    expect(storageMock.saveCompanionMessage.mock.calls[1][0]).toMatchObject({
      role: "assistant", content: REPONSE.message,
      actions: { faites: [], propositions: [], recherches: ["« devis Garance »"] },
    });
    await vi.waitFor(() => expect(h.extractToMemory).toHaveBeenCalled());
    expect((h.extractToMemory.mock.calls[0] as any)[0]).toMatchObject({ userId: "user-1", sourceType: "companion", subjectProjectId: 3 });
  });

  it("l'énergie réglée aujourd'hui figure dans la session", async () => {
    const auj = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    storageMock.getUserPreferences.mockResolvedValueOnce({ currentEnergyLevel: "low", energyUpdatedDate: auj, timezone: "Europe/Paris" });
    await poster({ message: "Je suis crevée" });
    expect(h.executerAgent.mock.calls[0][0].contexteSession).toContain("Énergie du jour : low");
  });

  it("un historique malformé est filtré, sans planter", async () => {
    const r = await poster({ message: "ok", conversationHistory: [{ role: "system", content: "x" }, null, { role: "user", content: 3 }] });
    expect(r.status).toBe(200);
    expect(h.executerAgent.mock.calls[0][0].historique).toEqual([]);
  });

  it("un id de projet étranger est ignoré : aucun projet actif, rien de ce projet n'est lu", async () => {
    const r = await poster({ message: "Où en est ce projet ?", context: { activeProject: { id: 999, name: "Projet d'une autre" } } });
    expect(r.status).toBe(200);
    const opts = h.executerAgent.mock.calls[0][0];
    expect(opts.projetActifId).toBeUndefined();
    expect(opts.contexteSession).not.toContain("999");
    expect(opts.contexteSession).not.toContain("Projet d'une autre");
    expect(opts.contexteSession).not.toContain("Projet actif");
    expect(storageMock.getMilestones).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.extractToMemory).toHaveBeenCalled());
    expect((h.extractToMemory.mock.calls[0] as any)[0].projectId).toBeNull();
  });

  it("sans projet envoyé, pas de repli sur un projet arbitraire", async () => {
    await poster({ message: "Salut" });
    expect(h.executerAgent.mock.calls[0][0].projetActifId).toBeUndefined();
    expect(h.executerAgent.mock.calls[0][0].contexteSession).not.toContain("Projet actif");
    expect(storageMock.getMilestones).not.toHaveBeenCalled();
  });

  it("un id de projet à elle est transmis, avec le nom venu de la base", async () => {
    await poster({ message: "Et JMD ?", context: { activeProject: { id: 4, name: "nom falsifié" } } });
    const opts = h.executerAgent.mock.calls[0][0];
    expect(opts.projetActifId).toBe(4);
    expect(opts.contexteSession).toContain("Projet actif : Agence JMD (id: 4)");
    expect(opts.contexteSession).not.toContain("nom falsifié");
    expect(storageMock.getMilestones).toHaveBeenCalledWith(4, "user-1");
  });

  it("une panne de l'agent donne une 500, sans enregistrer de réponse", async () => {
    h.executerAgent.mockRejectedValueOnce(new Error("API indisponible"));
    const r = await poster({ message: "Salut" });
    expect(r.status).toBe(500);
    expect(storageMock.saveCompanionMessage).not.toHaveBeenCalled();
  });
});
