// Veille AO : requêtes, collecte et passage BOAMP / TED → avis Naya. Aucun réseau : le fetch est
// simulé avec des réponses réelles enregistrées le 10 novembre 2026 (__fixtures__).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clauseBoamp, urlBoamp, corpsTed, collecterBoamp, collecterTed, BOAMP_URL, TED_URL, CPV_VEILLE, type Fetch } from "./sources";
import { mapperBoamp, mapperTed, procedureDepuisLibelle, instantTed } from "./mapping";

const fixture = (nom: string) => JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", nom), "utf8"));
const BOAMP = fixture("boamp-2026-11-10.json");
const TED = fixture("ted-2026-11-10.json");
const F = { depuis: "2026-11-07", aujourdhui: "2026-11-10" };
const reponse = (corps: unknown, ok = true, status = 200) => ({ ok, status, json: async () => corps });
const boamp = (id: string) => BOAMP.results.find((r: any) => r.idweb === id);
const ted = (id: string) => TED.notices.find((n: any) => n["publication-number"] === id);

describe("requête BOAMP (ODSQL)", () => {
  it("fenêtre de publication, avis de marché seulement, date limite non passée, périmètre", () => {
    const w = clauseBoamp(F);
    expect(w).toContain("dateparution>=date'2026-11-07'");
    expect(w).toContain("nature='APPEL_OFFRE'");
    expect(w).toContain("(datelimitereponse is null OR datelimitereponse>=date'2026-11-10')");
    expect(w).toContain('descripteur_libelle in ("Publicité, Communication"');
    for (const c of CPV_VEILLE) expect(w).toContain(`search(donnees,"${c}")`);
    expect(w).toContain('search(objet,"communication")');
  });

  it("URL paginée, triée par parution", () => {
    const u = new URL(urlBoamp(F, 200, 100));
    expect(`${u.origin}${u.pathname}`).toBe(BOAMP_URL);
    expect(u.searchParams.get("offset")).toBe("200");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("order_by")).toBe("dateparution desc");
    expect(u.searchParams.get("where")).toBe(clauseBoamp(F));
  });
});

describe("requête TED (v3, expert)", () => {
  it("CPV, acheteurs français, avis de marché, depuis la date", () => {
    const c = corpsTed(F, 2, 50);
    expect(c.query).toContain(`classification-cpv IN (${CPV_VEILLE.join(" ")})`);
    expect(c.query).toContain("buyer-country IN (FRA)");
    expect(c.query).toContain("publication-date>=20261107");
    expect(c.query).toContain("notice-type IN (cn-standard cn-social cn-desg)");
    expect(c).toMatchObject({ page: 2, limit: 50, scope: "ACTIVE" });
    expect(c.fields).toContain("publication-number");
  });
});

