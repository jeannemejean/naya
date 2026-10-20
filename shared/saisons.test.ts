import { describe, it, expect } from "vitest";
import {
  saisonDuJour, saisonEffective, normaliserApparence, photoDuJour, rapportContraste,
  APPARENCE_DEFAUT, PALETTES, COULEURS,
} from "./saisons";

describe("saisonDuJour", () => {
  const P = "Europe/Paris";
  it.each([
    ["2026-03-19T12:00:00Z", "hiver"], ["2026-03-20T12:00:00Z", "printemps"],
    ["2026-06-20T12:00:00Z", "printemps"], ["2026-06-21T12:00:00Z", "ete"],
    ["2026-09-20T12:00:00Z", "ete"], ["2026-09-21T12:00:00Z", "automne"],
    ["2026-12-20T12:00:00Z", "automne"], ["2026-12-21T12:00:00Z", "hiver"],
    ["2027-01-15T12:00:00Z", "hiver"],
  ])("%s → %s", (iso, attendu) => expect(saisonDuJour(new Date(iso), P)).toBe(attendu));
  it("suit le fuseau autour de minuit (00:30 à Paris le 21 déc.)", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), P)).toBe("hiver"));
  it("même instant, fuseau UTC → encore l'automne", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), "UTC")).toBe("automne"));
  it("fuseau invalide → Europe/Paris", () =>
    expect(saisonDuJour(new Date("2026-12-20T23:30:00Z"), "Pas/UnFuseau")).toBe("hiver"));
});

describe("saisonEffective", () => {
  const oct = new Date("2026-10-16T08:00:00Z");
  it("auto → saison du jour", () => expect(saisonEffective({ saison: "auto", decor: true }, oct, "Europe/Paris")).toBe("automne"));
  it("forcée → la saison choisie", () => expect(saisonEffective({ saison: "ete", decor: true }, oct, "Europe/Paris")).toBe("ete"));
});

describe("normaliserApparence", () => {
  it.each([null, undefined, "x", 3, [], { saison: "noel", decor: "oui" }])("%j → défaut", (v) =>
    expect(normaliserApparence(v)).toEqual(APPARENCE_DEFAUT));
  it("garde les champs valides, complète le reste", () => {
    expect(normaliserApparence({ saison: "hiver" })).toEqual({ saison: "hiver", decor: true });
    expect(normaliserApparence({ decor: false })).toEqual({ saison: "auto", decor: false });
  });
});

describe("photoDuJour", () => {
  it("aucune photo → null", () => expect(photoDuJour("automne", new Date(), "Europe/Paris")).toBeNull());
});

describe("contrastes (règle de la spec : ≥ 4,5:1)", () => {
  for (const [s, p] of Object.entries(PALETTES)) {
    it(`${s} : encre et secondaire sur le fond`, () => {
      expect(rapportContraste(COULEURS.encre, p.fond)).toBeGreaterThanOrEqual(4.5);
      expect(rapportContraste(COULEURS.secondaire, p.fond)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${s} : encre sur la touche claire`, () => expect(rapportContraste(COULEURS.encre, p.touche2)).toBeGreaterThanOrEqual(4.5));
  }
  it("texte secondaire sur la carte", () => expect(rapportContraste(COULEURS.secondaire, COULEURS.carte)).toBeGreaterThanOrEqual(4.5));
  it("texte clair sur l'ancre sombre", () => expect(rapportContraste(COULEURS.surAncre, COULEURS.ancre)).toBeGreaterThanOrEqual(4.5));
});
