// Routes de la bibliothèque (textes enregistrés, modèles) et de l'aperçu Instagram.
// Dépendances injectées, aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerBibliothequeRoutes } = await import("./routes-bibliotheque");

const POST = {
  id: 7, userId: "u1", projectId: 1, title: "T", body: "Texte IG", platform: "instagram", contentType: "post", pillar: "p",
  goal: "g", contentStatus: "ready", postStatus: "posted", autoPost: true, publishedAt: new Date(), socialAccountId: 4,
  scheduledFor: new Date("2026-12-01T09:00:00Z"), mediaIds: [1], premierCommentaire: "pc", postFormat: "carousel", crossPostGroupId: "g1",
};

function fauxDeps() {
  let n = 100;
  return {
    projet: vi.fn(async (id: number) => (id < 10 ? { id, projectKind: id === 2 ? "client" : "perso" } : undefined)),
    post: vi.fn(async (id: number) => (id === 7 ? { ...POST } : undefined)),
    freres: vi.fn(async () => [{ ...POST }, { ...POST, id: 8, platform: "linkedin", body: "Texte LI" }]),
    creerPost: vi.fn(async (row: any) => ({ ...row, id: ++n })),
    journaliser: vi.fn(async () => {}),
    textes: vi.fn(async () => [{ id: 1, titre: "Sig", texte: "—J" }]),
    creerTexte: vi.fn(async (_u: string, v: any) => ({ id: 3, ...v })),
    modifierTexte: vi.fn(async (_u: string, id: number, v: any) => (id === 3 ? { id, ...v } : undefined)),
    supprimerTexte: vi.fn(async (_u: string, id: number) => id === 3),
    modeles: vi.fn(async () => [] as any[]),
    modele: vi.fn(async (_u: string, id: number) => (id === 5 ? {
      id: 5, nom: "Promo", projectId: null,
      contenu: { platform: "instagram", textes: { instagram: "Texte IG", linkedin: "Texte LI" }, title: "T", mediaIds: [1], postFormat: "carousel", premierCommentaire: "pc" },
    } : undefined)),
    creerModele: vi.fn(async (_u: string, v: any) => ({ id: 9, ...v })),
    supprimerModele: vi.fn(async (_u: string, id: number) => id === 5),
    postsInstagram: vi.fn(async () => [
      { id: 20, platform: "instagram", postFormat: "feed_image", mediaIds: [1], scheduledFor: new Date(Date.now() + 86_400_000), contentStatus: "draft", autoPost: false },
      { id: 21, platform: "instagram", postFormat: "story", mediaIds: [], scheduledFor: new Date(Date.now() + 86_400_000) },
      { id: 22, platform: "instagram", postFormat: "reel", mediaIds: [2], publishedAt: new Date("2026-11-01T00:00:00Z"), postStatus: "posted" },
    ] as any[]),
    medias: vi.fn(async () => [{ id: 1, url: "a.jpg", thumbnailUrl: null, mimeType: "image/jpeg" }, { id: 2, url: "v.mp4", thumbnailUrl: "v.jpg", mimeType: "video/mp4" }]),
    comptes: vi.fn(async () => [
      { id: 30, platform: "instagram", projectId: null, isActive: true, accountName: "reglages" },
      { id: 31, platform: "instagram", projectId: 2, isActive: true, accountName: "client" },
    ]),
  };
}

