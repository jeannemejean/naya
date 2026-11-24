// Route des meilleures heures : dépendances simulées, aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerMeilleuresHeuresRoutes } = await import("./routes-meilleures-heures");
const { matriceGenerique, SEUIL_POSTS } = await import("@shared/meilleures-heures");

const mesure = (i: number) => ({ publieLe: new Date(Date.UTC(2026, 9, 4 + 7 * (i % 3), 18)), saves: 10, shares: 0, comments: 0, reach: 100 });

let deps: any;
let server: http.Server;
let port: number;
beforeEach(async () => {
  deps = {
    projet: vi.fn(async (id: number, userId: string) => (id === 3 && userId === "u1" ? { id: 3 } : undefined)),
    mesures: vi.fn(async () => [] as any[]),
    projetsDuGroupe: vi.fn(async (userId: string, g: number) => (userId === "u1" && g === 7 ? [3, 5] : null)),
    maintenant: () => new Date("2026-11-23T10:00:00Z"),
  };
  const app = express();
  registerMeilleuresHeuresRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const get = (q: string) => fetch(`http://127.0.0.1:${port}/api/meilleures-heures${q}`);

describe("GET /api/meilleures-heures", () => {
  it("sans données : la grille générique du réseau, source « generique »", async () => {
    const r = await get("?reseau=LinkedIn");
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j).toEqual({ reseau: "linkedin", matrice: matriceGenerique("linkedin"), source: "generique", n: 0 });
    // Marque des Réglages (projet null), 18 mois de mesures, pour l'utilisatrice connectée.
    const [userId, projectId, reseau, depuis] = deps.mesures.mock.calls[0];
    expect([userId, projectId, reseau]).toEqual(["u1", null, "linkedin"]);
    expect((depuis as Date).getTime()).toBeLessThan(new Date("2025-06-01").getTime());
  });

  it("au-delà du seuil, les données de la marque : source « mixte » et n", async () => {
    deps.mesures.mockResolvedValue(Array.from({ length: SEUIL_POSTS }, (_, i) => mesure(i)));
    const j: any = await (await get("?reseau=instagram&projectId=3")).json();
    expect(j.source).toBe("mixte");
    expect(j.n).toBe(SEUIL_POSTS);
    expect(deps.projet).toHaveBeenCalledWith(3, "u1");
    expect(deps.mesures.mock.calls[0][1]).toBe(3);
  });

  it("marque d'un autre compte : 404 ; réseau ou projet illisible : 400", async () => {
    expect((await get("?reseau=instagram&projectId=4")).status).toBe(404);
    expect(deps.mesures).not.toHaveBeenCalled();
    expect((await get("?reseau=myspace")).status).toBe(400);
    expect((await get("?reseau=instagram&projectId=abc")).status).toBe(400);
  });

  it("groupe de marques : les mesures de chacune de ses marques ; groupe d'un autre compte : 404", async () => {
    deps.mesures.mockImplementation(async (_u: string, pid: number) => (pid === 3 ? [mesure(0), mesure(1)] : [mesure(2)]));
    const j: any = await (await get("?reseau=instagram&groupeId=7")).json();
    expect(deps.mesures.mock.calls.map((c: any[]) => c[1])).toEqual([3, 5]);
    expect(j.n).toBe(3);
    expect(deps.projetsDuGroupe).toHaveBeenCalledWith("u1", 7);
    expect((await get("?reseau=instagram&groupeId=8")).status).toBe(404);
    expect((await get("?reseau=instagram&groupeId=x")).status).toBe(400);
  });
});
