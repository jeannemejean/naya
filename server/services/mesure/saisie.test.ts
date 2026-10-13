import { describe, it, expect } from "vitest";
import { validerMois, moisValide, suggestionDepuisConversions } from "./saisie";

const maintenant = new Date("2026-10-13T10:00:00Z");

describe("moisValide", () => {
  it("YYYY-MM réel, pas dans le futur", () => {
    expect(moisValide("2026-09", maintenant)).toBe(true);
    expect(moisValide("2026-10", maintenant)).toBe(true);
    expect(moisValide("2026-11", maintenant)).toBe(false);
    expect(moisValide("2026-13", maintenant)).toBe(false);
    expect(moisValide("26-09", maintenant)).toBe(false);
    expect(moisValide("1999-12", maintenant)).toBe(false);
  });
});

describe("validerMois", () => {
  it("garde les nombres valides, retire les canaux inconnus, vides → null", () => {
    const r = validerMois({ ca: "12 500,50", caNouveaux: "", nouveauxClients: 12, commandes: "40", coutsVariables: null, depenses: { paid_social: "300", magie: 5, outils: "" } });
    expect(r).toEqual({ ok: true, valeur: { ca: 12500.5, caNouveaux: null, nouveauxClients: 12, commandes: 40, coutsVariables: null, depenses: { paid_social: 300 } } });
  });
  it("refuse négatifs, non numériques, décimales de clients, part nouveaux > CA", () => {
    expect(validerMois({ ca: -1 }).ok).toBe(false);
    expect(validerMois({ ca: "beaucoup" }).ok).toBe(false);
    expect(validerMois({ nouveauxClients: 2.5 }).ok).toBe(false);
    expect(validerMois({ depenses: { paid_social: -3 } }).ok).toBe(false);
    expect(validerMois({ ca: 100, caNouveaux: 200 }).ok).toBe(false);
    expect(validerMois({ ca: true }).ok).toBe(false);
  });
  it("au moins un chiffre", () => {
    expect(validerMois({}).ok).toBe(false);
    expect(validerMois({ depenses: {} }).ok).toBe(false);
  });
});

describe("suggestionDepuisConversions", () => {
  it("ventes du mois seulement (type vente, sans casse ni accent)", () => {
    const r = suggestionDepuisConversions([
      { convertedAt: new Date("2026-09-03"), conversionType: "Vente", value: 100 },
      { convertedAt: new Date("2026-09-20"), conversionType: "vente", value: null },
      { convertedAt: new Date("2026-09-21"), conversionType: "lead", value: 50 },
      { convertedAt: new Date("2026-10-01"), conversionType: "vente", value: 70 },
    ] as any, "2026-09");
    expect(r).toEqual({ ventes: 2, ca: 100, valeursManquantes: 1 });
  });
  it("aucune vente → null", () => {
    expect(suggestionDepuisConversions([], "2026-09")).toBeNull();
  });
});

import { lireNombre } from "./saisie";
describe("lireNombre", () => {
  it("formats français et anglais non ambigus", () => {
    expect(lireNombre("12 500,50")).toBe(12500.5);
    expect(lireNombre("1.200,50")).toBe(1200.5);
    expect(lireNombre("1,200.50")).toBe(1200.5);
    expect(lireNombre("1,200,000")).toBe(1200000);
    expect(lireNombre("3,5")).toBe(3.5);
    expect(lireNombre("1 200 €")).toBe(1200);
  });
  it("« 1,200 » est ambigu (1,2 ou 1 200) : refusé, jamais deviné", () => {
    expect(lireNombre("1,200")).toBeUndefined();
    expect(lireNombre("12,500")).toBeUndefined();
    expect(lireNombre("1.200")).toBeUndefined();
    expect(lireNombre("1.200.000")).toBe(1200000);
    expect(lireNombre("1500.5")).toBe(1500.5);
  });
  it("vide → null, texte → invalide", () => {
    expect(lireNombre("")).toBeNull();
    expect(lireNombre("abc")).toBeUndefined();
    expect(lireNombre(true)).toBeUndefined();
  });
});
