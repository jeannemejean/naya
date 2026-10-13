import { describe, it, expect } from "vitest";
import { blocFondations } from "./contexte";

const f = {
  statuts: { offre: "valide", motivations: "valide", kpis: "valide", plan: "valide" },
  offre: { nom: "Coffret découverte", description: "3 cafés de spécialité", prix: "19 €", pourquoi: "goûter sans risque", existe: false },
  motivations: [{ cle: "rituel", nom: "Rituel plaisir", description: "", angle: "Le café du matin comme moment à soi", accroches: ["Ton matin mérite mieux"], preuves: ["Torréfié à Lyon"], objections: ["Trop cher"], formats: ["coulisses", "demonstration"] }],
  kpis: [{ cle: "abonnes", nom: "Abonnés actifs", etage: "business", definition: "", frequence: "mensuel", cible: "200" }],
  plan: { maturite: "demarrage", resume: "", briques: [{ cle: "organique_social", statut: "maintenant", raison: "", action: "3 posts par semaine" }, { cle: "sea", statut: "sans_objet", raison: "", action: "" }] },
};

describe("blocFondations", () => {
  it("rien de validé → vide", () => {
    expect(blocFondations({ ...f, statuts: { offre: "propose" } } as any, { tiers: false })).toBe("");
    expect(blocFondations(undefined, { tiers: false })).toBe("");
  });

  it("toutes les sections validées, pour l'utilisatrice", () => {
    const b = blocFondations(f as any, { tiers: false });
    expect(b).toContain("Coffret découverte");
    expect(b).toContain("Rituel plaisir");
    expect(b).toContain("Ton matin mérite mieux");
    expect(b).toContain("coulisses");
    expect(b).toContain("Abonnés actifs (cible : 200)");
    expect(b).toContain("Organique social");
    expect(b).not.toContain("SEA");
    expect(b).toMatch(/varie/i);
  });

  it("mode tiers : offre et motivations, ni KPI ni plan", () => {
    const b = blocFondations(f as any, { tiers: true });
    expect(b).toContain("Coffret découverte");
    expect(b).toContain("Rituel plaisir");
    expect(b).not.toContain("Abonnés actifs");
    expect(b).not.toContain("Organique social");
  });

  it("une section proposée mais pas validée n'apparaît pas", () => {
    const b = blocFondations({ ...f, statuts: { ...f.statuts, offre: "propose" } } as any, { tiers: false });
    expect(b).not.toContain("Coffret découverte");
    expect(b).toContain("Rituel plaisir");
  });
});
