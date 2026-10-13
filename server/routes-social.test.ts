// Routes des comptes sociaux. `./storage`, `./auth` et les échanges OAuth sont mockés ; la
// session est un objet partagé (une seule « navigatrice »).
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const igJeanne = { id: 1, platform: "instagram", projectId: null, isActive: true, accountName: "jeanne", accessToken: "t", expiresAt: null };
const igClient = { id: 2, platform: "instagram", projectId: 7, isActive: true, accountName: "client", accessToken: "t", expiresAt: null };
const storageMock = {
  getProject: vi.fn(async (id: number, u: string) => {
    if (u !== "user-1") return undefined;
    if (id === 7) return { id: 7, projectKind: "client" };
    if (id === 5) return { id: 5, projectKind: "personal" };
    return undefined;
  }),
  getSocialAccounts: vi.fn(async () => [igJeanne, igClient]),
  getSocialAccountByPlatform: vi.fn(async (_u: string, platform: string, projectId: number | null) =>
    [igJeanne, igClient].find((a) => a.platform === platform && a.projectId === projectId)),
  deleteSocialAccount: vi.fn(async () => true),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const oauth = vi.hoisted(() => ({
  getInstagramAuthUrl: vi.fn((state: string) => `https://ig/auth?state=${state}`),
  getLinkedInAuthUrl: vi.fn(() => "https://li"), getTwitterAuthUrl: vi.fn(() => "https://tw"), getTikTokAuthUrl: vi.fn(() => "https://tt"),
  exchangeInstagramCode: vi.fn(async () => {}), exchangeLinkedInCode: vi.fn(async () => {}),
  exchangeTwitterCode: vi.fn(async () => {}), exchangeTikTokCode: vi.fn(async () => {}),
  isPlatformConfigured: vi.fn(() => true),
}));
vi.mock("./services/social-oauth", () => oauth);

const { registerSocialRoutes } = await import("./routes-social");
let session: any = {};
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.session = session; next(); });
registerSocialRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, redirect: "manual" });

beforeEach(() => { vi.clearAllMocks(); session = {}; });

describe("routes des comptes sociaux", () => {
  it("projet d'une autre ou inconnu → 404 ; projet perso → 409", async () => {
    expect((await appel("GET", "/api/social/oauth/instagram/url?projectId=8")).status).toBe(404);
    expect((await appel("GET", "/api/social/accounts?projectId=abc")).status).toBe(404);
    expect((await appel("GET", "/api/social/oauth/instagram/url?projectId=5")).status).toBe(409);
    expect((await appel("DELETE", "/api/social/disconnect/instagram?projectId=5")).status).toBe(409);
    expect((await appel("DELETE", "/api/social/disconnect/instagram?projectId=8")).status).toBe(404);
    expect(storageMock.deleteSocialAccount).not.toHaveBeenCalled();
  });

  it("listes par périmètre : jamais les comptes d'un autre périmètre", async () => {
    const perso = await (await appel("GET", "/api/social/accounts")).json();
    expect(perso.map((a: any) => a.id)).toEqual([1]);
    const client = await (await appel("GET", "/api/social/accounts?projectId=7")).json();
    expect(client.map((a: any) => a.id)).toEqual([2]);
    const projetPerso = await (await appel("GET", "/api/social/accounts?projectId=5")).json();
    expect(projetPerso.map((a: any) => a.id)).toEqual([1]);
    const statut = await (await appel("GET", "/api/social/status?projectId=7")).json();
    expect(statut.instagram).toMatchObject({ accountName: "client", connected: true });
    expect(statut.linkedin.connected).toBe(false);
    expect(JSON.stringify(client)).not.toContain("accessToken");
  });

  it("OAuth d'un projet client : le compte est rangé dans le projet, retour sur la page projet", async () => {
    const { url } = await (await appel("GET", "/api/social/oauth/instagram/url?projectId=7")).json();
    const state = new URL(url).searchParams.get("state")!;
    expect(session.socialOAuthProjectId).toBe(7);
    const r = await appel("GET", `/api/social/oauth/instagram/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/projects/7?social=instagram&status=connected");
    expect(oauth.exchangeInstagramCode).toHaveBeenCalledWith("user-1", "abc", 7);
    expect(session.socialOAuthProjectId).toBeUndefined();
  });

  it("OAuth sans projet : compte de l'utilisatrice, retour aux Réglages", async () => {
    const { url } = await (await appel("GET", "/api/social/oauth/instagram/url")).json();
    const state = new URL(url).searchParams.get("state")!;
    const r = await appel("GET", `/api/social/oauth/instagram/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(r.headers.get("location")).toBe("/settings?social=instagram&status=connected");
    expect(oauth.exchangeInstagramCode).toHaveBeenCalledWith("user-1", "abc", null);
  });

  it("state différent de celui de la session → refus, aucun échange", async () => {
    await appel("GET", "/api/social/oauth/instagram/url?projectId=7");
    const r = await appel("GET", "/api/social/oauth/instagram/callback?code=abc&state=user-2:1");
    expect(r.headers.get("location")).toBe("/projects/7?social=instagram&status=error&reason=state_invalide");
    expect(oauth.exchangeInstagramCode).not.toHaveBeenCalled();
  });

  it("déconnexion dans le périmètre seulement", async () => {
    expect((await appel("DELETE", "/api/social/disconnect/instagram?projectId=7")).status).toBe(200);
    expect(storageMock.deleteSocialAccount).toHaveBeenCalledWith(2, "user-1");
    expect((await appel("DELETE", "/api/social/disconnect/instagram")).status).toBe(200);
    expect(storageMock.deleteSocialAccount).toHaveBeenLastCalledWith(1, "user-1");
  });
});
