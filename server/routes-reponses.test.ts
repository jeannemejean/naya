import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
process.env.UNIPILE_WEBHOOK_SECRET = "webhook-secret";
const storageMock = {
  updateLeadSequenceState: vi.fn(async () => ({})),
  desinscrireProspect: vi.fn(async () => "lead"),
  getLead: vi.fn(),
  setLeadLinkedinConnected: vi.fn(async () => {}),
  getInboxConversationParId: vi.fn(),
  getInboxMessages: vi.fn(async () => [] as any[]),
  listerConversationsInbox: vi.fn(async () => [] as any[]),
  compterInboxATraiter: vi.fn(async () => 0),
  updateInboxConversation: vi.fn(async () => {}),
  requalifierDernierEntrantInbox: vi.fn(async () => true),
  restaurerEtatSequence: vi.fn(async () => ({})),
  getLeadSequenceState: vi.fn(),
  updateLead: vi.fn(async () => ({})),
  annulerReponseOutreach: vi.fn(async () => 1),
  autreReponseEnAttente: vi.fn(async () => false),
  finaliserEnvoiInbox: vi.fn(async () => {}),
  supprimerInboxMessage: vi.fn(async () => {}),
  getOutreachMessages: vi.fn(async () => [] as any[]),
  getProspectionCampaign: vi.fn(async () => null),
  getTask: vi.fn(),
  completeTask: vi.fn(async () => ({})),
  deleteTask: vi.fn(async () => {}),
  getUserPreferences: vi.fn(async () => ({ timezone: "Europe/Paris", workDays: "mon,tue,wed,thu,fri" })),
  effacerEtatAvantReponse: vi.fn(async () => {}),
  reserverRelanceInbox: vi.fn(async () => true),
  ecrireRelanceInbox: vi.fn(async () => {}),
  refuserRelanceInbox: vi.fn(async () => true),
  isLeadUnsubscribed: vi.fn(async () => false),
  updateTask: vi.fn(async () => ({})),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const ingestion = vi.hoisted(() => ({
  normaliser: vi.fn((p: any) => ({ kind: "message", lu: p })),
  traiterEvenement: vi.fn(async () => {}),
  depsDepuisStorage: vi.fn(() => ({ deps: true })),
}));
vi.mock("./services/reponses/ingestion", () => ingestion);
const envoi = vi.hoisted(() => ({ envoyerReponse: vi.fn() }));
vi.mock("./services/reponses/envoi-reponse", () => envoi);
const proposition = vi.hoisted(() => ({
  proposerReponse: vi.fn(async () => "Merci !"),
  identiteConversation: vi.fn(),
  ConversationIntrouvableError: class extends Error {},
}));
vi.mock("./services/reponses/proposition", () => proposition);
const taches = vi.hoisted(() => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
vi.mock("./services/taches/ecrire-tache", () => taches);
vi.mock("./auth", () => ({ isAuthenticated: (q: any, _r: any, next: any) => { q.userId = "u1"; next(); } }));

const { registerReponsesRoutes, STADES_ENGAGES, reglagesWebhook } = await import("./routes-reponses");
const { jetonDesinscription } = await import("./services/desinscription");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
registerReponsesRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
});

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
  it("POST : désinscription enregistrée pour ce prospect + page de confirmation", async () => {
    const r = await appel("POST", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("désinscrit");
    expect(storageMock.desinscrireProspect).toHaveBeenCalledWith(9);
  });
  it("POST : prospect SUPPRIMÉ depuis l'envoi (pierre tombale) → confirmation aussi", async () => {
    storageMock.desinscrireProspect.mockResolvedValueOnce("supprime");
    const r = await appel("POST", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("désinscrit");
  });
  it("POST : ni fiche ni trace → la page ne ment pas (404, message honnête) et l'échec est journalisé", async () => {
    storageMock.desinscrireProspect.mockResolvedValueOnce("inconnu");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await appel("POST", `/desinscription/${jetonDesinscription(9)}`);
    expect(r.status).toBe(404);
    const html = await r.text();
    expect(html).not.toContain("Vous êtes désinscrit");
    expect(html).toContain("pas retrouvé");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("NON ENREGISTRÉE"));
  });
  it("jeton invalide : 404 sur GET et POST, rien d'écrit", async () => {
    expect((await appel("GET", "/desinscription/bidon")).status).toBe(404);
    expect((await appel("POST", "/desinscription/9.bidon")).status).toBe(404);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled();
    expect(storageMock.desinscrireProspect).not.toHaveBeenCalled();
  });
});

