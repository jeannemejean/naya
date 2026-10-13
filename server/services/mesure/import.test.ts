import { describe, it, expect } from "vitest";
import { lireImport } from "./import";

const maintenant = new Date("2026-10-13T10:00:00Z");

describe("lireImport", () => {
  it("copier-coller de tableur (tabulations, virgule décimale, alias FR)", () => {
    const r = lireImport("Mois\tCA\tNouveaux clients\tPub Meta\tGoogle Ads\n09/2026\t12 000,50\t30\t1 200\t300\n2026-08\t9000\t\t800\t", maintenant);
    expect(r.erreurs).toEqual([]);
    expect(r.lignes).toEqual([
      { mois: "2026-09", valeur: { ca: 12000.5, caNouveaux: null, nouveauxClients: 30, commandes: null, coutsVariables: null, depenses: { paid_social: 1200, google_ads: 300 } } },
      { mois: "2026-08", valeur: { ca: 9000, caNouveaux: null, nouveauxClients: null, commandes: null, coutsVariables: null, depenses: { paid_social: 800 } } },
    ]);
  });
  it("CSV point-virgule (Excel FR) avec virgule décimale", () => {
    const r = lireImport("mois;ca;commandes\n2026-09-01;1500,5;12", maintenant);
    expect(r.lignes[0]).toEqual({ mois: "2026-09", valeur: expect.objectContaining({ ca: 1500.5, commandes: 12 }) });
  });
  it("CSV virgule : point décimal, jamais de virgule décimale (pas de décalage)", () => {
    const r = lireImport("month,revenue,new_customers,paid_social\n2026-09,1500.5,4,100", maintenant);
    expect(r.lignes[0].valeur).toMatchObject({ ca: 1500.5, nouveauxClients: 4, depenses: { paid_social: 100 } });
  });
  it("erreurs par ligne : mois invalide, futur, en double, valeur invalide", () => {
    const r = lireImport("mois;ca\n2026-13;10\n2027-01;10\n2026-09;abc\n2026-08;5\n2026-08;6", maintenant);
    expect(r.erreurs.map((e) => e.ligne)).toEqual([2, 3, 4, 6]);
    expect(r.lignes.map((l) => l.mois)).toEqual(["2026-08"]);
  });
  it("colonnes inconnues signalées, colonne mois obligatoire", () => {
    expect(lireImport("ca;truc\n10;2", maintenant).erreurs[0]).toMatchObject({ ligne: 1, message: "colonne_mois_absente" });
    expect(lireImport("mois;ca;truc\n2026-09;10;2", maintenant).inconnues).toEqual(["truc"]);
  });
  it("vide", () => {
    expect(lireImport("  ", maintenant)).toEqual({ lignes: [], erreurs: [{ ligne: 1, message: "vide" }], inconnues: [] });
  });
});