describe("BOAMP → avis", () => {
  it("schéma eForms : faits, CPV, montant structuré, lien DCE", () => {
    const a = mapperBoamp(boamp("26-108562"))!;
    expect(a).toMatchObject({
      source: "boamp", sourceId: "26-108562", reference: "BOAMP 26-108562", acheteur: "SEINE PARK",
      procedure: "Appel d'offres ouvert", departement: "92", montantEstimeHt: "250000.00",
      lienAvis: "https://www.boamp.fr/pages/avis/?q=idweb:26-108562",
      lienDce: "https://marches.maximilien.fr/entreprise/consultation/937974?orgAcronyme=a5n",
    });
    expect(a.dateLimite?.toISOString()).toBe("2026-12-07T22:59:00.000Z");
    expect(a.cpv).toEqual(expect.arrayContaining(["79340000", "79822500"]));
    expect(a.texte).toContain("Valeur technique");
    expect(a.texte).not.toMatch(/ElectronicMail|Telephone/);
  });

  it("schéma MAPA : procédure adaptée, départements, profil acheteur", () => {
    const a = mapperBoamp(boamp("26-109294"))!;
    expect(a).toMatchObject({ procedure: "MAPA", departement: "20A, 20B", montantEstimeHt: null });
    expect(a.lienDce).toMatch(/^https:\/\/alta-rocca\.e-marchespublics\.com\//);
  });

  it("schéma FNSimple : capacités et critères dans le texte lu par l'IA", () => {
    const a = mapperBoamp(boamp("26-109228"))!;
    expect(a.texte).toContain("Aucun chiffre d’affaires minimal requis");
    expect(a.texte).toContain("Prix (40%)");
    expect(a.cpv).toEqual(["79952000"]);
    expect(a.departement).toBe("09, 11, 12, 30, 31, 34, 65, 66, 81");
  });

  it("lienSur appliqué : un lien non http(s) n'est jamais gardé", () => {
    const r = { ...boamp("26-109294"), url_avis: "javascript:alert(1)" };
    const donnees = JSON.parse(r.donnees);
    donnees.MAPA.organisme.urlProfilAcheteur = "data:text/html,x";
    const a = mapperBoamp({ ...r, donnees: JSON.stringify(donnees) })!;
    expect(a.lienAvis).toBe("https://www.boamp.fr/pages/avis/?q=idweb:26-109294");
    expect(a.lienDce).toBeNull();
  });

  it("sans idweb ou sans objet : ignoré", () => {
    expect(mapperBoamp({ ...boamp("26-109294"), idweb: null })).toBeNull();
    expect(mapperBoamp({ ...boamp("26-109294"), objet: "  " })).toBeNull();
  });

  it("procédures", () => {
    expect(procedureDepuisLibelle("Procédure Adaptée")).toBe("MAPA");
    expect(procedureDepuisLibelle("Procédure Ouverte")).toBe("Appel d'offres ouvert");
    expect(procedureDepuisLibelle("Concours restreint")).toBe("Concours");
    expect(procedureDepuisLibelle("Procédure avec négociation")).toBe("Autre");
    expect(procedureDepuisLibelle(null)).toBeNull();
  });
});

describe("TED → avis", () => {
  it("titre de procédure, acheteur, date limite la plus proche, valeur, DCE", () => {
    const a = mapperTed(ted("769510-2026"))!;
    expect(a).toMatchObject({
      source: "ted", sourceId: "769510-2026", reference: "TED 769510-2026",
      acheteur: "METROPOLE TOULON PROVENCE MEDITERRANEE", procedure: "Appel d'offres ouvert", montantEstimeHt: "165280.00",
      lienAvis: "https://ted.europa.eu/fr/notice/-/detail/769510-2026",
    });
    expect(a.objet).toContain("mise en œuvre");
    expect(a.dateLimite?.toISOString()).toBe("2026-12-09T14:00:00.000Z");
    expect(a.lienDce).toMatch(/^https:\/\/www\.achatpublic\.com\//);
    expect(a.texte).toContain("Critères d'attribution : 1- Valeur Technique. (50)");
    expect(a.texte).toContain("trois derniers exercices");
  });

  it("date sans heure : 23 h 59 à Paris", () => {
    expect(instantTed("2026-12-09+01:00")?.toISOString()).toBe("2026-12-09T22:59:00.000Z");
    expect(instantTed("pas une date")).toBeNull();
  });

  it("lien html non http(s) remplacé par le lien TED officiel", () => {
    const a = mapperTed({ ...ted("776725-2026"), links: { html: { FRA: "javascript:x" } } })!;
    expect(a.lienAvis).toBe("https://ted.europa.eu/fr/notice/-/detail/776725-2026");
  });
});

describe("collecte", () => {
  it("BOAMP : une page suffit quand tout est là", async () => {
    const fetch = vi.fn<Fetch>(async () => reponse(BOAMP));
    const avis = await collecterBoamp(fetch, F);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(avis.map((a) => a.sourceId).sort()).toEqual(["26-108562", "26-108766", "26-108811", "26-109228", "26-109294"]);
  });

  it("BOAMP : pagination plafonnée (pagesMax)", async () => {
    const fetch = vi.fn<Fetch>(async () => reponse({ total_count: 5000, results: BOAMP.results.slice(0, 2) }));
    await collecterBoamp(fetch, F, { parPage: 2, pagesMax: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get("offset")).toBe("4");
  });

  it("TED : POST JSON sur l'API de recherche", async () => {
    const fetch = vi.fn<Fetch>(async () => reponse(TED));
    const avis = await collecterTed(fetch, F);
    expect(avis).toHaveLength(4);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(TED_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).query).toContain("buyer-country IN (FRA)");
  });

  it("erreur HTTP : la collecte lève (le passage la note et continue)", async () => {
    await expect(collecterBoamp(async () => reponse({}, false, 503), F)).rejects.toThrow("HTTP 503");
  });

  it("délai d'expiration : la requête est interrompue", async () => {
    const fetch: Fetch = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    await expect(collecterTed(fetch, F, { timeoutMs: 10 })).rejects.toThrow("aborted");
  });
});
