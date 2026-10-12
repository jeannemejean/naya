import { describe, it, expect } from "vitest";
import { validerItem, lireProposition, fusionnerPropositions, suivis, kindDuType, PLAFONDS } from "./items";

const item = (over: any = {}) => ({ id: 1, userId: "u", projectId: 7, type: "concurrent", libelle: "Maison Lune", valeur: { site: "maison-lune.fr" }, statut: "suivi", source: "naya", createdAt: null, updatedAt: null, ...over });

describe("validerItem", () => {
  it("accepte un concurrent et nettoie sa valeur", () => {
    const r = validerItem({ type: "concurrent", libelle: "  Maison Lune ", valeur: { site: "https://maison-lune.fr", instagram: "@maisonlune", variantes: ["Lune", 3, ""], pirate: "x" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur.libelle).toBe("Maison Lune");
      expect(r.valeur.valeur).toEqual({ site: "https://maison-lune.fr", instagram: "@maisonlune", variantes: ["Lune"] });
    }
  });
  it("refuse un type inconnu, un libellé vide, un statut inconnu", () => {
    expect(validerItem({ type: "espion", libelle: "x" }).ok).toBe(false);
    expect(validerItem({ type: "mot_cle", libelle: "   " }).ok).toBe(false);
    expect(validerItem({ type: "mot_cle", libelle: "x", statut: "publie" }).ok).toBe(false);
  });
  it("en mise à jour partielle, le type n'est ni exigé ni modifiable", () => {
    const r = validerItem({ statut: "suivi", type: "marque" }, { partiel: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.valeur.statut).toBe("suivi"); expect(r.valeur.type).toBeUndefined(); }
  });
});

describe("lireProposition", () => {
  it("lit la réponse de l'IA et écarte les entrées vides", () => {
    const raw = `Voici : {"marque":{"nom":"Lune","site":"lune.fr","variantes":["Lune Studio"]},
      "concurrents":[{"nom":"Soleil","site":"soleil.fr","instagram":"soleil"},{"nom":""}],
      "requetes_voc":["site:reddit.com bougie parfumée avis"],"mots_cles":["bougie artisanale lyon",""],
      "prompts_geo":["Quelle marque de bougies artisanales choisir ?"]}`;
    const p = lireProposition(raw);
    expect(p.marque?.libelle).toBe("Lune");
    expect(p.marque?.valeur).toEqual({ site: "lune.fr", variantes: ["Lune Studio"] });
    expect(p.concurrents).toHaveLength(1);
    expect(p.mots_cles).toEqual([{ libelle: "bougie artisanale lyon" }]);
    expect(p.prompts_geo).toHaveLength(1);
  });
  it("une réponse illisible ne donne rien", () => {
    const p = lireProposition("nope");
    expect(p.marque).toBeNull();
    expect(p.concurrents).toEqual([]);
  });
});

describe("fusionnerPropositions", () => {
  it("ne repropose jamais un élément déjà présent, même écarté", () => {
    const existants = [item(), item({ id: 2, type: "mot_cle", libelle: "Bougie Artisanale", statut: "ecarte", valeur: null })];
    const out = fusionnerPropositions(existants as any, {
      marque: null,
      concurrents: [{ libelle: "maison lune", valeur: {} }, { libelle: "Soleil", valeur: {} }],
      requetes_voc: [], mots_cles: [{ libelle: "bougie artisanale" }, { libelle: "cire de soja" }], prompts_geo: [],
    });
    expect(out.map((o) => o.libelle)).toEqual(["Soleil", "cire de soja"]);
    expect(out.every((o) => o.statut === "propose" && o.source === "naya")).toBe(true);
  });
  it("respecte les plafonds en tenant compte de l'existant", () => {
    const existants = Array.from({ length: PLAFONDS.concurrent - 1 }, (_, i) => item({ id: i + 1, libelle: `C${i}` }));
    const out = fusionnerPropositions(existants as any, {
      marque: null, requetes_voc: [], mots_cles: [], prompts_geo: [],
      concurrents: [{ libelle: "A", valeur: {} }, { libelle: "B", valeur: {} }, { libelle: "C", valeur: {} }],
    });
    expect(out).toHaveLength(1);
  });
  it("une seule marque par projet", () => {
    const out = fusionnerPropositions([item({ type: "marque", libelle: "Lune" })] as any, {
      marque: { libelle: "Lune Studio", valeur: {} }, concurrents: [], requetes_voc: [], mots_cles: [], prompts_geo: [],
    });
    expect(out).toEqual([]);
  });
});

describe("suivis et kinds", () => {
  it("ne garde que les éléments suivis du type, dans la limite du plafond", () => {
    const xs = [item(), item({ id: 2, statut: "propose" }), item({ id: 3, type: "mot_cle" })];
    expect(suivis(xs as any, "concurrent").map((x) => x.id)).toEqual([1]);
  });
  it("associe chaque type à sa routine", () => {
    expect(kindDuType("concurrent")).toBe("veille_concurrents");
    expect(kindDuType("requete_voc")).toBe("veille_voix_client");
    expect(kindDuType("mot_cle")).toBe("veille_serp");
    expect(kindDuType("prompt_geo")).toBe("veille_geo");
    expect(kindDuType("marque")).toBeNull();
  });
});
