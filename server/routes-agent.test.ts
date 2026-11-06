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
  validerProposition: vi.fn(),
  annulerProposition: vi.fn(),
  actionsAnnulees: vi.fn(async () => []),
  annuleesDepuis: vi.fn(async () => []),
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
  getCompanionHistory: vi.fn(async () => []),
};
vi.mock("./storage", () => ({ storage: storageMock }));
vi.mock("./services/usage", () => ({ isAiBlocked: h.isAiBlocked }));
vi.mock("./services/agent/depot", () => ({ depot: { actionsAnnulees: h.actionsAnnulees, annuleesDepuis: h.annuleesDepuis } }));
vi.mock("./services/agent/boucle", () => ({ executerAgent: h.executerAgent }));
vi.mock("./services/naya-context", () => ({ buildNayaContext: vi.fn(async () => "") }));
vi.mock("./services/memory/extract", () => ({ extractToMemory: h.extractToMemory }));
vi.mock("./services/agent/propositions", () => ({ validerProposition: h.validerProposition, annulerProposition: h.annulerProposition }));

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
    storageMock.getCompanionHistory.mockRejectedValueOnce(new Error("table absente"));
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
    expect(opts.historique).toEqual([{ role: "user", content: "Salut" }, { role: "assistant", content: "Bonjour" }]); // secours : lecture sauvegardée en échec
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

  it("après rechargement (historique client vide), le modèle reçoit le tour sauvegardé annoté de l'annulation", async () => {
    storageMock.getCompanionHistory.mockResolvedValueOnce([
      { role: "user", content: "Rappelle Camille lundi 10h" },
      { role: "assistant", content: "Fait.", actions: { faites: [{ actionId: 7, resume: "Tâche « Rappeler Camille Fictive »" }] } },
    ] as any);
    h.actionsAnnulees.mockResolvedValueOnce([{ id: 7, resume: "Tâche « Rappeler Camille Fictive »" }] as any);
    const r = await poster({ message: "Où en est la tâche pour Camille ?", conversationHistory: [] });
    expect(storageMock.getCompanionHistory).toHaveBeenCalledWith("user-1", 20);
    expect(h.actionsAnnulees).toHaveBeenCalledTimes(1);
    expect(h.actionsAnnulees).toHaveBeenCalledWith("user-1", [7]);
    expect(h.executerAgent.mock.calls[0][0].historique).toEqual([
      { role: "user", content: "Rappelle Camille lundi 10h" },
      { role: "assistant", content: "Fait.\n(Annulé ensuite par l'utilisatrice : Tâche « Rappeler Camille Fictive »)" },
    ]);
    expect(Object.keys(await r.json()).sort()).toEqual(["actions", "faites", "message", "propositions", "recherches", "suggestions"]);
  });

  it("les gestes annulés ces 24 h arrivent dans le bloc de session", async () => {
    h.annuleesDepuis.mockResolvedValueOnce([{ resume: "Tâche « Rappeler Camille Fictive »", annuleeAt: new Date() }] as any);
    await poster({ message: "Et la tâche pour Camille ?" });
    expect(h.annuleesDepuis.mock.calls[0][0]).toBe("user-1");
    expect(h.executerAgent.mock.calls[0][0].contexteSession).toContain("Gestes annulés récemment (24 h)");
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

  it("todayTasks / upcomingEvents malformés (éléments nuls) : 200, éléments écartés", async () => {
    const r = await poster({
      message: "Salut",
      context: {
        todayTasks: [null, 3, { title: "Appeler Léa", completed: false }, { title: null }],
        upcomingEvents: [null, { title: "Salon", date: "2026-11-04" }, { date: 5 }],
      },
    });
    expect(r.status).toBe(200);
    const s: string = h.executerAgent.mock.calls[0][0].contexteSession;
    expect(s).toContain("Appeler Léa");
    expect(s).toContain("Salon le 2026-11-04");
  });

  it("todayTasks qui n'est pas une liste : ignoré, sans planter", async () => {
    const r = await poster({ message: "Salut", context: { todayTasks: { title: "x" }, upcomingEvents: "non" } });
    expect(r.status).toBe(200);
  });

  it("le drapeau interne prospectLu n'est jamais envoyé au client", async () => {
    h.executerAgent.mockResolvedValueOnce({ ...REPONSE, prospectLu: false });
    const r = await poster({ message: "Salut" });
    expect("prospectLu" in (await r.json())).toBe(false);
  });

  it("sans réponse de prospect lue, la mémoire reçoit le message ET la réponse de Naya", async () => {
    h.executerAgent.mockResolvedValueOnce({ ...REPONSE, prospectLu: false });
    await poster({ message: "Qu'est-ce que j'ai envoyé ?" });
    await vi.waitFor(() => expect(h.extractToMemory).toHaveBeenCalled());
    const src = (h.extractToMemory.mock.calls[0] as any)[0].sourceText as string;
    expect(src).toContain("Utilisateur : Qu'est-ce que j'ai envoyé ?");
    expect(src).toContain(`Naya : ${REPONSE.message}`);
  });

  it("une réponse de prospect lue : la mémoire ne reçoit QUE le message de l'utilisatrice", async () => {
    h.executerAgent.mockResolvedValueOnce({ ...REPONSE, message: "Paul écrit : « tarif trop élevé ».", prospectLu: true });
    const r = await poster({ message: "Paul a répondu ?" });
    expect("prospectLu" in (await r.json())).toBe(false);
    await vi.waitFor(() => expect(h.extractToMemory).toHaveBeenCalled());
    const src = (h.extractToMemory.mock.calls[0] as any)[0].sourceText as string;
    expect(src).toBe("Utilisateur : Paul a répondu ?");
    expect(src).not.toContain("tarif");
  });

  it("une panne de l'agent donne une 500, sans enregistrer de réponse", async () => {
    h.executerAgent.mockRejectedValueOnce(new Error("API indisponible"));
    const r = await poster({ message: "Salut" });
    expect(r.status).toBe(500);
    expect(storageMock.saveCompanionMessage).not.toHaveBeenCalled();
  });
});

