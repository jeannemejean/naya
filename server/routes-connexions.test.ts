// Routes des connexions d'un projet client. `./storage`, `./auth`, SendGrid et Unipile mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
let connexion: any;
let prefs: any = { linkedinUnipileAccountId: "acc-jeanne" };
const storageMock = {
  getProject: vi.fn(async (id: number, u: string) => {
    if (u !== "user-1") return undefined;
    if (id === 7) return { id: 7, projectKind: "client" };
    if (id === 5) return { id: 5, projectKind: "personal" };
    return undefined;
  }),
  getSocialAccounts: vi.fn(async () => [
    { id: 1, platform: "instagram", projectId: null, isActive: true, accountName: "jeanne", accessToken: "t" },
    { id: 2, platform: "instagram", projectId: 7, isActive: true, accountName: "client", accessToken: "t" },
    { id: 3, platform: "linkedin_page_300", projectId: 7, isActive: false, accountName: "Page client", accessToken: "t" },
    { id: 4, platform: "linkedin_page_100", projectId: null, isActive: true, accountName: "JMD", accessToken: "t" },
  ]),
  updateSocialAccount: vi.fn(async (id: number, _u: string, patch: any) => ({ id, ...patch })),
  deleteSocialAccount: vi.fn(async () => true),
  getConnexionProjet: vi.fn(async () => connexion),
  upsertConnexionProjet: vi.fn(async (_u: string, _p: number, patch: any) => (connexion = { ...(connexion ?? {}), ...patch })),
  getUserPreferences: vi.fn(async (): Promise<any> => prefs),
  updateUserPreferences: vi.fn(async (_u: string, patch: any) => { prefs = { ...prefs, ...patch }; }),
  getConnexionsProjetDe: vi.fn(async () => [] as any[]),
  getProspectionCampaigns: vi.fn(async () => [{ id: 31, projectId: 7 }, { id: 32, projectId: 9 }, { id: 33, projectId: 7 }]),
  purgeLeadStepMessagesForCampaign: vi.fn(async () => 0),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const sg = vi.hoisted(() => ({ getSenderStatus: vi.fn(async () => "none"), createSingleSender: vi.fn(async () => ({ ok: true })) }));
vi.mock("./services/sendgrid-senders", () => sg);
const li = vi.hoisted(() => ({
  linkedinConfigured: vi.fn(() => true),
  generateConnectLink: vi.fn(async (nom: string) => `https://unipile/link?name=${nom}`),
  listUnipileAccounts: vi.fn(async (): Promise<any[]> => [
    { id: "acc-jeanne", name: "user-1" }, { id: "acc-client", name: "user-1:projet:7" },
    { id: "gm-jeanne", type: "GOOGLE_OAUTH", name: "user-1", adresse: "jeanne@gmail.com" },
    { id: "gm-client", type: "GOOGLE_OAUTH", name: "user-1:projet:7", adresse: "marc@client.fr" },
  ]),
}));
vi.mock("./services/linkedin", () => li);

const { registerConnexionsRoutes } = await import("./routes-connexions");
const app = express();
app.use(express.json());
registerConnexionsRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => { vi.clearAllMocks(); connexion = undefined; prefs = { linkedinUnipileAccountId: "acc-jeanne" }; });

