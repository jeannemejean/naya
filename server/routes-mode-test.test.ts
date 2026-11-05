// Route « Envoyer un test » : authentifiée, utilisatrice tirée de req.userId, codes d'erreur
// renvoyés tels quels. Aucune base ni réseau : stockage simulé, dépendances injectées.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, afterAll } from "vitest";

vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (q: any, _r: any, next: any) => { q.userId = "u1"; next(); } }));
const service = vi.hoisted(() => ({ envoyerEmailTest: vi.fn() }));
vi.mock("./services/prospection-mode-test", () => service);

const { registerModeTestRoutes } = await import("./routes-mode-test");
const deps = { marque: "deps-test" } as any;
const app = express();
app.use(express.json());
registerModeTestRoutes(app, deps);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const poster = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("POST /api/prospection/campaigns/:id/test-email", () => {
  it("passe l'utilisatrice authentifiée, la campagne et le corps au service", async () => {
    service.envoyerEmailTest.mockResolvedValueOnce({ ok: true, leadId: 42, subject: "S", body: "B", secours: false });
    const r = await poster("/api/prospection/campaigns/7/test-email", { nom: "Claire", email: "c@x.fr" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, leadId: 42, subject: "S", body: "B", secours: false });
    expect(service.envoyerEmailTest).toHaveBeenCalledWith(deps, "u1", 7, { nom: "Claire", email: "c@x.fr" });
  });

  it("renvoie le statut et le code d'un refus", async () => {
    service.envoyerEmailTest.mockResolvedValueOnce({ ok: false, status: 404, code: "introuvable" });
    const r = await poster("/api/prospection/campaigns/8/test-email", { email: "c@x.fr" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ message: "introuvable" });
  });

  it("exception inattendue : 500 sans détail", async () => {
    service.envoyerEmailTest.mockRejectedValueOnce(new Error("boom params: secret"));
    const r = await poster("/api/prospection/campaigns/7/test-email", { email: "c@x.fr" });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ message: "echec_envoi" });
  });
});
