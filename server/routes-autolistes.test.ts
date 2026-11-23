// Routes des autolistes. Dépendances injectées, passage de pose simulé ; aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));
const pose = vi.hoisted(() => ({
  materialiserAutoliste: vi.fn(async () => ({ poses: 0, problemes: [] })),
  reconstruireAutoliste: vi.fn(async () => ({ poses: 0, problemes: [] })),
  retirerDeLaFile: vi.fn(async (_d: any, _u: string, _l: number, _p: number, retirer: () => Promise<boolean>) => retirer()),
  supprimerAutoliste: vi.fn(async (_d: any, _u: string, _l: number, supprimer: () => Promise<boolean>) => supprimer()),
}));
vi.mock("./services/autolistes/materialiser", () => pose);

const { registerAutolistesRoutes } = await import("./routes-autolistes");

const LISTE = { id: 4, userId: "u1", projectId: null, nom: "Evergreen", actif: true, enBoucle: false, creneaux: [], comptes: [30], fuseau: "Europe/Paris" };
const POST = {
  id: 7, userId: "u1", projectId: 1, title: "T", body: "Texte IG", platform: "instagram", contentType: "post", pillar: "p",
  goal: "g", mediaIds: [1], postFormat: "carousel", crossPostGroupId: "g1", socialAccountId: 30, autoPost: true,
};

function fauxDeps() {
  return {
    materialiser: { marque: "deps-materialiser" },
    projet: vi.fn(async (id: number) => (id < 10 ? { id, projectKind: id === 2 ? "client" : "perso" } : undefined)),
    comptes: vi.fn(async () => [
      { id: 30, platform: "Instagram", projectId: null, isActive: true, accountName: "reglages", accessToken: "secret" },
      { id: 31, platform: "linkedin", projectId: 2, isActive: true, accountName: "client", accessToken: "secret" },
    ]),
    listes: vi.fn(async () => [{ ...LISTE, nbPosts: 2 }]),
    liste: vi.fn(async (_u: string, id: number) => (id === 4 ? { ...LISTE } : undefined)),
    creerListe: vi.fn(async (_u: string, v: any) => ({ ...LISTE, ...v, id: 4 })),
    modifierListe: vi.fn(async (_u: string, id: number, v: any) => (id === 4 ? { ...LISTE, ...v } : undefined)),
    supprimerListe: vi.fn(async () => true),
    posts: vi.fn(async () => [{ id: 1, ordre: 0 }, { id: 2, ordre: 1 }, { id: 3, ordre: 2 }] as any[]),
    ajouterPost: vi.fn(async (_l: number, contenu: any) => ({ id: 9, contenu, ordre: 3 })),
    modifierPost: vi.fn(async (_l: number, id: number, v: any) => (id < 4 ? { id, ...v } : undefined)),
    supprimerPost: vi.fn(async (_l: number, id: number) => id < 4),
    materialisationsAVenir: vi.fn(async () => [{ id: 50, autolistePostId: 1 }]),
    post: vi.fn(async (id: number) => (id === 7 ? { ...POST } : undefined)),
    freres: vi.fn(async () => [{ ...POST }, { ...POST, id: 8, platform: "linkedin", body: "Texte LI" }]),
    modele: vi.fn(async (_u: string, id: number) => (id === 5 ? { id: 5, nom: "Promo", contenu: { platform: "instagram", textes: { instagram: "M" } } } : undefined)),
  };
}

