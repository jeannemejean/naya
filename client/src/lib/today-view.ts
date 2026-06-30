// Logique (pure, testable) de la vue "Today Task" — extraite pour pouvoir la tester sans
// monter le composant React (le JSX n'est pas transformable dans les tests vitest/oxc).

export type TodayView = "list" | "planner";
export type PlannerDay = 0 | 1; // 0 = aujourd'hui, 1 = demain

// Vue par défaut = planning horaire (condition 3), plus une to-do liste plate.
export const DEFAULT_TODAY_VIEW: TodayView = "planner";

// Flèche latérale : borne le jour affiché entre aujourd'hui (0) et demain (1).
export function nextPlannerDay(current: PlannerDay, dir: 1 | -1): PlannerDay {
  const v = current + dir;
  return (v < 0 ? 0 : v > 1 ? 1 : v) as PlannerDay;
}

// Jeu de tâches affiché par le planning selon le jour sélectionné.
export function tasksForPlannerDay<T>(day: PlannerDay, today: T[], tomorrow: T[]): T[] {
  return day === 0 ? today : tomorrow;
}
