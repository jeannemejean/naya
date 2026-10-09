import { describe, it, expect } from "vitest";
import { repackDay, type RepackTask } from "./schedule-repack";

const opts = { dayStartMin: 9 * 60, dayEndMin: 18 * 60, lunchStartMin: 12 * 60, lunchEndMin: 13 * 60, lunchEnabled: true, bufferMin: 10 };
const debut = (r: ReturnType<typeof repackDay>, tasks: RepackTask[], id: number) =>
  r.moves.find((m) => m.id === id)?.newStartMin ?? tasks.find((t) => t.id === id)!.startMin;

describe("repackDay — ordre imposé (apres)", () => {
  it("Relire, posé à 9h, passe après Rédiger posé à 14h", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 15, apres: [2], depend: [2] },   // Relire
      { id: 2, startMin: 14 * 60, durationMin: 30 },                            // Rédiger
    ];
    const r = repackDay(tasks, opts);
    expect(r.overflow).toEqual([]);
    expect(debut(r, tasks, 1)).toBeGreaterThanOrEqual(debut(r, tasks, 2) + 30);
  });

  it("sans contrainte, rien ne change par rapport à avant", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 30 },
      { id: 2, startMin: 10 * 60, durationMin: 30 },
    ];
    expect(repackDay(tasks, opts).moves).toEqual([]);
  });

  it("si l'étape précédente déborde, la suivante la suit au jour d'après", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 180 }, { id: 4, startMin: 13 * 60, durationMin: 270 }, // journée pleine jusqu'à 17h30
      { id: 2, startMin: 17 * 60, durationMin: 60 },                          // Rédiger : déborde
      { id: 3, startMin: 17 * 60 + 10, durationMin: 15, apres: [2], depend: [2] }, // Relire : tiendrait seul
    ];
    const r = repackDay(tasks, opts);
    expect(r.overflow).toContain(2);
    expect(r.overflow).toContain(3);
  });

  it("une contrainte d'ordre sans dépendance ne propage pas le débordement", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 180 }, { id: 4, startMin: 13 * 60, durationMin: 270 },
      { id: 2, startMin: 17 * 60, durationMin: 60 },
      { id: 3, startMin: 17 * 60 + 10, durationMin: 15, apres: [2] },
    ];
    const r = repackDay(tasks, opts);
    expect(r.overflow).toContain(2);
    expect(r.overflow).not.toContain(3);
  });
});

describe("repackDay — préparation des posts en début de journée", () => {
  it("une étape « au plus tôt » posée à 16h passe devant une tâche libre de 14h", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 14 * 60, durationMin: 30 },
      { id: 2, startMin: 16 * 60, durationMin: 30, auPlusTot: true },
    ];
    const r = repackDay(tasks, opts);
    expect(r.moves.find((m) => m.id === 2)?.newStartMin).toBe(9 * 60);
    expect(r.moves.find((m) => m.id === 1)).toBeUndefined(); // la tâche libre garde son heure
  });
});