describe("routes des connexions d'un projet client", () => {
  it("projet d'une autre → 404 ; projet perso → 409 ; rien n'est écrit", async () => {
    for (const [m, p] of [["GET", ""], ["PUT", "/email"], ["POST", "/email/verify"], ["POST", "/linkedin/lien"], ["POST", "/gmail/lien"], ["POST", "/gmail/sync"], ["DELETE", "/gmail"], ["POST", "/linkedin/sync"], ["POST", "/linkedin/lever-restriction"], ["DELETE", "/linkedin"]]) {
      expect((await appel(m, `/api/projects/8/connexions${p}`, m === "PUT" ? { senderEmail: "x@y.z" } : undefined)).status).toBe(404);
      expect((await appel(m, `/api/projects/5/connexions${p}`, m === "PUT" ? { senderEmail: "x@y.z" } : undefined)).status).toBe(409);
    }
    expect(storageMock.upsertConnexionProjet).not.toHaveBeenCalled();
    expect(li.generateConnectLink).not.toHaveBeenCalled();
  });

  it("GET : réseaux du client seulement, connexion sans clé", async () => {
    connexion = { senderEmail: "marc@client.fr", senderName: "Marc", sendgridApiKey: "chiffree" };
    const j = await (await appel("GET", "/api/projects/7/connexions")).json();
    expect(j.reseaux.comptes.map((c: any) => c.id)).toEqual([2]);
    expect(j.reseaux.statut.instagram.accountName).toBe("client");
    expect(j.email).toMatchObject({ senderEmail: "marc@client.fr", senderName: "Marc", hasOwnKey: true });
    expect(JSON.stringify(j)).not.toContain("chiffree");
  });

  it("PUT e-mail : clé chiffrée, jamais renvoyée ; vérification demandée quand l'adresse est complète", async () => {
    const r = await appel("PUT", "/api/projects/7/connexions/email", {
      senderEmail: " marc@client.fr ", senderName: "Marc", sendgridApiKey: "SG.secret", address: "2 av", city: "Paris", country: "France",
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    const patch = storageMock.upsertConnexionProjet.mock.calls[0][2];
    expect(patch.senderEmail).toBe("marc@client.fr");
    expect(patch.sendgridApiKey).toBeTruthy();
    expect(patch.sendgridApiKey).not.toBe("SG.secret");
    expect(JSON.stringify(j)).not.toContain("SG.secret");
    expect(j.verificationTriggered).toBe(true);
    expect(sg.createSingleSender).toHaveBeenCalledWith("SG.secret", expect.objectContaining({ email: "marc@client.fr", city: "Paris" }));
  });

  it("signature changée : les messages déjà rédigés des campagnes du client sont périmés (et seulement eux)", async () => {
    connexion = { senderName: "Marc" };
    await appel("PUT", "/api/projects/7/connexions/email", { senderName: "Sophie" });
    expect(storageMock.purgeLeadStepMessagesForCampaign.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([31, 33]);
    vi.clearAllMocks();
    await appel("PUT", "/api/projects/7/connexions/email", { senderName: "Sophie", city: "Lyon" });
    expect(storageMock.purgeLeadStepMessagesForCampaign).not.toHaveBeenCalled();
  });

  it("pages LinkedIn en attente : listées, puis choisies ou écartées — seulement celles du projet", async () => {
    const j = await (await appel("GET", "/api/projects/7/connexions")).json();
    expect(j.reseaux.enAttente).toEqual([{ id: 3, platform: "linkedin_page_300", accountName: "Page client" }]);
    expect((await appel("POST", "/api/projects/7/connexions/reseaux/3/activer")).status).toBe(200);
    expect(storageMock.updateSocialAccount).toHaveBeenCalledWith(3, "user-1", { isActive: true });
    expect((await appel("POST", "/api/projects/7/connexions/reseaux/4/activer")).status).toBe(404);
    expect((await appel("DELETE", "/api/projects/7/connexions/reseaux/1")).status).toBe(404);
    expect((await appel("DELETE", "/api/projects/7/connexions/reseaux/3")).status).toBe(200);
    expect(storageMock.deleteSocialAccount).toHaveBeenCalledWith(3, "user-1");
  });

  it("LinkedIn : lien et synchro au nom du projet, jamais le compte de l'utilisatrice", async () => {
    const { url } = await (await appel("POST", "/api/projects/7/connexions/linkedin/lien")).json();
    expect(url).toContain("user-1:projet:7");
    const j = await (await appel("POST", "/api/projects/7/connexions/linkedin/sync")).json();
    expect(storageMock.upsertConnexionProjet).toHaveBeenCalledWith("user-1", 7, expect.objectContaining({ linkedinUnipileAccountId: "acc-client", linkedinAccountConnectedAt: expect.any(Date) }));
    expect(j.linkedin.connected).toBe(true);
    li.listUnipileAccounts.mockResolvedValueOnce([{ id: "acc-jeanne", name: "user-1" }]);
    expect((await appel("POST", "/api/projects/7/connexions/linkedin/sync")).status).toBe(404);
  });

  it("LinkedIn : le même profil que celui de l'utilisatrice (deux connexions Unipile) est refusé — un seul budget", async () => {
    li.listUnipileAccounts.mockResolvedValueOnce([
      { id: "acc-jeanne", name: "user-1", profil: "li-jeanne" },
      { id: "acc-client", name: "user-1:projet:7", profil: "li-jeanne" },
    ] as any);
    const r = await appel("POST", "/api/projects/7/connexions/linkedin/sync");
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe("linkedin_deja_utilise");
    expect(storageMock.upsertConnexionProjet).not.toHaveBeenCalled();
  });

  it("LinkedIn : reconnecter le même compte ne relance pas la montée en charge", async () => {
    connexion = { linkedinUnipileAccountId: "acc-client", linkedinAccountConnectedAt: new Date("2026-09-01") };
    await appel("POST", "/api/projects/7/connexions/linkedin/sync");
    expect(storageMock.upsertConnexionProjet.mock.calls[0][2]).toEqual({ linkedinUnipileAccountId: "acc-client", comptesDeconnectes: null });
  });
});

describe("Gmail d'un projet client", () => {
  it("lien : provider GOOGLE, nom du projet", async () => {
    const r = await appel("POST", "/api/projects/7/connexions/gmail/lien");
    expect((await r.json()).url).toContain("name=user-1:projet:7");
    expect(li.generateConnectLink).toHaveBeenCalledWith("user-1:projet:7", ["GOOGLE"], undefined);
  });

  it("sync : le compte Google du projet (pas celui de l'utilisatrice), adresse reprise, alerte e-mail levée", async () => {
    connexion = { comptesDeconnectes: { email: "2026-10-01", linkedin: "2026-10-02" } };
    const j = await (await appel("POST", "/api/projects/7/connexions/gmail/sync")).json();
    expect(j.gmail).toMatchObject({ connected: true, address: "marc@client.fr" });
    const patch = storageMock.upsertConnexionProjet.mock.calls[0][2];
    expect(patch).toMatchObject({ emailUnipileAccountId: "gm-client", senderEmail: "marc@client.fr", comptesDeconnectes: { linkedin: "2026-10-02" } });
    expect(patch.emailAccountConnectedAt).toBeInstanceOf(Date);
  });

  it("sync : adresse d'envoi déjà réglée conservée", async () => {
    connexion = { senderEmail: "autre@client.fr" };
    await appel("POST", "/api/projects/7/connexions/gmail/sync");
    expect(storageMock.upsertConnexionProjet.mock.calls[0][2]).not.toHaveProperty("senderEmail");
  });

  it("sync : seul un compte Google de l'utilisatrice existe → 404, rien écrit", async () => {
    li.listUnipileAccounts.mockResolvedValueOnce([{ id: "gm-jeanne", type: "GOOGLE_OAUTH", name: "user-1" }, { id: "acc-client", name: "user-1:projet:7" }]);
    expect((await appel("POST", "/api/projects/7/connexions/gmail/sync")).status).toBe(404);
    expect(storageMock.upsertConnexionProjet).not.toHaveBeenCalled();
  });

  it("sync LinkedIn : lève l'alerte linkedin seulement", async () => {
    connexion = { comptesDeconnectes: { email: "2026-10-01", linkedin: "2026-10-02" } };
    await appel("POST", "/api/projects/7/connexions/linkedin/sync");
    expect(storageMock.upsertConnexionProjet.mock.calls[0][2].comptesDeconnectes).toEqual({ email: "2026-10-01" });
  });

  it("DELETE : détache Gmail seulement", async () => {
    connexion = { emailUnipileAccountId: "gm-client", linkedinUnipileAccountId: "acc-client", comptesDeconnectes: { email: "2026-10-01" } };
    const j = await (await appel("DELETE", "/api/projects/7/connexions/gmail")).json();
    expect(j.gmail.connected).toBe(false);
    expect(connexion.linkedinUnipileAccountId).toBe("acc-client");
    expect(connexion.comptesDeconnectes).toBeNull();
  });
});

describe("garde : un Gmail ne sert qu'à un périmètre", () => {
  it("projet : compte déjà celui de l'utilisatrice → 409, rien écrit", async () => {
    prefs = { emailUnipileAccountId: "gm-client" };
    const r = await appel("POST", "/api/projects/7/connexions/gmail/sync");
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe("gmail_deja_utilise");
    expect(storageMock.upsertConnexionProjet).not.toHaveBeenCalled();
  });
  it("projet : même adresse déjà reliée à un autre projet → 409", async () => {
    storageMock.getConnexionsProjetDe.mockResolvedValueOnce([{ projectId: 9, emailUnipileAccountId: "gm-autre" }]);
    li.listUnipileAccounts.mockResolvedValueOnce([
      { id: "gm-client", type: "GOOGLE_OAUTH", name: "user-1:projet:7", adresse: "Marc@client.fr" },
      { id: "gm-autre", type: "GOOGLE_OAUTH", name: "user-1:projet:9", adresse: "marc@client.fr" },
    ]);
    expect((await appel("POST", "/api/projects/7/connexions/gmail/sync")).status).toBe(409);
  });
  it("utilisatrice : compte déjà relié à un client → 409, rien écrit", async () => {
    storageMock.getConnexionsProjetDe.mockResolvedValueOnce([{ projectId: 7, emailUnipileAccountId: "gm-jeanne" }]);
    const r = await appel("POST", "/api/prospection/gmail/sync");
    expect(r.status).toBe(409);
    expect(storageMock.updateUserPreferences).not.toHaveBeenCalled();
  });
});

describe("Gmail de l'utilisatrice", () => {
  it("lien : provider GOOGLE, son propre nom", async () => {
    await appel("POST", "/api/prospection/gmail/connect-link");
    expect(li.generateConnectLink).toHaveBeenCalledWith("user-1", ["GOOGLE"], undefined);
  });
  it("sync : son compte Google (pas celui du projet), adresse reprise, alerte e-mail levée", async () => {
    prefs = { comptesDeconnectes: { email: "2026-10-01", linkedin: "2026-10-02" } };
    expect((await appel("POST", "/api/prospection/gmail/sync")).status).toBe(200);
    const patch = storageMock.updateUserPreferences.mock.calls[0][1];
    expect(patch).toMatchObject({ emailUnipileAccountId: "gm-jeanne", prospectionSenderEmail: "jeanne@gmail.com", comptesDeconnectes: { linkedin: "2026-10-02" } });
    expect(patch.emailAccountConnectedAt).toBeInstanceOf(Date);
  });
  it("sync : adresse d'envoi déjà réglée conservée ; aucun compte Google à son nom → 404", async () => {
    prefs = { prospectionSenderEmail: "contact@jmd.fr" };
    await appel("POST", "/api/prospection/gmail/sync");
    expect(storageMock.updateUserPreferences.mock.calls[0][1]).not.toHaveProperty("prospectionSenderEmail");
    li.listUnipileAccounts.mockResolvedValueOnce([{ id: "gm-client", type: "GOOGLE_OAUTH", name: "user-1:projet:7" }]);
    expect((await appel("POST", "/api/prospection/gmail/sync")).status).toBe(404);
  });
  it("status : l'adresse du compte Google relié, état déconnecté exposé", async () => {
    prefs = { emailUnipileAccountId: "gm-jeanne", prospectionSenderEmail: "autre@x.fr", comptesDeconnectes: { email: "2026-10-05" } };
    expect(await (await appel("GET", "/api/prospection/gmail/status")).json())
      .toEqual({ configured: true, connected: true, address: "jeanne@gmail.com", disconnectedAt: "2026-10-05" });
  });
  it("DELETE : détache Gmail, garde LinkedIn", async () => {
    prefs = { emailUnipileAccountId: "gm-jeanne", linkedinUnipileAccountId: "acc-jeanne", comptesDeconnectes: { email: "2026-10-05" } };
    await appel("DELETE", "/api/prospection/gmail");
    expect(prefs).toMatchObject({ emailUnipileAccountId: null, emailAccountConnectedAt: null, comptesDeconnectes: null, linkedinUnipileAccountId: "acc-jeanne" });
  });
});

describe("DELETE /api/prospection/linkedin", () => {
  it("délie le compte, garde la date de connexion et la restriction", async () => {
    const quand = new Date("2026-09-01");
    prefs = {
      linkedinUnipileAccountId: "acc-jeanne", linkedinAccountConnectedAt: quand,
      linkedinRestrictedAt: quand, linkedinRestrictedReason: "limite",
      comptesDeconnectes: { linkedin: "2026-10-01", email: "2026-10-02" },
    };
    expect((await appel("DELETE", "/api/prospection/linkedin")).status).toBe(200);
    expect(prefs).toMatchObject({
      linkedinUnipileAccountId: null, linkedinAccountConnectedAt: quand,
      linkedinRestrictedAt: quand, linkedinRestrictedReason: "limite", comptesDeconnectes: { email: "2026-10-02" },
    });
    expect(storageMock.updateUserPreferences.mock.calls[0][1]).not.toHaveProperty("linkedinAccountConnectedAt");
  });
});


// Unipile ne garde pas le `name` du lien sur le compte (constaté en prod : le compte Google
// s'appelle d'après son adresse) : le rattachement passe par `notify_url`.
describe("notification Unipile d'un compte relié", () => {
  const SECRET = "secret-test";
  const reel = [
    { id: "gm-reel", type: "GOOGLE_OAUTH", name: "jeanne@agence.com", adresse: "jeanne@agence.com" },
    { id: "li-reel", type: "LINKEDIN", name: "Jeanne Mejean" },
    { id: "gm-client", type: "GOOGLE_OAUTH", name: "marc@client.fr", adresse: "marc@client.fr" },
  ];
  const urlDe = async (nom: string, canal: "gmail" | "linkedin") => {
    const { urlNotification } = await import("./services/connexions/rattacher-compte");
    return new URL(urlNotification(nom, canal)!);
  };
  const notifier = (u: URL, body: unknown) =>
    fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  beforeEach(() => {
    process.env.UNIPILE_WEBHOOK_SECRET = SECRET;
    process.env.APP_URL = "https://naya.test";
    prefs = {};
  });
  afterAll(() => { delete process.env.UNIPILE_WEBHOOK_SECRET; delete process.env.APP_URL; });

  it("le lien porte une adresse de notification signée (https seulement)", async () => {
    await appel("POST", "/api/prospection/gmail/connect-link");
    const notif = li.generateConnectLink.mock.calls[0][2] as string;
    expect(notif).toMatch(/^https:\/\/naya\.test\/api\/unipile\/compte-relie\?canal=gmail&sig=/);
    process.env.APP_URL = "http://naya.test";
    await appel("POST", "/api/prospection/gmail/connect-link");
    expect(li.generateConnectLink.mock.calls[1][2]).toBeUndefined();
  });

  it("Gmail de l'utilisatrice : rangé à la notification, puis « Terminé » le retrouve", async () => {
    li.listUnipileAccounts.mockResolvedValue(reel);
    const r = await notifier(await urlDe("user-1", "gmail"), { status: "CREATION_SUCCESS", account_id: "gm-reel", name: "user-1" });
    expect(r.status).toBe(200);
    expect(prefs).toMatchObject({ emailUnipileAccountId: "gm-reel", prospectionSenderEmail: "jeanne@agence.com" });
    const quand = prefs.emailAccountConnectedAt;
    expect(quand).toBeInstanceOf(Date);
    expect((await appel("POST", "/api/prospection/gmail/sync")).status).toBe(200);
    expect(prefs.emailAccountConnectedAt).toBe(quand); // même compte : la date ne bouge pas
    li.listUnipileAccounts.mockReset();
  });

  it("LinkedIn d'un projet client : rangé dans le projet, jamais chez l'utilisatrice", async () => {
    li.listUnipileAccounts.mockResolvedValueOnce(reel);
    await notifier(await urlDe("user-1:projet:7", "linkedin"), { status: "CREATION_SUCCESS", account_id: "li-reel", name: "user-1:projet:7" });
    expect(storageMock.upsertConnexionProjet.mock.calls[0][1]).toBe(7);
    expect(connexion).toMatchObject({ linkedinUnipileAccountId: "li-reel" });
    expect(storageMock.updateUserPreferences).not.toHaveBeenCalled();
  });

  it("signature d'un autre nom ou d'un autre canal → 401, rien écrit", async () => {
    const u = await urlDe("user-2", "gmail");
    expect((await notifier(u, { account_id: "gm-reel", name: "user-1" })).status).toBe(401);
    const v = await urlDe("user-1", "linkedin");
    v.searchParams.set("canal", "gmail");
    expect((await notifier(v, { account_id: "gm-reel", name: "user-1" })).status).toBe(401);
    expect(storageMock.updateUserPreferences).not.toHaveBeenCalled();
  });

  it("Gmail déjà relié à un client → non rangé chez l'utilisatrice (200 quand même)", async () => {
    li.listUnipileAccounts.mockResolvedValueOnce(reel);
    storageMock.getConnexionsProjetDe.mockResolvedValueOnce([{ projectId: 7, emailUnipileAccountId: "gm-reel" }]);
    const r = await notifier(await urlDe("user-1", "gmail"), { account_id: "gm-reel", name: "user-1" });
    expect(r.status).toBe(200);
    expect(storageMock.updateUserPreferences).not.toHaveBeenCalled();
  });
});
