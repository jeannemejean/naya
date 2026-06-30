import { describe, it, expect } from "vitest";
import { DEFAULT_TODAY_VIEW, nextPlannerDay, tasksForPlannerDay } from "./today-view";

describe("today-view — vue par défaut + flèche aujourd'hui/demain (condition 3)", () => {
  it("la vue par défaut est le planning horaire (planner), pas la liste plate", () => {
    expect(DEFAULT_TODAY_VIEW).toBe("planner");
  });

  it("la flèche bascule aujourd'hui (0) ⇄ demain (1) et reste bornée", () => {
    expect(nextPlannerDay(0, 1)).toBe(1);  // aujourd'hui → demain
    expect(nextPlannerDay(1, -1)).toBe(0); // demain → aujourd'hui
    expect(nextPlannerDay(1, 1)).toBe(1);  // pas au-delà de demain
    expect(nextPlannerDay(0, -1)).toBe(0); // pas avant aujourd'hui
  });

  it("le planning affiche les tâches du jour sélectionné", () => {
    const today = [{ id: 1 }, { id: 2 }];
    const tomorrow = [{ id: 3 }];
    expect(tasksForPlannerDay(0, today, tomorrow)).toBe(today);
    expect(tasksForPlannerDay(1, today, tomorrow)).toBe(tomorrow);
  });
});
