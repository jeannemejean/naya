import { describe, it, expect } from "vitest";
import {
  codeDepuisOctets, CODE_RE, detecterUrls, doitCompter, estLienCourt, estRobot, estUrlSure, fusionnerUtm,
  lienRepris, lireSmartlink, lireUtm, remplacerUrl, slugifier, themeSur, THEME_DEFAUT, utmParDefaut, validerSlug,
} from "./liens";

describe("estUrlSure", () => {
  it("accepte http(s) absolu", () => {
    expect(estUrlSure("https://exemple.fr/a?b=1#c")).toBe(true);
    expect(estUrlSure("http://exemple.fr")).toBe(true);
  });
  it("refuse javascript:, data:, relatif, identifiants, espaces", () => {
    for (const u of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>", "/chemin", "ftp://x.fr",
      "https://user:pw@x.fr", "https://x.fr/a b", "", "   ", null, 42, "https://x.fr/\"onmouseover=1"]) {
      expect(estUrlSure(u)).toBe(false);
    }
  });
  it("httpsSeulement refuse http", () => {
    expect(estUrlSure("http://x.fr", true)).toBe(false);
    expect(estUrlSure("https://x.fr", true)).toBe(true);
  });
  it("refuse une URL trop longue", () => {
    expect(estUrlSure("https://x.fr/" + "a".repeat(2100))).toBe(false);
  });
});

describe("fusionnerUtm", () => {
  it("ajoute les UTM", () => {
    expect(fusionnerUtm("https://x.fr/p", { source: "instagram", medium: "social", campaign: "noel" }))
      .toBe("https://x.fr/p?utm_source=instagram&utm_medium=social&utm_campaign=noel");
  });
  it("garde les paramètres existants et n'écrase jamais un utm déjà présent", () => {
    const r = new URL(fusionnerUtm("https://x.fr/p?ref=a&utm_source=newsletter#top", { source: "instagram", medium: "social" }));
    expect(r.searchParams.get("ref")).toBe("a");
    expect(r.searchParams.getAll("utm_source")).toEqual(["newsletter"]);
    expect(r.searchParams.get("utm_medium")).toBe("social");
    expect(r.hash).toBe("#top");
  });
  it("sans UTM : l'URL inchangée", () => {
    expect(fusionnerUtm("https://x.fr/p?a=1", {})).toBe("https://x.fr/p?a=1");
    expect(fusionnerUtm("https://x.fr/p", null)).toBe("https://x.fr/p");
  });
  it("encode les valeurs", () => {
    expect(fusionnerUtm("https://x.fr", { campaign: "été & co" })).toContain("utm_campaign=%C3%A9t%C3%A9+%26+co");
  });
});

describe("lireUtm", () => {
  it("nettoie, ignore les vides, refuse l'illisible", () => {
    expect(lireUtm({ source: " ig ", medium: "", foo: "x" })).toEqual({ source: "ig" });
    expect(lireUtm(undefined)).toEqual({});
    expect(lireUtm({ source: 3 })).toBeNull();
    expect(lireUtm({ source: "a".repeat(101) })).toBeNull();
    expect(lireUtm([])).toBeNull();
  });
});

describe("code", () => {
  it("7 caractères base62 depuis des octets", () => {
    const c = codeDepuisOctets([0, 1, 61, 62, 247, 10, 35, 36]);
    expect(c).toBe("01z0zAZ");
    expect(CODE_RE.test(c!)).toBe(true);
  });
  it("rejette les octets ≥ 248 (distribution uniforme) ; null si trop peu", () => {
    expect(codeDepuisOctets([248, 255, 1, 2, 3, 4, 5, 6, 7])).toBe("1234567");
    expect(codeDepuisOctets([255, 1, 2])).toBeNull();
  });
  it("CODE_RE", () => {
    expect(CODE_RE.test("aB3dE5f")).toBe(true);
    for (const c of ["aB3dE5", "aB3dE5fg", "aB3-E5f", "../etc"]) expect(CODE_RE.test(c)).toBe(false);
  });
});

