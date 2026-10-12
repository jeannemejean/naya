import { describe, it, expect, vi } from "vitest";
import { executerConcurrents, executerVoixClient, executerSerp, executerGeo, routineVeillePour, type DepsVeille } from "./executeurs";
import { empreinte } from "./texte";

const routine = (kind: string) => ({ id: 1, userId: "u1", kind, cible: { projectId: 7 }, projectId: 7 }) as any;
const it_ = (id: number, type: string, libelle: string, valeur: any = null, statut = "suivi") =>
  ({ id, userId: "u1", projectId: 7, type, libelle, valeur, statut, source: "naya", createdAt: null, updatedAt: null });

function fausseBase(items: any[], releves: any[] = [], constats: any[] = []) {
  return {
    items, releves, constats,
    getProject: vi.fn(async (id: number, u: string) => (id === 7 && u === "u1" ? { id: 7, name: "Lune", userId: "u1" } : undefined)),
    getVeilleItems: vi.fn(async () => items),
    getRelevesParCles: vi.fn(async (_u: string, _p: number, kind: string, cles: string[]) =>
      releves.filter((r) => r.kind === kind && cles.includes(r.cle)).sort((a, b) => b.id - a.id)),
    addVeilleReleves: vi.fn(async (rows: any[]) => { rows.forEach((r) => releves.push({ id: releves.length + 100, ...r })); }),
    addVeilleConstats: vi.fn(async (rows: any[]) => { rows.forEach((r) => constats.push(r)); return rows; }),
    getVeilleConstats: vi.fn(async () => constats),
  };
}

function deps(base: any, over: Partial<DepsVeille> = {}): DepsVeille {
  return {
    storage: base,
    garde: vi.fn(async () => null),
    bloque: vi.fn(async () => false),
    chercher: vi.fn(async () => []),
    lirePage: vi.fn(async () => null),
    interroger: vi.fn(async () => ({ texte: "", citations: [] })),
    moteurs: () => ["openai"],
    ia: vi.fn(async () => "{}"),
    instagram: vi.fn(async () => null),
    serpConfigure: () => true,
    lectureConfiguree: () => true,
    instagramConfigure: () => false,
    ...over,
  } as DepsVeille;
}

describe("garde commune", () => {
  it("projet disparu ou d'une autre utilisatrice : routine désactivée, aucune dépense", async () => {
    const base = fausseBase([it_(1, "concurrent", "Soleil")]);
    base.getProject.mockResolvedValue(undefined);
    const d = deps(base);
    const r = await executerConcurrents(routine("veille_concurrents"), d);
    expect(r.desactiver).toBe(true);
    expect(d.chercher).not.toHaveBeenCalled();
  });
  it("aucun élément suivi : rien à faire, sans même vérifier le budget", async () => {
    const d = deps(fausseBase([it_(1, "concurrent", "Soleil", null, "propose")]));
    const r = await executerConcurrents(routine("veille_concurrents"), d);
    expect(r.statut).toBe("rien_a_faire");
    expect(d.garde).not.toHaveBeenCalled();
    expect(d.lirePage).not.toHaveBeenCalled();
  });
  it("accès ou budget refusé : le résultat de la garde est rendu, aucun appel", async () => {
    const d = deps(fausseBase([it_(1, "mot_cle", "bougie")]), { garde: vi.fn(async () => ({ statut: "rien_a_faire" as const, resume: "Budget atteint" })) });
    const r = await executerSerp(routine("veille_serp"), d);
    expect(r.resume).toBe("Budget atteint");
    expect(d.chercher).not.toHaveBeenCalled();
  });
});

