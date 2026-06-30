import { describe, it, expect } from "vitest";
import { allocateTaskCaps, taskCapForBudget, budgetWeight, PER_PROJECT_CEIL, DEFAULT_BUDGET_H } from "./task-allocation";

describe("task-allocation — répartition pondérée par budget temps (condition 2)", () => {
  it("Agence JMD (4h) reçoit nettement plus que Encore Merci (1h) — PAS un split égal", () => {
    // Scénario de la preuve : JMD 4h, Encore Merci 1h, + 2 projets sans budget (défaut 2h).
    const projects = [
      { name: "Agence JMD", dailyTimeBudgetHours: 4 },
      { name: "Encore Merci", dailyTimeBudgetHours: 1 },
      { name: "Jeanne PB", dailyTimeBudgetHours: null },
      { name: "Naya", dailyTimeBudgetHours: null },
    ];
    const caps = allocateTaskCaps(projects, 20);
    const [jmd, em, pb, naya] = caps;

    // Le ratio reflète le budget, pas l'égalité.
    expect(jmd).toBeGreaterThan(em);
    expect(jmd).toBeGreaterThanOrEqual(em * 3); // ~4:1 budget → au moins 3:1 en tâches
    // Ce n'est PAS un split égal (sinon les 4 seraient identiques).
    expect(new Set(caps).size).toBeGreaterThan(1);
    // Les projets à budget par défaut (2h) sont entre les deux.
    expect(pb).toBe(naya);
    expect(pb).toBeGreaterThan(em);
    expect(pb).toBeLessThan(jmd);
  });

  it("budget par défaut quand non défini / invalide", () => {
    expect(budgetWeight(null)).toBe(DEFAULT_BUDGET_H);
    expect(budgetWeight(undefined)).toBe(DEFAULT_BUDGET_H);
    expect(budgetWeight(0)).toBe(DEFAULT_BUDGET_H);
    expect(budgetWeight(-5)).toBe(DEFAULT_BUDGET_H);
    expect(budgetWeight(4)).toBe(4);
  });

  it("cap borné à [1, PER_PROJECT_CEIL]", () => {
    expect(taskCapForBudget(100, 100, 20)).toBe(PER_PROJECT_CEIL); // part énorme → plafonné
    expect(taskCapForBudget(0.001, 1000, 20)).toBe(1);              // part minuscule → plancher 1
  });

  it("budgets égaux → caps égaux (cohérence : l'ancien comportement reste possible)", () => {
    const caps = allocateTaskCaps([{ dailyTimeBudgetHours: 2 }, { dailyTimeBudgetHours: 2 }, { dailyTimeBudgetHours: 2 }], 15);
    expect(new Set(caps).size).toBe(1);
  });
});
