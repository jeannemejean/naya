import { describe, it, expect, vi } from "vitest";
import {
  marcheDeRecherche,
  normaliserRequeteGoogle,
  sourcerJusquaCible,
  PLAFOND_APPELS_SERP,
  PAGES_PAR_REQUETE,
} from "./prospection-sourcing";
import { buildSerpUrl, type SerpResult } from "./serp";

describe("marcheDeRecherche — gl/hl épinglés depuis le marché de l'utilisatrice", () => {
  it("prend le pays ISO renvoyé par les critères en priorité", () => {
    expect(marcheDeRecherche({ searchCountry: "BE", geographies: ["France"], langueCompte: "fr" })).toEqual({ pays: "be", langue: "fr" });
  });
  it("reconnaît un pays nommé dans les géographies de l'ICP", () => {
    expect(marcheDeRecherche({ geographies: ["Suisse romande"], langueCompte: "fr" })).toEqual({ pays: "ch", langue: "fr" });
    expect(marcheDeRecherche({ geographies: ["United Kingdom"], langueCompte: "en" })).toEqual({ pays: "gb", langue: "en" });
  });
  it("géographies sans pays reconnaissable (villes) → repli sur la langue du compte", () => {
    expect(marcheDeRecherche({ geographies: ["Paris", "Lyon"], langueCompte: "fr" }).pays).toBe("fr");
    expect(marcheDeRecherche({ geographies: ["Montréal"], searchCountry: "CA", langueCompte: "fr" }).pays).toBe("ca");
  });
  it("la langue des critères l'emporte sur celle du compte", () => {
    expect(marcheDeRecherche({ searchCountry: "DE", searchLanguage: "de", langueCompte: "fr" })).toEqual({ pays: "de", langue: "de" });
  });
  it("sans aucun indice : pays déduit de la langue du compte, jamais aléatoire", () => {
    expect(marcheDeRecherche({ langueCompte: "fr" })).toEqual({ pays: "fr", langue: "fr" });
    expect(marcheDeRecherche({ langueCompte: "en" })).toEqual({ pays: "us", langue: "en" });
    expect(marcheDeRecherche({})).toEqual({ pays: "fr", langue: "fr" });
  });
  it("ignore un code pays invalide", () => {
    expect(marcheDeRecherche({ searchCountry: "France!!", geographies: ["Belgique"] }).pays).toBe("be");
  });
});

describe("normaliserRequeteGoogle — jamais de syntaxe Sales Navigator envoyée à Google", () => {
  it("ajoute le X-ray LinkedIn s'il manque", () => {
    expect(normaliserRequeteGoogle('"directrice marketing" cosmétique')).toBe('site:linkedin.com/in "directrice marketing" cosmétique');
  });
  it("garde une requête X-ray déjà correcte", () => {
    expect(normaliserRequeteGoogle('site:linkedin.com/in "head of brand"')).toBe('site:linkedin.com/in "head of brand"');
  });
  it("traduit AND / NOT en syntaxe Google", () => {
    expect(normaliserRequeteGoogle('"directeur" AND (mode OR luxe) NOT agence NOT "freelance"')).toBe(
      'site:linkedin.com/in "directeur" (mode OR luxe) -agence -"freelance"',
    );
  });
  it("vide → null", () => {
    expect(normaliserRequeteGoogle("   ")).toBeNull();
  });
});

describe("buildSerpUrl — pagination", () => {
  it("page 0 : pas de start ; page 2 : start=20", () => {
    expect(buildSerpUrl("x")).not.toContain("start=");
    expect(buildSerpUrl("x", { page: 2 })).toContain("start=20");
  });
});

function profil(slug: string, nom = slug): SerpResult {
  return { link: `https://www.linkedin.com/in/${slug}`, title: `${nom} - Directrice - Maison ${slug} | LinkedIn` };
}

