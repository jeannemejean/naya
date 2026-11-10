// Les routes des appels d'offres : chaque requête porte l'utilisatrice connectée, jamais
// un id venu du client. Accès base mocké : aucune vraie base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = req.headers["x-user"] ?? "user-1"; next(); },
}));
vi.mock("./services/appels-offres-store", () => ({ appelsOffresStore: {} }));

const { registerAppelsOffresRoutes } = await import("./routes-appels-offres");

// Faux stockage à deux utilisatrices, qui applique le filtre userId comme la vraie requête.
const lignes = () => [
  { id: 1, userId: "user-1", objet: "AO de user-1", statut: "repere", notes: null },
  { id: 2, userId: "user-2", objet: "AO de user-2", statut: "repere", notes: null },
];

describe("routes des appels d'offres", () => {
  let server: http.Server;
  let base: string;
  let donnees: ReturnType<typeof lignes>;
  const deps = {
    listerAppelsOffres: vi.fn(async (userId: string) => donnees.filter((l) => l.userId === userId)),
    lireAppelOffres: vi.fn(async (id: number, userId: string) => donnees.find((l) => l.id === id && l.userId === userId)),
    modifierAppelOffres: vi.fn(async (id: number, userId: string, modif: any) => {
      const l = donnees.find((x) => x.id === id && x.userId === userId);
      if (!l) return undefined;
      Object.assign(l, modif);
      return l;
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    donnees = lignes();
    const app = express();
    app.use(express.json());
    registerAppelsOffresRoutes(app, deps as any);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(() => { server.close(); });

  const patch = (id: number | string, corps: unknown, user = "user-1") => fetch(`${base}/api/appels-offres/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(corps),
  });

  it("liste seulement ceux de l'utilisatrice connectée", async () => {
    const r = await (await fetch(`${base}/api/appels-offres`)).json();
    expect(r.map((l: any) => l.id)).toEqual([1]);
    expect(deps.listerAppelsOffres).toHaveBeenCalledWith("user-1");
  });

  it("404 sur l'appel d'offres d'une autre", async () => {
    const res = await fetch(`${base}/api/appels-offres/2`);
    expect(res.status).toBe(404);
    expect(deps.lireAppelOffres).toHaveBeenCalledWith(2, "user-1");
    expect((await fetch(`${base}/api/appels-offres/1`)).status).toBe(200);
  });

  it("400 sur un id qui n'en est pas un", async () => {
    expect((await fetch(`${base}/api/appels-offres/abc`)).status).toBe(400);
  });

  it("change le statut et les notes", async () => {
    const res = await patch(1, { statut: "en_redaction", notes: "Relire le CCTP" });
    expect(res.status).toBe(200);
    expect(deps.modifierAppelOffres).toHaveBeenCalledWith(1, "user-1", { statut: "en_redaction", notes: "Relire le CCTP" });
    expect((await res.json()).statut).toBe("en_redaction");
  });

  it("refuse de modifier celui d'une autre", async () => {
    const res = await patch(2, { statut: "ecarte" });
    expect(res.status).toBe(404);
    expect(donnees.find((l) => l.id === 2)!.statut).toBe("repere");
  });

  it("refuse un statut inconnu et ne laisse rien passer d'autre", async () => {
    expect((await patch(1, { statut: "🏆 Gagné" })).status).toBe(400);
    expect((await patch(1, { objet: "réécrit", userId: "user-2" })).status).toBe(400);
    expect(deps.modifierAppelOffres).not.toHaveBeenCalled();
  });

  it("des notes vides redeviennent null", async () => {
    await patch(1, { notes: "   " });
    expect(deps.modifierAppelOffres).toHaveBeenCalledWith(1, "user-1", { notes: null });
  });
});
