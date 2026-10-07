// « Régénérer » un post passe par la mémoire de Naya (savoir déposé, préférences de marque),
// ne réécrit jamais un post publié, et ne laisse jamais un texte non relu partir seul.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
  hashPassword: vi.fn(), verifyPassword: vi.fn(), generateUserId: vi.fn(), generateJWT: vi.fn(),
}));
const storageMock = {
  getContentById: vi.fn(),
  getBrandDna: vi.fn(async () => ({ uniquePositioning: "x" })),
  updateContent: vi.fn(async (_id: number, data: any) => ({ id: 7, ...data })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const claudeMock = { callClaudeWithContext: vi.fn(async () => '{"title":"Nouvel angle","body":"Nouveau corps"}') };
vi.mock("./services/claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: claudeMock.callClaudeWithContext }));
vi.mock("./services/garde-langue", () => ({ imposerLangueDuCompte: vi.fn(async () => 0) }));
vi.mock("./services/campaign-reject/preferences", async (orig) => ({
  ...(await orig<any>()),
  preferencesDeLaMarque: vi.fn(async () => [{ content: "Pas de ton institutionnel", salience: 0.8 }]),
}));

const { registerRoutes } = await import("./routes");

let server: http.Server;
let port: number;
beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

const regen = () => fetch(`http://127.0.0.1:${port}/api/content/7/regenerate`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback: "trop long" }),
});
const post = { id: 7, userId: "user-1", projectId: 15, title: "A", body: "B", platform: "instagram", contentType: "post", pillar: "p", goal: "g", autoPost: true, postStatus: "pending", publishedAt: null };

describe("POST /api/content/:id/regenerate", () => {
  it("passe par la mémoire de Naya avec la marque du post, et injecte les préférences", async () => {
    storageMock.getContentById.mockResolvedValue(post);
    const res = await regen();
    expect(res.status).toBe(200);
    const appel = claudeMock.callClaudeWithContext.mock.calls[0][0] as any;
    expect(appel.projectId).toBe(15);
    expect(appel.userId).toBe("user-1");
    expect(appel.userMessage).toContain("Pas de ton institutionnel");
  });
  it("désactive la publication automatique du texte réécrit", async () => {
    storageMock.getContentById.mockResolvedValue(post);
    await regen();
    expect(storageMock.updateContent).toHaveBeenCalledWith(7, expect.objectContaining({ autoPost: false, title: "Nouvel angle" }));
  });
  it("refuse un post publié (409), sans appel IA ni écriture", async () => {
    storageMock.getContentById.mockResolvedValue({ ...post, publishedAt: new Date(), postStatus: "posted" });
    const res = await regen();
    expect(res.status).toBe(409);
    expect(claudeMock.callClaudeWithContext).not.toHaveBeenCalled();
    expect(storageMock.updateContent).not.toHaveBeenCalled();
  });
  it("réponse IA invalide → 500 sans écriture", async () => {
    storageMock.getContentById.mockResolvedValue(post);
    claudeMock.callClaudeWithContext.mockResolvedValueOnce('{"title":""}');
    const res = await regen();
    expect(res.status).toBe(500);
    expect(storageMock.updateContent).not.toHaveBeenCalled();
  });
});
