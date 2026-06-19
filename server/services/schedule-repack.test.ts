import { describe, it, expect } from "vitest";
import { repackDay, type RepackTask } from "./schedule-repack";

const opts = {
  dayStartMin: 9 * 60,    // 09:00
  dayEndMin: 18 * 60,     // 18:00
  lunchStartMin: 12 * 60, // 12:00
  lunchEndMin: 13 * 60,   // 13:00
  lunchEnabled: true,
};

// Vérifie qu'aucune paire de tâches ne se chevauche après re-tassage.
function assertNoOverlap(scheduled: { startMin: number; durationMin: number }[]) {
  const sorted = [...scheduled].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startMin + sorted[i - 1].durationMin;
    expect(sorted[i].startMin).toBeGreaterThanOrEqual(prevEnd);
  }
}

// Applique les moves à la liste d'entrée pour obtenir l'horaire final.
function apply(tasks: RepackTask[], moves: { id: number; newStartMin: number }[]) {
  const m = new Map(moves.map((x) => [x.id, x.newStartMin]));
  return tasks.map((t) => ({ startMin: m.has(t.id) ? m.get(t.id)! : t.startMin, durationMin: t.durationMin }));
}

describe("repackDay", () => {
  it("résout le chevauchement réel #177(16:25,45) / #176(16:30,40)", () => {
    const tasks: RepackTask[] = [
      { id: 177, startMin: 985, durationMin: 45 }, // 16:25–17:10
      { id: 176, startMin: 990, durationMin: 40 }, // 16:30–17:10  (overlap)
    ];
    const moves = repackDay(tasks, opts);
    // #177 garde sa place, #176 est poussée après
    expect(moves.find((m) => m.id === 177)).toBeUndefined();
    const move176 = moves.find((m) => m.id === 176);
    expect(move176?.newStartMin).toBe(1030); // 17:10
    assertNoOverlap(apply(tasks, moves));
  });

  it("ne touche pas une journée déjà sans chevauchement (bout-à-bout)", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 840, durationMin: 40 }, // 14:00–14:40
      { id: 2, startMin: 880, durationMin: 45 }, // 14:40–15:25
    ];
    expect(repackDay(tasks, opts)).toEqual([]);
  });

  it("ne déplace jamais une tâche avant 'floorMin' (jour courant : pas dans le passé)", () => {
    const tasks: RepackTask[] = [
      { id: 10, startMin: 985, durationMin: 45 }, // 16:25
      { id: 11, startMin: 990, durationMin: 40 }, // 16:30 overlap
    ];
    const moves = repackDay(tasks, { ...opts, floorMin: 1000 }); // maintenant = 16:40
    const final = apply(tasks, moves);
    for (const t of final) expect(t.startMin).toBeGreaterThanOrEqual(1000);
    assertNoOverlap(final);
  });

  it("ne pose pas une tâche à cheval sur la pause déjeuner", () => {
    const tasks: RepackTask[] = [
      { id: 20, startMin: 690, durationMin: 40 }, // 11:30–12:10 chevauche le déjeuner
    ];
    const moves = repackDay(tasks, opts);
    expect(moves.find((m) => m.id === 20)?.newStartMin).toBe(780); // poussée à 13:00
  });

  it("garantit zéro chevauchement même sur une cascade", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 600, durationMin: 60 }, // 10:00–11:00
      { id: 2, startMin: 610, durationMin: 30 }, // 10:10 overlap
      { id: 3, startMin: 615, durationMin: 30 }, // 10:15 overlap
    ];
    assertNoOverlap(apply(tasks, repackDay(tasks, opts)));
  });
});
