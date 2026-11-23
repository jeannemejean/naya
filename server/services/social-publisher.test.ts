import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = {
  getDueScheduledContent: vi.fn(),
  getProcessingContent: vi.fn(async () => []),
  claimContentForPosting: vi.fn(async () => true),
  updateContent: vi.fn(async () => ({})),
  getMediaItemById: vi.fn(async () => ({ url: "https://x/img.jpg", mimeType: "image/jpeg" })),
  createTask: vi.fn(async (t: any) => ({ id: 1, ...t })),
};
vi.mock("../storage", () => ({ storage }));
const publishPost = vi.fn();
vi.mock("./social-publishers", () => ({ publishPost: (...a: any[]) => publishPost(...a), igFinishAsync: vi.fn(), tiktokFinishAsync: vi.fn() }));
vi.mock("./social-integrations", () => ({ socialMediaService: {} }));
vi.mock("./connexions/comptes", () => ({
  compteDePublication: vi.fn(async () => ({ compte: { platform: "instagram", accessToken: "t", accountId: "a", expiresAt: null } })),
}));
// db : sélection (alerte déjà ouverte ?) vide ; mises à jour du rattrapage : rien à rattraper.
const chaine = (fin: any) => new Proxy({}, { get: (_t, k) => (k === "then" ? (r: any) => r(fin) : () => chaine(fin)) });
vi.mock("../db", () => ({ db: { select: () => chaine([]), update: () => chaine([]) } }));

const { publishDueContent } = await import("./social-publisher");

const post = (o: Record<string, unknown> = {}) => ({
  id: 7, userId: "u", title: "Post de lundi", platform: "Instagram", autoPost: true, postStatus: "pending",
  body: "texte", mediaIds: [1], lastError: null, scheduledFor: new Date(), ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("publishDueContent", () => {
  it("erreur passagère : réessai prévu, pas d'alerte", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockResolvedValue({ state: "failed", error: "fetch failed" });
    await publishDueContent();
    const maj = storage.updateContent.mock.calls.at(-1)![1] as any;
    expect(maj.postStatus).toBe("pending");
    expect(maj.lastError).toMatch(/^reessai:1@/);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("erreur définitive : échec et tâche d'alerte du jour", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockResolvedValue({ state: "failed", error: "Invalid parameter" });
    await publishDueContent();
    expect((storage.updateContent.mock.calls.at(-1)![1] as any).postStatus).toBe("failed");
    expect(storage.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Publication échouée : Post de lundi", source: "publication_echec", contentId: 7,
    }));
  });

  it("réessai pas encore dû : ni réclamé ni publié", async () => {
    const plusTard = new Date(Date.now() + 10 * 60_000).toISOString();
    storage.getDueScheduledContent.mockResolvedValue([post({ lastError: `reessai:1@${plusTard}|fetch failed` })]);
    await publishDueContent();
    expect(storage.claimContentForPosting).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("réussite : publié, pas d'alerte", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    const r = await publishDueContent();
    expect(r.posted).toBe(1);
    expect(storage.createTask).not.toHaveBeenCalled();
  });
});
