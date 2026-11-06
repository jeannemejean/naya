// Routes de suppression définitive : authentifiées, utilisatrice tirée de req.userId, ids
// filtrés. Aucune base ni réseau : stockage simulé, dépendance injectée.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";

vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (q: any, _r: any, next: any) => { q.userId = "u1"; next(); } }));

const { registerSuppressionLeadsRoutes, MAX_SUPPRESSION_GROUPEE } = await import("./routes-suppression-leads");
const deps = { deleteLeads: vi.fn() };
const app = express();
app.use(express.json());
registerSuppressionLeadsRoutes(app, deps as any);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
beforeEach(() => { deps.deleteLeads.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("DELETE /api/leads/:id", () => {
  it("supprime le prospect de l'utilisatrice authentifiée", async () => {
    deps.deleteLeads.mockResolvedValueOnce({ supprimes: [7], refuses: [], bloques: 1 });
    const r = await appel("DELETE", "/api/leads/7");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ supprimes: 1, bloques: 1 });
    expect(deps.deleteLeads).toHaveBeenCalledWith([7], "u1");
  });
  it("pas à elle → 404 ; envoi en cours → 409 ; transaction annulée → 500", async () => {
    deps.deleteLeads.mockResolvedValueOnce({ supprimes: [], refuses: [{ id: 7, raison: "introuvable" }], bloques: 0 });
    expect((await appel("DELETE", "/api/leads/7")).status).toBe(404);
    deps.deleteLeads.mockResolvedValueOnce({ supprimes: [], refuses: [{ id: 7, raison: "envoi_en_cours" }], bloques: 0 });
    const r = await appel("DELETE", "/api/leads/7");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ message: "envoi_en_cours" });
    deps.deleteLeads.mockResolvedValueOnce({ supprimes: [], refuses: [{ id: 7, raison: "erreur" }], bloques: 0 });
    expect((await appel("DELETE", "/api/leads/7")).status).toBe(500);
  });
  it("id invalide → 400 sans toucher au stockage", async () => {
    expect((await appel("DELETE", "/api/leads/abc")).status).toBe(400);
    expect(deps.deleteLeads).not.toHaveBeenCalled();
  });
});

describe("POST /api/leads/bulk-delete", () => {
  it("ids nettoyés (entiers positifs, dédoublonnés), refus rendus tels quels", async () => {
    deps.deleteLeads.mockResolvedValueOnce({ supprimes: [1], refuses: [{ id: 2, raison: "introuvable" }], bloques: 0 });
    const r = await appel("POST", "/api/leads/bulk-delete", { ids: [1, 2, 1, "3", -4, 2.5] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ supprimes: 1, ids: [1], refuses: [{ id: 2, raison: "introuvable" }], bloques: 0 });
    expect(deps.deleteLeads).toHaveBeenCalledWith([1, 2], "u1");
  });
  it("aucun id → 400 ; plus de 100 ids → 400 explicite (l'interface découpe en lots)", async () => {
    expect((await appel("POST", "/api/leads/bulk-delete", { ids: [] })).status).toBe(400);
    const trop = Array.from({ length: MAX_SUPPRESSION_GROUPEE + 1 }, (_, i) => i + 1);
    const r = await appel("POST", "/api/leads/bulk-delete", { ids: trop });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ message: "too_many_ids", max: 100 });
    expect(deps.deleteLeads).not.toHaveBeenCalled();
  });
  it("exception → 500 sans détail", async () => {
    deps.deleteLeads.mockRejectedValueOnce(new Error("secret"));
    const r = await appel("POST", "/api/leads/bulk-delete", { ids: [1] });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ message: "delete_failed" });
  });
});