let deps: ReturnType<typeof fauxDeps>;
let server: http.Server;
let port: number;
beforeEach(async () => {
  vi.clearAllMocks();
  deps = fauxDeps();
  const app = express();
  app.use(express.json());
  registerAutolistesRoutes(app, deps as any);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

describe("listes", () => {
  it("liste, lit (posts et posés à venir) ; celle d'un autre compte : 404", async () => {
    expect((await req("GET", "/api/autolistes")).status).toBe(200);
    expect(deps.listes).toHaveBeenCalledWith("u1");
    const r = await req("GET", "/api/autolistes/4");
    const j: any = await r.json();
    expect(j.posts).toHaveLength(3);
    expect(j.materialisations).toEqual([{ id: 50, autolistePostId: 1 }]);
    expect(deps.liste).toHaveBeenCalledWith("u1", 4);
    expect((await req("GET", "/api/autolistes/5")).status).toBe(404);
  });

  it("crée : validée, comptes du périmètre de la marque, posée aussitôt", async () => {
    const r = await req("POST", "/api/autolistes", { nom: " Evergreen ", comptes: [30], creneaux: [{ heure: "09:00", jours: [1] }], enBoucle: true });
    expect(r.status).toBe(201);
    expect(deps.creerListe).toHaveBeenCalledWith("u1", expect.objectContaining({ nom: "Evergreen", comptes: [30], enBoucle: true, actif: true, projectId: null }));
    expect(pose.materialiserAutoliste).toHaveBeenCalledWith(deps.materialiser, "u1", 4);
  });

  it("refuse un compte hors du périmètre (client), une marque d'un autre compte, un corps illisible", async () => {
    expect((await req("POST", "/api/autolistes", { nom: "a", comptes: [31] })).status).toBe(400); // compte du client, liste sans marque
    expect((await req("POST", "/api/autolistes", { nom: "a", projectId: 2, comptes: [30] })).status).toBe(400); // client : pas de repli
    expect((await req("POST", "/api/autolistes", { nom: "a", projectId: 42 })).status).toBe(404);
    expect((await req("POST", "/api/autolistes", { nom: "", comptes: [] })).status).toBe(400);
    expect(deps.creerListe).not.toHaveBeenCalled();
    expect((await req("POST", "/api/autolistes", { nom: "a", projectId: 2, comptes: [31] })).status).toBe(201);
  });

  it("modifie : repose la liste ; un simple renommage ne touche pas aux posts posés", async () => {
    expect((await req("PATCH", "/api/autolistes/4", { nom: "Neuf" })).status).toBe(200);
    expect(pose.reconstruireAutoliste).not.toHaveBeenCalled();
    expect((await req("PATCH", "/api/autolistes/4", { actif: false })).status).toBe(200);
    expect(deps.modifierListe).toHaveBeenLastCalledWith("u1", 4, { actif: false });
    expect(pose.reconstruireAutoliste).toHaveBeenCalledWith(deps.materialiser, "u1", 4);
    expect((await req("PATCH", "/api/autolistes/4", { comptes: [31] })).status).toBe(400);
    expect((await req("PATCH", "/api/autolistes/5", { actif: false })).status).toBe(404);
  });

  it("supprime : ses posts à venir d'abord (passage), puis la liste", async () => {
    expect((await req("DELETE", "/api/autolistes/4")).status).toBe(200);
    expect(pose.supprimerAutoliste).toHaveBeenCalled();
    expect(deps.supprimerListe).toHaveBeenCalledWith("u1", 4);
    expect((await req("DELETE", "/api/autolistes/5")).status).toBe(404);
  });

  it("comptes d'une marque : sans jeton, dans le périmètre", async () => {
    const j: any = await (await req("GET", "/api/autolistes/comptes?projectId=2")).json();
    expect(j).toEqual([{ id: 31, platform: "linkedin", accountName: "client", isActive: true, expiresAt: null, projectId: 2 }]);
    const sans: any = await (await req("GET", "/api/autolistes/comptes")).json();
    expect(sans.map((c: any) => c.id)).toEqual([30]);
    expect(JSON.stringify(sans)).not.toContain("secret");
    expect((await req("GET", "/api/autolistes/comptes?projectId=42")).status).toBe(404);
  });
});

describe("la file", () => {
  it("ajoute un post du calendrier : texte de chaque réseau, médias, options ; posée", async () => {
    const r = await req("POST", "/api/autolistes/4/posts", { contentId: 7 });
    expect(r.status).toBe(201);
    expect(deps.post).toHaveBeenCalledWith(7, "u1");
    const [, contenu] = deps.ajouterPost.mock.calls[0] as any[];
    expect(contenu.textes).toEqual({ instagram: "Texte IG", linkedin: "Texte LI" });
    expect(contenu).toMatchObject({ mediaIds: [1], postFormat: "carousel" });
    expect(contenu).not.toHaveProperty("socialAccountId");
    expect(pose.materialiserAutoliste).toHaveBeenCalledWith(deps.materialiser, "u1", 4);
  });

  it("ajoute un modèle ; introuvables : 404 ; corps vide : 400 ; 200 posts au plus : 409", async () => {
    expect((await req("POST", "/api/autolistes/4/posts", { modeleId: 5 })).status).toBe(201);
    expect(deps.modele).toHaveBeenCalledWith("u1", 5);
    expect((await req("POST", "/api/autolistes/4/posts", { modeleId: 6 })).status).toBe(404);
    expect((await req("POST", "/api/autolistes/4/posts", { contentId: 9 })).status).toBe(404);
    expect((await req("POST", "/api/autolistes/5/posts", { contentId: 7 })).status).toBe(404);
    expect((await req("POST", "/api/autolistes/4/posts", {})).status).toBe(400);
    deps.posts.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, ordre: i })));
    expect((await req("POST", "/api/autolistes/4/posts", { modeleId: 5 })).status).toBe(409);
    expect(deps.ajouterPost).toHaveBeenCalledTimes(1);
  });

  it("retire un post (ses posts à venir d'abord) ; remet en file ; ordre", async () => {
    expect((await req("DELETE", "/api/autolistes/4/posts/2")).status).toBe(200);
    expect(pose.retirerDeLaFile).toHaveBeenCalledWith(deps.materialiser, "u1", 4, 2, expect.any(Function));
    expect(deps.supprimerPost).toHaveBeenCalledWith(4, 2);
    expect((await req("DELETE", "/api/autolistes/4/posts/8")).status).toBe(404);

    expect((await req("PATCH", "/api/autolistes/4/posts/1", { actif: true })).status).toBe(200);
    expect(deps.modifierPost).toHaveBeenCalledWith(4, 1, { actif: true });
    expect((await req("PATCH", "/api/autolistes/4/posts/1", { actif: "oui" })).status).toBe(400);

    expect((await req("PUT", "/api/autolistes/4/ordre", { ids: [3, 1, 2] })).status).toBe(200);
    expect(deps.modifierPost).toHaveBeenCalledWith(4, 3, { ordre: 0 });
    expect(deps.modifierPost).toHaveBeenCalledWith(4, 1, { ordre: 1 });
    expect(deps.modifierPost).toHaveBeenCalledWith(4, 2, { ordre: 2 });
    expect(pose.reconstruireAutoliste).toHaveBeenCalledWith(deps.materialiser, "u1", 4);
    expect((await req("PUT", "/api/autolistes/4/ordre", { ids: [3, 1] })).status).toBe(400);
  });
});
