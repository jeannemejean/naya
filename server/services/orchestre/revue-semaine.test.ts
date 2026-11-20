// Étape 5 du chef d'orchestre : la revue de la semaine (bilan pur).
import { describe, it, expect } from "vitest";
import { bilanSemaine, semaineARevoir } from "./revue-semaine";

const JOURS = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];

describe("semaineARevoir", () => {
  it("du lundi au vendredi : la semaine en cours ; le week-end : la suivante", () => {
    expect(semaineARevoir("2026-11-25")).toBe("2026-11-23");
    expect(semaineARevoir("2026-11-28")).toBe("2026-11-30");
    expect(semaineARevoir("2026-11-29")).toBe("2026-11-30");
  });
});

describe("bilanSemaine", () => {
  const t = (o: Record<string, unknown>) => ({ id: 1, title: "x", completed: false, estimatedDuration: 60, ...o });

  it("minutes par flux et par jour, contre la capacité ; tâches faites et marqueurs exclus", () => {
    const b = bilanSemaine([
      t({ id: 1, scheduledDate: "2026-11-23", taskType: "atelier_contenu", estimatedDuration: 120 }),
      t({ id: 2, scheduledDate: "2026-11-23", source: "generated", goalId: 3 }),
      t({ id: 3, scheduledDate: "2026-11-23", source: "generated", completed: true }),
      t({ id: 4, scheduledDate: "2026-11-24", type: "milestone" }),
      t({ id: 5, scheduledDate: "2026-11-24", source: "appel_offres", estimatedDuration: 45 }),
    ], { jours: JOURS, capaciteMin: 480, aujourdhui: "2026-11-22" });
    expect(b.semaine).toBe("2026-11-23");
    expect(b.jours[0]).toEqual({ jour: "2026-11-23", capaciteMin: 480, occupeMin: 180, parFlux: { atelier: 120, objectifs: 60 } });
    expect(b.jours[1].parFlux).toEqual({ appels_offres: 45 });
    expect(b.parFlux).toEqual({ atelier: 120, objectifs: 60, appels_offres: 45 });
    expect(b.capaciteMin).toBe(2400);
    expect(b.occupeMin).toBe(225);
    expect(b.risques).toEqual([]);
  });

  it("risques : échéance dure dépassée par la date planifiée ; journée chargée au-delà de sa capacité", () => {
    const b = bilanSemaine([
      t({ id: 9, title: "AO : déposer", scheduledDate: "2026-11-26", actionData: { echeanceDure: "2026-11-25" } }),
      t({ id: 10, scheduledDate: "2026-11-27", estimatedDuration: 500 }),
    ], { jours: JOURS, capaciteMin: 480, aujourdhui: "2026-11-22" });
    expect(b.risques).toEqual([
      { genre: "echeance", tacheId: 9, titre: "AO : déposer", echeance: "2026-11-25", jour: "2026-11-26" },
      { genre: "surcharge", jour: "2026-11-27", occupeMin: 500, capaciteMin: 480 },
    ]);
  });

  it("hors semaine : ignorée", () => {
    const b = bilanSemaine([t({ scheduledDate: "2026-12-01" })], { jours: JOURS, capaciteMin: 480, aujourdhui: "2026-11-22" });
    expect(b.occupeMin).toBe(0);
  });
});

describe("estMomentDeLaRevue", () => {
  it("le dimanche à partir de 18 h à Paris, et seulement alors", async () => {
    const { estMomentDeLaRevue } = await import("./revue-semaine");
    expect(estMomentDeLaRevue(new Date("2026-11-22T17:00:00Z"))).toBe(true);  // dimanche 18 h Paris
    expect(estMomentDeLaRevue(new Date("2026-11-22T16:59:00Z"))).toBe(false); // dimanche 17 h 59
    expect(estMomentDeLaRevue(new Date("2026-11-22T22:30:00Z"))).toBe(true);  // dimanche 23 h 30
    expect(estMomentDeLaRevue(new Date("2026-11-22T23:30:00Z"))).toBe(false); // lundi 0 h 30
    expect(estMomentDeLaRevue(new Date("2026-11-21T18:00:00Z"))).toBe(false); // samedi
  });
});
