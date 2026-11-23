// Routes des liens courts (/l/:code, /api/liens) et des SmartLinks (/b/:slug, /api/smartlinks).
// Dépendances injectées, aucune base.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "u1"; next(); } }));

const { registerLiensPublics, registerLiensRoutes, imageDePublication } = await import("./routes-liens");

const NAV = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram";

function fauxDeps() {
  let n = 0;
  let octet = 0;
  const stock: any[] = [
    { id: 1, userId: "u1", projectId: 1, code: "abcDEF1", urlCible: "https://x.fr/p?ref=a&utm_source=news", utm: { source: "instagram", medium: "social" }, origine: "composeur", clics: 4 },
    { id: 2, userId: "u1", projectId: 1, code: "BTN0001", urlCible: "https://site.fr", utm: {}, origine: "smartlink", clics: 9 },
  ];
  const smart: any = {
    id: 5, userId: "u1", projectId: 1, slug: "ma-marque", titre: "<Ma> marque", bio: "Bio", avatarUrl: null, theme: {},
    actif: true, tuilesActives: true,
    boutons: [
      { id: "b1", libelle: "Site", url: "https://site.fr", actif: true, lienId: 2, code: "BTN0001" },
      { id: "b2", libelle: "Caché", url: "https://cache.fr", actif: false, lienId: 3, code: "BTN0002" },
    ],
    liensTuiles: { "20": { url: "https://p.fr", lienId: 4, code: "TUI0001" } },
  };
  return {
    stock,
    smart,
    projet: vi.fn(async (id: number) => (id < 10 ? { id, name: "P", slug: "p" } : undefined)),
    octets: vi.fn((k: number) => Uint8Array.from({ length: k }, () => (octet++ % 62))),
    maintenant: vi.fn(() => new Date("2026-11-23T10:00:00Z")),
    compterLiensDepuis: vi.fn(async () => 0),
    creerLien: vi.fn(async (v: any) => ({ ...v, id: 100 + ++n, clics: 0, createdAt: new Date() })),
    liens_: null as any,
    liens: vi.fn(async (): Promise<any[]> => []),
    liensParIds: vi.fn(async (_u: string, ids: number[]) => stock.filter((l) => ids.includes(l.id))),
    lienParCode: vi.fn(async (code: string) => stock.find((l) => l.code === code)),
    compterClic: vi.fn(async () => {}),
    clicsDepuis: vi.fn(async () => [{ lienId: 2, jour: "2026-11-22", clics: 3 }, { lienId: 2, jour: "2026-11-23", clics: 1 }]),
    smartlinkDe: vi.fn(async (_u: string, pid: number | null) => (pid === 1 ? smart : undefined)),
    smartlink: vi.fn(async (_u: string, id: number) => (id === 5 ? smart : undefined)),
    smartlinkParSlug: vi.fn(async (slug: string) => (slug === "ma-marque" ? smart : slug === "prise" ? { id: 99, slug } : undefined)),
    creerSmartlink: vi.fn(async (row: any) => ({ id: 6, ...row })),
    modifierSmartlink: vi.fn(async (_u: string, id: number, row: any) => ({ ...smart, id, ...row })),
    supprimerSmartlink: vi.fn(async (_u: string, id: number) => id === 5),
    publications: vi.fn(async () => [
      { id: 20, mediaIds: [7], mediaUrl: null, couvertureUrl: null, publishedAt: new Date() },
      { id: 21, mediaIds: [], mediaUrl: "https://cdn.x/m.jpg", couvertureUrl: null, publishedAt: new Date() },
    ]),
    medias: vi.fn(async () => [{ id: 7, url: "https://cdn.x/i.jpg", thumbnailUrl: null, mimeType: "image/jpeg" }]),
  } as any;
}

