// Le premier jet d'AO est du Markdown simple écrit par Naya : titres, paragraphes, listes,
// cases à cocher, citations, gras et italique. Rien d'autre n'est interprété (pas de HTML).
import { describe, it, expect } from "vitest";
import { blocsMarkdown, segmentsEnLigne } from "./markdown-simple";

describe("blocsMarkdown", () => {
  it("titres, paragraphes (lignes jointes), listes, cases, citation", () => {
    const b = blocsMarkdown("# Titre\n\nUn\ndeux\n\n## Partie\n- a\n- b\n\n- [ ] DUME\n- [x] Kbis\n\n> **Provisoire**\n\n1. un\n2. deux");
    expect(b).toEqual([
      { type: "titre", niveau: 1, texte: "Titre" },
      { type: "paragraphe", texte: "Un deux" },
      { type: "titre", niveau: 2, texte: "Partie" },
      { type: "liste", items: [{ texte: "a" }, { texte: "b" }] },
      { type: "liste", items: [{ texte: "DUME", coche: false }, { texte: "Kbis", coche: true }] },
      { type: "citation", texte: "**Provisoire**" },
      { type: "liste", ordonnee: true, items: [{ texte: "un" }, { texte: "deux" }] },
    ]);
  });
  it("niveau 3 et plus : titre de niveau 3", () => {
    expect(blocsMarkdown("#### Petit")).toEqual([{ type: "titre", niveau: 3, texte: "Petit" }]);
  });
  it("vide : aucun bloc", () => {
    expect(blocsMarkdown("  \n\n")).toEqual([]);
  });
});

describe("segmentsEnLigne", () => {
  it("gras et italique, le reste en texte brut (balises HTML comprises)", () => {
    expect(segmentsEnLigne("Le **gras** et *italique* <b>x</b>")).toEqual([
      { texte: "Le " }, { texte: "gras", gras: true }, { texte: " et " }, { texte: "italique", italique: true }, { texte: " <b>x</b>" },
    ]);
  });
  it("[À COMPLÉTER : …] en gras est aussi surligné", () => {
    expect(segmentsEnLigne("**[À COMPLÉTER : dates]**")).toEqual([{ texte: "[À COMPLÉTER : dates]", gras: true, aCompleter: true }]);
  });
  it("[À COMPLÉTER : …] est repéré pour être surligné", () => {
    expect(segmentsEnLigne("Nom : [À COMPLÉTER : chef de projet].")).toEqual([
      { texte: "Nom : " }, { texte: "[À COMPLÉTER : chef de projet]", aCompleter: true }, { texte: "." },
    ]);
  });
});
