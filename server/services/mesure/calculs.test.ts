import { describe, it, expect } from "vitest";
import { indicateurs, evolutions, serieIndicateur, moisPrecedent, libelleMois } from "./calculs";

const ligne = (over: any = {}) => ({ mois: "2026-09", ca: 10000, caNouveaux: 4000, nouveauxClients: 20, commandes: 100, coutsVariables: 3000, depenses: { paid_social: 1500, email_fidelisation: 300, outils: 200 }, ...over });

describe("indicateurs", () => {
  it("calcule MER, CAC (acquisition seulement), panier, part nouveaux, marge", () => {
    expect(indicateurs(ligne())).toEqual({
      ca: 10000, nouveaux_clients: 20, depense_totale: 2000, depense_acquisition: 1500,
      mer: 5, cac: 75, panier_moyen: 100, part_ca_nouveaux: 0.4, marge_contributive: 5000,
    });
  });
  it("aucune dépense saisie → pas de MER, pas de CAC, pas de marge (jamais 0)", () => {
    const r = indicateurs(ligne({ depenses: {} }));
    expect(r.depense_totale).toBeNull();
    expect(r.mer).toBeNull();
    expect(r.cac).toBeNull();
    expect(r.marge_contributive).toBeNull();
  });
  it("divisions par zéro → null, jamais Infinity", () => {
    const r = indicateurs(ligne({ nouveauxClients: 0, commandes: 0, ca: 0, depenses: { paid_social: 0 } }));
    expect(r.cac).toBeNull();
    expect(r.panier_moyen).toBeNull();
    expect(r.mer).toBeNull();
    expect(r.part_ca_nouveaux).toBeNull();
  });
  it("dépense sans canal d'acquisition → CAC null", () => {
    expect(indicateurs(ligne({ depenses: { outils: 50 } })).cac).toBeNull();
  });
  it("données manquantes → null", () => {
    const r = indicateurs({ mois: "2026-09", depenses: {} } as any);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
  it("ignore les canaux hors catalogue et les montants non numériques", () => {
    expect(indicateurs(ligne({ depenses: { paid_social: 100, inconnu: 9999, google_ads: "x" } })).depense_totale).toBe(100);
  });
});

describe("evolutions", () => {
  const serie = [
    { mois: "2026-09", valeur: 120 }, { mois: "2026-08", valeur: 100 },
    { mois: "2026-07", valeur: null }, { mois: "2026-06", valeur: 80 }, { mois: "2026-05", valeur: 90 },
  ];
  it("vs mois précédent et moyenne des 3 mois précédents disponibles", () => {
    const e = evolutions(serie, "2026-09");
    expect(e.precedent).toBeCloseTo(0.2);
    expect(e.moyenne3).toBeCloseTo(120 / 90 - 1);
  });
  it("pas de base → null", () => {
    expect(evolutions([{ mois: "2026-09", valeur: 5 }], "2026-09")).toEqual({ precedent: null, moyenne3: null });
    expect(evolutions([{ mois: "2026-09", valeur: 5 }, { mois: "2026-08", valeur: 0 }], "2026-09").precedent).toBeNull();
    expect(evolutions([{ mois: "2026-09", valeur: null }, { mois: "2026-08", valeur: 3 }], "2026-09").precedent).toBeNull();
  });
  it("le mois précédent doit être le mois calendaire précédent", () => {
    expect(evolutions([{ mois: "2026-09", valeur: 5 }, { mois: "2026-06", valeur: 4 }], "2026-09").precedent).toBeNull();
  });
});

describe("serieIndicateur", () => {
  it("série chronologique, mois sans valeur omis", () => {
    const r = serieIndicateur([ligne({ mois: "2026-09" }), ligne({ mois: "2026-08", depenses: {} })], "mer");
    expect(r).toEqual([{ date: "2026-09-01T00:00:00.000Z", valeur: 5 }]);
  });
});

describe("mois", () => {
  it("moisPrecedent passe l'année", () => {
    expect(moisPrecedent("2026-01")).toBe("2025-12");
    expect(moisPrecedent("2026-10")).toBe("2026-09");
  });
  it("libelleMois en français", () => {
    expect(libelleMois("2026-09")).toBe("septembre 2026");
  });
});

import { memesChiffres } from "./calculs";
describe("relecture", () => {
  it("I5 : évolution depuis une base négative (−1000 → +500 = +150 %)", () => {
    expect(evolutions([{ mois: "2026-09", valeur: 500 }, { mois: "2026-08", valeur: -1000 }], "2026-09").precedent).toBeCloseTo(1.5);
  });
  it("I3 : memesChiffres ignore l'ordre des canaux, voit toute différence", () => {
    const a = { ca: 1, caNouveaux: null, nouveauxClients: 2, commandes: null, coutsVariables: null, depenses: { outils: 1, paid_social: 2 } };
    expect(memesChiffres(a, { ...a, depenses: { paid_social: 2, outils: 1 } })).toBe(true);
    expect(memesChiffres(a, { ...a, ca: 2 })).toBe(false);
    expect(memesChiffres(a, { ...a, depenses: { outils: 1 } })).toBe(false);
    expect(memesChiffres(undefined, a)).toBe(false);
  });
});
