import { describe, it, expect } from "vitest";
import {
  natureErreur, apresEchec, reessaiDu, raisonLisible, MAX_TENTATIVES, DELAIS_MIN, DELAI_BLOQUE_MIN, estBloque,
} from "./fiabilite";

const t0 = new Date("2026-11-24T09:00:00Z");

describe("natureErreur (formats réels des publieurs)", () => {
  it("refus explicite du réseau : rien n'est parti, réessai sûr", () => {
    for (const e of ["ig_429: Too many calls", "graph_429: x", "li_post_429: x", "(#4) Application request limit reached", "(#9007) Media ID is not available", "rate limit reached"]) {
      expect(natureErreur(e)).toBe("refus_sur");
    }
  });
  it("coupure, délai, erreur serveur : le post a pu partir", () => {
    for (const e of ["fetch failed", "ECONNRESET", "socket hang up", "ig_500: An unexpected error has occurred. Please retry", "li_post_503: x", "The operation was aborted due to timeout"]) {
      expect(natureErreur(e)).toBe("incertain");
    }
  });
  it("le reste : définitif (et « 500 words » n'est pas une erreur serveur)", () => {
    for (const e of ["compte_expire", "media_required", "ig_400: The caption exceeds 2,200 characters (500 words)", "plateforme_non_supportee"]) {
      expect(natureErreur(e)).toBe("definitif");
    }
  });
});

describe("apresEchec", () => {
  it("refus sûr, première fois : réessai dans 5 min, numéroté", () => {
    const r = apresEchec("ig_429: x", null, t0);
    expect(r).toEqual({ etat: "reessai", lastError: `reessai:1@${new Date(t0.getTime() + DELAIS_MIN[0] * 60_000).toISOString()}|ig_429: x` });
  });
  it("refus sûr, tentatives épuisées : échec", () => {
    let dernier: string | null = null;
    for (let i = 0; i < MAX_TENTATIVES; i++) {
      const r = apresEchec("graph_429: x", dernier, t0);
      expect(r.etat).toBe("reessai");
      dernier = r.lastError;
    }
    expect(apresEchec("graph_429: x", dernier, t0)).toEqual({ etat: "echec", lastError: "graph_429: x" });
  });
  it("coupure réseau : JAMAIS réessayée, échec à vérifier", () => {
    const r = apresEchec("fetch failed", null, t0);
    expect(r.etat).toBe("echec");
    expect(raisonLisible(r.lastError)).toMatch(/peut-être parti/);
  });
  it("définitif : échec tout de suite", () => {
    expect(apresEchec("Invalid parameter", null, t0)).toEqual({ etat: "echec", lastError: "Invalid parameter" });
  });
});

describe("reessaiDu", () => {
  it("pas de réessai prévu : dû", () => {
    expect(reessaiDu(null, t0)).toBe(true);
    expect(reessaiDu("une vieille erreur", t0)).toBe(true);
  });
  it("réessai prévu plus tard : pas encore", () => {
    const r = apresEchec("ig_429: x", null, t0);
    expect(reessaiDu(r.lastError, t0)).toBe(false);
    expect(reessaiDu(r.lastError, new Date(t0.getTime() + 6 * 60_000))).toBe(true);
  });
});

describe("estBloque", () => {
  it("en cours de publication depuis plus de 15 min", () => {
    expect(estBloque({ postStatus: "posting", updatedAt: new Date(t0.getTime() - (DELAI_BLOQUE_MIN + 1) * 60_000) }, t0)).toBe(true);
    expect(estBloque({ postStatus: "posting", updatedAt: new Date(t0.getTime() - 60_000) }, t0)).toBe(false);
    expect(estBloque({ postStatus: "pending", updatedAt: new Date(0) }, t0)).toBe(false);
  });
});

describe("raisonLisible", () => {
  it("traduit les codes connus, garde le reste", () => {
    expect(raisonLisible("compte_expire")).toMatch(/connexion .* expiré/i);
    expect(raisonLisible("publication_manquee")).toMatch(/pas pu partir à l'heure/);
    expect(raisonLisible("reessai:2@2026-11-24T09:05:00.000Z|ig_429: x")).toBe("ig_429: x");
    expect(raisonLisible("truc inconnu")).toBe("truc inconnu");
  });
});
