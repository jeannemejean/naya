import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { evaluationReseaux, lireInstagram, cleDoublon } = await import("./reseaux");

const D = new Date("2026-11-10T00:00:00Z"); const M = new Date("2026-11-25T09:00:00Z");
const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

const base = (o: any = {}) => ({
  postsNaya: vi.fn(async () => [
    { platform: "LinkedIn", scheduledFor: new Date("2026-11-12T08:00:00Z"), postStatus: "posted", publishedAt: new Date("2026-11-12T08:00:00Z"), body: "Actu du jour sur la mode durable" },
  ]),
  connexionMetricool: vi.fn(async () => null),
  postsMetricool: vi.fn(),
  marquerMetricoolRefuse: vi.fn(async () => {}),
  compteInstagram: vi.fn(async () => null),
  lireInstagram: vi.fn(),
  ...o,
});

describe("evaluationReseaux", () => {
  it("sans Metricool : metricool_absent, Naya seule, LinkedIn profil signalé", async () => {
    const e = await evaluationReseaux(base(), "u1", D, M);
    expect(e.limites).toEqual(expect.arrayContaining(["metricool_absent", "linkedin_profil_non_lisible"]));
    expect(e.parReseau).toEqual([expect.objectContaining({ reseau: "linkedin", prevus: 1, publies: 1, source: "naya", portee: null })]);
  });
  it("Metricool refuse (403) : connexion marquée refusée, évaluation rendue quand même", async () => {
    const d = base({ connexionMetricool: vi.fn(async () => ({ jeton: "t", mcUserId: "1", marques: [{ blogId: "2", nom: "A" }] })), postsMetricool: vi.fn(async () => ({ ok: false, raison: "refuse" })) });
    const e = await evaluationReseaux(d, "u1", D, M);
    expect(e.limites).toContain("metricool_refuse");
    expect(d.marquerMetricoolRefuse).toHaveBeenCalledWith("u1");
    expect(e.parReseau[0].publies).toBe(1);
  });
  it("même post dans Naya et Metricool : compté une fois ; les manqués listés, par marque", async () => {
    const d = base({
      connexionMetricool: vi.fn(async () => ({ jeton: "t", mcUserId: "1", marques: [{ blogId: "2", nom: "Agence JMD" }] })),
      postsMetricool: vi.fn(async () => ({ ok: true, posts: [
        { reseau: "linkedin", prevuLe: "2026-11-12T09:00:00+01:00", publie: true, texte: "Actu du jour sur la mode durable" },
        { reseau: "linkedin", prevuLe: "2026-11-13T09:00:00+01:00", publie: false, texte: "Actu ratée" },
      ] })),
    });
    const e = await evaluationReseaux(d, "u1", D, M);
    expect(e.parReseau.find((r) => r.reseau === "linkedin" && !r.marque)).toMatchObject({ prevus: 1, publies: 1, source: "naya" });
    expect(e.parReseau.find((r) => r.marque === "Agence JMD")).toMatchObject({
      reseau: "linkedin", prevus: 1, publies: 0, source: "metricool", manques: [{ texte: "Actu ratée", prevuLe: "2026-11-13T09:00:00+01:00" }],
    });
  });
  it("plusieurs marques Metricool : lues une à une, une ligne par réseau et par marque", async () => {
    const postsMetricool = vi.fn(async (cx: any) => ({ ok: true, posts: cx.blogId === "10"
      ? [{ reseau: "instagram", prevuLe: "2026-11-14T09:00:00Z", publie: true, texte: "Perso" }]
      : [{ reseau: "instagram", prevuLe: "2026-11-14T09:00:00Z", publie: false, texte: "Actu agence" }] }));
    const d = base({
      postsNaya: vi.fn(async () => []),
      connexionMetricool: vi.fn(async () => ({ jeton: "t", mcUserId: "1", marques: [{ blogId: "10", nom: "jeanne__md" }, { blogId: "20", nom: "Agence JMD" }] })),
      postsMetricool,
    });
    const e = await evaluationReseaux(d, "u1", D, M);
    expect(postsMetricool.mock.calls.map((c: any) => c[0])).toEqual([
      { jeton: "t", mcUserId: "1", blogId: "10" }, { jeton: "t", mcUserId: "1", blogId: "20" },
    ]);
    expect(e.parReseau).toEqual([
      expect.objectContaining({ reseau: "instagram", marque: "jeanne__md", prevus: 1, publies: 1 }),
      expect.objectContaining({ reseau: "instagram", marque: "Agence JMD", prevus: 1, publies: 0 }),
    ]);
  });
  it("une marque Metricool indisponible : les autres restent comptées", async () => {
    const d = base({
      postsNaya: vi.fn(async () => []),
      connexionMetricool: vi.fn(async () => ({ jeton: "t", mcUserId: "1", marques: [{ blogId: "10", nom: "A" }, { blogId: "20", nom: "B" }] })),
      postsMetricool: vi.fn(async (cx: any) => cx.blogId === "10" ? { ok: false, raison: "indisponible" }
        : { ok: true, posts: [{ reseau: "linkedin", prevuLe: "2026-11-14T09:00:00Z", publie: true, texte: "x" }] }),
    });
    const e = await evaluationReseaux(d, "u1", D, M);
    expect(e.limites).toContain("metricool_indisponible");
    expect(e.parReseau).toEqual([expect.objectContaining({ marque: "B", publies: 1 })]);
  });
  it("Instagram sans la portée statistiques : chiffres null (jamais 0) et portee_manquante", async () => {
    const d = base({
      compteInstagram: vi.fn(async () => ({ jeton: "ig" })),
      lireInstagram: vi.fn(async () => ({ posts: [{ texte: "Reel", publieLe: "2026-11-14T10:00:00+0000", portee: null }], abonnesGagnes: null, limite: "portee_manquante" })),
    });
    const e = await evaluationReseaux(d, "u1", D, M);
    const ig = e.parReseau.find((r) => r.reseau === "instagram")!;
    expect(ig).toMatchObject({ publies: 1, portee: null, abonnesGagnes: null, source: "instagram" });
    expect(e.limites).toContain("portee_manquante");
  });
  it("Instagram qui plante : l'évaluation reste, avec instagram_erreur", async () => {
    const d = base({ compteInstagram: vi.fn(async () => ({ jeton: "ig" })), lireInstagram: vi.fn(async () => { throw new Error("fetch failed"); }) });
    const e = await evaluationReseaux(d, "u1", D, M);
    expect(e.limites).toContain("instagram_erreur");
    expect(e.parReseau[0]).toMatchObject({ reseau: "linkedin", publies: 1 });
  });
  it("clé de doublon : réseau, minute, 40 premiers caractères", () => {
    expect(cleDoublon("LinkedIn", "2026-11-12T08:00:30Z", "Abc")).toBe(cleDoublon("linkedin", "2026-11-12T09:00:00+01:00", "Abc"));
  });
});

