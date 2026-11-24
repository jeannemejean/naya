// Portée Instagram du premier commentaire : demandée seulement quand l'app Meta l'a (variable
// INSTAGRAM_COMMENTS_SCOPE=1) — une portée inconnue casserait la connexion Instagram.
import { describe, it, expect, vi, afterEach } from "vitest";

const storage = vi.hoisted(() => ({
  getSocialAccounts: vi.fn(async () => [] as any[]),
  getSocialAccountByPlatform: vi.fn(async () => undefined as any),
  createSocialAccount: vi.fn(async (a: any) => ({ id: 1, ...a })),
  updateSocialAccount: vi.fn(async () => ({})),
}));
vi.mock("../storage", () => ({ storage }));
const { getInstagramAuthUrl, exchangeLinkedInCode } = await import("./social-oauth");

const portees = () => decodeURIComponent(new URL(getInstagramAuthUrl("s")).searchParams.get("scope") ?? "");

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("getInstagramAuthUrl — portée des commentaires", () => {
  it("par défaut : pas de instagram_business_manage_comments", () => {
    vi.stubEnv("IG_APP_ID", "app");
    vi.stubEnv("INSTAGRAM_COMMENTS_SCOPE", "");
    expect(portees()).toBe("instagram_business_basic,instagram_business_content_publish");
  });
  it("INSTAGRAM_COMMENTS_SCOPE=1 : portée ajoutée", () => {
    vi.stubEnv("IG_APP_ID", "app");
    vi.stubEnv("INSTAGRAM_COMMENTS_SCOPE", "1");
    expect(portees()).toContain("instagram_business_manage_comments");
  });
});

describe("exchangeLinkedInCode — projet perso ou client", () => {
  const reponses = (url: string) => {
    if (url.includes("accessToken")) return { access_token: "tok", expires_in: 3600 };
    if (url.includes("/v2/me")) return { id: "me1", localizedFirstName: "Jeanne", localizedLastName: "M" };
    if (url.includes("organizationalEntityAcls")) return { elements: [{ organizationalTarget: "urn:li:organization:300" }] };
    if (url.includes("/organizations/300")) return { id: 300, localizedName: "Marque" };
    return {};
  };
  const brancher = () => vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ json: async () => reponses(String(url)) })));

  it("projet perso : la page arrive utilisée dans le projet, aucun profil personnel", async () => {
    brancher();
    await exchangeLinkedInCode("u1", "code", 5, { repli: true });
    expect(storage.createSocialAccount).toHaveBeenCalledTimes(1);
    expect(storage.createSocialAccount).toHaveBeenCalledWith(expect.objectContaining({ platform: "linkedin_page_300", projectId: 5, isActive: true }));
  });

  it("projet perso : une page déjà rangée dans le projet est réactivée", async () => {
    brancher();
    storage.getSocialAccountByPlatform.mockResolvedValueOnce({ id: 9, platform: "linkedin_page_300", projectId: 5, isActive: false });
    await exchangeLinkedInCode("u1", "code", 5, { repli: true });
    expect(storage.updateSocialAccount).toHaveBeenCalledWith(9, "u1", expect.objectContaining({ isActive: true }));
  });

  it("client (inchangé) : la page arrive en attente", async () => {
    brancher();
    await exchangeLinkedInCode("u1", "code", 7);
    expect(storage.createSocialAccount).toHaveBeenCalledWith(expect.objectContaining({ platform: "linkedin_page_300", projectId: 7, isActive: false }));
  });
});
