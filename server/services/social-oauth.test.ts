// Portée Instagram du premier commentaire : demandée seulement quand l'app Meta l'a (variable
// INSTAGRAM_COMMENTS_SCOPE=1) — une portée inconnue casserait la connexion Instagram.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
const { getInstagramAuthUrl } = await import("./social-oauth");

const portees = () => decodeURIComponent(new URL(getInstagramAuthUrl("s")).searchParams.get("scope") ?? "");

afterEach(() => { vi.unstubAllEnvs(); });

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
