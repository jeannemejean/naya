// Le lancement manuel de la veille : réservé aux inscrites, pour soi seulement, au plus une fois
// toutes les 10 minutes, et sans garder la requête ouverte (202 puis état interrogé).
// Passage simulé : ni réseau, ni base, ni IA.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = req.headers["x-user"] ?? "user-1"; next(); },
}));
vi.mock("./services/appels-offres-store", () => ({ appelsOffresStore: {} }));

const { registerAppelsOffresRoutes, INTERVALLE_VEILLE_MS, resultatPassage } = await import("./routes-appels-offres");

const bilan = (over: Record<string, unknown> = {}) => ({
  examines: 12, nouveaux: 3, rafraichis: 2, doublons: 1, horsDelai: 0, echecsQualification: 0, reportesPlafond: 0,
  iaBloquee: false, coutEur: 0.1, erreursSources: [] as string[], inseres: [], ...over,
});
const attendre = () => new Promise((r) => setTimeout(r, 5));

describe("routes de la veille", () => {
  let server: http.Server;
  let base: string;
  let horloge: number;
  let n: number;
  let terminer: (b: any) => void;
  let echouer: (e: Error) => void;
  const veille = {
    estActivee: vi.fn((u: string) => u === "user-1" || u === "user-3"),
    enCours: vi.fn((_u: string) => false),
    lancer: vi.fn((_u: string) => new Promise<any>((res, rej) => { terminer = res; echouer = rej; })),
    maintenant: () => horloge,
    nouvelId: () => `p${++n}`,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    horloge = 1_000_000;
    n = 0;
    const app = express();
    app.use(express.json());
    registerAppelsOffresRoutes(app, { lireAppelOffres: vi.fn() } as any, veille);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(() => { server.close(); });

  const lancer = (user = "user-1") => fetch(`${base}/api/appels-offres/veille`, { method: "POST", headers: { "x-user": user } });
  const etat = (id: string, user = "user-1") => fetch(`${base}/api/appels-offres/veille/passages/${id}`, { headers: { "x-user": user } });

  it("202 tout de suite, le passage continue ; l'état passe d'« en cours » à « fini »", async () => {
    const res = await lancer();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ id: "p1", statut: "en_cours" });
    expect(veille.lancer).toHaveBeenCalledWith("user-1");
    expect(await (await etat("p1")).json()).toEqual({ id: "p1", statut: "en_cours" });
    terminer(bilan());
    await attendre();
    expect(await (await etat("p1")).json()).toMatchObject({ id: "p1", statut: "fini", nouveaux: 3, misAJour: 2, examines: 12 });
    expect((await (await fetch(`${base}/api/appels-offres/veille`)).json()).passage).toMatchObject({ id: "p1", statut: "fini" });
  });

  it("erreur du passage : statut « erreur »", async () => {
    await lancer();
    echouer(new Error("boum"));
    await attendre();
    expect(await (await etat("p1")).json()).toEqual({ id: "p1", statut: "erreur", erreur: "veille_echec" });
  });

  it("l'état d'un passage n'est visible que par celle qui l'a lancé", async () => {
    await lancer("user-1");
    expect((await etat("p1", "user-3")).status).toBe(404);
    expect((await etat("inconnu")).status).toBe(404);
  });

  it("état : activée ou non (pas pris pour un id)", async () => {
    expect(await (await fetch(`${base}/api/appels-offres/veille`)).json()).toEqual({ active: true, enCours: false, passage: null });
    expect((await (await fetch(`${base}/api/appels-offres/veille`, { headers: { "x-user": "user-2" } })).json()).active).toBe(false);
  });

  it("403 pour une utilisatrice non inscrite", async () => {
    expect((await lancer("user-2")).status).toBe(403);
    expect(veille.lancer).not.toHaveBeenCalled();
  });

  it("409 pendant un passage (manuel ou quotidien)", async () => {
    await lancer();
    const r = await lancer();
    expect(r.status).toBe(409);
    expect((await r.json()).id).toBe("p1");
    veille.enCours.mockReturnValueOnce(true);
    expect((await lancer("user-3")).status).toBe(409);
    expect(veille.lancer).toHaveBeenCalledTimes(1);
  });

  it("une fois toutes les 10 minutes", async () => {
    await lancer();
    terminer(bilan());
    await attendre();
    horloge += INTERVALLE_VEILLE_MS - 1;
    expect((await lancer()).status).toBe(429);
    horloge += 1;
    expect((await lancer()).status).toBe(202);
    expect(veille.lancer).toHaveBeenCalledTimes(2);
  });

  it("bilan → résultat affiché", () => {
    expect(resultatPassage("a", null)).toMatchObject({ statut: "erreur" });
    expect(resultatPassage("a", bilan({ erreursSources: ["passage: base"] }) as any)).toMatchObject({ statut: "erreur" });
    expect(resultatPassage("a", bilan({ examines: 0, erreursSources: ["boamp: HTTP 503", "ted: HTTP 500"] }) as any)).toMatchObject({ statut: "erreur" });
    expect(resultatPassage("a", bilan({ erreursSources: ["ted: HTTP 500"] }) as any)).toMatchObject({ statut: "fini", sourcesEnErreur: 1 });
  });
});
