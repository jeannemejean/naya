import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
const { registerMetricoolRoutes } = await import("./routes-metricool");

let deps: any; let server: http.Server; let port: number;
beforeEach(async () => {
  deps = {
    etat: vi.fn(async () => ({ connecte: true, etat: "ok", blogId: "22" })),
    verifier: vi.fn(async () => ({ ok: true, posts: [] })),
    enregistrer: vi.fn(async () => {}),
    supprimer: vi.fn(async () => {}),
    maintenant: () => new Date("2026-11-25T09:00:00Z"),
  };
  const app = express(); app.use(express.json());
  registerMetricoolRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });
const req = (m: string, body?: any) => fetch(`http://127.0.0.1:${port}/api/metricool/connexion`, { method: m, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("connexion Metricool (routes)", () => {
  it("GET : l'état seulement, jamais le jeton", async () => {
    const t = await (await req("GET")).text();
    expect(JSON.parse(t)).toEqual({ connecte: true, etat: "ok", blogId: "22" });
    expect(t).not.toMatch(/jeton|token/i);
  });
  it("PUT : champs requis", async () => {
    expect((await req("PUT", { jeton: "t" })).status).toBe(400);
  });
  it("PUT : vérifié par un appel sur 1 jour, puis enregistré avec l'état", async () => {
    const r = await req("PUT", { jeton: "t", mcUserId: "1", blogId: "2" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ connecte: true, etat: "ok" });
    const [cx, debut, fin] = deps.verifier.mock.calls[0];
    expect(cx).toEqual({ jeton: "t", mcUserId: "1", blogId: "2" });
    expect(fin.getTime() - debut.getTime()).toBe(86_400_000);
    expect(deps.enregistrer).toHaveBeenCalledWith("u1", { jeton: "t", mcUserId: "1", blogId: "2" }, "ok", expect.any(Date));
  });
  it("PUT refusé par Metricool (offre sans API, mauvais jeton) : 422, rien enregistré", async () => {
    deps.verifier.mockResolvedValue({ ok: false, raison: "refuse" });
    const r = await req("PUT", { jeton: "t", mcUserId: "1", blogId: "2" });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ message: "refuse" });
    expect(deps.enregistrer).not.toHaveBeenCalled();
  });
  it("DELETE", async () => {
    expect((await req("DELETE")).status).toBe(200);
    expect(deps.supprimer).toHaveBeenCalledWith("u1");
  });
});