describe("propositions à valider", () => {
  const appel = (chemin: string) => fetch(`http://127.0.0.1:${port}${chemin}`, { method: "POST" });

  it("valider : 200 {reussis, echecs}, l'utilisatrice vient de la session, fuseau de ses préférences", async () => {
    h.validerProposition.mockResolvedValueOnce({ ok: true, reussis: ["« A » déplacée au 4 nov."], echecs: ["« B » : jour non travaillé"] });
    const r = await appel("/api/agent/propositions/12/valider");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reussis: ["« A » déplacée au 4 nov."], echecs: ["« B » : jour non travaillé"] });
    expect(h.validerProposition).toHaveBeenCalledWith("user-1", 12, expect.any(Date), { fuseau: "Europe/Paris" });
  });

  it("valider : 409 {message: raison} si impossible", async () => {
    h.validerProposition.mockResolvedValueOnce({ ok: false, raison: "expiree" });
    const r = await appel("/api/agent/propositions/12/valider");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ message: "expiree" });
  });

  it("valider : un id non numérique est introuvable, sans rien appeler", async () => {
    const r = await appel("/api/agent/propositions/abc/valider");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ message: "introuvable" });
    expect(h.validerProposition).not.toHaveBeenCalled();
  });

  it("annuler : 200 {ok: true}, ou 409 {message: raison}", async () => {
    h.annulerProposition.mockResolvedValueOnce({ ok: true });
    const r = await appel("/api/agent/propositions/12/annuler");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(h.annulerProposition).toHaveBeenCalledWith("user-1", 12);
    h.annulerProposition.mockResolvedValueOnce({ ok: false, raison: "deja_traitee" });
    const r2 = await appel("/api/agent/propositions/12/annuler");
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ message: "deja_traitee" });
  });
});
