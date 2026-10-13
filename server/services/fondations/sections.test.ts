import { describe, it, expect } from "vitest";
import { slug, validerSection, lireProposition, statutsDe } from "./sections";

describe("slug", () => {
  it("minuscules, sans accents, séparateurs simples", () => {
    expect(slug("  Efficacité prouvée !")).toBe("efficacite_prouvee");
    expect(slug("Rituel / plaisir")).toBe("rituel_plaisir");
  });
  it("vide quand il n'y a rien d'alphanumérique", () => {
    expect(slug("!!!")).toBe("");
  });
});

describe("validerSection — offre", () => {
  it("garde les champs utiles et refuse une offre sans nom", () => {
    const r = validerSection("offre", { nom: " Coffret découverte ", description: "3 cafés", prix: "19 €", pourquoi: "petit risque", existe: true, intrus: 1 });
    expect(r).toEqual({ ok: true, valeur: { nom: "Coffret découverte", description: "3 cafés", prix: "19 €", pourquoi: "petit risque", existe: true } });
    expect(validerSection("offre", { description: "x" }).ok).toBe(false);
    expect(validerSection("offre", "texte").ok).toBe(false);
  });
  it("omet le prix vide et met existe à false par défaut", () => {
    const r = validerSection("offre", { nom: "Essai", prix: "  " });
    expect(r.ok && r.valeur).toEqual({ nom: "Essai", description: "", pourquoi: "", existe: false });
  });
});

describe("validerSection — motivations", () => {
  it("dérive la clé du nom, retire les formats hors catalogue, plafonne les listes", () => {
    const r = validerSection("motivations", [{
      nom: "Efficacité prouvée", description: "d", angle: "a",
      accroches: ["1", "2", "3", "4", "5", "6", ""], preuves: ["p"], objections: [3, "o"],
      formats: ["demonstration", "danse", "demonstration", "temoignage", "comparatif", "coulisses", "conseil"],
    }]);
    expect(r.ok).toBe(true);
    const m = (r as any).valeur[0];
    expect(m.cle).toBe("efficacite_prouvee");
    expect(m.accroches).toEqual(["1", "2", "3", "4", "5"]);
    expect(m.objections).toEqual(["o"]);
    expect(m.formats).toEqual(["demonstration", "temoignage", "comparatif", "coulisses"]);
  });
  it("garde une clé fournie valide (renommer ne casse pas les étiquettes)", () => {
    const r = validerSection("motivations", [{ cle: "efficacite", nom: "Résultats visibles" }]);
    expect((r as any).valeur[0].cle).toBe("efficacite");
  });
  it("dédoublonne les clés et refuse la clé réservée « aucun »", () => {
    const r = validerSection("motivations", [{ nom: "Cadeau" }, { nom: "cadeau" }, { cle: "aucun", nom: "Aucun" }]);
    expect((r as any).valeur.map((m: any) => m.cle)).toEqual(["cadeau", "cadeau_2", "aucun_2"]);
  });
  it("au plus 5 motivations, et au moins une", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ nom: `M${i}` }));
    expect((validerSection("motivations", six) as any).valeur).toHaveLength(5);
    expect(validerSection("motivations", [{ description: "sans nom" }]).ok).toBe(false);
    expect(validerSection("motivations", []).ok).toBe(false);
  });
});

describe("validerSection — kpis", () => {
  it("retire les KPI dont l'étage ou la fréquence sort du catalogue (jamais deviné)", () => {
    const r = validerSection("kpis", [
      { nom: "Marge contributive", etage: "business", definition: "CA - coûts", frequence: "mensuel", cible: "30 %" },
      { nom: "Vanité", etage: "ego" },
      { nom: "Taux de réponse", etage: "canal", frequence: "chaque minute" },
      { nom: "Abonnés", etage: "canal", frequence: "hebdo" },
    ]);
    expect(r.ok).toBe(true);
    expect((r as any).valeur).toEqual([
      { cle: "marge_contributive", nom: "Marge contributive", etage: "business", definition: "CA - coûts", frequence: "mensuel", cible: "30 %" },
      { cle: "abonnes", nom: "Abonnés", etage: "canal", definition: "", frequence: "hebdo" },
    ]);
  });
  it("garde une source du registre (indicateur calculé), retire une source inconnue", () => {
    const r = validerSection("kpis", [
      { nom: "MER", etage: "business", frequence: "mensuel", source: "mer" },
      { nom: "Abonnés", etage: "canal", frequence: "hebdo", source: "followers" },
    ]);
    expect((r as any).valeur[0].source).toBe("mer");
    expect((r as any).valeur[1]).not.toHaveProperty("source");
  });

  it("au plus 12, au moins un", () => {
    const treize = Array.from({ length: 13 }, (_, i) => ({ nom: `K${i}`, etage: "systeme", frequence: "mensuel" }));
    expect((validerSection("kpis", treize) as any).valeur).toHaveLength(12);
    expect(validerSection("kpis", [{ nom: "x", etage: "nope" }]).ok).toBe(false);
  });
});

describe("validerSection — plan", () => {
  it("garde seulement les briques du catalogue, une fois chacune", () => {
    const r = validerSection("plan", {
      maturite: "demarrage", resume: "r",
      briques: [
        { cle: "seo", statut: "maintenant", raison: "x", action: "y" },
        { cle: "seo", statut: "sans_objet", raison: "doublon" },
        { cle: "tiktok_magique", statut: "maintenant" },
        { cle: "sea", statut: "peut-être" },
        { cle: "geo", statut: "plus_tard" },
      ],
    });
    expect(r.ok).toBe(true);
    expect((r as any).valeur).toEqual({
      maturite: "demarrage", resume: "r",
      briques: [
        { cle: "seo", statut: "maintenant", raison: "x", action: "y" },
        { cle: "geo", statut: "plus_tard", raison: "", action: "" },
      ],
    });
  });
  it("refuse une maturité inconnue ou un plan sans brique", () => {
    expect(validerSection("plan", { maturite: "géant", briques: [{ cle: "seo", statut: "maintenant" }] }).ok).toBe(false);
    expect(validerSection("plan", { maturite: "scale", briques: [] }).ok).toBe(false);
  });
});

describe("validerSection — section inconnue", () => {
  it("erreur", () => {
    expect(validerSection("nimporte" as any, {}).ok).toBe(false);
  });
});

describe("lireProposition", () => {
  it("lit le JSON entouré de texte", () => {
    expect(lireProposition('Voici :\n```json\n{"offre":{"nom":"x"},"kpis":[]}\n```')).toEqual({ offre: { nom: "x" }, kpis: [] });
  });
  it("rend un objet vide si illisible", () => {
    expect(lireProposition("pas de json")).toEqual({});
    expect(lireProposition("[1,2]")).toEqual({});
  });
});

describe("statutsDe", () => {
  it("vide par défaut, ignore les valeurs inconnues", () => {
    expect(statutsDe({ statuts: { offre: "valide", kpis: "bof" } } as any)).toEqual({ offre: "valide", motivations: "vide", kpis: "vide", plan: "vide" });
    expect(statutsDe(undefined)).toEqual({ offre: "vide", motivations: "vide", kpis: "vide", plan: "vide" });
  });
});
