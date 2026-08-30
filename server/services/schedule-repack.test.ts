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

/**
 * Plages occupées par des éléments que le re-tassage ne possède pas et ne peut pas
 * déplacer : rendez-vous Google Agenda et tâches DÉJÀ TERMINÉES (leur créneau est de
 * l'histoire, on ne le réattribue pas). Avant, `repackDay` ne connaissait que la pause
 * déjeuner et les rituels ancrés : il re-tassait par-dessus ces plages-là.
 */
describe("repackDay — plages bloquées externes (rendez-vous, tâches terminées)", () => {
  it("ne pose pas une tâche sur une plage bloquée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 600, durationMin: 30 }]; // 10:00–10:30
    const { moves, overflow } = repackDay(tasks, {
      ...opts,
      blockedRanges: [{ start: 615, end: 690 }], // 10:15–11:30
    });
    expect(overflow).toEqual([]);
    expect(moves.find((m) => m.id === 1)?.newStartMin).toBe(690); // poussée à 11:30
  });

  it("laisse intacte une tâche qui ne touche aucune plage bloquée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 540, durationMin: 30 }]; // 09:00–09:30
    const r = repackDay(tasks, { ...opts, blockedRanges: [{ start: 630, end: 690 }] });
    expect(r.moves).toEqual([]);
    expect(r.overflow).toEqual([]);
  });

  it("enchaîne autour de plusieurs plages bloquées sans jamais les chevaucher", () => {
    const blockedRanges = [
      { start: 600, end: 660 }, // 10:00–11:00
      { start: 690, end: 720 }, // 11:30–12:00
    ];
    const tasks: RepackTask[] = [
      { id: 1, startMin: 570, durationMin: 60 }, // 09:30, déborderait sur le 1er bloc
      { id: 2, startMin: 600, durationMin: 30 },
    ];
    const { moves, overflow } = repackDay(tasks, { ...opts, blockedRanges });
    expect(overflow).toEqual([]);

    const final = apply(tasks, moves, overflow);
    assertNoOverlap(final);
    for (const t of final) {
      for (const b of blockedRanges) {
        expect(t.startMin < b.end && t.startMin + t.durationMin > b.start).toBe(false);
      }
    }
  });

  it("ne renvoie jamais une plage bloquée dans les moves (elle n'appartient pas au re-tassage)", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 600, durationMin: 30 }];
    const { moves } = repackDay(tasks, { ...opts, blockedRanges: [{ start: 600, end: 660 }] });
    expect(moves.every((m) => m.id === 1)).toBe(true);
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

describe("repackDay — tâches ancrées (rituels schedulingMode='fixed')", () => {
  // Une tâche ancrée garde IMPÉRATIVEMENT son créneau : le repack ne doit jamais
  // la déplacer (promesse UI « rien ne sera planifié par-dessus »). Les tâches
  // flexibles doivent se ranger autour d'elle, y compris quand le curseur du
  // matin déborderait naturellement sur son créneau.

  it("un rituel à 14:00 reste à 14:00 même si le matin déborde ; la flexible qui le chevaucherait passe après", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 180 },        // 09:00–12:00, flexible, tient tel quel
      { id: 2, startMin: 12 * 60, durationMin: 90 },        // voudrait 12:00, poussée par la pause déj. puis par l'ancre
      { id: 100, startMin: 14 * 60, durationMin: 30, anchored: true }, // rituel 14:00–14:30
    ];
    const { moves, overflow } = repackDay(tasks, opts);

    expect(overflow).toEqual([]);
    // L'ancre ne bouge JAMAIS.
    expect(moves.find((m) => m.id === 100)).toBeUndefined();
    // La flexible #1 tient avant l'ancre : pas de move.
    expect(moves.find((m) => m.id === 1)).toBeUndefined();
    // La flexible #2 est repoussée après la fin de l'ancre (14:30), pas avant.
    const move2 = moves.find((m) => m.id === 2);
    expect(move2?.newStartMin).toBe(14 * 60 + 30);

    const final = apply(tasks, moves, overflow);
    assertNoOverlap(final);
    // Vérifie explicitement que rien ne chevauche le créneau de l'ancre.
    const anchorFinal = { startMin: 14 * 60, durationMin: 30 };
    for (const t of final) {
      if (t.startMin === anchorFinal.startMin) continue; // c'est l'ancre elle-même
      const noOverlap = t.startMin >= anchorFinal.startMin + anchorFinal.durationMin
        || t.startMin + t.durationMin <= anchorFinal.startMin;
      expect(noOverlap).toBe(true);
    }
  });

  it("un rituel à 09:00 (début de journée) reste à 09:00 ; une flexible qui voulait 09:00 passe après", () => {
    const tasks: RepackTask[] = [
      { id: 200, startMin: 9 * 60, durationMin: 60, anchored: true }, // rituel 09:00–10:00
      { id: 201, startMin: 9 * 60, durationMin: 30 },                  // flexible voulant aussi 09:00
    ];
    const { moves, overflow } = repackDay(tasks, opts);

    expect(overflow).toEqual([]);
    expect(moves.find((m) => m.id === 200)).toBeUndefined();
    expect(moves.find((m) => m.id === 201)?.newStartMin).toBe(10 * 60);
  });

  it("sans aucune tâche ancrée, comportement identique à avant (non-régression, cascade)", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 600, durationMin: 60 },
      { id: 2, startMin: 610, durationMin: 30 },
      { id: 3, startMin: 615, durationMin: 30 },
    ];
    const { moves, overflow } = repackDay(tasks, opts);
    assertNoOverlap(apply(tasks, moves, overflow));
  });

  it("une flexible qui rentre avant l'ancre reste avant ; l'ordre relatif des flexibles est préservé", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 60 },        // 09:00–10:00, tient avant l'ancre
      { id: 2, startMin: 10 * 60, durationMin: 60 },       // 10:00–11:00, tient avant l'ancre
      { id: 100, startMin: 14 * 60, durationMin: 30, anchored: true }, // rituel 14:00–14:30
    ];
    const { moves, overflow } = repackDay(tasks, opts);

    expect(overflow).toEqual([]);
    // Aucune des deux flexibles n'a besoin de bouger : elles tiennent avant l'ancre.
    expect(moves.find((m) => m.id === 1)).toBeUndefined();
    expect(moves.find((m) => m.id === 2)).toBeUndefined();
    expect(moves.find((m) => m.id === 100)).toBeUndefined();
  });
});

