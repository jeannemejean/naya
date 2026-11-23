import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = {
  getDueScheduledContent: vi.fn(),
  getProcessingContent: vi.fn(async () => []),
  claimContentForPosting: vi.fn(async () => true),
  updateContent: vi.fn(async () => ({})),
  getMediaItemById: vi.fn(async () => ({ url: "https://x/img.jpg", mimeType: "image/jpeg" })),
  createTask: vi.fn(async (t: any) => ({ id: 1, ...t })),
  getContentById: vi.fn(async (): Promise<any> => undefined),
};
vi.mock("../storage", () => ({ storage }));
const publishPost = vi.fn();
const publierPremierCommentaire = vi.fn();
vi.mock("./social-publishers", () => ({
  publishPost: (...a: any[]) => publishPost(...a), igFinishAsync: vi.fn(), tiktokFinishAsync: vi.fn(),
  publierPremierCommentaire: (...a: any[]) => publierPremierCommentaire(...a),
}));
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

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("publishDueContent", () => {
  it("refus explicite du réseau (limite) : réessai prévu, pas d'alerte", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockResolvedValue({ state: "failed", error: "ig_429: Too many calls" });
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

  it("coupure réseau : jamais réessayée (le post a pu partir), alerte « à vérifier »", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockRejectedValue(new Error("fetch failed"));
    await publishDueContent();
    const maj = storage.updateContent.mock.calls.at(-1)![1] as any;
    expect(maj.postStatus).toBe("failed");
    expect(storage.createTask).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/peut-être parti/) }));
  });

  it("claim refusé (post bloqué par la validation client) : ni publié ni alerte", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    storage.claimContentForPosting.mockResolvedValueOnce(false);
    const r = await publishDueContent();
    expect(storage.claimContentForPosting).toHaveBeenCalledWith(7);
    expect(publishPost).not.toHaveBeenCalled();
    expect(storage.createTask).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it("réussite : publié, pas d'alerte", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post()]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    const r = await publishDueContent();
    expect(r.posted).toBe(1);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("publié avec un premier commentaire : posté une fois, marqué", async () => {
    vi.stubEnv("INSTAGRAM_COMMENTS_SCOPE", "1");
    storage.getDueScheduledContent.mockResolvedValue([post({ premierCommentaire: "Lien en bio 👇" })]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    publierPremierCommentaire.mockResolvedValue({ ok: true });
    await publishDueContent();
    expect(publierPremierCommentaire).toHaveBeenCalledWith(expect.objectContaining({ platform: "instagram", platformPostId: "p1", texte: "Lien en bio 👇" }));
    expect(storage.updateContent).toHaveBeenCalledWith(7, expect.objectContaining({ premierCommentaireAt: expect.any(Date) }));
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("Instagram sans la portée des commentaires : aucun appel, la tâche porte le texte, marqué traité", async () => {
    vi.stubEnv("INSTAGRAM_COMMENTS_SCOPE", "");
    storage.getDueScheduledContent.mockResolvedValue([post({ premierCommentaire: "Lien en bio" })]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    await publishDueContent();
    vi.unstubAllEnvs();
    expect(publierPremierCommentaire).not.toHaveBeenCalled();
    expect(storage.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Poster le premier commentaire : Post de lundi", source: "premier_commentaire", description: expect.stringContaining("Lien en bio"),
    }));
    expect(storage.updateContent).toHaveBeenCalledWith(7, expect.objectContaining({ premierCommentaireAt: expect.any(Date) }));
  });

  it("commentaire raté : le post reste publié, une tâche porte le texte à coller", async () => {
    vi.stubEnv("INSTAGRAM_COMMENTS_SCOPE", "1");
    storage.getDueScheduledContent.mockResolvedValue([post({ premierCommentaire: "Lien en bio" })]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    publierPremierCommentaire.mockResolvedValue({ ok: false, erreur: "ig_403: permission" });
    const r = await publishDueContent();
    expect(r.posted).toBe(1);
    expect(storage.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Poster le premier commentaire : Post de lundi", source: "premier_commentaire", description: expect.stringContaining("Lien en bio"),
    }));
  });

  it("couverture transmise au publieur", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post({ couvertureOffsetMs: 2000 })]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    await publishDueContent();
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ couverture: { url: null, offsetMs: 2000 } }));
  });

  it("options de post transmises au publieur", async () => {
    storage.getDueScheduledContent.mockResolvedValue([post({
      texteAlternatif: "alt", collaborateurs: ["a.b"], reelDansLeFil: false, nomAudio: "Son", linkedinDocument: true,
    })]);
    publishPost.mockResolvedValue({ state: "posted", platformPostId: "p1" });
    await publishDueContent();
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({ options: {
      texteAlternatif: "alt", collaborateurs: ["a.b"], reelDansLeFil: false, nomAudio: "Son", linkedinDocument: true, titre: "Post de lundi",
    } }));
  });
});