let deps: ReturnType<typeof fauxDeps>;
let server: http.Server;
let port: number;
beforeEach(async () => {
  deps = fauxDeps();
  const app = express();
  app.use(express.json());
  registerBibliothequeRoutes(app, deps as any);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

describe("textes enregistrés", () => {
  it("liste, crée, modifie, supprime ; ceux d'un autre compte : 404", async () => {
    expect((await req("GET", "/api/bibliotheque/textes")).status).toBe(200);
    expect(deps.textes).toHaveBeenCalledWith("u1");
    const r = await req("POST", "/api/bibliotheque/textes", { titre: " Sig ", texte: "— Jeanne", projectId: 1 });
    expect(r.status).toBe(201);
    expect(deps.creerTexte).toHaveBeenCalledWith("u1", { titre: "Sig", texte: "— Jeanne", projectId: 1 });
    expect((await req("PATCH", "/api/bibliotheque/textes/3", { texte: "neuf" })).status).toBe(200);
    expect(deps.modifierTexte).toHaveBeenCalledWith("u1", 3, { texte: "neuf" });
    expect((await req("PATCH", "/api/bibliotheque/textes/4", { texte: "neuf" })).status).toBe(404);
    expect((await req("DELETE", "/api/bibliotheque/textes/3")).status).toBe(200);
    expect((await req("DELETE", "/api/bibliotheque/textes/4")).status).toBe(404);
  });
  it("invalide : 400 ; marque d'un autre compte : 404, rien de créé", async () => {
    expect((await req("POST", "/api/bibliotheque/textes", { titre: "", texte: "x" })).status).toBe(400);
    expect((await req("POST", "/api/bibliotheque/textes", { titre: "a", texte: "x", projectId: 42 })).status).toBe(404);
    expect((await req("PATCH", "/api/bibliotheque/textes/3", { projectId: 42 })).status).toBe(404);
    expect(deps.creerTexte).not.toHaveBeenCalled();
    expect(deps.modifierTexte).not.toHaveBeenCalled();
  });
});

describe("modèles", () => {
  it("enregistrer un post comme modèle : textes de chaque réseau, médias, options ; marque du post", async () => {
    const r = await req("POST", "/api/content/7/enregistrer-modele", { nom: " Promo " });
    expect(r.status).toBe(201);
    expect(deps.freres).toHaveBeenCalledWith("u1", "g1");
    const [, v] = deps.creerModele.mock.calls[0] as any[];
    expect(v.nom).toBe("Promo");
    expect(v.projectId).toBe(1);
    expect(v.contenu.textes).toEqual({ instagram: "Texte IG", linkedin: "Texte LI" });
    expect(v.contenu).toMatchObject({ mediaIds: [1], postFormat: "carousel", premierCommentaire: "pc" });
    expect(v.contenu).not.toHaveProperty("socialAccountId");
  });
  it("post introuvable : 404 ; nom vide : 400", async () => {
    expect((await req("POST", "/api/content/9/enregistrer-modele", { nom: "x" })).status).toBe(404);
    expect((await req("POST", "/api/content/7/enregistrer-modele", { nom: " " })).status).toBe(400);
    expect(deps.creerModele).not.toHaveBeenCalled();
  });
  it("utiliser : brouillon jamais programmé, dans la marque et à la date choisies ; journalisé", async () => {
    const r = await req("POST", "/api/bibliotheque/modeles/5/utiliser", { projectId: 2, scheduledFor: "2027-01-05T10:00:00.000Z", platform: "linkedin" });
    expect(r.status).toBe(201);
    expect(deps.creerPost).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", projectId: 2, platform: "linkedin", body: "Texte LI", autoPost: false, socialAccountId: null,
      scheduledFor: new Date("2027-01-05T10:00:00.000Z"), contentStatus: "draft",
    }));
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 101, "cree", { modele: "Promo" });
  });
  it("utiliser : modèle, marque introuvables : 404 ; réseau absent du modèle, date illisible : 400", async () => {
    expect((await req("POST", "/api/bibliotheque/modeles/6/utiliser", { projectId: 1 })).status).toBe(404);
    expect((await req("POST", "/api/bibliotheque/modeles/5/utiliser", { projectId: 42 })).status).toBe(404);
    expect((await req("POST", "/api/bibliotheque/modeles/5/utiliser", { platform: "tiktok" })).status).toBe(400);
    expect((await req("POST", "/api/bibliotheque/modeles/5/utiliser", { scheduledFor: "demain" })).status).toBe(400);
    expect(deps.creerPost).not.toHaveBeenCalled();
  });
  it("liste et suppression", async () => {
    expect((await req("GET", "/api/bibliotheque/modeles")).status).toBe(200);
    expect((await req("DELETE", "/api/bibliotheque/modeles/5")).status).toBe(200);
    expect((await req("DELETE", "/api/bibliotheque/modeles/6")).status).toBe(404);
  });
});

describe("aperçu Instagram", () => {
  it("tuiles ordonnées, stories exclues, compte du périmètre", async () => {
    const r = await req("GET", "/api/content/apercu-instagram?projectId=2");
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(deps.postsInstagram).toHaveBeenCalledWith("u1", 2, expect.any(Date));
    expect(j.tuiles.map((t: any) => t.id)).toEqual([20, 22]);
    expect(j.tuiles[1]).toMatchObject({ kind: "video", thumbnailUrl: "v.jpg", etat: "publie" });
    expect(j.compte).toEqual({ id: 31, accountName: "client" });
    expect(deps.medias).toHaveBeenCalledWith("u1", [1, 2]);
  });
  it("sans marque : posts sans projet, compte des Réglages ; projet perso sans compte propre : repli", async () => {
    let j: any = await (await req("GET", "/api/content/apercu-instagram")).json();
    expect(deps.postsInstagram).toHaveBeenCalledWith("u1", null, expect.any(Date));
    expect(j.compte).toEqual({ id: 30, accountName: "reglages" });
    j = await (await req("GET", "/api/content/apercu-instagram?projectId=1")).json();
    expect(j.compte).toEqual({ id: 30, accountName: "reglages" });
  });
  it("marque d'un autre compte : 404", async () => {
    expect((await req("GET", "/api/content/apercu-instagram?projectId=42")).status).toBe(404);
    expect((await req("GET", "/api/content/apercu-instagram?projectId=abc")).status).toBe(404);
    expect(deps.postsInstagram).not.toHaveBeenCalled();
  });
});
