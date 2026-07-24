import { describe, it, expect } from "vitest";
import { repackDay, type RepackTask } from "./schedule-repack";

const opts = {
  dayStartMin: 9 * 60,    // 09:00
  dayEndMin: 18 * 60,     // 18:00
  lunchStartMin: 12 * 60, // 12:00
  lunchEndMin: 13 * 60,   // 13:00
  lunchEnabled: true,
};

function assertNoOverlap(scheduled: { startMin: number; durationMin: number }[]) {
  const sorted = [...scheduled].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startMin + sorted[i - 1].durationMin;
    expect(sorted[i].startMin).toBeGreaterThanOrEqual(prevEnd);
  }
}

function apply(tasks: RepackTask[], moves: { id: number; newStartMin: number }[], overflow: number[] = []) {
  const m = new Map(moves.map((x) => [x.id, x.newStartMin]));
  return tasks
    .filter((t) => !overflow.includes(t.id))
    .map((t) => ({ startMin: m.has(t.id) ? m.get(t.id)! : t.startMin, durationMin: t.durationMin }));
}

describe("repackDay", () => {
  it("résout le chevauchement réel #177(16:25,45) / #176(16:30,40)", () => {
    const tasks: RepackTask[] = [
      { id: 177, startMin: 985, durationMin: 45 }, // 16:25–17:10
      { id: 176, startMin: 990, durationMin: 40 }, // 16:30–17:10  (overlap)
    ];
    const { moves, overflow } = repackDay(tasks, opts);
    expect(moves.find((m) => m.id === 177)).toBeUndefined();
    expect(moves.find((m) => m.id === 176)?.newStartMin).toBe(1030); // 17:10
    assertNoOverlap(apply(tasks, moves, overflow));
  });

  it("ne touche pas une journée déjà sans chevauchement (bout-à-bout)", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 840, durationMin: 40 }, // 14:00–14:40
      { id: 2, startMin: 880, durationMin: 45 }, // 14:40–15:25
    ];
    const r = repackDay(tasks, opts);
    expect(r.moves).toEqual([]);
    expect(r.overflow).toEqual([]);
  });

  it("ne déplace jamais une tâche avant 'floorMin'", () => {
    const tasks: RepackTask[] = [
      { id: 10, startMin: 985, durationMin: 45 },
      { id: 11, startMin: 990, durationMin: 40 },
    ];
    const { moves, overflow } = repackDay(tasks, { ...opts, floorMin: 1000 });
    const final = apply(tasks, moves, overflow);
    for (const t of final) expect(t.startMin).toBeGreaterThanOrEqual(1000);
    assertNoOverlap(final);
  });

  it("ne pose pas une tâche à cheval sur la pause déjeuner", () => {
    const tasks: RepackTask[] = [{ id: 20, startMin: 690, durationMin: 40 }];
    expect(repackDay(tasks, opts).moves.find((m) => m.id === 20)?.newStartMin).toBe(780); // 13:00
  });

  it("garantit zéro chevauchement sur une cascade", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 600, durationMin: 60 },
      { id: 2, startMin: 610, durationMin: 30 },
      { id: 3, startMin: 615, durationMin: 30 },
    ];
    const { moves, overflow } = repackDay(tasks, opts);
    assertNoOverlap(apply(tasks, moves, overflow));
  });

  it("déplanifie (overflow) une tâche qui finirait après la fin de journée (18:00)", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 17 * 60, durationMin: 45 },  // 17:00–17:45 → OK
      { id: 2, startMin: 17 * 60 + 30, durationMin: 60 }, // poussée à 17:45, finirait 18:45 → overflow
    ];
    const { moves, overflow } = repackDay(tasks, opts);
    expect(overflow).toContain(2);
    expect(overflow).not.toContain(1);
    assertNoOverlap(apply(tasks, moves, overflow));
  });

  it("une tâche pile jusqu'à 18:00 reste planifiée (pas d'overflow)", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 17 * 60, durationMin: 60 }]; // 17:00–18:00
    expect(repackDay(tasks, opts).overflow).toEqual([]);
  });
});

describe("repackDay — tâches sans créneau (exigence : rien de « non planifié »)", () => {
  const OPTS = {
    dayStartMin: 9 * 60, dayEndMin: 18 * 60,
    lunchStartMin: 12 * 60, lunchEndMin: 14 * 60, lunchEnabled: true,
  };

  it("place une tâche sans créneau après les tâches déjà horodatées", () => {
    const { moves, overflow } = repackDay([
      { id: 2, startMin: 0, durationMin: 30, unplaced: true },
      { id: 1, startMin: 9 * 60, durationMin: 60 },
    ], OPTS);

    expect(overflow).toEqual([]);
    // La tâche 1 garde 09:00, la tâche 2 se range juste derrière à 10:00.
    expect(moves).toEqual([{ id: 2, newStartMin: 10 * 60, newEndMin: 10 * 60 + 30 }]);
  });

  it("produit toujours un move pour une tâche sans créneau, même si l'heure coïncide", () => {
    const { moves } = repackDay(
      [{ id: 1, startMin: 9 * 60, durationMin: 30, unplaced: true }],
      OPTS,
    );
    // startMin vaudrait 09:00 par coïncidence : sans ce cas, la tâche resterait sans heure.
    expect(moves).toEqual([{ id: 1, newStartMin: 9 * 60, newEndMin: 9 * 60 + 30 }]);
  });

  it("reporte en overflow ce qui ne tient plus dans la journée", () => {
    const { moves, overflow } = repackDay([
      { id: 1, startMin: 17 * 60, durationMin: 60 },        // 17:00 → 18:00, tient
      { id: 2, startMin: 0, durationMin: 60, unplaced: true }, // ne tient plus
    ], OPTS);

    expect(moves).toEqual([]);
    expect(overflow).toEqual([2]);
  });

  it("respecte « maintenant » : l'après-midi, rien n'est placé le matin", () => {
    const { moves, overflow } = repackDay(
      [{ id: 1, startMin: 0, durationMin: 60, unplaced: true }],
      { ...OPTS, floorMin: 15 * 60 }, // il est 15h
    );

    expect(overflow).toEqual([]);
    expect(moves).toEqual([{ id: 1, newStartMin: 15 * 60, newEndMin: 16 * 60 }]);
  });

  it("saute la pause déjeuner pour une tâche sans créneau", () => {
    const { moves } = repackDay(
      [{ id: 1, startMin: 0, durationMin: 60, unplaced: true }],
      { ...OPTS, floorMin: 11 * 60 + 30 }, // 11:30, chevaucherait 12:00-14:00
    );

    expect(moves).toEqual([{ id: 1, newStartMin: 14 * 60, newEndMin: 15 * 60 }]);
  });
});
