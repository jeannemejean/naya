// Routes des groupes de marques (lot 9) : dépendances simulées, aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerGroupesMarquesRoutes } = await import("./routes-groupes-marques");

let deps: any;
let server: http.Server;
let port: number;
beforeEach(async () => {
  const groupes: any[] = [{ id: 1, userId: "u1", nom: "Clients", couleur: "#112233", projectIds: [3], createdAt: new Date(), updatedAt: new Date() }];
  deps = {
    groupes: vi.fn(async (u: string) => groupes.filter((g) => g.userId === u)),
    projetsSiens: vi.fn(async (u: string, ids: number[]) => (u === "u1" ? ids.filter((i) => [3, 4, 5].includes(i)) : [])),
    creer: vi.fn(async (u: string, g: any) => ({ id: 2, userId: u, ...g })),
    modifier: vi.fn(async (id: number, u: string, patch: any) => {
      const g = groupes.find((x) => x.id === id && x.userId === u);
      return g ? Object.assign(g, patch) : undefined;
    }),
    supprimer: vi.fn(async (id: number, u: string) => groupes.some((x) => x.id === id && x.userId === u)),
    projetsDuGroupe: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  registerGroupesMarquesRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

describe("groupes de marques", () => {
  it("liste : ceux de l'utilisatrice, avec leurs projets", async () => {
    const j = await (await req("GET", "/api/groupes-marques")).json();
    expect(j).toEqual([{ id: 1, nom: "Clients", couleur: "#112233", projectIds: [3] }]);
    expect(deps.groupes).toHaveBeenCalledWith("u1");
  });
  it("création : validée ; un projet d'un autre compte → 400, rien créé", async () => {
    const r = await req("POST", "/api/groupes-marques", { nom: "Perso", projectIds: [4, 5] });
    expect(r.status).toBe(201);
    expect(deps.creer).toHaveBeenCalledWith("u1", { nom: "Perso", couleur: "#6366f1", projectIds: [4, 5] });
    expect((await req("POST", "/api/groupes-marques", { nom: "X", projectIds: [3, 99] })).status).toBe(400);
    expect((await req("POST", "/api/groupes-marques", { nom: "" })).status).toBe(400);
    expect(deps.creer).toHaveBeenCalledTimes(1);
  });
  it("modification : renommer, choisir ses projets ; groupe d'un autre compte → 404", async () => {
    const r = await req("PATCH", "/api/groupes-marques/1", { nom: "Mes clients", projectIds: [3, 4] });
    expect(await r.json()).toEqual({ id: 1, nom: "Mes clients", couleur: "#112233", projectIds: [3, 4] });
    expect(deps.modifier).toHaveBeenCalledWith(1, "u1", { nom: "Mes clients", projectIds: [3, 4] });
    expect((await req("PATCH", "/api/groupes-marques/1", { projectIds: [99] })).status).toBe(400);
    expect((await req("PATCH", "/api/groupes-marques/42", { nom: "Y" })).status).toBe(404);
  });
  it("suppression : 404 si le groupe n'est pas à elle", async () => {
    expect((await req("DELETE", "/api/groupes-marques/1")).status).toBe(200);
    expect(deps.supprimer).toHaveBeenCalledWith(1, "u1");
    expect((await req("DELETE", "/api/groupes-marques/42")).status).toBe(404);
  });
});
