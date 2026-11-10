// Le lancement manuel de la veille : réservé aux inscrites, pour soi seulement, au plus une fois
// toutes les 10 minutes. Passage simulé : ni réseau, ni base, ni IA.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = req.headers["x-user"] ?? "user-1"; next(); },
}));
vi.mock("./services/appels-offres-store", () => ({ appelsOffresStore: {} }));

const { registerAppelsOffresRoutes, INTERVALLE_VEILLE_MS } = await import("./routes-appels-offres");

const bilan = (nouveaux: number) => ({
  examines: 12, nouveaux, rafraichis: 2, doublons: 1, horsDelai: 0, echecsQualification: 0, reportesPlafond: 0,
  iaBloquee: false, coutEur: 0.1, erreursSources: [], inseres: [],
});

describe("routes de la veille", () => {
  let server: http.Server;
  let base: string;
  let horloge: number;
  const veille = {
    estActivee: vi.fn((u: string) => u === "user-1"),
    enCours: vi.fn(() => false),
    lancer: vi.fn(async (_u: string) => bilan(3) as any),
    maintenant: () => horloge,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    horloge = 1_000_000;
    const app = express();
    app.use(express.json());
    registerAppelsOffresRoutes(app, { lireAppelOffres: vi.fn() } as any, veille);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(() => { server.close(); });

  const lancer = (user = "user-1") => fetch(`${base}/api/appels-offres/veille`, { method: "POST", headers: { "x-user": user } });

  it("état : activée ou non pour l'utilisatrice connectée (pas pris pour un id)", async () => {
    expect(await (await fetch(`${base}/api/appels-offres/veille`)).json()).toEqual({ active: true, enCours: false });
    expect(await (await fetch(`${base}/api/appels-offres/veille`, { headers: { "x-user": "user-2" } })).json()).toEqual({ active: false, enCours: false });
  });

  it("lance pour soi et renvoie le nombre de nouveaux avis", async () => {
    const res = await lancer();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nouveaux: 3, rafraichis: 2, examines: 12 });
    expect(veille.lancer).toHaveBeenCalledWith("user-1");
  });

  it("403 pour une utilisatrice non inscrite", async () => {
    expect((await lancer("user-2")).status).toBe(403);
    expect(veille.lancer).not.toHaveBeenCalled();
  });

  it("une fois toutes les 10 minutes", async () => {
    expect((await lancer()).status).toBe(200);
    horloge += INTERVALLE_VEILLE_MS - 1;
    expect((await lancer()).status).toBe(429);
    horloge += 1;
    expect((await lancer()).status).toBe(200);
    expect(veille.lancer).toHaveBeenCalledTimes(2);
  });

  it("409 si un passage tourne déjà", async () => {
    veille.lancer.mockResolvedValueOnce(null);
    expect((await lancer()).status).toBe(409);
  });
});