describe("repackDay — respiration entre les tâches", () => {
  it("insère le tampon entre deux tâches consécutives", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 540, durationMin: 30 }, // 09:00–09:30
      { id: 2, startMin: 570, durationMin: 30 }, // 09:30 → doit passer à 09:40
    ];
    const { moves } = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(moves.find((m) => m.id === 2)?.newStartMin).toBe(580);
  });

  it("n'insère pas de tampon avant la première tâche de la journée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 540, durationMin: 30 }];
    const r = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(r.moves).toEqual([]);
  });

  it("une flexible qui suit une ancre démarre pile à sa fin, sans tampon ajouté après elle", () => {
    // Sans ce test, un bug qui ajouterait bufferMin après skipAnchors() passerait
    // inaperçu : la tâche 2 chevauche l'ancre et DOIT être repoussée exactement à
    // sa fin (09:30), jamais à 09:30+10 — le tampon ne s'insère qu'entre deux
    // tâches flexibles, jamais après une ancre.
    const tasks: RepackTask[] = [
      { id: 100, startMin: 9 * 60, durationMin: 30, anchored: true }, // rituel 09:00–09:30
      { id: 2, startMin: 9 * 60, durationMin: 30 },                    // flexible, chevauche l'ancre
    ];
    const { moves } = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(moves.find((m) => m.id === 2)?.newStartMin).toBe(9 * 60 + 30);
  });

  it("ne fait pas déborder une tâche qui finit pile à la fin de journée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 17 * 60, durationMin: 60 }]; // 17:00–18:00
    expect(repackDay(tasks, { ...opts, bufferMin: 15 }).overflow).toEqual([]);
  });

  it("tampon absent ou nul = comportement inchangé", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 540, durationMin: 30 },
      { id: 2, startMin: 570, durationMin: 30 },
    ];
    expect(repackDay(tasks, { ...opts, bufferMin: 0 }).moves).toEqual([]);
    expect(repackDay(tasks, opts).moves).toEqual([]);
  });

  it("le tampon avance le curseur DANS une plage bloquée : la tâche suivante démarre à la fin de la plage", () => {
    // Tâche A 09:00–09:30 + tampon 10 → curseur à 09:40. Une plage bloquée
    // 09:35–10:30 (rendez-vous) chevauche ce curseur : la tâche suivante doit
    // être repoussée à la fin de la plage (10:30), pas à 09:40. Ce cas combine
    // bufferMin et blockedRanges — absent avant cette revue malgré le fait que
    // la respiration est posée directement sur la feature blockedRanges.
    const tasks: RepackTask[] = [
      { id: 1, startMin: 9 * 60, durationMin: 30 },       // 09:00–09:30
      { id: 2, startMin: 9 * 60 + 40, durationMin: 30 },  // voudrait 09:40, juste après le tampon
    ];
    const { moves, overflow } = repackDay(tasks, {
      ...opts,
      bufferMin: 10,
      blockedRanges: [{ start: 9 * 60 + 35, end: 10 * 60 + 30 }], // 09:35–10:30
    });
    expect(overflow).toEqual([]);
    expect(moves.find((m) => m.id === 1)).toBeUndefined(); // tâche 1 ne bouge pas
    expect(moves.find((m) => m.id === 2)?.newStartMin).toBe(10 * 60 + 30); // poussée à la fin de la plage
  });
});
