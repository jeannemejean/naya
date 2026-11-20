// Le bilan de la semaine : pour l'utilisatrice connectée, ramené au lundi.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
}));
const { registerOrchestreRoutes } = await import("./routes-orchestre");

describe("GET /api/orchestre/semaine", () => {
  let server: http.Server;
  let base: string;
  const calculer = vi.fn(async (userId: string, semaine: string) => ({ userId, semaine }));
  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    registerOrchestreRoutes(app, calculer);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(() => { server.close(); });

  it("ramène le jour demandé au lundi de sa semaine ; un dimanche, la semaine suivante", async () => {
    expect(await (await fetch(`${base}/api/orchestre/semaine?semaine=2026-11-26`)).json()).toEqual({ userId: "user-1", semaine: "2026-11-23" });
    expect(await (await fetch(`${base}/api/orchestre/semaine?semaine=2026-11-22`)).json()).toEqual({ userId: "user-1", semaine: "2026-11-23" });
  });

  it("400 sur une date mal formée, sans calcul", async () => {
    expect((await fetch(`${base}/api/orchestre/semaine?semaine=demain`)).status).toBe(400);
    expect(calculer).not.toHaveBeenCalled();
  });

  it("500 lisible si le calcul échoue", async () => {
    calculer.mockRejectedValueOnce(new Error("base"));
    const r = await fetch(`${base}/api/orchestre/semaine`);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ message: "bilan_indisponible" });
  });
});
