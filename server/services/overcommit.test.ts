import { describe, it, expect } from "vitest";
import { evaluateProjectOvercommit, averageTaskDurationMin, DEFAULT_TASK_DURATION_MIN } from "./overcommit";

describe("overcommit — seuil PAR PROJET dérivé du budget temps (4 conditions)", () => {
  it("Condition 1 : seuil dérivé du budget, pas un nombre fixe (4h→~8, 1h→~2)", () => {
    const s4 = evaluateProjectOvercommit(0, 4, [30, 30, 30]); // tâches 30 min
    expect(s4.threshold).toBe(8);   // 240/30
    const s1 = evaluateProjectOvercommit(0, 1, [30]);
    expect(s1.threshold).toBe(2);   // 60/30
    // ce ne sont PAS le même nombre → dépend bien du budget
    expect(s4.threshold).not.toBe(s1.threshold);
  });

  it("Condition 2 : l'alerte se déclenche PAR projet — 9 tâches (4h) NE déclenche PAS (bande 8-10)", () => {
    const s = evaluateProjectOvercommit(9, 4, [30, 30, 30]);
    expect(s.threshold).toBe(8);
    expect(s.limit).toBe(10);
    expect(s.overcommitted).toBe(false); // 9 ≤ 10
    expect(evaluateProjectOvercommit(11, 4, [30]).overcommitted).toBe(true); // 11 > 10 → surcharge
    // Un petit projet déborde à un nombre BIEN plus bas (preuve : c'est par projet, pas un total)
    expect(evaluateProjectOvercommit(4, 1, [30]).overcommitted).toBe(true);  // seuil 2, limit 3, 4>3
  });

  it("Condition 3 : la durée moyenne vient des tâches RÉELLES, pas d'une constante", () => {
    // tâches longues (60 min) → moins de tâches tiennent dans 4h → seuil plus bas que 8
    const sLong = evaluateProjectOvercommit(0, 4, [60, 60, 60]);
    expect(sLong.avgTaskDurationMin).toBe(60);
    expect(sLong.threshold).toBe(4); // 240/60
    // tâches courtes (15 min) → plus de tâches tiennent → seuil plus haut
    const sShort = evaluateProjectOvercommit(0, 4, [15, 15]);
    expect(sShort.avgTaskDurationMin).toBe(15);
    expect(sShort.threshold).toBe(16); // 240/15
  });

  it("Condition 3 (repli) : sans aucune durée définie → défaut 30 min documenté", () => {
    expect(averageTaskDurationMin([])).toBe(DEFAULT_TASK_DURATION_MIN);
    expect(averageTaskDurationMin([null, undefined, 0, -5])).toBe(DEFAULT_TASK_DURATION_MIN);
    const s = evaluateProjectOvercommit(0, 2, []); // aucune durée
    expect(s.avgTaskDurationMin).toBe(30);
    expect(s.threshold).toBe(4); // 120/30
  });

  it("budget non défini → repli neutre (pas de crash, seuil cohérent)", () => {
    const s = evaluateProjectOvercommit(5, null, [30]);
    expect(s.dailyTimeBudgetHours).toBeGreaterThan(0);
    expect(s.threshold).toBeGreaterThanOrEqual(1);
  });
});
