// Routes des connexions d'un projet client. `./storage`, `./auth`, SendGrid et Unipile mockés.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
let connexion: any;
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
  getProspectionCampaigns: vi.fn(async () => [{ id: 31, projectId: 7 }, { id: 32, projectId: 9 }, { id: 33, projectId: 7 }]),
  purgeLeadStepMessagesForCampaign: vi.fn(async () => 0),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const sg = vi.hoisted(() => ({ getSenderStatus: vi.fn(async () => "none"), createSingleSender: vi.fn(async () => ({ ok: true })) }));
vi.mock("./services/sendgrid-senders", () => sg);
const li = vi.hoisted(() => ({
  linkedinConfigured: vi.fn(() => true),
  generateConnectLink: vi.fn(async (nom: string) => `https://unipile/link?name=${nom}`),
  listUnipileAccounts: vi.fn(async () => [{ id: "acc-jeanne", name: "user-1" }, { id: "acc-client", name: "user-1:projet:7" }]),
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

beforeEach(() => { vi.clearAllMocks(); connexion = undefined; });

describe("routes des connexions d'un projet client", () => {
  it("projet d'une autre → 404 ; projet perso → 409 ; rien n'est écrit", async () => {
    for (const [m, p] of [["GET", ""], ["PUT", "/email"], ["POST", "/email/verify"], ["POST", "/linkedin/lien"], ["POST", "/linkedin/sync"], ["POST", "/linkedin/lever-restriction"], ["DELETE", "/linkedin"]]) {
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

  it("LinkedIn : reconnecter le même compte ne relance pas la montée en charge", async () => {
    connexion = { linkedinUnipileAccountId: "acc-client", linkedinAccountConnectedAt: new Date("2026-09-01") };
    await appel("POST", "/api/projects/7/connexions/linkedin/sync");
    expect(storageMock.upsertConnexionProjet.mock.calls[0][2]).toEqual({ linkedinUnipileAccountId: "acc-client" });
  });
});
