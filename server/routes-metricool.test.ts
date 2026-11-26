import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
const { registerMetricoolRoutes } = await import("./routes-metricool");

let deps: any; let server: http.Server; let port: number;
const MARQUES = [{ blogId: "10", nom: "jeanne__md" }, { blogId: "20", nom: "Agence JMD" }, { blogId: "30", nom: "Encore Merci" }];
beforeEach(async () => {
  deps = {
    etat: vi.fn(async () => ({ connecte: true, etat: "ok", marques: MARQUES.slice(1) })),
    lire: vi.fn(async () => ({ jeton: "enregistre", mcUserId: "7", marques: MARQUES.slice(1) })),
    marques: vi.fn(async () => ({ ok: true, marques: MARQUES })),
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
const req = (m: string, body?: any, chemin = "connexion") => fetch(`http://127.0.0.1:${port}/api/metricool/${chemin}`, { method: m, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("connexion Metricool (routes)", () => {
  it("GET : l'état et les marques suivies, jamais le jeton", async () => {
    const t = await (await req("GET")).text();
    expect(JSON.parse(t)).toEqual({ connecte: true, etat: "ok", marques: MARQUES.slice(1) });
    expect(t).not.toMatch(/jeton|token/i);
  });
  it("POST marques : liste les marques du compte avec jeton + userId seulement", async () => {
    const r = await req("POST", { jeton: "t", mcUserId: "1" }, "marques");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ marques: MARQUES });
    expect(deps.marques).toHaveBeenCalledWith("t", "1");
  });
  it("POST marques : champs requis ; refus Metricool → 422", async () => {
    expect((await req("POST", { jeton: "t" }, "marques")).status).toBe(400);
    deps.marques.mockResolvedValue({ ok: false, raison: "refuse" });
    const r = await req("POST", { jeton: "t", mcUserId: "1" }, "marques");
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ message: "refuse" });
  });
  it("PUT : champs requis", async () => {
    expect((await req("PUT", { jeton: "t" })).status).toBe(400);
  });
  it("PUT avec des marques cochées : seules celles-là, avec leur nom, vérifiées sur 1 jour", async () => {
    const r = await req("PUT", { jeton: "t", mcUserId: "1", blogIds: ["20", "30", "inconnue"] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ connecte: true, etat: "ok", marques: MARQUES.slice(1) });
    const [cx, debut, fin] = deps.verifier.mock.calls[0];
    expect(cx).toEqual({ jeton: "t", mcUserId: "1", blogId: "20" });
    expect(fin.getTime() - debut.getTime()).toBe(86_400_000);
    expect(deps.enregistrer).toHaveBeenCalledWith("u1", { jeton: "t", mcUserId: "1", marques: MARQUES.slice(1) }, "ok", expect.any(Date));
  });
  it("PUT sans marques cochées : toutes les marques du compte", async () => {
    await req("PUT", { jeton: "t", mcUserId: "1" });
    expect(deps.enregistrer).toHaveBeenCalledWith("u1", { jeton: "t", mcUserId: "1", marques: MARQUES }, "ok", expect.any(Date));
  });
  it("PUT : aucune des marques cochées n'existe → 400, rien enregistré", async () => {
    expect((await req("PUT", { jeton: "t", mcUserId: "1", blogIds: ["999"] })).status).toBe(400);
    expect(deps.enregistrer).not.toHaveBeenCalled();
  });
  it("PUT refusé par Metricool (offre sans API, mauvais jeton) : 422, rien enregistré", async () => {
    deps.verifier.mockResolvedValue({ ok: false, raison: "refuse" });
    const r = await req("PUT", { jeton: "t", mcUserId: "1", blogIds: ["20"] });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ message: "refuse" });
    expect(deps.enregistrer).not.toHaveBeenCalled();
  });
  it("déjà connectée : liste et change les marques sans recoller le jeton", async () => {
    const l = await req("POST", {}, "marques");
    expect(await l.json()).toEqual({ marques: MARQUES });
    expect(deps.marques).toHaveBeenCalledWith("enregistre", "7");
    const r = await req("PUT", { blogIds: ["10"] });
    expect(r.status).toBe(200);
    expect(deps.enregistrer).toHaveBeenCalledWith("u1", { jeton: "enregistre", mcUserId: "7", marques: [MARQUES[0]] }, "ok", expect.any(Date));
  });
  it("pas connectée et rien collé : 400", async () => {
    deps.lire.mockResolvedValue(null);
    expect((await req("POST", {}, "marques")).status).toBe(400);
    expect((await req("PUT", { blogIds: ["10"] })).status).toBe(400);
  });
  it("DELETE", async () => {
    expect((await req("DELETE")).status).toBe(200);
    expect(deps.supprimer).toHaveBeenCalledWith("u1");
  });
});