let deps: ReturnType<typeof fauxDeps>;
let server: http.Server;
let port: number;
beforeEach(async () => {
  deps = fauxDeps();
  deps.liens.mockImplementation(async () => deps.liens_ ?? []);
  const app = express();
  app.use(express.json());
  registerLiensPublics(app, deps);
  registerLiensRoutes(app, deps);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => { server.closeAllConnections?.(); await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: any, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
  method, redirect: "manual", headers: { "Content-Type": "application/json", "User-Agent": NAV, ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

describe("GET /l/:code", () => {
  it("redirige (302) avec les UTM ajoutés sans écraser l'existant, et compte le clic", async () => {
    const r = await req("GET", "/l/abcDEF1");
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://x.fr/p");
    expect(loc.searchParams.get("ref")).toBe("a");
    expect(loc.searchParams.getAll("utm_source")).toEqual(["news"]);
    expect(loc.searchParams.get("utm_medium")).toBe("social");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(deps.compterClic).toHaveBeenCalledWith(1, "2026-11-23", expect.any(Date));
  });
  it("HEAD, robot ou préchargement : redirigé, pas compté", async () => {
    expect((await req("HEAD", "/l/abcDEF1")).status).toBe(302);
    expect((await req("GET", "/l/abcDEF1", undefined, { "User-Agent": "facebookexternalhit/1.1" })).status).toBe(302);
    expect((await req("GET", "/l/abcDEF1", undefined, { "Sec-Purpose": "prefetch" })).status).toBe(302);
    expect(deps.compterClic).not.toHaveBeenCalled();
  });
  it("un comptage en échec ne bloque pas la redirection", async () => {
    deps.compterClic.mockRejectedValueOnce(new Error("db"));
    expect((await req("GET", "/l/abcDEF1")).status).toBe(302);
  });
  it("code inconnu ou mal formé : 404 sans requête inutile", async () => {
    expect((await req("GET", "/l/zzzzzzz")).status).toBe(404);
    expect((await req("GET", "/l/abc")).status).toBe(404);
    expect(deps.lienParCode).toHaveBeenCalledTimes(1);
  });
  it("ne redirige jamais vers une cible non http(s)", async () => {
    deps.stock.push({ id: 9, code: "EVIL001", urlCible: "javascript:alert(1)", utm: {} });
    expect((await req("GET", "/l/EVIL001")).status).toBe(404);
  });
});

describe("GET /b/:slug", () => {
  it("200, HTML échappé, boutons actifs via liens courts, tuiles", async () => {
    const r = await req("GET", "/b/ma-marque");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await r.text();
    expect(html).toContain("&lt;Ma&gt; marque");
    expect(html).not.toContain("<Ma>");
    expect(html).toContain(`href="/l/BTN0001"`);
    expect(html).not.toContain("BTN0002");
    expect(html).toContain(`<a class="tuile" href="/l/TUI0001" rel="noopener"><img src="https://cdn.x/i.jpg"`);
    expect(html).toContain(`<div class="tuile"><img src="https://cdn.x/m.jpg"`);
    expect(deps.publications).toHaveBeenCalledWith("u1", 1, 9);
  });
  it("404 si inactive, inconnue ou slug illisible", async () => {
    deps.smart.actif = false;
    expect((await req("GET", "/b/ma-marque")).status).toBe(404);
    expect((await req("GET", "/b/inconnue")).status).toBe(404);
    expect((await req("GET", "/b/A%3Cb%3E")).status).toBe(404);
  });
});

describe("POST /api/liens", () => {
  it("crée un lien court (code base62 de 7) dans la marque", async () => {
    const r = await req("POST", "/api/liens", { url: "https://x.fr/a", utm: { source: "instagram", medium: "social" }, projectId: 1 });
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(j.urlCourte).toBe(`http://localhost:3000/l/${j.code}`);
    expect(deps.creerLien).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", projectId: 1, urlCible: "https://x.fr/a", utm: { source: "instagram", medium: "social" }, origine: "composeur",
    }));
  });
  it("refuse javascript:, data:, UTM illisibles ; marque d'un autre compte : 404", async () => {
    expect((await req("POST", "/api/liens", { url: "javascript:alert(1)" })).status).toBe(400);
    expect((await req("POST", "/api/liens", { url: "data:text/html,x" })).status).toBe(400);
    expect((await req("POST", "/api/liens", { url: "https://x.fr", utm: { source: 1 } })).status).toBe(400);
    expect((await req("POST", "/api/liens", { url: "https://x.fr", projectId: 77 })).status).toBe(404);
    expect(deps.creerLien).not.toHaveBeenCalled();
  });
  it("limite de 200 liens par 24 h : 429", async () => {
    deps.compterLiensDepuis.mockResolvedValueOnce(200);
    const r = await req("POST", "/api/liens", { url: "https://x.fr" });
    expect(r.status).toBe(429);
    expect(deps.compterLiensDepuis).toHaveBeenCalledWith("u1", new Date("2026-11-22T10:00:00Z"));
  });
  it("code déjà pris : un autre est tiré", async () => {
    deps.creerLien.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    expect((await req("POST", "/api/liens", { url: "https://x.fr" })).status).toBe(201);
    expect(deps.creerLien).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/liens", () => {
  it("liste les liens du composeur avec les clics des 30 jours", async () => {
    deps.liens_ = [{ id: 2, code: "BTN0001", urlCible: "https://site.fr", utm: {}, clics: 9 }];
    const r = await req("GET", "/api/liens?projectId=1");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j[0]).toMatchObject({ code: "BTN0001", clics: 9, trenteJours: 4 });
    expect(deps.liens).toHaveBeenCalledWith("u1", 1, "composeur");
    expect(deps.clicsDepuis).toHaveBeenCalledWith([2], "2026-10-25");
    expect((await req("GET", "/api/liens?projectId=77")).status).toBe(404);
  });
});

describe("/api/smartlinks", () => {
  it("lit la SmartLink de la marque avec son URL publique et les publications", async () => {
    const j = await (await req("GET", "/api/smartlinks?projectId=1")).json();
    expect(j.smartlink.urlPublique).toBe("http://localhost:3000/b/ma-marque");
    expect(j.publications.map((p: any) => p.id)).toEqual([20, 21]);
    expect((await req("GET", "/api/smartlinks?projectId=77")).status).toBe(404);
  });

  it("crée : un lien court par bouton et par tuile liée", async () => {
    const r = await req("POST", "/api/smartlinks", {
      projectId: 2, slug: "autre-marque", titre: "A", boutons: [{ libelle: "Site", url: "https://a.fr" }],
      tuilesActives: true, liensTuiles: { "20": "https://p.fr" },
    });
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.boutons[0]).toMatchObject({ libelle: "Site", url: "https://a.fr", actif: true, lienId: expect.any(Number), code: expect.stringMatching(/^[0-9A-Za-z]{7}$/) });
    expect(j.liensTuiles["20"]).toMatchObject({ url: "https://p.fr", code: expect.any(String) });
    expect(deps.creerLien).toHaveBeenCalledTimes(2);
    expect(deps.creerLien).toHaveBeenCalledWith(expect.objectContaining({ origine: "smartlink", projectId: 2, utm: { source: "smartlink", medium: "bio", campaign: "autre-marque" } }));
    expect(deps.creerSmartlink).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", projectId: 2 }));
  });

  it("refuse : slug réservé/pris, URL non https, déjà une SmartLink pour la marque", async () => {
    expect((await (await req("POST", "/api/smartlinks", { projectId: 2, slug: "admin" })).json()).message).toBe("slug_reserve");
    expect((await req("POST", "/api/smartlinks", { projectId: 2, slug: "prise" })).status).toBe(409);
    expect((await (await req("POST", "/api/smartlinks", { projectId: 2, slug: "neuve", boutons: [{ libelle: "x", url: "javascript:alert(1)" }] })).json()).message).toBe("bouton_url");
    expect((await (await req("POST", "/api/smartlinks", { projectId: 1, slug: "neuve" })).json()).message).toBe("deja_existante");
    expect((await req("POST", "/api/smartlinks", { projectId: 77, slug: "neuve" })).status).toBe(404);
  });

  it("modifie : garde le lien d'un bouton inchangé, en crée un pour une URL changée", async () => {
    const r = await req("PUT", "/api/smartlinks/5", {
      slug: "ma-marque", titre: "T",
      boutons: [{ id: "b2", libelle: "Neuf", url: "https://neuf.fr" }, { id: "b1", libelle: "Site", url: "https://site.fr" }],
      tuilesActives: true, liensTuiles: { "20": "https://p.fr" },
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.boutons.map((b: any) => b.id)).toEqual(["b2", "b1"]);
    expect(j.boutons[1]).toMatchObject({ lienId: 2, code: "BTN0001" });
    expect(j.boutons[0].lienId).toBeGreaterThan(100);
    expect(j.liensTuiles["20"]).toMatchObject({ lienId: 4, code: "TUI0001" });
    expect(deps.creerLien).toHaveBeenCalledTimes(1);
    expect((await req("PUT", "/api/smartlinks/6", { slug: "ma-marque" })).status).toBe(404);
  });

  it("modifie : quota dépassé → 429, rien d'écrit", async () => {
    deps.compterLiensDepuis.mockResolvedValueOnce(200);
    const r = await req("PUT", "/api/smartlinks/5", { slug: "ma-marque", boutons: [{ id: "b9", libelle: "N", url: "https://n.fr" }] });
    expect(r.status).toBe(429);
    expect(deps.modifierSmartlink).not.toHaveBeenCalled();
  });

  it("statistiques : total et 30 jours par bouton", async () => {
    const j = await (await req("GET", "/api/smartlinks/5/stats")).json();
    expect(j.total).toBe(9);
    expect(j.trenteJours).toBe(4);
    expect(j.boutons[0]).toMatchObject({ id: "b1", total: 9, trenteJours: 4 });
    expect(j.boutons[1]).toMatchObject({ id: "b2", total: 0, trenteJours: 0 });
    expect(j.parJour).toEqual([{ jour: "2026-11-22", clics: 3 }, { jour: "2026-11-23", clics: 1 }]);
    expect(deps.liensParIds).toHaveBeenCalledWith("u1", [2, 3, 4]);
  });

  it("supprime la sienne ; celle d'un autre : 404", async () => {
    expect((await req("DELETE", "/api/smartlinks/5")).status).toBe(200);
    expect((await req("DELETE", "/api/smartlinks/6")).status).toBe(404);
  });
});

describe("imageDePublication", () => {
  it("vignette, puis image, puis couverture ; jamais http", () => {
    const m = new Map([[1, { url: "https://c/v.mp4", thumbnailUrl: "https://c/v.jpg", mimeType: "video/mp4" }],
      [2, { url: "https://c/v2.mp4", thumbnailUrl: null, mimeType: "video/mp4" }]]);
    expect(imageDePublication({ id: 1, mediaIds: [1], mediaUrl: null, couvertureUrl: null, publishedAt: null }, m)).toBe("https://c/v.jpg");
    expect(imageDePublication({ id: 1, mediaIds: [2], mediaUrl: null, couvertureUrl: "https://c/cov.jpg", publishedAt: null }, m)).toBe("https://c/cov.jpg");
    expect(imageDePublication({ id: 1, mediaIds: [], mediaUrl: "http://c/m.jpg", couvertureUrl: null, publishedAt: null }, m)).toBeNull();
  });
});

describe("montage des routes publiques", () => {
  it("/l et /b sont montées avant l'authentification ; le SPA vient après registerRoutes", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
    const publics = routes.indexOf("registerLiensPublics(app)");
    expect(publics).toBeGreaterThan(0);
    expect(publics).toBeLessThan(routes.indexOf("await setupAuth(app)"));
    expect(publics).toBeLessThan(routes.indexOf("app.use(gateNayaAccess)"));
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(index.indexOf("await registerRoutes(app)")).toBeLessThan(index.indexOf("await setupVite(app, server)"));
    expect(index.indexOf("await registerRoutes(app)")).toBeLessThan(index.indexOf("serveStatic(app)"));
  });
});
