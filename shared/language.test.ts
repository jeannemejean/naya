import { describe, it, expect } from "vitest";
import { DEFAULT_LANGUAGE, normalizeLanguage, resolveLanguage } from "./language";

describe("normalizeLanguage", () => {
  it("accepte les deux langues supportées", () => {
    expect(normalizeLanguage("fr")).toBe("fr");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("rejette tout le reste", () => {
    expect(normalizeLanguage("de")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
    expect(normalizeLanguage("FR")).toBeNull(); // pas de tolérance à la casse : la base écrit en minuscules
  });
});

describe("resolveLanguage", () => {
  it("le compte l'emporte sur le cache local", () => {
    expect(resolveLanguage({ account: "en", cached: "fr" })).toBe("en");
    expect(resolveLanguage({ account: "fr", cached: "en" })).toBe("fr");
  });

  it("retombe sur le cache quand le compte est absent", () => {
    expect(resolveLanguage({ cached: "en" })).toBe("en");
    expect(resolveLanguage({ account: null, cached: "en" })).toBe("en");
  });

  it("retombe sur le français quand rien n'est exploitable", () => {
    expect(resolveLanguage({})).toBe("fr");
    expect(resolveLanguage({ account: null, cached: null })).toBe("fr");
    expect(resolveLanguage({ account: "de", cached: "es" })).toBe("fr");
  });

  it("ignore une valeur de compte invalide et utilise le cache", () => {
    expect(resolveLanguage({ account: "de", cached: "en" })).toBe("en");
  });

  it("le défaut est le français", () => {
    expect(DEFAULT_LANGUAGE).toBe("fr");
  });
});
