import { describe, it, expect } from "vitest";
import {
  phaseDuCycle, lundiDe, joursDeSemaine, estTachePerso, SOURCE_VIE_PERSO,
  SCHEMA_PLAN_REPAS, SCHEMA_ACTIVITE, ajouterJours,
} from "./vie-perso";

describe("phaseDuCycle", () => {
  const regles = "2026-11-01";
  it("J1 à J5 : règles", () => {
    expect(phaseDuCycle("2026-11-01", regles, 28)).toBe("regles");
    expect(phaseDuCycle("2026-11-05", regles, 28)).toBe("regles");
  });
  it("J6 à J13 : folliculaire", () => {
    expect(phaseDuCycle("2026-11-06", regles, 28)).toBe("folliculaire");
    expect(phaseDuCycle("2026-11-13", regles, 28)).toBe("folliculaire");
  });
  it("J14 à J16 : ovulation, puis lutéale", () => {
    expect(phaseDuCycle("2026-11-14", regles, 28)).toBe("ovulation");
    expect(phaseDuCycle("2026-11-16", regles, 28)).toBe("ovulation");
    expect(phaseDuCycle("2026-11-17", regles, 28)).toBe("luteale");
    expect(phaseDuCycle("2026-11-28", regles, 28)).toBe("luteale");
  });
  it("cycle suivant : J29 avec une durée de 28 redevient J1", () => {
    expect(phaseDuCycle("2026-11-29", regles, 28)).toBe("regles");
    expect(phaseDuCycle("2026-12-04", regles, 28)).toBe("folliculaire");
  });
  it("sans date ou avant les dernières règles : inconnue", () => {
    expect(phaseDuCycle("2026-11-10", null, 28)).toBeNull();
    expect(phaseDuCycle("2026-10-20", regles, 28)).toBeNull();
  });
  it("durée absente ou absurde : 28 jours", () => {
    expect(phaseDuCycle("2026-11-29", regles, null)).toBe("regles");
    expect(phaseDuCycle("2026-11-29", regles, 5)).toBe("regles");
  });
});

describe("semaines", () => {
  it("lundiDe : un dimanche renvoie le lundi d'avant", () => {
    expect(lundiDe("2026-11-29")).toBe("2026-11-23");
    expect(lundiDe("2026-11-23")).toBe("2026-11-23");
    expect(lundiDe("2026-11-25")).toBe("2026-11-23");
  });
  it("joursDeSemaine : sept jours depuis le lundi", () => {
    expect(joursDeSemaine("2026-11-30")).toEqual([
      "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06",
    ]);
  });
  it("ajouterJours", () => {
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
    expect(ajouterJours("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("estTachePerso", () => {
  it("reconnaît la source", () => {
    expect(estTachePerso({ source: SOURCE_VIE_PERSO })).toBe(true);
    expect(estTachePerso({ source: "generated" })).toBe(false);
    expect(estTachePerso({})).toBe(false);
  });
});

const repas = { titre: "Bowl saumon", detail: "130 g saumon, riz", kcal: 690, proteines: 42, lipides: 22, glucides: 52, variantes: [{ membre: "Milan", texte: "+100 g riz" }], preparationMin: 10 };
const jour = (date: string) => ({ date, dejeuner: repas, diner: repas, dessert: { ...repas, preparationMin: 0 } });

describe("SCHEMA_PLAN_REPAS", () => {
  const plan = {
    jours: ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"].map(jour),
    batch: { dureeMin: 110, etapes: [{ appareil: "Thermomix", action: "Cuire 600 g de poulet" }] },
    courses: [{ article: "Pavés de saumon", quantite: "x4", magasin: "Picard", rayon: "Surgelés", pour: "tous" }],
    regles: ["Déjeuner à 12 h pile"],
    snacks: ["30 g de noix"],
  };
  it("accepte un plan complet", () => {
    expect(SCHEMA_PLAN_REPAS.safeParse(plan).success).toBe(true);
  });
  it("refuse un plan qui n'a pas 7 jours", () => {
    expect(SCHEMA_PLAN_REPAS.safeParse({ ...plan, jours: plan.jours.slice(0, 6) }).success).toBe(false);
  });
  it("valeurs nutritionnelles facultatives (null)", () => {
    const j = { ...jour("2026-11-30"), diner: { ...repas, kcal: null, proteines: null, lipides: null, glucides: null } };
    expect(SCHEMA_PLAN_REPAS.safeParse({ ...plan, jours: [j, ...plan.jours.slice(1)] }).success).toBe(true);
  });
});

describe("SCHEMA_ACTIVITE", () => {
  it("accepte achats et étapes", () => {
    expect(SCHEMA_ACTIVITE.safeParse({
      achats: [{ article: "Feutrine rouge", quantite: "3 plaques", ou: "Mercerie" }],
      etapes: [{ titre: "Découper les lettres", dureeMin: 60, ensemble: true }],
    }).success).toBe(true);
  });
});
