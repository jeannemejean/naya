import { describe, it, expect } from "vitest";
import { resumeSourcing, rechercheEnPanne } from "./sourcing-resume";

describe("resumeSourcing", () => {
  it("prospects ajoutés et préparés", () => {
    expect(resumeSourcing({ importes: 6, prepares: 3, enrichissement: "ok" })).toBe("6 prospects ajoutés, 3 préparés à valider.");
  });
  it("un seul, au singulier", () => {
    expect(resumeSourcing({ importes: 1, prepares: 1, enrichissement: "ok" })).toBe("1 prospect ajouté, 1 préparé à valider.");
  });
  it("sans accès à l'enrichissement", () => {
    expect(resumeSourcing({ importes: 4, prepares: 0, enrichissement: "plan" })).toBe("4 prospects ajoutés. Préparation des messages non incluse dans ton offre.");
  });
  it("limite LinkedIn de la semaine atteinte", () => {
    expect(resumeSourcing({ importes: 2, prepares: 0, enrichissement: "limite" })).toContain("limite LinkedIn");
  });
  it("aucun nouveau prospect", () => {
    expect(resumeSourcing({ importes: 0, prepares: 0, enrichissement: "ok" })).toBe("Aucun nouveau prospect trouvé aujourd'hui.");
  });
});

describe("rechercheEnPanne", () => {
  it("toutes les recherches en erreur = panne", () => {
    expect(rechercheEnPanne(5, 5)).toBe(true);
  });
  it("au moins une recherche réussie, ou aucune recherche = pas de panne", () => {
    expect(rechercheEnPanne(5, 4)).toBe(false);
    expect(rechercheEnPanne(0, 0)).toBe(false);
  });
});
