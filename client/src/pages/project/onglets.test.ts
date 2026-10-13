import { describe, it, expect } from "vitest";
import { ongletDe, lienOnglet, ongletPourAutreProjet } from "./onglets";

describe("onglets de la page projet", () => {
  it("lit l'onglet dans l'URL ; inconnu ou absent → vue d'ensemble", () => {
    expect(ongletDe("?onglet=mesure", false)).toBe("mesure");
    expect(ongletDe("onglet=fondations", false)).toBe("fondations");
    expect(ongletDe("", false)).toBe("ensemble");
    expect(ongletDe("?onglet=nimporte", false)).toBe("ensemble");
  });
  it("« client » seulement pour un projet client", () => {
    expect(ongletDe("?onglet=client", true)).toBe("client");
    expect(ongletDe("?onglet=client", false)).toBe("ensemble");
  });
  it("liens : la vue d'ensemble n'a pas de paramètre", () => {
    expect(lienOnglet(7, "veille")).toBe("/projects/7?onglet=veille");
    expect(lienOnglet(7, "ensemble")).toBe("/projects/7");
  });
  it("changer de projet garde l'onglet, sauf « client » vers un projet perso", () => {
    expect(ongletPourAutreProjet("mesure", false)).toBe("mesure");
    expect(ongletPourAutreProjet("client", false)).toBe("ensemble");
    expect(ongletPourAutreProjet("client", true)).toBe("client");
  });
});
