import { describe, it, expect } from "vitest";
import { normaliser, empreinte, domaineDe, anonymiser, contientMot } from "./texte";

describe("texte de veille", () => {
  it("normalise accents, casse et ponctuation", () => {
    expect(normaliser("  Sérum ÉCLAT, peau-sensible ! ")).toBe("serum eclat peau sensible");
  });

  it("l'empreinte ignore la casse et les espaces, pas le contenu", () => {
    expect(empreinte("Offre à 49 €")).toBe(empreinte("offre  à 49 €"));
    expect(empreinte("Offre à 49 €")).not.toBe(empreinte("Offre à 59 €"));
    expect(empreinte("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("extrait le domaine d'une URL ou d'un domaine nu", () => {
    expect(domaineDe("https://www.Maison-Lune.fr/boutique?x=1")).toBe("maison-lune.fr");
    expect(domaineDe("maison-lune.fr")).toBe("maison-lune.fr");
    expect(domaineDe("http://blog.exemple.com")).toBe("blog.exemple.com");
    expect(domaineDe("pas une url")).toBeNull();
    expect(domaineDe("")).toBeNull();
    expect(domaineDe(null)).toBeNull();
  });

  it("anonymise les verbatims : pseudos, mentions, adresses mail", () => {
    const t = anonymiser("u/marie_92 dit : écrivez-moi à marie@gmail.com, cc @lea.b et /user/toto — trop cher");
    expect(t).not.toMatch(/marie_92|marie@gmail|@lea|toto/);
    expect(t).toContain("trop cher");
  });

  it("borne la longueur d'un verbatim", () => {
    expect(anonymiser("a".repeat(500)).length).toBeLessThanOrEqual(240);
  });

  it("cherche un mot entier, sans accents ni casse", () => {
    expect(contientMot("On recommande Lune Studio pour ça", "lune studio")).toBe(true);
    expect(contientMot("La lunette est cassée", "lune")).toBe(false);
    expect(contientMot("Essayez ÉCLAT !", "eclat")).toBe(true);
    expect(contientMot("rien", "")).toBe(false);
  });
});
