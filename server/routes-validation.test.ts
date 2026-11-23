// Routes de la validation client (lot 8) : portail public par lien privé et routes de la marque.
// Dépendances injectées, aucune base, aucun email.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerValidationPublique, registerValidationRoutes } = await import("./routes-validation");

const TOKEN = "a".repeat(43);
const ANNE = { nom: "Anne", email: "anne@client.fr" };
const BRUNO = { nom: "Bruno", email: "bruno@client.fr" };
const DEMANDE = new Date("2026-11-23T08:00:00Z");

function fauxDeps() {
  const decisions: any[] = [];
  const reglages: any = { id: 1, userId: "u1", projectId: 3, actif: true, regle: "un", relecteurs: [ANNE, BRUNO] };
  const portail: any = { id: 9, userId: "u1", projectId: 3, token: TOKEN, actif: true, expireAt: null, createdAt: new Date() };
  const posts: any[] = [
    { id: 50, userId: "u1", projectId: 3, title: "Lundi", body: "Texte", platform: "instagram", postFormat: "feed_image", mediaIds: [7],
      mediaUrl: null, couvertureUrl: null, scheduledFor: new Date("2026-11-24T09:00:00Z"), publishedAt: null, postStatus: "pending",
      validationStatut: "a_valider", validationDemandeeAt: DEMANDE, supprimeLe: null },
    { id: 51, userId: "u1", projectId: 4, title: "Autre marque", body: "x", platform: "linkedin", postFormat: "text", mediaIds: [],
      mediaUrl: null, couvertureUrl: null, scheduledFor: null, publishedAt: null, postStatus: "pending",
      validationStatut: null, validationDemandeeAt: null, supprimeLe: null },
    { id: 52, userId: "u1", projectId: 3, title: "Publié", body: "x", platform: "instagram", postFormat: "feed_image", mediaIds: [],
      mediaUrl: null, couvertureUrl: null, scheduledFor: null, publishedAt: new Date(), postStatus: "posted",
      validationStatut: null, validationDemandeeAt: null, supprimeLe: null },
  ];
  let n = 0;
  return {
    d: { decisions, reglages, portail, posts },
    maintenant: vi.fn(() => new Date("2026-11-23T10:00:00Z")),
    jeton: vi.fn(() => "b".repeat(43)),
    projet: vi.fn(async (id: number, userId: string) => (userId === "u1" && (id === 3 || id === 4) ? { id, name: `P${id}` } : undefined)),
    projetParId: vi.fn(async (id: number) => (id === 3 ? { id, userId: "u1", name: "Marque", clientName: "Client SA" } : undefined)),
    langue: vi.fn(async () => "fr" as const),
    reglages: vi.fn(async (pid: number) => (pid === 3 ? reglages : undefined)),
    enregistrerReglages: vi.fn(async (v: any) => ({ id: 1, ...v })),
    portail: vi.fn(async () => portail),
    portailParJeton: vi.fn(async (t: string) => (t === portail.token ? portail : undefined)),
    nouveauPortail: vi.fn(async (userId: string, projectId: number, token: string) => ({ id: 10, userId, projectId, token, actif: true, expireAt: null, createdAt: new Date() })),
    couperPortail: vi.fn(async () => {}),
    posts: vi.fn(async (userId: string, ids: number[]) => posts.filter((p) => p.userId === userId && ids.includes(p.id))),
    postsDuProjet: vi.fn(async (_u: string, pid: number) => posts.filter((p) => p.projectId === pid && p.validationStatut)),
    decisions: vi.fn(async (ids: number[]) => decisions.filter((d) => ids.includes(d.contentId))),
    ajouterDecision: vi.fn(async (v: any) => { const d = { id: ++n, ...v, createdAt: new Date(Date.UTC(2026, 10, 23, 10, 0, n)) }; decisions.push(d); return d; }),
    poserStatut: vi.fn(async (id: number, _u: string, statut: any, demandeeAt: any) => {
      const p = posts.find((x) => x.id === id); if (!p) return false;
      p.validationStatut = statut; p.validationDemandeeAt = demandeeAt; return true;
    }),
    medias: vi.fn(async () => [{ id: 7, url: "https://cdn.x/i.jpg", thumbnailUrl: null, mimeType: "image/jpeg" }]),
    journaliser: vi.fn(async () => {}),
  } as any;
}

let deps: ReturnType<typeof fauxDeps>;
let server: http.Server;
let port: number;
beforeEach(async () => {
  deps = fauxDeps();
  const app = express();
  app.use(express.json());
  registerValidationPublique(app, deps);
  registerValidationRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});