describe("POST /api/unipile/webhook", () => {
  const poster = (headers: Record<string, string>, body: string) =>
    fetch(`http://127.0.0.1:${port}/api/unipile/webhook`, { method: "POST", headers, body });
  const corps = JSON.stringify({ event: "message_received", account_id: "acc" });

  it("mauvais secret ou secret absent : 401, rien traité, avertissement sans secret ni corps", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await poster({ "content-type": "application/json", "Unipile-Auth": "faux" }, corps)).status).toBe(401);
      expect((await poster({ "content-type": "application/json" }, corps)).status).toBe(401);
      expect(ingestion.traiterEvenement).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
      const journal = warn.mock.calls.flat().join(" ");
      expect(journal).toContain("401");
      expect(journal).not.toContain("faux");
      expect(journal).not.toContain("webhook-secret");
      expect(journal).not.toContain("message_received");
    } finally { warn.mockRestore(); }
  });

  it("bon secret, corps en text/plain : traiterEvenement attendu, puis 200", async () => {
    const r = await poster({ "content-type": "text/plain", "Unipile-Auth": "webhook-secret" }, corps);
    expect(r.status).toBe(200);
    expect(ingestion.traiterEvenement).toHaveBeenCalledTimes(1);
    expect(ingestion.normaliser).toHaveBeenCalledWith({ event: "message_received", account_id: "acc" });
    expect(ingestion.traiterEvenement).toHaveBeenCalledWith({ kind: "message", lu: { event: "message_received", account_id: "acc" } }, { deps: true });
  });

  it("événement non reconnu : 200, rien traité", async () => {
    ingestion.normaliser.mockReturnValueOnce(null as any);
    expect((await poster({ "content-type": "application/json", "Unipile-Auth": "webhook-secret" }, "{}")).status).toBe(200);
    expect(ingestion.traiterEvenement).not.toHaveBeenCalled();
  });

  it("traitement en échec : 500 (Unipile renverra)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      ingestion.traiterEvenement.mockRejectedValueOnce(new Error("db down") as never);
      expect((await poster({ "content-type": "application/json", "Unipile-Auth": "webhook-secret" }, corps)).status).toBe(500);
    } finally { err.mockRestore(); }
  });

  it("traitement trop long : 500 au bout du délai, sans attendre la fin", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const avant = reglagesWebhook.delaiMs;
    reglagesWebhook.delaiMs = 30;
    let finir!: () => void;
    try {
      ingestion.traiterEvenement.mockImplementationOnce((() => new Promise<void>((r) => { finir = r; })) as any);
      const r = await poster({ "content-type": "application/json", "Unipile-Auth": "webhook-secret" }, corps);
      expect(r.status).toBe(500);
    } finally { finir?.(); reglagesWebhook.delaiMs = avant; err.mockRestore(); }
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

describe("boîte « Réponses »", () => {
  const conv = (o: any = {}) => ({
    id: 11, userId: "u1", projectId: null, leadId: 7, channel: "linkedin", unipileAccountId: "acc", providerChatId: "chat",
    statut: "a_traiter", nonLu: true, taskId: 99, lastMessageAt: new Date("2026-11-01T09:00:00Z"),
    etatAvantReponse: { status: "active", currentStep: 2, nextRunAt: "2026-11-01T08:00:00.000Z", delayAnchorAt: "2026-10-28T08:00:00.000Z" },
    ...o,
  });

  it("conversation d'un autre utilisateur : 404 sur chaque route, rien d'écrit ni envoyé", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(undefined);
    const routes: Array<[string, string, unknown?]> = [
      ["GET", "/api/reponses/11"],
      ["POST", "/api/reponses/11/proposition"],
      ["POST", "/api/reponses/11/envoyer", { texte: "Bonjour" }],
      ["POST", "/api/reponses/11/traitee"],
      ["POST", "/api/reponses/11/pas-une-reponse"],
      ["POST", "/api/reponses/11/relances/5/valider"],
      ["POST", "/api/reponses/11/relances/5/refuser"],
      ["POST", "/api/reponses/11/relances/5/proposition"],
      ["POST", "/api/reponses/11/relances/5/texte", { texte: "Bonjour" }],
      ["POST", "/api/reponses/11/relances/5/date", { date: "2027-01-12" }],
    ];
    for (const [m, p, b] of routes) expect([p, (await appel(m, p, b)).status]).toEqual([p, 404]);
    expect(storageMock.getInboxConversationParId).toHaveBeenCalledWith(11, "u1");
    expect(storageMock.updateInboxConversation).not.toHaveBeenCalled();
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
    expect(storageMock.deleteTask).not.toHaveBeenCalled();
    expect(envoi.envoyerReponse).not.toHaveBeenCalled();
    expect(proposition.proposerReponse).not.toHaveBeenCalled();
    expect(taches.creerTache).not.toHaveBeenCalled();
    expect(storageMock.reserverRelanceInbox).not.toHaveBeenCalled();
    expect(storageMock.refuserRelanceInbox).not.toHaveBeenCalled();
    expect(storageMock.updateTask).not.toHaveBeenCalled();
    expect(taches.modifierTache).not.toHaveBeenCalled();
  });

  it("pas-une-reponse : remet l'état sauvegardé (nextRunAt = max(ancien, now)), traitée, tâche supprimée, entrant requalifié « accuse »", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    const avant = Date.now();
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, restaure: true });
    const [leadId, etat] = storageMock.restaurerEtatSequence.mock.calls[0] as any;
    expect(leadId).toBe(7);
    expect(etat.status).toBe("active");
    expect(etat.currentStep).toBe(2);
    expect(etat.delayAnchorAt).toBe("2026-10-28T08:00:00.000Z");
    expect(new Date(etat.nextRunAt).getTime()).toBeGreaterThanOrEqual(avant); // l'ancien était passé
    expect(storageMock.requalifierDernierEntrantInbox).toHaveBeenCalledWith(11, "accuse");
    expect(storageMock.updateInboxConversation).toHaveBeenCalledWith(11, { statut: "traitee", nonLu: false, taskId: null });
    // État d'avant consommé (les décisions de relance du même jsonb sont gardées par storage).
    expect(storageMock.effacerEtatAvantReponse).toHaveBeenCalledWith(11);
    expect(storageMock.deleteTask).toHaveBeenCalledWith(99);
  });

  it("pas-une-reponse : un nextRunAt futur est gardé tel quel", async () => {
    const futur = "2030-01-01T08:00:00.000Z";
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: { status: "active", currentStep: 1, nextRunAt: futur, delayAnchorAt: null } }));
    await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect((storageMock.restaurerEtatSequence.mock.calls[0] as any)[1].nextRunAt).toBe(futur);
  });

  it("pas-une-reponse sans état sauvegardé : rien restauré, conversation quand même traitée", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: null }));
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(await r.json()).toEqual({ ok: true, restaure: false });
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
    expect(storageMock.requalifierDernierEntrantInbox).toHaveBeenCalledWith(11, "accuse");
  });

  it("R13 : remet le stade d'avant (lead encore « en discussion ») et défait le marquage de réponse de l'outreach", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: {
      status: "active", currentStep: 1, nextRunAt: null, delayAnchorAt: null, stageAvant: "connection_sent", repondueLe: "2026-11-01T09:00:00.000Z",
    } }));
    storageMock.getLead.mockResolvedValueOnce({ id: 7, stage: "in_discussion" });
    expect((await appel("POST", "/api/reponses/11/pas-une-reponse")).status).toBe(200);
    expect(storageMock.updateLead).toHaveBeenCalledWith(7, "u1", { stage: "connection_sent" });
    expect(storageMock.annulerReponseOutreach).toHaveBeenCalledWith(7, new Date("2026-11-01T09:00:00.000Z"));
  });

  it("R13 : stade déplacé par Jeanne depuis la réponse → laissé tel quel", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: {
      status: "active", currentStep: 1, nextRunAt: null, delayAnchorAt: null, stageAvant: "connection_sent", repondueLe: "2026-11-01T09:00:00.000Z",
    } }));
    storageMock.getLead.mockResolvedValueOnce({ id: 7, stage: "proposal_sent" });
    expect((await appel("POST", "/api/reponses/11/pas-une-reponse")).status).toBe(200);
    expect(storageMock.updateLead).not.toHaveBeenCalled();
  });

  it("R13 : état sauvegardé « awaiting_linkedin » → repris en active maintenant, brouillon de l'étape libéré", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: {
      status: "awaiting_linkedin", currentStep: 2, nextRunAt: null, delayAnchorAt: "2026-10-28T08:00:00.000Z",
    } }));
    const avant = Date.now();
    await appel("POST", "/api/reponses/11/pas-une-reponse");
    const [leadId, etat, opts] = storageMock.restaurerEtatSequence.mock.calls[0] as any;
    expect(leadId).toBe(7);
    expect(etat).toMatchObject({ status: "active", currentStep: 2, delayAnchorAt: "2026-10-28T08:00:00.000Z" });
    expect(new Date(etat.nextRunAt).getTime()).toBeGreaterThanOrEqual(avant);
    expect(opts).toEqual({ libererBrouillonEtape: 3 }); // le brouillon attendu est l'étape currentStep + 1
  });

  it("pas-une-reponse : une autre réponse du lead attend → requalifiée et tâche retirée, mais séquence NON restaurée", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    storageMock.autreReponseEnAttente.mockResolvedValueOnce(true);
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, restaure: false, raison: "autre_reponse_en_attente" });
    expect(storageMock.autreReponseEnAttente).toHaveBeenCalledWith(7, 11);
    // La vérification se fait APRÈS la requalification (celle-ci ne compte plus comme réponse).
    expect(storageMock.requalifierDernierEntrantInbox.mock.invocationCallOrder[0])
      .toBeLessThan(storageMock.autreReponseEnAttente.mock.invocationCallOrder[0]);
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
    expect(storageMock.annulerReponseOutreach).not.toHaveBeenCalled();
    expect(storageMock.updateLead).not.toHaveBeenCalled();
    // État d'avant gardé pour une restauration future.
    expect(storageMock.updateInboxConversation).toHaveBeenCalledWith(11, { statut: "traitee", nonLu: false, taskId: null });
    expect(storageMock.effacerEtatAvantReponse).not.toHaveBeenCalled();
    expect(storageMock.deleteTask).toHaveBeenCalledWith(99);
  });

  it("pas-une-reponse : une relance validée sur un AUTRE message attend → séquence NON restaurée (relance_prevue)", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: {
      status: "active", currentStep: 2, nextRunAt: null, delayAnchorAt: null,
      relances: { "4": { statut: "validee", le: "x", taskId: 300 } },
    } }));
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 4, sens: "entrant", nature: "reponse", sentAt: new Date("2026-11-01T09:00:00Z") },
      { id: 5, sens: "entrant", nature: "reponse", sentAt: new Date("2026-11-02T09:00:00Z") },
    ]);
    storageMock.getTask.mockImplementation(async (id: number) => (id === 300 ? { id: 300, completed: false } : undefined));
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(await r.json()).toEqual({ ok: true, restaure: false, raison: "relance_prevue" });
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
    expect(storageMock.deleteTask).not.toHaveBeenCalledWith(300);
    expect(storageMock.effacerEtatAvantReponse).not.toHaveBeenCalled();
    storageMock.getTask.mockReset();
  });

  it("pas-une-reponse : la relance du message requalifié est annulée, sa tâche retirée, la séquence reprend", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: {
      status: "active", currentStep: 2, nextRunAt: null, delayAnchorAt: null,
      relances: { "5": { statut: "validee", le: "x", taskId: 300 } },
    } }));
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", sentAt: new Date("2026-11-02T09:00:00Z") },
    ]);
    storageMock.getTask.mockImplementation(async (id: number) => (id === 300 ? { id: 300, completed: false } : undefined));
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(await r.json()).toEqual({ ok: true, restaure: true });
    expect(storageMock.deleteTask).toHaveBeenCalledWith(300);
    expect(storageMock.ecrireRelanceInbox).toHaveBeenCalledWith(11, 5, expect.objectContaining({ statut: "annulee" }));
    storageMock.getTask.mockReset();
  });

  it("pas-une-reponse : un jsonb qui ne porte que des relances n'est pas un état à restaurer", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: { relances: { "9": { statut: "refusee", le: "x" } } } }));
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(await r.json()).toEqual({ ok: true, restaure: false });
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
  });

  it("pas-une-reponse : autre conversation « à traiter » ou autre entrant « reponse » → même refus de restaurer (storage décide)", async () => {
    // Les deux cas sont tranchés par storage.autreReponseEnAttente (testé dans storage.inbox-restauration.test.ts).
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ id: 11 }));
    storageMock.autreReponseEnAttente.mockResolvedValueOnce(true);
    expect((await (await appel("POST", "/api/reponses/11/pas-une-reponse")).json()).raison).toBe("autre_reponse_en_attente");
  });

  it("pas-une-reponse : Jeanne a déjà répondu après le dernier entrant → 409 deja_repondu, rien touché", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { sens: "entrant", nature: "reponse", sentAt: new Date("2026-11-01T09:00:00Z") },
      { sens: "sortant", nature: "nous", sentAt: new Date("2026-11-01T10:00:00Z") },
    ]);
    const r = await appel("POST", "/api/reponses/11/pas-une-reponse");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, raison: "deja_repondu" });
    expect(storageMock.requalifierDernierEntrantInbox).not.toHaveBeenCalled();
    expect(storageMock.restaurerEtatSequence).not.toHaveBeenCalled();
    expect(storageMock.updateInboxConversation).not.toHaveBeenCalled();
  });

  it("envoyer : texte trop long → 400", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    envoi.envoyerReponse.mockResolvedValueOnce({ ok: false, raison: "texte_trop_long" });
    expect((await appel("POST", "/api/reponses/11/envoyer", { texte: "x" })).status).toBe(400);
  });

  it("traitee : conversation traitée et tâche cochée", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    storageMock.getTask.mockResolvedValue({ id: 99, completed: false });
    expect((await appel("POST", "/api/reponses/11/traitee")).status).toBe(200);
    expect(storageMock.updateInboxConversation).toHaveBeenCalledWith(11, { statut: "traitee", nonLu: false });
    expect(storageMock.completeTask).toHaveBeenCalledWith(99);
  });

  it("liste : filtres projectId/statut transmis, utilisateur courant", async () => {
    storageMock.listerConversationsInbox.mockResolvedValueOnce([{ id: 11 }]);
    const r = await appel("GET", "/api/reponses?projectId=5&statut=a_traiter");
    expect(await r.json()).toEqual([{ id: 11 }]);
    expect(storageMock.listerConversationsInbox).toHaveBeenCalledWith("u1", { projectId: 5, statut: "a_traiter" });
  });

  it("compte : nombre de conversations à traiter", async () => {
    storageMock.compterInboxATraiter.mockResolvedValueOnce(3);
    expect(await (await appel("GET", "/api/reponses/compte")).json()).toEqual({ aTraiter: 3 });
    expect(storageMock.compterInboxATraiter).toHaveBeenCalledWith("u1");
  });

  it("détail : fil fusionné et trié (séquence + boîte), marqué lu", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    storageMock.getLead.mockResolvedValueOnce({ id: 7, name: "Marc", prospectionCampaignId: null });
    storageMock.getOutreachMessages.mockResolvedValueOnce([
      { id: 1, platform: "linkedin", subject: null, body: "Bonjour", sentAt: new Date("2026-10-30T09:00:00Z") },
      { id: 2, platform: "email", subject: "x", body: "brouillon", sentAt: null },
    ]);
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Oui", sentAt: new Date("2026-10-29T09:00:00Z") },
    ]);
    const j = await (await appel("GET", "/api/reponses/11")).json();
    expect(j.messages.map((m: any) => m.body)).toEqual(["Oui", "Bonjour"]);
    expect(j.messages[1]).toMatchObject({ source: "sequence", sens: "sortant", canal: "linkedin" });
    expect(j.lead.id).toBe(7);
    expect(storageMock.updateInboxConversation).toHaveBeenCalledWith(11, { nonLu: false });
  });

  it("envoyer : passe le texte à envoyerReponse ; refus → 409 avec la raison", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    envoi.envoyerReponse.mockResolvedValueOnce({ ok: true });
    expect((await appel("POST", "/api/reponses/11/envoyer", { texte: "Bonjour" })).status).toBe(200);
    expect(envoi.envoyerReponse).toHaveBeenCalledWith(11, "u1", "Bonjour", expect.any(Object));
    envoi.envoyerReponse.mockResolvedValueOnce({ ok: false, raison: "compte_restreint" });
    const r = await appel("POST", "/api/reponses/11/envoyer", { texte: "Bonjour" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, raison: "compte_restreint" });
  });

  it("détail : la proposition de relance lue dans la réponse, rien de prêt avant la date", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: null }));
    storageMock.getLead.mockResolvedValueOnce({ id: 7, name: "Marc", prospectionCampaignId: null });
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Pas maintenant. Revenez vers moi dans 3 mois.", sentAt: new Date() },
    ]);
    const j = await (await appel("GET", "/api/reponses/11")).json();
    expect(j.messages[0].relance).toMatchObject({ statut: "proposee" });
    expect(j.messages[0].relance.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.relancePrete).toBeNull();
    expect(taches.creerTache).not.toHaveBeenCalled(); // une proposition ne crée rien
  });

  it("relance valider : tâche créée avec le brouillon rédigé, jamais d'envoi", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: null }));
    storageMock.getInboxMessages.mockResolvedValue([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi dans 3 mois.", sentAt: new Date() },
    ]);
    storageMock.getLead.mockResolvedValue({ id: 7, name: "Marc Dupont", company: "Acme", projectId: null });
    storageMock.getLeadSequenceState.mockResolvedValue({ status: "stopped_replied" });
    proposition.proposerReponse.mockResolvedValueOnce("Bonjour Marc,\n\nVous m'aviez dit de revenir vers vous.");
    taches.creerTache.mockImplementation(async (_u: string, d: any) => ({ ok: true, tache: { id: 300, ...d } }));
    const r = await appel("POST", "/api/reponses/11/relances/5/valider", {});
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, taskId: 300 });
    const [userId, donnees] = taches.creerTache.mock.calls[0] as any;
    expect(userId).toBe("u1");
    expect(donnees).toMatchObject({ title: "Relancer Marc (Acme)", source: "relance_prospect", leadId: 7, scheduledDate: j.date });
    expect(donnees.actionData.relance.texte).toContain("revenir vers vous");
    expect(proposition.proposerReponse).toHaveBeenCalledWith("u1", 11, undefined, expect.objectContaining({ date: j.date }));
    expect(storageMock.reserverRelanceInbox).toHaveBeenCalledWith(11, 5, expect.any(Date));
    expect(storageMock.ecrireRelanceInbox).toHaveBeenCalledWith(11, 5, expect.objectContaining({ statut: "validee", taskId: 300 }), undefined);
    expect(storageMock.updateLeadSequenceState).not.toHaveBeenCalled(); // déjà arrêtée
    expect(envoi.envoyerReponse).not.toHaveBeenCalled();
    storageMock.getInboxMessages.mockReset();
    storageMock.getInboxMessages.mockResolvedValue([]);
    storageMock.getLead.mockReset();
    taches.creerTache.mockReset();
  });

  it("détail : prospect désinscrit → aucune proposition de relance", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: null }));
    storageMock.getLead.mockResolvedValueOnce({ id: 7, name: "Marc", prospectionCampaignId: null });
    storageMock.isLeadUnsubscribed.mockResolvedValueOnce(true);
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi dans 3 mois.", sentAt: new Date() },
    ]);
    const j = await (await appel("GET", "/api/reponses/11")).json();
    expect(j.messages[0].relance).toBeUndefined();
    expect(j.relancePrete).toBeNull();
  });

  it("relance texte : le brouillon modifié est rangé dans la tâche de l'utilisatrice, jamais envoyé", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: { relances: { "5": { statut: "validee", le: "x", taskId: 300, date: "2027-01-04" } } } }));
    storageMock.getInboxMessages.mockResolvedValue([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi début 2027.", sentAt: new Date() },
    ]);
    storageMock.getTask.mockImplementation(async (id: number) => (id === 300
      ? { id: 300, userId: "u1", completed: false, archivedAt: null, scheduledDate: "2027-01-04", actionData: { lien: "/x", relance: { texte: "Ancien", date: "2027-01-04" } } }
      : undefined));
    const r = await appel("POST", "/api/reponses/11/relances/5/texte", { texte: "Nouveau brouillon" });
    expect(await r.json()).toEqual({ ok: true, date: "2027-01-04" });
    expect(storageMock.updateTask).toHaveBeenCalledWith(300, { actionData: { lien: "/x", relance: { texte: "Nouveau brouillon", date: "2027-01-04" } } });
    expect(envoi.envoyerReponse).not.toHaveBeenCalled();
    // Trop long → 400, rien écrit.
    storageMock.updateTask.mockClear();
    const long = await appel("POST", "/api/reponses/11/relances/5/texte", { texte: "x".repeat(8001) });
    expect(long.status).toBe(400);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
    // Tâche d'un autre compte → 404.
    storageMock.getTask.mockImplementation(async () => ({ id: 300, userId: "u2", completed: false, archivedAt: null, actionData: {} }));
    expect((await appel("POST", "/api/reponses/11/relances/5/texte", { texte: "Volé" })).status).toBe(404);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
    storageMock.getTask.mockReset();
    storageMock.getInboxMessages.mockReset();
    storageMock.getInboxMessages.mockResolvedValue([]);
  });

  it("relance texte : relance non validée → 409, rien écrit", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: null }));
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi début 2027.", sentAt: new Date() },
    ]);
    const r = await appel("POST", "/api/reponses/11/relances/5/texte", { texte: "Bonjour" });
    expect(r.status).toBe(409);
    expect(storageMock.updateTask).not.toHaveBeenCalled();
  });

  it("relance refuser : « Non merci » persiste la décision", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi en septembre.", sentAt: new Date() },
    ]);
    const r = await appel("POST", "/api/reponses/11/relances/5/refuser");
    expect(await r.json()).toEqual({ ok: true });
    expect(storageMock.refuserRelanceInbox).toHaveBeenCalledWith(11, 5, expect.any(Date));
    expect(envoi.envoyerReponse).not.toHaveBeenCalled();
  });

  it("envoyer : le jour de la relance, sa tâche est cochée après l'envoi", async () => {
    const hier = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    storageMock.getInboxConversationParId.mockResolvedValue(conv({ etatAvantReponse: { relances: { "5": { statut: "validee", le: "x", taskId: 300 } } } }));
    storageMock.getInboxMessages.mockResolvedValueOnce([
      { id: 5, sens: "entrant", nature: "reponse", subject: null, body: "Revenez vers moi en septembre.", sentAt: new Date("2026-01-05T09:00:00Z") },
    ]);
    storageMock.getTask.mockImplementation(async (id: number) => (id === 300
      ? { id: 300, completed: false, archivedAt: null, scheduledDate: hier, actionData: { relance: { texte: "Bonjour Marc," } } }
      : undefined));
    envoi.envoyerReponse.mockResolvedValueOnce({ ok: true });
    expect((await appel("POST", "/api/reponses/11/envoyer", { texte: "Bonjour Marc," })).status).toBe(200);
    expect(storageMock.completeTask).toHaveBeenCalledWith(300);
    storageMock.getTask.mockReset();
  });

  it("proposition : renvoie le texte proposé", async () => {
    storageMock.getInboxConversationParId.mockResolvedValue(conv());
    const r = await appel("POST", "/api/reponses/11/proposition");
    expect(await r.json()).toEqual({ texte: "Merci !" });
    expect(proposition.proposerReponse).toHaveBeenCalledWith("u1", 11);
  });
});

describe("GET /api/reponses/par-lead/:leadId", () => {
  it("renvoie la conversation à traiter du prospect (liste filtrée par utilisateur)", async () => {
    storageMock.listerConversationsInbox.mockResolvedValueOnce([{ id: 4, leadId: 8 }, { id: 5, leadId: 9 }] as any[]);
    const r = await appel("GET", "/api/reponses/par-lead/9");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ conversationId: 5 });
    expect(storageMock.listerConversationsInbox).toHaveBeenCalledWith("u1", { statut: "a_traiter" });
  });
  it("404 quand rien n'attend pour ce prospect, 400 si l'identifiant est invalide", async () => {
    storageMock.listerConversationsInbox.mockResolvedValueOnce([{ id: 4, leadId: 8 }] as any[]);
    expect((await appel("GET", "/api/reponses/par-lead/9")).status).toBe(404);
    expect((await appel("GET", "/api/reponses/par-lead/abc")).status).toBe(400);
  });
});