describe("veille concurrents", () => {
  const soleil = it_(3, "concurrent", "Soleil", { site: "https://soleil.fr" });
  it("premier passage : instantané du site, pas de « changement »", async () => {
    const base = fausseBase([soleil]);
    const d = deps(base, { lirePage: vi.fn(async () => "Coffret à 49 €"), serpConfigure: () => false });
    const r = await executerConcurrents(routine("veille_concurrents"), d);
    expect(d.ia).not.toHaveBeenCalled();
    expect(base.releves.find((x: any) => x.cle === "site:3")).toBeTruthy();
    expect(r.statut).toBe("rien_a_faire");
    expect(r.notifier).toBeFalsy();
  });
  it("site modifié : résumé du changement d'offre, constat et notification", async () => {
    const base = fausseBase([soleil], [{ id: 1, kind: "veille_concurrents", cle: "site:3", donnees: { hash: empreinte("Coffret à 49 €"), extrait: "Coffret à 49 €" } }]);
    const d = deps(base, {
      lirePage: vi.fn(async () => "Coffret à 39 € jusqu'à dimanche"), serpConfigure: () => false,
      ia: vi.fn(async () => '{"changement_commercial": true, "resume": "Coffret passé de 49 à 39 € jusqu\'à dimanche."}'),
    });
    const r = await executerConcurrents(routine("veille_concurrents"), d);
    expect(base.constats).toHaveLength(1);
    expect(base.constats[0].type).toBe("offre_concurrent");
    expect(base.constats[0].texte).toContain("39 €");
    expect(r.statut).toBe("ok");
    expect(r.notifier).toBe(true);
  });
  it("actualité de la semaine : les articles déjà vus ne reviennent pas", async () => {
    const vu = "https://presse.fr/soleil-leve-des-fonds";
    const base = fausseBase([it_(3, "concurrent", "Soleil")], [{ id: 1, kind: "veille_concurrents", cle: `actu:${empreinte(vu)}`, donnees: {} }]);
    const d = deps(base, { chercher: vi.fn(async () => [{ link: vu, title: "Soleil lève des fonds" }, { link: "https://presse.fr/soleil-ouvre", title: "Soleil ouvre une boutique", source: "Presse" }]) });
    await executerConcurrents(routine("veille_concurrents"), d);
    expect(base.constats.map((c: any) => c.type)).toEqual(["actu_concurrent"]);
    expect(base.constats[0].preuve.url).toBe("https://presse.fr/soleil-ouvre");
    const [, requete, opts] = (d.chercher as any).mock.calls[0];
    expect(requete).toBe('"Soleil"');
    expect(opts).toMatchObject({ vertical: "news", freshness: "week" });
  });
  it("tout échoue (fournisseur en panne) : erreur neutre, sans notification", async () => {
    const d = deps(fausseBase([soleil]), { lirePage: vi.fn(async () => null), chercher: vi.fn(async () => { throw new Error("HTTP 401"); }) });
    const r = await executerConcurrents(routine("veille_concurrents"), d);
    expect(r.statut).toBe("erreur");
    expect(r.notifier).toBeFalsy();
  });
});

describe("veille voix du client", () => {
  const req = it_(4, "requete_voc", "site:reddit.com bougie avis");
  it("lit au plus 8 pages neuves, en extrait des constats et notifie", async () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ link: `https://reddit.com/r/b/${i}`, title: `t${i}` }));
    const base = fausseBase([req], [{ id: 1, kind: "veille_voix_client", cle: `url:${empreinte(links[0].link)}`, donnees: {} }]);
    const d = deps(base, {
      chercher: vi.fn(async () => links),
      lirePage: vi.fn(async (_u: string, url: string) => `contenu ${url}`),
      ia: vi.fn(async () => JSON.stringify({ constats: [{ type: "objection", texte: "Trop cher pour une bougie", verbatim: "45 € ??", url: "https://reddit.com/r/b/1" }] })),
    });
    const r = await executerVoixClient(routine("veille_voix_client"), d);
    expect((d.lirePage as any).mock.calls.length).toBe(8);
    expect((d.lirePage as any).mock.calls.map((c: any) => c[1])).not.toContain(links[0].link);
    expect(base.constats).toHaveLength(1);
    expect(base.constats[0].preuve).toMatchObject({ url: "https://reddit.com/r/b/1" });
    expect(r.notifier).toBe(true);
  });
  it("rien de neuf : aucune lecture, aucun appel IA", async () => {
    const link = "https://reddit.com/r/b/0";
    const base = fausseBase([req], [{ id: 1, kind: "veille_voix_client", cle: `url:${empreinte(link)}`, donnees: {} }]);
    const d = deps(base, { chercher: vi.fn(async () => [{ link, title: "t" }]) });
    const r = await executerVoixClient(routine("veille_voix_client"), d);
    expect(r.statut).toBe("rien_a_faire");
    expect(d.lirePage).not.toHaveBeenCalled();
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("recherche en panne : erreur sans notification", async () => {
    const d = deps(fausseBase([req]), { chercher: vi.fn(async () => { throw new Error("HTTP 401"); }) });
    const r = await executerVoixClient(routine("veille_voix_client"), d);
    expect(r.statut).toBe("erreur");
    expect(r.notifier).toBeFalsy();
  });
});

