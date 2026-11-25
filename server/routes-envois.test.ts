import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
const { registerEnvoisRoutes } = await import("./routes-envois");

const e1 = { id: 1, userId: "u1", projectId: null, marque: "Sézane", objet: "Campagne", statut: "envoye", envoyeLe: "2026-11-20", prochaineRelance: "2026-11-27" };
let deps: any; let server: http.Server; let port: number;
beforeEach(async () => {
  deps = {
    lister: vi.fn(async () => [e1]),
    creer: vi.fn(async (_u: string, e: any) => ({ id: 2, userId: "u1", ...e })),
    lire: vi.fn(async (id: number, userId: string) => (id === 1 && userId === "u1" ? e1 : undefined)),
    maj: vi.fn(async (_u: string, _id: number, c: any) => ({ ...e1, ...c })),
    retirerRelanceNonFaite: vi.fn(async () => 1),
    projet: vi.fn(async (id: number, userId: string) => (id === 4 && userId === "u1" ? { id: 4 } : undefined)),
    aujourdhui: () => "2026-11-25",
  };
  const app = express(); app.use(express.json());
  registerEnvoisRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });
const req = (m: string, p: string, body?: any) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("routes envois", () => {
  it("POST : marque et objet requis ; défauts envoyé aujourd'hui, relance J+7", async () => {
    expect((await req("POST", "/api/envois", { marque: "" })).status).toBe(400);
    const r = await req("POST", "/api/envois", { marque: "Sézane", objet: "Campagne" });
    expect(r.status).toBe(200);
    expect(deps.creer).toHaveBeenCalledWith("u1", expect.objectContaining({ envoyeLe: "2026-11-25", prochaineRelance: "2026-12-02", statut: "envoye" }));
  });
  it("POST : projet d'une autre → 404", async () => {
    expect((await req("POST", "/api/envois", { marque: "A", objet: "B", projectId: 9 })).status).toBe(404);
  });
  it("PATCH d'un envoi d'une autre → 404", async () => {
    expect((await req("PATCH", "/api/envois/5", { statut: "reponse" })).status).toBe(404);
  });
  it("PATCH statut inconnu → 400", async () => {
    expect((await req("PATCH", "/api/envois/1", { statut: "bof" })).status).toBe(400);
  });
  it("PATCH prochaineRelance : retire la relance non faite de l'ancienne date", async () => {
    const r = await req("PATCH", "/api/envois/1", { prochaineRelance: "2026-12-04" });
    expect(r.status).toBe(200);
    expect(deps.retirerRelanceNonFaite).toHaveBeenCalledWith("u1", e1, "2026-11-27");
  });
  it("GET : la liste", async () => {
    const r = await req("GET", "/api/envois?projectId=4");
    expect(await r.json()).toEqual([e1]);
    expect(deps.lister).toHaveBeenCalledWith("u1", { projectId: 4 });
  });
});
