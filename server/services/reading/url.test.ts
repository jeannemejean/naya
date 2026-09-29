import { describe, it, expect } from "vitest";
import { canonicalizeUrl, hashUrl, normalizeTitle } from "./url";

describe("canonicalizeUrl", () => {
  it("retire les paramètres de suivi, garde les paramètres utiles", () => {
    expect(canonicalizeUrl("https://a.fr/x?utm_source=news&id=12&utm_campaign=z")).toBe("https://a.fr/x?id=12");
  });

  it("deux URLs qui ne diffèrent que par le suivi donnent la MÊME canonique", () => {
    const a = canonicalizeUrl("https://a.fr/article?utm_medium=mail");
    const b = canonicalizeUrl("https://a.fr/article?fbclid=abc");
    expect(a).toBe(b);
  });

  it("normalise le schéma, la casse de l'hôte, le www et le slash final", () => {
    expect(canonicalizeUrl("HTTP://WWW.A.fr/Article/")).toBe("http://a.fr/Article");
  });

  it("retire le fragment", () => {
    expect(canonicalizeUrl("https://a.fr/x#section-2")).toBe("https://a.fr/x");
  });

  it("rend null sur une URL inexploitable plutôt que de jeter", () => {
    expect(canonicalizeUrl("pas une url")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });
});

describe("hashUrl", () => {
  it("est stable et dépend de l'URL", () => {
    expect(hashUrl("https://a.fr/x")).toBe(hashUrl("https://a.fr/x"));
    expect(hashUrl("https://a.fr/x")).not.toBe(hashUrl("https://a.fr/y"));
  });
});

describe("normalizeTitle", () => {
  it("ignore la casse, les accents, la ponctuation et les espaces multiples", () => {
    expect(normalizeTitle("L'Été   du PACKAGING, enfin !")).toBe(normalizeTitle("l ete du packaging enfin"));
  });
});