describe("veille Google (SERP)", () => {
  const marque = it_(1, "marque", "Lune", { site: "lune.fr" });
  const soleil = it_(2, "concurrent", "Soleil", { site: "soleil.fr" });
  const kw = it_(5, "mot_cle", "bougie artisanale");
  const resultats = (d: string[]) => d.map((x) => ({ link: `https://${x}/`, title: x }));
  it("premier passage : un bilan de départ", async () => {
    const base = fausseBase([marque, soleil, kw]);
    const d = deps(base, { chercher: vi.fn(async () => resultats(["a.fr", "lune.fr"])) });
    const r = await executerSerp(routine("veille_serp"), d);
    expect(base.constats.map((c: any) => c.type)).toEqual(["bilan_serp"]);
    expect(base.releves[0].donnees.positions).toEqual({ marque: 2, c2: null });
    expect(r.notifier).toBe(true);
  });
  it("passage suivant : signale le gain de position", async () => {
    const base = fausseBase([marque, soleil, kw], [{ id: 1, kind: "veille_serp", cle: "serp:5", donnees: { positions: { marque: 9, c2: null } } }]);
    const d = deps(base, { chercher: vi.fn(async () => resultats(["lune.fr"])) });
    await executerSerp(routine("veille_serp"), d);
    expect(base.constats.map((c: any) => c.type)).toEqual(["position"]);
  });
  it("aucun site connu (ni marque ni concurrents) : rien à faire, aucune recherche", async () => {
    const d = deps(fausseBase([it_(1, "marque", "Lune"), kw]));
    const r = await executerSerp(routine("veille_serp"), d);
    expect(r.statut).toBe("rien_a_faire");
    expect(d.chercher).not.toHaveBeenCalled();
  });
});

describe("veille GEO", () => {
  const marque = it_(1, "marque", "Lune Studio", { site: "lune-studio.fr" });
  const etoile = it_(2, "concurrent", "Étoile");
  const p1 = it_(6, "prompt_geo", "Quelle bougie artisanale offrir ?");
  it("aucune IA branchée : erreur sans notification ni dépense", async () => {
    const d = deps(fausseBase([marque, p1]), { moteurs: () => [] });
    const r = await executerGeo(routine("veille_geo"), d);
    expect(r.statut).toBe("erreur");
    expect(r.notifier).toBeFalsy();
    expect(d.interroger).not.toHaveBeenCalled();
  });
  it("premier passage : bilan et sources à travailler", async () => {
    const base = fausseBase([marque, etoile, p1]);
    const d = deps(base, { interroger: vi.fn(async () => ({ texte: "Étoile est la référence.", citations: ["https://elle.fr/x"] })) });
    const r = await executerGeo(routine("veille_geo"), d);
    expect(base.constats.map((c: any) => c.type).sort()).toEqual(["bilan_geo", "source_geo"]);
    expect(base.releves[0].cle).toBe("geo:openai:6");
    expect(r.notifier).toBe(true);
  });
  it("passage suivant : la marque devient citée", async () => {
    const base = fausseBase([marque, etoile, p1], [{ id: 1, kind: "veille_geo", cle: "geo:openai:6", donnees: { analyse: { citee: false, citeeDansSources: false, position: null, concurrentsCites: ["Étoile"], sources: [] } } }]);
    const d = deps(base, { interroger: vi.fn(async () => ({ texte: "Lune Studio et Étoile.", citations: [] })) });
    await executerGeo(routine("veille_geo"), d);
    expect(base.constats.map((c: any) => c.type)).toContain("citation_geo");
  });
  it("le budget atteint en cours de passage arrête les questions", async () => {
    const p2 = it_(7, "prompt_geo", "Q2");
    const bloque = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const d = deps(fausseBase([marque, p1, p2]), { bloque, interroger: vi.fn(async () => ({ texte: "x", citations: [] })) });
    await executerGeo(routine("veille_geo"), d);
    expect(d.interroger).toHaveBeenCalledTimes(1);
  });
});

it("routineVeillePour : hebdomadaire, une par projet et par type, premier passage le lendemain matin", () => {
  const maintenant = new Date("2026-10-12T20:00:00Z");
  const r = routineVeillePour("veille_geo", { userId: "u1", projectId: 7 }, maintenant);
  expect(r).toMatchObject({ kind: "veille_geo", cibleCle: "project:7", cible: { projectId: 7 }, cadence: "hebdomadaire", heureUtc: 5, actif: true });
  expect(r.prochainPassage.toISOString()).toBe("2026-10-13T05:00:00.000Z");
});
