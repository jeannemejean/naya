import { describe, it, expect } from "vitest";
import { lireConstatsVoc, dedoublonnerConstats } from "./voc-analyse";

describe("lireConstatsVoc", () => {
  const urls = new Set(["https://reddit.com/r/a/1", "https://trustpilot.com/review/x"]);
  it("garde les constats valides, anonymisés, avec une URL réellement lue", () => {
    const raw = JSON.stringify({ constats: [
      { type: "objection", texte: "Le prix paraît élevé pour une bougie.", verbatim: "u/claire_b : 45 € pour une bougie ??", url: "https://reddit.com/r/a/1" },
      { type: "vocabulaire", texte: "Ils disent « bougie qui coule ».", verbatim: "elle coule", url: "https://inventee.com" },
      { type: "insulte", texte: "x", url: "https://reddit.com/r/a/1" },
      { type: "sujet", texte: "", url: "https://reddit.com/r/a/1" },
    ] });
    const c = lireConstatsVoc(raw, urls);
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe("objection");
    expect(c[0].verbatim).not.toContain("claire_b");
  });
  it("une réponse illisible ne donne rien", () => {
    expect(lireConstatsVoc("pas du json", urls)).toEqual([]);
  });
});

it("dedoublonnerConstats ignore la casse et les accents, et les doublons internes", () => {
  const out = dedoublonnerConstats(["Le prix paraît élevé"], [
    { texte: "le prix parait eleve" }, { texte: "Livraison lente" }, { texte: "livraison LENTE" },
  ]);
  expect(out.map((x) => x.texte)).toEqual(["Livraison lente"]);
});
