import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = req.headers["x-user"] ?? "user-1"; next(); },
}));

const { registerViePersoRoutes } = await import("./routes-vie-perso");
import { PROFIL_DEFAUT } from "@shared/vie-perso";

describe("routes vie perso", () => {
  let server: http.Server;
  let base: string;
  let genererFin: (() => void) | null;
  const repas = { titre: "R", detail: "", kcal: 0, proteines: 0, lipides: 0, glucides: 0, variantes: [], preparationMin: 0 };
  const PLAN = {
    jours: Array.from({ length: 7 }, (_, i) => ({ date: `d${i}`, dejeuner: repas, diner: repas, dessert: { ...repas, titre: "" } })),
    batch: { dureeMin: 0, etapes: [] }, courses: [{ article: "Saumon", quantite: "1", magasin: "Picard", rayon: "", pour: "tous" }], regles: [], snacks: [],
  };
  let plan: any;
  const deps: any = {
    profil: vi.fn(async () => PROFIL_DEFAUT),
    membres: vi.fn(async () => []),
    recettes: vi.fn(async () => []),
    lirePlan: vi.fn(async () => plan),
    ecrirePlan: vi.fn(async (_u: string, _s: string, contenu: any, o: any) => { plan = { statut: o.statut, contenu, coches: [] }; }),
    lireActivite: vi.fn(async () => null),
    ecrireActivite: vi.fn(async () => {}),
    supprimerTachesNonFaites: vi.fn(async () => 0),
    occupes: vi.fn(async () => new Map()),
    creerTaches: vi.fn(async (_u: string, _o: any, t: any[]) => t.length),
    generer: vi.fn(() => new Promise((r) => { genererFin = () => r({ valeur: PLAN, coutEur: 0.04 }); })),
    maintenant: () => ({ jour: "2026-11-23", min: 600 }),
  };
  const store: any = {
    ecrireProfil: vi.fn(async () => {}),
    ajouterMembre: vi.fn(async (_u: string, m: any) => ({ id: 1, ...m })),
    ecrireCoches: vi.fn(async () => true),
    listerActivites: vi.fn(async () => []),
  };
  const iaBloquee = vi.fn(async () => false);

  beforeEach(async () => {
    vi.clearAllMocks();
    plan = null; genererFin = null;
    const app = express();
    app.use(express.json());
    registerViePersoRoutes(app, { deps, store, activePour: (u) => u === "user-1", iaBloquee });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(() => { server.close(); });

  const appel = (methode: string, chemin: string, corps?: unknown, user = "user-1") => fetch(`${base}${chemin}`, {
    method: methode, headers: { "Content-Type": "application/json", "x-user": user }, body: corps === undefined ? undefined : JSON.stringify(corps),
  });

  it("sans l'option : /etat dit non, le reste répond 404", async () => {
    expect(await (await appel("GET", "/api/vie-perso/etat", undefined, "user-2")).json()).toEqual({ active: false });
    expect((await appel("GET", "/api/vie-perso/profil", undefined, "user-2")).status).toBe(404);
    expect((await appel("POST", "/api/vie-perso/plans/2026-11-30/preparer", {}, "user-2")).status).toBe(404);
    expect(await (await appel("GET", "/api/vie-perso/etat")).json()).toEqual({ active: true });
  });

  it("réglages : validés (heures, fenêtres)", async () => {
    expect((await appel("PUT", "/api/vie-perso/profil", { ...PROFIL_DEFAUT, soirDebut: "25:00" })).status).toBe(400);
    expect((await appel("PUT", "/api/vie-perso/profil", { ...PROFIL_DEFAUT, soirDebut: "23:00", soirFin: "22:00" })).status).toBe(400);
    expect((await appel("PUT", "/api/vie-perso/profil", PROFIL_DEFAUT)).status).toBe(200);
    expect(store.ecrireProfil).toHaveBeenCalledWith("user-1", PROFIL_DEFAUT);
  });

  it("membre : prénom requis", async () => {
    expect((await appel("POST", "/api/vie-perso/membres", { prenom: "" })).status).toBe(400);
    expect((await appel("POST", "/api/vie-perso/membres", { prenom: "Milan", repasMaison: "diner" })).status).toBe(201);
  });

  it("préparer : semaine = un lundi ; 202 puis état fini ; 409 si déjà en cours", async () => {
    expect((await appel("POST", "/api/vie-perso/plans/2026-12-01/preparer", {})).status).toBe(400);
    const r = await appel("POST", "/api/vie-perso/plans/2026-11-30/preparer", {});
    expect(r.status).toBe(202);
    expect((await appel("POST", "/api/vie-perso/plans/2026-11-30/preparer", {})).status).toBe(409);
    expect((await (await appel("GET", "/api/vie-perso/plans/2026-11-30")).json()).preparation.statut).toBe("en_cours");
    genererFin!();
    await new Promise((r) => setTimeout(r, 10));
    const fin = await (await appel("GET", "/api/vie-perso/plans/2026-11-30")).json();
    expect(fin.preparation.statut).toBe("fini");
    expect(fin.plan.statut).toBe("brouillon");
  });

  it("préparer : IA bloquée → 402", async () => {
    iaBloquee.mockResolvedValueOnce(true);
    expect((await appel("POST", "/api/vie-perso/plans/2026-11-30/preparer", {})).status).toBe(402);
  });

  it("courses : coche dans la liste, index hors liste refusé", async () => {
    plan = { statut: "brouillon", contenu: PLAN, coches: [] };
    expect(await (await appel("PATCH", "/api/vie-perso/plans/2026-11-30/courses", { index: 0, coche: true })).json()).toEqual({ coches: [0] });
    expect((await appel("PATCH", "/api/vie-perso/plans/2026-11-30/courses", { index: 3, coche: true })).status).toBe(400);
  });

  it("valider sans plan : 404", async () => {
    expect((await appel("POST", "/api/vie-perso/plans/2026-11-30/valider", {})).status).toBe(404);
  });
});
