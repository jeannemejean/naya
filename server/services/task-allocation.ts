// Répartition du quota hebdomadaire de tâches ENTRE projets, pondérée par le budget temps/jour.
// Remplace l'ancien split égal (cap / nbProjets). Un projet « revenu 4h/jour » reçoit
// proportionnellement plus de tâches qu'un projet « passion 1h/jour ».

export const DEFAULT_BUDGET_H = 2;   // budget neutre pour un projet sans valeur définie
export const PER_PROJECT_CEIL = 10;  // plafond par projet (laisse le ratio s'exprimer)

// Poids d'un projet = son budget temps/jour (ou un défaut neutre si non défini / invalide).
export function budgetWeight(dailyTimeBudgetHours: number | null | undefined): number {
  const b = Number(dailyTimeBudgetHours);
  return Number.isFinite(b) && b > 0 ? b : DEFAULT_BUDGET_H;
}

// Cap d'un projet = part de weeklyCap proportionnelle à son poids, bornée [1, PER_PROJECT_CEIL].
export function taskCapForBudget(
  dailyTimeBudgetHours: number | null | undefined,
  totalWeight: number,
  weeklyCap: number,
): number {
  const raw = Math.round(weeklyCap * (budgetWeight(dailyTimeBudgetHours) / (totalWeight || 1)));
  return Math.max(1, Math.min(PER_PROJECT_CEIL, raw));
}

// Caps pour une liste de projets (somme des poids calculée en interne).
export function allocateTaskCaps(
  projects: Array<{ dailyTimeBudgetHours?: number | null }>,
  weeklyCap: number,
): number[] {
  const total = projects.reduce((s, p) => s + budgetWeight(p.dailyTimeBudgetHours), 0) || 1;
  return projects.map((p) => taskCapForBudget(p.dailyTimeBudgetHours, total, weeklyCap));
}
