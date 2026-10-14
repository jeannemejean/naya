// server/routes-profils-veille.test.ts
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("./auth", () => ({ isAuthenticated: (req: any, _r: any, next: any) => { req.userId = req.headers["x-user"] || "user-1"; next(); } }));
const storageMock = {
  getUser: vi.fn(async (id: string) => ({ id, role: id === "owner-1" ? "owner" : "user" })),
  getProject: vi.fn(async (id: number, u: string) => (id === 4 && u === "user-1" ? { id: 4, userId: "user-1", name: "Lune" } : undefined)),
  createContent: vi.fn(async (row: any) => ({ id: 77, ...row })),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const s = vi.hoisted(() => ({
  rattachementDuProjet: vi.fn(async () => ({ id: 1, profilId: 7, statut: "propose", raison: "r", nomProfil: "Coachs", descriptionProfil: "d" })),
  catalogueActif: vi.fn(async () => [{ id: 7, nom: "Coachs", description: "d", criteres: {} }, { id: 8, nom: "Mode", description: "d", criteres: {} }]),
  tendancesDuProjet: vi.fn(async () => [{ id: 3, tendanceId: 12, statut: "nouveau", expireLe: new Date("2030-01-01"), plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 2, adaptation: "a", exemples: [], pourquoi: "p", nbForts: 3, nbComptes: 2 }]),
  tendanceProjet: vi.fn(async (u: string, id: number) => (u === "user-1" && id === 3 ? { id: 3, userId: "user-1", projectId: 4, tendanceId: 12, statut: "nouveau", adaptation: "Ta cliente avant/après", plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres" } : undefined)),
  majTendanceProjet: vi.fn(async () => {}),
  choisirProfil: vi.fn(async () => {}),
  refuserRattachement: vi.fn(async () => {}),
  ajouterCompte: vi.fn(async (row: any) => ({ id: 5, ...row })),
  listeAdmin: vi.fn(async () => []),
  creerProfil: vi.fn(async (row: any) => ({ id: 9, ...row })),
  majProfil: vi.fn(async (id: number, p: any) => (id === 9 ? { id, ...p } : undefined)),
  majCompteAdmin: vi.fn(async () => ({ id: 5 })),
  tendancesAdmin: vi.fn(async () => []),
  majTendanceAdmin: vi.fn(async () => ({ id: 1 })),
  aEtiqueter: vi.fn(async () => []),
  etiqueter: vi.fn(async () => {}),
  profil: vi.fn(async (id: number) => (id === 9 ? { id: 9, nom: "n", description: "d", statut: "actif" } : undefined)),
}));
vi.mock("./services/profils-veille/stockage", () => ({ stockageProfils: s }));
vi.mock("./services/profils-veille/deps", () => ({ estOuvertPour: vi.fn(async () => true), depsCollecte: {}, depsAnalyse: {} }));
const placement = vi.hoisted(() => ({ placerTachesProductionPosts: vi.fn(async () => ({ creees: 1 })) }));
vi.mock("./services/campagne/placement", () => placement);
vi.mock("./services/profils-veille/collecte", () => ({ collecterProfil: vi.fn(async () => ({ statut: "ok" })) }));
vi.mock("./services/profils-veille/analyse", () => ({ lancerAnalyse: vi.fn(async () => "rien") }));

const { registerProfilsVeilleRoutes } = await import("./routes-profils-veille");
const app = express(); app.use(express.json()); registerProfilsVeilleRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
afterAll(() => server.close());
const appel = (method: string, path: string, body?: unknown, user = "user-1") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-user": user }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => vi.clearAllMocks());

describe("routes utilisatrice", () => {
  it("404 sur le projet ou la tendance d'une autre", async () => {
    expect((await appel("GET", "/api/profils-veille/projet/5")).status).toBe(404);
    expect((await appel("PATCH", "/api/profils-veille/tendances/99", { statut: "garde" })).status).toBe(404);
    expect((await appel("POST", "/api/profils-veille/tendances/99/post")).status).toBe(404);
  });
  it("lit le rattachement, le catalogue et seulement les tendances visibles", async () => {
    const r = await (await appel("GET", "/api/profils-veille/projet/4")).json();
    expect(r.rattachement.nomProfil).toBe("Coachs");
    expect(r.catalogue.map((c: any) => c.id)).toEqual([7, 8]);
    expect(r.tendances.map((t: any) => t.id)).toEqual([3]);
    expect(r.ouvert).toBe(true);
  });
  it("changer de profil : seulement un profil du catalogue actif", async () => {
    expect((await appel("POST", "/api/profils-veille/projet/4/profil", { profilId: 99 })).status).toBe(400);
    expect((await appel("POST", "/api/profils-veille/projet/4/profil", { profilId: 8 })).status).toBe(200);
    expect(s.choisirProfil).toHaveBeenCalledWith("user-1", 4, 8);
  });
  it("suggérer un compte : normalisé, rattaché au profil du projet, origine suggestion", async () => {
    expect((await appel("POST", "/api/profils-veille/projet/4/suggestion", { plateforme: "instagram", saisie: "pas valide !" })).status).toBe(400);
    expect((await appel("POST", "/api/profils-veille/projet/4/suggestion", { plateforme: "instagram", saisie: "@Terre.Atelier" })).status).toBe(201);
    expect(s.ajouterCompte).toHaveBeenCalledWith({ profilId: 7, plateforme: "instagram", compte: "terre.atelier", url: "https://www.instagram.com/terre.atelier/", origine: "suggestion", suggerePar: "user-1", statut: "propose" });
  });
  it("statuts permis : vu, garde, ecarte (écarter date l'écart)", async () => {
    expect((await appel("PATCH", "/api/profils-veille/tendances/3", { statut: "utilise" })).status).toBe(400);
    expect((await appel("PATCH", "/api/profils-veille/tendances/3", { statut: "ecarte" })).status).toBe(200);
    expect(s.majTendanceProjet).toHaveBeenCalledWith(3, { statut: "ecarte", ecarteLe: expect.any(Date) });
  });
  it("En faire un post : crée un post à rédiger, relié à la tendance, et le place dans l'atelier", async () => {
    const r = await appel("POST", "/api/profils-veille/tendances/3/post");
    expect(r.status).toBe(201);
    const row = storageMock.createContent.mock.calls[0][0] as any;
    expect(row).toMatchObject({ userId: "user-1", projectId: 4, platform: "instagram", postFormat: "carousel", tendanceId: 12, tendanceProjetId: 3, contentStatus: "idea", autoPost: false });
    expect(row.body).toContain("Ta cliente avant/après");
    expect(placement.placerTachesProductionPosts).toHaveBeenCalled();
    expect(s.majTendanceProjet).toHaveBeenCalledWith(3, { statut: "utilise", contentId: 77 });
    expect((await r.json()).contentId).toBe(77);
  });
});

describe("routes admin", () => {
  it("403 sans rôle owner", async () => {
    expect((await appel("GET", "/api/admin/profils-veille")).status).toBe(403);
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "x" })).status).toBe(403);
  });
  it("owner : crée un profil, refuse un nom vide, statut parmi les valeurs permises", async () => {
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "" }, "owner-1")).status).toBe(400);
    expect((await appel("POST", "/api/admin/profils-veille", { nom: "Céramistes", description: "d" }, "owner-1")).status).toBe(201);
    expect((await appel("PATCH", "/api/admin/profils-veille/9", { statut: "nimporte" }, "owner-1")).status).toBe(400);
    expect((await appel("PATCH", "/api/admin/profils-veille/9", { statut: "actif" }, "owner-1")).status).toBe(200);
  });
  it("owner : refuse un 16e compte suivi sur une plateforme", async () => {
    s.listeAdmin.mockResolvedValueOnce([{ id: 9, comptes: Array.from({ length: 15 }, (_, i) => ({ id: i, plateforme: "instagram", statut: "suivi" })) }] as any);
    expect((await appel("POST", "/api/admin/profils-veille/9/comptes", { plateforme: "instagram", saisie: "@nouveau", statut: "suivi" }, "owner-1")).status).toBe(409);
  });
  it("owner : étiquette — structure et accroche du vocabulaire", async () => {
    expect((await appel("POST", "/api/admin/profils-veille/etiquettes", { postId: 1, structure: "x", accroche: "chiffre" }, "owner-1")).status).toBe(400);
    expect((await appel("POST", "/api/admin/profils-veille/etiquettes", { postId: 1, structure: "liste", accroche: "chiffre" }, "owner-1")).status).toBe(200);
  });
});
