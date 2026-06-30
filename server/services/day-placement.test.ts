import { describe, it, expect } from "vitest";
import { placeTasksFromNow, minutesToHHMM } from "./day-placement";

const H = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

describe("placeTasksFromNow — placement des tâches du jour (garde-fous condition 2)", () => {
  const base = { workDayStartMin: H("09:00"), workDayEndMin: H("18:00") };

  it("ne place JAMAIS dans le passé : départ à maintenant+buffer même si la matinée est libre", () => {
    const now = H("14:00");
    const { placed } = placeTasksFromNow([{ id: 1, durationMin: 30 }], { ...base, nowMin: now });
    expect(placed).toHaveLength(1);
    expect(placed[0].startMin).toBeGreaterThanOrEqual(now); // jamais avant l'heure courante
    expect(minutesToHHMM(placed[0].startMin)).toBe("14:15"); // now + buffer 15
  });

  it("cas « il est 22h, 6 tâches » → AUCUNE n'est placée (toutes restent à planifier)", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, durationMin: 30 }));
    const { placed, unplaced } = placeTasksFromNow(tasks, { ...base, nowMin: H("22:00") });
    expect(placed).toHaveLength(0);
    expect(unplaced).toEqual([1, 2, 3, 4, 5, 6]); // jamais forcées dans un créneau passé/hors fenêtre
  });

  it("placement PARTIEL : ce qui rentre est placé, le reste reste sans heure", () => {
    // À 17h, fin à 18h → 60 min dispo. 3 tâches de 30 min → 2 rentrent (17:15-17:45-... non), recalcul :
    // départ 17:15, t1 17:15-17:45, t2 17:45-18:15 > 18:00 → seule t1 rentre.
    const tasks = [{ id: 1, durationMin: 30 }, { id: 2, durationMin: 30 }, { id: 3, durationMin: 30 }];
    const { placed, unplaced } = placeTasksFromNow(tasks, { ...base, nowMin: H("17:00") });
    expect(placed.map((p) => p.id)).toEqual([1]);
    expect(unplaced).toEqual([2, 3]);
    expect(placed[0].endMin).toBeLessThanOrEqual(base.workDayEndMin);
  });

  it("évite les créneaux occupés (tâches déjà datées / agenda / pauses)", () => {
    const used = [{ start: H("14:15"), end: H("15:00") }]; // réunion
    const { placed } = placeTasksFromNow([{ id: 1, durationMin: 30 }], {
      ...base, nowMin: H("14:00"), usedRanges: used,
    });
    expect(placed[0].startMin).toBe(H("15:00")); // poussé après le créneau occupé
  });

  it("plusieurs tâches s'enchaînent sans chevauchement", () => {
    const { placed } = placeTasksFromNow(
      [{ id: 1, durationMin: 30 }, { id: 2, durationMin: 45 }],
      { ...base, nowMin: H("09:00") },
    );
    expect(placed).toHaveLength(2);
    expect(placed[1].startMin).toBeGreaterThanOrEqual(placed[0].endMin); // pas de chevauchement
  });
});
