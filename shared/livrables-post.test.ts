import { describe, it, expect } from "vitest";
import { effetSurPost, etapeDeProduction, postModifiable } from "./livrables";

describe("etapeDeProduction", () => {
  it("lit l'étape avant le tiret cadratin", () => {
    expect(etapeDeProduction("Rédiger le texte — Coulisses de la collecte")).toBe("Rédiger le texte");
  });
  it("null pour une tâche hors production", () => {
    expect(etapeDeProduction("Appeler le fournisseur")).toBeNull();
    expect(etapeDeProduction(null)).toBeNull();
  });
});

describe("effetSurPost", () => {
  it("le texte d'une étape d'écriture devient le texte du post", () => {
    expect(effetSurPost("Rédiger le texte — X")).toEqual({ texte: true, media: false });
    expect(effetSurPost("Rédiger les slides — X").texte).toBe(true);
  });
  it("le visuel d'une étape visuelle est joint au post", () => {
    expect(effetSurPost("Préparer le visuel — X")).toEqual({ texte: false, media: true });
    expect(effetSurPost("Designer les slides — X").media).toBe(true);
    expect(effetSurPost("Monter — X").media).toBe(true);
  });
  it("relire et publier : le texte et le visuel finaux", () => {
    expect(effetSurPost("Relire et valider le post — X")).toEqual({ texte: true, media: true });
    expect(effetSurPost("Publier — X")).toEqual({ texte: true, media: true });
  });
  it("structure, script et rushes ne touchent pas au post", () => {
    for (const e of ["Structurer le carrousel", "Écrire le script", "Tourner", "Construire le plan"]) {
      expect(effetSurPost(`${e} — X`)).toEqual({ texte: false, media: false });
    }
  });
  it("une tâche hors production ne touche à rien", () => {
    expect(effetSurPost("Faire la compta")).toEqual({ texte: false, media: false });
  });
});

describe("postModifiable", () => {
  it("refuse un post publié ou en cours de publication", () => {
    for (const s of ["posted", "uploading", "processing", "posting"]) expect(postModifiable(s)).toBe(false);
    for (const s of ["pending", "failed", null, undefined]) expect(postModifiable(s)).toBe(true);
  });
});
