// Étape 3 du chef d'orchestre : capacité en minutes, marge de 70 %, flux de chaque tâche.
import { describe, it, expect } from "vitest";
import { MARGE_PLANIFIABLE, minutesPlanifiables, minutesOccupees, tachesEncorePossibles, fluxDe } from "./capacite";

describe("capacité en minutes", () => {
  it("on ne planifie que 70 % du temps disponible, au prorata de l'énergie", () => {
    expect(MARGE_PLANIFIABLE).toBe(0.7);
    expect(minutesPlanifiables({ disponibles: 480, energie: 1 })).toBe(336);
    expect(minutesPlanifiables({ disponibles: 480, energie: 0.6 })).toBe(201);
  });

  it("occupé : durée (30 par défaut) + tampon des tâches non faites, hors marqueurs de jalon", () => {
    expect(minutesOccupees([
      { estimatedDuration: 60 }, { estimatedDuration: null }, { estimatedDuration: 90, completed: true },
      { estimatedDuration: 20, type: "milestone" },
    ], 10)).toBe(110);
  });

  it("tâches de 45 min (+ tampon) qui tiennent encore ; jamais négatif", () => {
    // 336 planifiables − 120 occupées (2 × 50 + 20 d'agenda) = 216 → 216 / 55 = 3
    expect(tachesEncorePossibles({ disponibles: 480, energie: 1, tampon: 10, taches: [{ estimatedDuration: 40 }, { estimatedDuration: 40 }], agendaMin: 20 })).toBe(3);
    // Une journée déjà prise par un atelier de 4 h : plus rien d'objectif.
    expect(tachesEncorePossibles({ disponibles: 480, energie: 1, tampon: 10, taches: [{ estimatedDuration: 240 }, { estimatedDuration: 90 }] })).toBe(0);
  });
});

describe("fluxDe (à quelle entité appartient une tâche)", () => {
  it.each([
    [{ ritualId: 3, source: "ritual" }, "rituels"],
    [{ contentId: 4 }, "contenu"],
    [{ taskType: "atelier_contenu" }, "atelier"],
    [{ taskType: "atelier_validation", source: "campaign" }, "atelier"],
    [{ source: "appel_offres", taskType: "ao_jalon" }, "appels_offres"],
    [{ source: "prospection", taskType: "prospection_validation", campaignId: 2 }, "prospection"],
    [{ source: "relance_prospect" }, "relances"],
    [{ source: "reponse_prospect" }, "relances"],
    [{ source: "campaign", campaignId: 2 }, "campagne"],
    [{ source: "generated", goalId: 1 }, "objectifs"],
    [{ source: "replan", milestoneId: 4 }, "objectifs"],
    [{ source: "fil_mail" }, "autre"],
    [{}, "autre"],
  ] as const)("%o → %s", (t, flux) => {
    expect(fluxDe(t as any)).toBe(flux);
  });
});