describe("robots et préchargement", () => {
  it("détecte les robots évidents", () => {
    for (const ua of ["Googlebot/2.1", "facebookexternalhit/1.1", "Twitterbot/1.0", "LinkedInBot/1.0", "WhatsApp/2.23",
      "Slackbot-LinkExpanding 1.0", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/120", "", undefined]) {
      expect(estRobot(ua)).toBe(true);
    }
  });
  it("laisse passer les navigateurs", () => {
    expect(estRobot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0")).toBe(false);
    expect(estRobot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(false);
  });
  it("doitCompter : ni HEAD, ni prefetch, ni robot", () => {
    const nav = { "user-agent": "Mozilla/5.0 Safari/605" };
    expect(doitCompter("GET", nav)).toBe(true);
    expect(doitCompter("HEAD", nav)).toBe(false);
    expect(doitCompter("GET", { ...nav, purpose: "prefetch" })).toBe(false);
    expect(doitCompter("GET", { ...nav, "sec-purpose": "prefetch;prerender" })).toBe(false);
    expect(doitCompter("GET", { "user-agent": "Googlebot" })).toBe(false);
  });
});

describe("slug", () => {
  it("format et mots réservés", () => {
    expect(validerSlug("cafe-mouture")).toBe("ok");
    expect(validerSlug("ab")).toBe("format");
    expect(validerSlug("a".repeat(41))).toBe("format");
    expect(validerSlug("Cafe")).toBe("format");
    expect(validerSlug("café")).toBe("format");
    expect(validerSlug("a/b")).toBe("format");
    expect(validerSlug("api")).toBe("reserve");
    expect(validerSlug("admin")).toBe("reserve");
    expect(validerSlug(3)).toBe("format");
  });
  it("slugifier", () => {
    expect(slugifier("Café Mouture !")).toBe("cafe-mouture");
    expect(slugifier("  ")).toBe("");
  });
});

describe("texte", () => {
  it("détecte les URL sans ponctuation finale ni doublon", () => {
    expect(detecterUrls("Voir https://x.fr/a. Et (https://y.fr/b?c=1), https://x.fr/a !"))
      .toEqual(["https://x.fr/a", "https://y.fr/b?c=1"]);
    expect(detecterUrls("rien ici")).toEqual([]);
  });
  it("remplace toutes les occurrences", () => {
    expect(remplacerUrl("a https://x.fr b https://x.fr", "https://x.fr", "https://n.app/l/abcdefg"))
      .toBe("a https://n.app/l/abcdefg b https://n.app/l/abcdefg");
  });
  it("reconnaît un lien court", () => {
    expect(estLienCourt("https://www.hellonaya.app/l/abcDEF1", "https://www.hellonaya.app/")).toBe(true);
    expect(estLienCourt("https://www.hellonaya.app/b/marque", "https://www.hellonaya.app")).toBe(false);
  });
  it("UTM par défaut", () => {
    expect(utmParDefaut("Instagram", "Lancement Été")).toEqual({ medium: "social", source: "instagram", campaign: "lancement-ete" });
    expect(utmParDefaut(null, null)).toEqual({ medium: "social" });
  });
});

describe("lireSmartlink", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const base = { slug: "ma-marque", titre: "Ma marque", bio: "Bio", boutons: [{ id: "b1", libelle: "Site", url: "https://x.fr" }] };

  it("valide et normalise", () => {
    const r = lireSmartlink({ ...base, slug: " Ma-Marque ", theme: { couleurFond: "#000000", couleurTexte: "red" } }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.slug).toBe("ma-marque");
    expect(r.valeur.boutons).toEqual([{ id: "b1", libelle: "Site", url: "https://x.fr", actif: true }]);
    expect(r.valeur.theme).toEqual({ couleurFond: "#000000", couleurTexte: THEME_DEFAUT.couleurTexte });
    expect(r.valeur.actif).toBe(true);
    expect(r.valeur.tuilesActives).toBe(false);
  });
  it("refuse slug réservé, URL non https, libellé trop long, avatar javascript:", () => {
    expect(lireSmartlink({ ...base, slug: "api" }, id)).toEqual({ ok: false, erreur: "slug_reserve" });
    expect(lireSmartlink({ ...base, slug: "x" }, id)).toEqual({ ok: false, erreur: "slug_format" });
    expect(lireSmartlink({ ...base, boutons: [{ libelle: "a", url: "http://x.fr" }] }, id)).toEqual({ ok: false, erreur: "bouton_url" });
    expect(lireSmartlink({ ...base, boutons: [{ libelle: "a", url: "javascript:alert(1)" }] }, id)).toEqual({ ok: false, erreur: "bouton_url" });
    expect(lireSmartlink({ ...base, boutons: [{ libelle: "a".repeat(81), url: "https://x.fr" }] }, id)).toEqual({ ok: false, erreur: "bouton_libelle" });
    expect(lireSmartlink({ ...base, avatarUrl: "javascript:alert(1)" }, id)).toEqual({ ok: false, erreur: "avatar" });
    expect(lireSmartlink({ ...base, liensTuiles: { "12": "data:x" } }, id)).toEqual({ ok: false, erreur: "tuiles" });
  });
  it("donne un id aux boutons sans id ou en double", () => {
    const r = lireSmartlink({ ...base, boutons: [{ libelle: "a", url: "https://a.fr" }, { id: "z", libelle: "b", url: "https://b.fr" }, { id: "z", libelle: "c", url: "https://c.fr", actif: false }] }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.valeur.boutons.map((b) => b.id);
    expect(new Set(ids).size).toBe(3);
    expect(r.valeur.boutons[2].actif).toBe(false);
  });
  it("liens de tuiles : vides ignorés", () => {
    const r = lireSmartlink({ ...base, tuilesActives: true, liensTuiles: { "12": "https://p.fr", "13": "" } }, id);
    expect(r.ok && r.valeur.liensTuiles).toEqual({ "12": "https://p.fr" });
  });
});

describe("lienRepris / themeSur", () => {
  it("reprend le lien si l'URL n'a pas changé", () => {
    expect(lienRepris({ url: "https://a.fr", lienId: 3, code: "abcdefg" }, "https://a.fr")).toEqual({ lienId: 3, code: "abcdefg" });
    expect(lienRepris({ url: "https://a.fr", lienId: 3, code: "abcdefg" }, "https://b.fr")).toBeNull();
    expect(lienRepris(undefined, "https://b.fr")).toBeNull();
  });
  it("theme invalide → défaut", () => {
    expect(themeSur({ couleurFond: "url(javascript:x)" })).toEqual(THEME_DEFAUT);
  });
});
