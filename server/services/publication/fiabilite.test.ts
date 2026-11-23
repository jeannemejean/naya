import { describe, it, expect } from "vitest";
import {
  estTransitoire, apresEchec, reessaiDu, raisonLisible, MAX_TENTATIVES, DELAIS_MIN, DELAI_BLOQUE_MIN, estBloque,
} from "./fiabilite";

const t0 = new Date("2026-11-24T09:00:00Z");

describe("estTransitoire", () => {
  it("réseau, 5xx, limite de débit : transitoire", () => {
    for (const e of ["fetch failed", "ECONNRESET", "ETIMEDOUT", "HTTP 502 Bad Gateway", "status 503", "429 Too Many Requests", "rate limit reached", "socket hang up"]) {
      expect(estTransitoire(e)).toBe(true);
    }
  });
  it("le reste : définitif", () => {
    for (const e of ["compte_expire", "media_required", "Invalid parameter", "HTTP 400", "plateforme_non_supportee"]) {
      expect(estTransitoire(e)).toBe(false);
    }
  });
});

describe("apresEchec", () => {
  it("transitoire, première fois : réessai dans 5 min, numéroté", () => {
    const r = apresEchec("fetch failed", null, t0);
    expect(r).toEqual({ etat: "reessai", lastError: `reessai:1@${new Date(t0.getTime() + DELAIS_MIN[0] * 60_000).toISOString()}|fetch failed` });
  });
  it("transitoire, tentatives épuisées : échec définitif", () => {
    let dernier: string | null = null;
    for (let i = 0; i < MAX_TENTATIVES; i++) {
      const r = apresEchec("HTTP 503", dernier, t0);
      expect(r.etat).toBe("reessai");
      dernier = r.lastError;
    }
    expect(apresEchec("HTTP 503", dernier, t0)).toEqual({ etat: "echec", lastError: "HTTP 503" });
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
    const r = apresEchec("fetch failed", null, t0);
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
    expect(raisonLisible("reessai:2@2026-11-24T09:05:00.000Z|fetch failed")).toBe("fetch failed");
    expect(raisonLisible("truc inconnu")).toBe("truc inconnu");
  });
});
