import { describe, it, expect } from "vitest";
import {
  calculerCibleProspects,
  joursOuvresProchains,
  lireMontant,
  panierMoyenDepuis,
  tauxConversionObserve,
  PLANCHER_CIBLE,
  PLAFOND_CIBLE,
  TAUX_CONVERSION_PAR_DEFAUT,
} from "./prospection-volume";

// Jeudi 8 octobre 2026.
const AUJ = new Date("2026-10-08T09:00:00Z");
const LUN_VEN = "mon,tue,wed,thu,fri";

describe("joursOuvresProchains", () => {
  it("compte les jours ouvrés des 14 prochains jours (lun-ven → 10)", () => {
    expect(joursOuvresProchains(AUJ, LUN_VEN, 14)).toBe(10);
  });
  it("respecte les jours de travail de l'utilisatrice", () => {
    expect(joursOuvresProchains(AUJ, "mon,tue,wed", 14)).toBe(6);
  });
  it("jours de travail vides ou illisibles → lun-ven", () => {
    expect(joursOuvresProchains(AUJ, null, 14)).toBe(10);
    expect(joursOuvresProchains(AUJ, "", 14)).toBe(10);
  });
});

describe("lireMontant", () => {
  it("lit les formats courants", () => {
    expect(lireMontant("10 clients")).toBe(10);
    expect(lireMontant("5 000 €")).toBe(5000);
    expect(lireMontant("5k€")).toBe(5000);
    expect(lireMontant("3,5k")).toBe(3500);
    expect(lireMontant("12000€/mois")).toBe(12000);
  });
  it("rien de lisible → null", () => {
    expect(lireMontant("beaucoup")).toBeNull();
    expect(lireMontant(null)).toBeNull();
  });
});

describe("panierMoyenDepuis", () => {
  it("moyenne d'une fourchette", () => {
    expect(panierMoyenDepuis("1500 - 3000 €")).toBe(2250);
  });
  it("valeur seule", () => {
    expect(panierMoyenDepuis("à partir de 2k€")).toBe(2000);
  });
  it("vide → null", () => {
    expect(panierMoyenDepuis(undefined)).toBeNull();
  });
});

describe("tauxConversionObserve", () => {
  it("trop peu d'historique → null (on ne devine pas sur 3 contacts)", () => {
    expect(tauxConversionObserve([{ stage: "signed" }, { stage: "connection_sent" }])).toBeNull();
  });
  it("calcule signés / contactés quand l'historique suffit", () => {
    const leads = [
      ...Array.from({ length: 18 }, () => ({ stage: "connection_sent" })),
      { stage: "signed" },
      { stage: "signed" },
      // jamais contactés : ne comptent pas au dénominateur
      ...Array.from({ length: 30 }, () => ({ stage: "identified" })),
    ];
    expect(tauxConversionObserve(leads)).toBeCloseTo(0.1);
  });
});

describe("calculerCibleProspects", () => {
  it("sans objectif ni rythme : plancher de repli", () => {
    const r = calculerCibleProspects({ objectifs: [], aujourdHui: AUJ, workDays: LUN_VEN });
    expect(r.cible).toBe(PLANCHER_CIBLE);
    expect(r.source).toBe("plancher");
    expect(r.prospectsParJour).toBe(Math.ceil(PLANCHER_CIBLE / 10));
  });

  it("le rythme de la campagne sur deux semaines ouvrées", () => {
    const r = calculerCibleProspects({ prospectsParJour: 8, objectifs: [], aujourdHui: AUJ, workDays: LUN_VEN });
    expect(r.cible).toBe(80);
    expect(r.source).toBe("rythme");
  });

  it("un objectif en nombre de clients, avec échéance, dérive la cible", () => {
    // 10 clients, 2 déjà signés → 8 restants. Taux par défaut → 8 / taux prospects
    // à contacter d'ici l'échéance (28 jours) → la moitié sur les 14 prochains jours.
    const r = calculerCibleProspects({
      prospectsParJour: 3,
      objectifs: [{ title: "Signer 10 clients", successMode: "revenue", targetValue: "10 clients", currentValue: "2", dueDate: new Date("2026-11-05T09:00:00Z") }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    const attendu = Math.ceil((8 / TAUX_CONVERSION_PAR_DEFAUT) * (14 / 28));
    expect(r.cible).toBe(Math.min(PLAFOND_CIBLE, attendu));
    expect(r.source).toBe("objectif");
  });

  it("un objectif de chiffre d'affaires passe par le panier moyen du Brand DNA", () => {
    const r = calculerCibleProspects({
      objectifs: [{ title: "CA trimestre", goalType: "revenue", targetValue: "20 000 €", currentValue: "5 000 €", dueDate: null }],
      panierMoyen: 2500,
      tauxConversion: 0.1,
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    // 15 000 € restants / 2 500 € = 6 clients → 60 prospects sur l'horizon par défaut (90 j)
    // → 60 × 14 / 90 = 9.33 → 10. Le plancher ne s'applique qu'en l'absence de donnée.
    expect(r.source).toBe("objectif");
    expect(r.cible).toBe(10);
  });

  it("un objectif de CA sans panier moyen ne peut pas être converti → ignoré", () => {
    const r = calculerCibleProspects({
      objectifs: [{ title: "CA", goalType: "revenue", targetValue: "20 000 €" }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.source).toBe("plancher");
  });

  it("un objectif de visibilité ne se traduit pas en prospects", () => {
    const r = calculerCibleProspects({
      objectifs: [{ title: "1000 abonnés", successMode: "visibility", goalType: "visibility", targetValue: "1000 abonnés" }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.source).toBe("plancher");
  });

  it("garde le plus exigeant du rythme et de l'objectif", () => {
    const r = calculerCibleProspects({
      prospectsParJour: 10,
      objectifs: [{ title: "2 clients", successMode: "revenue", targetValue: "2 clients", dueDate: null }],
      tauxConversion: 0.2,
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.cible).toBe(100);
    expect(r.source).toBe("rythme");
  });

  it("borne la cible pour protéger le budget de recherche", () => {
    const r = calculerCibleProspects({
      objectifs: [{ title: "500 clients", successMode: "revenue", targetValue: "500 clients", dueDate: new Date("2026-10-20T00:00:00Z") }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.cible).toBe(PLAFOND_CIBLE);
  });

  it("ignore les objectifs terminés ou en pause", () => {
    const r = calculerCibleProspects({
      objectifs: [{ title: "10 clients", successMode: "revenue", targetValue: "10 clients", status: "completed" }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.source).toBe("plancher");
  });

  it("un objectif déjà atteint ne demande aucun prospect", () => {
    const r = calculerCibleProspects({
      prospectsParJour: 2,
      objectifs: [{ title: "5 clients", successMode: "revenue", targetValue: "5", currentValue: "5" }],
      aujourdHui: AUJ,
      workDays: LUN_VEN,
    });
    expect(r.source).toBe("rythme");
    expect(r.cible).toBe(20);
  });
});