const decider = (body: any, id = 50, token = TOKEN) => req("POST", `/api/portail-validation/${token}/posts/${id}/decision`, body);

describe("portail public", () => {
  it("lien valide : la marque, les relecteurs et les posts à valider (aperçu), sans adresse dans les décisions", async () => {
    deps.d.decisions.push({ id: 99, contentId: 50, relecteurEmail: ANNE.email, decision: "commentaire", commentaire: "Joli", createdAt: new Date() });
    const r = await req("GET", `/api/portail-validation/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    const j = await r.json();
    expect(j.marque).toBe("Client SA");
    expect(j.relecteurs).toEqual([ANNE, BRUNO]);
    expect(j.posts.map((p: any) => p.id)).toEqual([50]);
    expect(j.posts[0].visuels).toEqual([{ url: "https://cdn.x/i.jpg", type: "image", vignette: null }]);
    expect(j.posts[0].decisions[0]).toMatchObject({ relecteur: "Anne", commentaire: "Joli" });
    expect(j.posts[0].decisions[0].relecteurEmail).toBeUndefined();
  });
  it("jeton inconnu ou mal formé : 404", async () => {
    expect((await req("GET", `/api/portail-validation/${"z".repeat(43)}`)).status).toBe(404);
    expect((await req("GET", "/api/portail-validation/court")).status).toBe(404);
    expect(deps.portailParJeton).toHaveBeenCalledTimes(1);
  });
  it("lien coupé, expiré ou validation désactivée : 404", async () => {
    deps.d.portail.actif = false;
    expect((await req("GET", `/api/portail-validation/${TOKEN}`)).status).toBe(404);
    deps.d.portail.actif = true;
    deps.d.portail.expireAt = new Date("2026-11-23T09:00:00Z");
    expect((await req("GET", `/api/portail-validation/${TOKEN}`)).status).toBe(404);
    deps.d.portail.expireAt = null;
    deps.d.reglages.actif = false;
    expect((await decider({ relecteurEmail: ANNE.email, decision: "validee" })).status).toBe(404);
  });
  it("relecteur hors liste : 403, rien d'écrit", async () => {
    const r = await decider({ relecteurEmail: "intrus@x.fr", decision: "validee" });
    expect(r.status).toBe(403);
    expect(deps.ajouterDecision).not.toHaveBeenCalled();
  });
  it("règle « un » : la première validation valide le post (décision enregistrée, historique)", async () => {
    const r = await decider({ relecteurEmail: "Anne@Client.fr", decision: "validee", commentaire: "Parfait" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ statut: "validee" });
    expect(deps.ajouterDecision).toHaveBeenCalledWith({ contentId: 50, relecteurEmail: ANNE.email, decision: "validee", commentaire: "Parfait" });
    expect(deps.poserStatut).toHaveBeenCalledWith(50, "u1", "validee", DEMANDE, { statut: "a_valider", demandeeAt: DEMANDE });
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 50, "validation_validee", expect.objectContaining({ relecteur: "Anne" }));
  });
  it("règle « tous » : il faut chaque relecteur ; un refus refuse", async () => {
    deps.d.reglages.regle = "tous";
    expect(await (await decider({ relecteurEmail: ANNE.email, decision: "validee" })).json()).toEqual({ statut: "a_valider" });
    expect(deps.poserStatut).not.toHaveBeenCalled();
    expect(await (await decider({ relecteurEmail: BRUNO.email, decision: "validee" })).json()).toEqual({ statut: "validee" });

    deps.d.posts[0].validationStatut = "a_valider";
    deps.d.posts[0].validationDemandeeAt = new Date("2026-11-23T10:00:02.500Z"); // relancé : les décisions d'avant ne comptent plus
    expect(await (await decider({ relecteurEmail: BRUNO.email, decision: "validee" })).json()).toEqual({ statut: "a_valider" });
  });
  it("un refus refuse ; décider ensuite : 409, commenter reste possible", async () => {
    expect(await (await decider({ relecteurEmail: BRUNO.email, decision: "refusee", commentaire: "Pas ce visuel" })).json()).toEqual({ statut: "refusee" });
    expect((await decider({ relecteurEmail: ANNE.email, decision: "validee" })).status).toBe(409);
    const c = await decider({ relecteurEmail: ANNE.email, decision: "commentaire", commentaire: "D'accord avec Bruno" });
    expect(c.status).toBe(200);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 50, "validation_commentaire", { relecteur: "Anne" });
  });
  it("post d'une autre marque ou hors validation : 404", async () => {
    expect((await decider({ relecteurEmail: ANNE.email, decision: "validee" }, 51)).status).toBe(404);
    expect((await decider({ relecteurEmail: ANNE.email, decision: "validee" }, 999)).status).toBe(404);
  });
  it("corps illisible : 400", async () => {
    expect((await decider({ relecteurEmail: ANNE.email, decision: "publier" })).status).toBe(400);
  });
  it("décisions limitées par lien : 429 au-delà de 60 en 10 minutes", async () => {
    let dernier = 0;
    for (let i = 0; i < 61; i++) dernier = (await decider({ relecteurEmail: ANNE.email, decision: "commentaire", commentaire: `c${i}` })).status;
    expect(dernier).toBe(429);
  });
});

describe("routes de la marque", () => {
  it("lecture : réglages, lien du portail, posts", async () => {
    const j = await (await req("GET", "/api/validation/projets/3")).json();
    expect(j.reglages).toEqual({ actif: true, regle: "un", relecteurs: [ANNE, BRUNO] });
    expect(j.portail.lien).toBe(`/v/${TOKEN}`);
    expect(j.posts[0].id).toBe(50);
  });
  it("marque d'un autre compte : 404 partout", async () => {
    expect((await req("GET", "/api/validation/projets/77")).status).toBe(404);
    expect((await req("PUT", "/api/validation/projets/77", { actif: false, regle: "un", relecteurs: [] })).status).toBe(404);
    expect((await req("POST", "/api/validation/projets/77/portail")).status).toBe(404);
    expect((await req("DELETE", "/api/validation/projets/77/portail")).status).toBe(404);
    expect(deps.enregistrerReglages).not.toHaveBeenCalled();
    expect(deps.nouveauPortail).not.toHaveBeenCalled();
  });
  it("réglages : validés puis enregistrés ; illisibles → 400", async () => {
    const r = await req("PUT", "/api/validation/projets/3", { actif: true, regle: "tous", relecteurs: [{ nom: "Anne", email: "ANNE@client.fr" }] });
    expect(r.status).toBe(200);
    expect(deps.enregistrerReglages).toHaveBeenCalledWith({ userId: "u1", projectId: 3, actif: true, regle: "tous", relecteurs: [ANNE] });
    expect((await req("PUT", "/api/validation/projets/3", { actif: true, regle: "un", relecteurs: [] })).status).toBe(400);
  });
  it("portail : créer / régénérer donne un lien neuf ; couper", async () => {
    const r = await req("POST", "/api/validation/projets/3/portail");
    expect(r.status).toBe(201);
    expect((await r.json()).lien).toBe(`/v/${"b".repeat(43)}`);
    expect(deps.nouveauPortail).toHaveBeenCalledWith("u1", 3, "b".repeat(43));
    expect((await req("DELETE", "/api/validation/projets/3/portail")).status).toBe(200);
    expect(deps.couperPortail).toHaveBeenCalledWith("u1", 3);
  });
  it("envoyer en validation : posé « à valider » et journalisé ; sans validation ou publié → laissé", async () => {
    deps.d.posts[0].validationStatut = null;
    const j = await (await req("POST", "/api/validation/envoyer", { ids: [50, 51, 52] })).json();
    expect(j.traites).toEqual([50]);
    expect(j.ignores).toEqual([{ id: 51, raison: "sans_validation" }, { id: 52, raison: "deja_publie" }]);
    expect(deps.poserStatut).toHaveBeenCalledWith(50, "u1", "a_valider", expect.any(Date));
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 50, "validation_demandee", null);
  });
  it("envoyer : un post d'un autre compte → 404, rien touché", async () => {
    expect((await req("POST", "/api/validation/envoyer", { ids: [50, 999] })).status).toBe(404);
    expect(deps.poserStatut).not.toHaveBeenCalled();
    expect((await req("POST", "/api/validation/envoyer", { ids: [] })).status).toBe(400);
  });
  it("statut d'un post et retrait de la validation", async () => {
    deps.d.decisions.push({ id: 1, contentId: 50, relecteurEmail: BRUNO.email, decision: "refusee", commentaire: "Non", createdAt: new Date() });
    const j = await (await req("GET", "/api/validation/posts/50")).json();
    expect(j).toMatchObject({ actif: true, regle: "un", statut: "a_valider" });
    expect(j.decisions[0]).toMatchObject({ relecteur: "Bruno", decision: "refusee", commentaire: "Non" });
    expect((await req("DELETE", "/api/validation/posts/50")).status).toBe(200);
    expect(deps.poserStatut).toHaveBeenCalledWith(50, "u1", null, null);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 50, "validation_retiree", { avant: "a_valider" });
    expect((await req("GET", "/api/validation/posts/999")).status).toBe(404);
  });
});