describe("lireInstagram", () => {
  it("posts de la période + portée par post quand la permission est là", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/me/media")) return rep(200, { data: [{ id: "m1", caption: "Reel", timestamp: "2026-11-14T10:00:00+0000" }, { id: "m0", caption: "Vieux", timestamp: "2026-10-01T10:00:00+0000" }] });
      if (url.includes("/m1/insights")) return rep(200, { data: [{ name: "reach", values: [{ value: 120 }] }] });
      return rep(400, {});
    });
    const r = await lireInstagram({ jeton: "ig" }, D, M, f as any);
    expect(r.posts).toEqual([{ texte: "Reel", publieLe: "2026-11-14T10:00:00+0000", portee: 120 }]);
    expect(r.limite).toBeUndefined();
  });
  it("statistiques refusées (permission absente) : portée null + portee_manquante", async () => {
    const f = vi.fn(async (url: string) => (url.includes("/me/media")
      ? rep(200, { data: [{ id: "m1", caption: "Reel", timestamp: "2026-11-14T10:00:00+0000" }] })
      : rep(403, { error: { code: 10 } })));
    const r = await lireInstagram({ jeton: "ig" }, D, M, f as any);
    expect(r.posts[0].portee).toBeNull();
    expect(r.limite).toBe("portee_manquante");
  });
  it("jeton expiré (190) : instagram_expire, aucun post", async () => {
    const f = vi.fn(async () => rep(400, { error: { code: 190 } }));
    expect(await lireInstagram({ jeton: "ig" }, D, M, f as any)).toEqual({ posts: [], abonnesGagnes: null, limite: "instagram_expire" });
  });
  it("plus de 50 posts : suit les pages suivantes jusqu'au début de la période", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, caption: "x", timestamp: "2026-11-20T10:00:00+0000" }));
    const page2 = [{ id: "b1", caption: "y", timestamp: "2026-11-12T10:00:00+0000" }, { id: "b0", caption: "vieux", timestamp: "2026-10-01T10:00:00+0000" }];
    const f = vi.fn(async (url: string) => {
      if (url.includes("after=P2")) return rep(200, { data: page2, paging: { next: "https://graph.instagram.com/v1/me/media?after=P3" } });
      if (url.includes("/me/media")) return rep(200, { data: page1, paging: { next: "https://graph.instagram.com/v1/me/media?after=P2" } });
      return rep(200, { data: [{ name: "reach", values: [{ value: 1 }] }] });
    });
    const r = await lireInstagram({ jeton: "ig" }, D, M, f as any);
    expect(r.posts).toHaveLength(51);
    expect(r.partiel).toBeUndefined();
    expect(f.mock.calls.some(([u]) => String(u).includes("after=P3"))).toBe(false); // page 2 atteint le début : on s'arrête
  });
  it("trop de posts pour tout lire : partiel", async () => {
    let n = 0;
    const f = vi.fn(async (url: string) => {
      if (url.includes("media")) {
        n++;
        return rep(200, { data: Array.from({ length: 50 }, (_, i) => ({ id: `p${n}_${i}`, caption: "x", timestamp: "2026-11-20T10:00:00+0000" })), paging: { next: `https://graph.instagram.com/v1/me/media?after=P${n + 1}` } });
      }
      return rep(200, { data: [{ name: "reach", values: [{ value: 1 }] }] });
    });
    const r = await lireInstagram({ jeton: "ig" }, D, M, f as any);
    expect(r.partiel).toBe(true);
  });
  it("page suivante hors de graph.instagram.com : jamais suivie", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, caption: "x", timestamp: "2026-11-20T10:00:00+0000" }));
    const f = vi.fn(async (url: string) => (url.includes("/me/media")
      ? rep(200, { data: page1, paging: { next: "https://ailleurs.example/me/media?after=P2" } })
      : rep(200, { data: [] })));
    await lireInstagram({ jeton: "ig" }, D, M, f as any);
    expect(f.mock.calls.some(([u]) => String(u).includes("ailleurs.example"))).toBe(false);
  });
});

describe("évaluation : lecture Instagram partielle", () => {
  it("le dit dans les limites", async () => {
    const d = base({ compteInstagram: vi.fn(async () => ({ jeton: "ig" })), lireInstagram: vi.fn(async () => ({ posts: [], abonnesGagnes: null, partiel: true })) });
    expect((await evaluationReseaux(d, "u1", D, M)).limites).toContain("instagram_partiel");
  });
});