describe("sourcerJusquaCible — continue tant que la cible n'est pas atteinte", () => {
  it("pagine chaque requête et s'arrête dès que la cible est atteinte", async () => {
    const search = vi.fn(async (q: string, page: number) => [profil(`${q}-${page}-a`), profil(`${q}-${page}-b`)]);
    const r = await sourcerJusquaCible({ requetes: ["q1", "q2"], cible: 5, search, estConnu: () => false });
    expect(r.leads).toHaveLength(5);
    // q1 p0, p1, p2 (6 profils ≥ 5) → s'arrête avant q2
    expect(search.mock.calls.map((c) => [c[0], c[1]])).toEqual([["q1", 0], ["q1", 1], ["q1", 2]]);
    expect(r.appels).toBe(3);
    expect(r.cibleAtteinte).toBe(true);
  });

  it("passe à la requête suivante quand une page ne rend plus de profil", async () => {
    const search = vi.fn(async (q: string, page: number) => (page === 0 ? [profil(`${q}-0`)] : []));
    const r = await sourcerJusquaCible({ requetes: ["q1", "q2"], cible: 50, search, estConnu: () => false });
    expect(search.mock.calls.map((c) => [c[0], c[1]])).toEqual([["q1", 0], ["q1", 1], ["q2", 0], ["q2", 1]]);
    expect(r.leads).toHaveLength(2);
    expect(r.cibleAtteinte).toBe(false);
  });

  it("ne compte que les profils NOUVEAUX (déjà connus ou doublons écartés)", async () => {
    const search = vi.fn(async () => [profil("deja"), profil("neuf"), profil("neuf")]);
    const r = await sourcerJusquaCible({
      requetes: ["q1"], cible: 10, search,
      estConnu: (url) => url.includes("/deja"),
    });
    expect(r.leads.map((l) => l.linkedinUrl)).toEqual(["https://www.linkedin.com/in/neuf"]);
    expect(r.dejaConnus).toBe(1);
  });

  it("redemande de nouvelles requêtes quand les premières sont épuisées, en passant celles déjà utilisées", async () => {
    let n = 0;
    const search = vi.fn(async () => [profil(`p${n++}`)]);
    const nouvellesRequetes = vi.fn(async (deja: string[]) => (deja.length < 2 ? ["q2"] : []));
    const r = await sourcerJusquaCible({
      requetes: ["q1"], cible: 100, search, estConnu: () => false, nouvellesRequetes,
    });
    expect(nouvellesRequetes).toHaveBeenCalledWith(["q1"]);
    expect(r.requetesUtilisees).toEqual(["q1", "q2"]);
    expect(r.epuise).toBe(true);
  });

  it("ne dépasse JAMAIS le plafond d'appels SERP (coût Bright Data)", async () => {
    let n = 0;
    const search = vi.fn(async () => [profil(`p${n++}`)]);
    const requetes = Array.from({ length: 40 }, (_, i) => `q${i}`);
    const r = await sourcerJusquaCible({ requetes, cible: 10_000, search, estConnu: () => false });
    expect(search).toHaveBeenCalledTimes(PLAFOND_APPELS_SERP);
    expect(r.appels).toBe(PLAFOND_APPELS_SERP);
  });

  it("au plus PAGES_PAR_REQUETE pages par requête", async () => {
    let n = 0;
    const search = vi.fn(async () => [profil(`p${n++}`)]);
    await sourcerJusquaCible({ requetes: ["q1"], cible: 10_000, search, estConnu: () => false });
    expect(search).toHaveBeenCalledTimes(PAGES_PAR_REQUETE);
  });

  it("dédoublonne les requêtes identiques", async () => {
    const search = vi.fn(async () => []);
    await sourcerJusquaCible({ requetes: ["q1", " q1 ", "Q1"], cible: 10, search, estConnu: () => false });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("notifie chaque appel facturé (journal d'usage)", async () => {
    const surAppel = vi.fn();
    await sourcerJusquaCible({ requetes: ["q1"], cible: 10, search: async () => [], estConnu: () => false, surAppel });
    expect(surAppel).toHaveBeenCalledTimes(1);
  });
});
