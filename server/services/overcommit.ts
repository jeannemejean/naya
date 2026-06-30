import { DEFAULT_BUDGET_H } from "./task-allocation";

// Seuil de surcharge ("overcommitting") calculé PAR PROJET, à partir de son budget temps/jour
// et de la durée MOYENNE RÉELLE de ses tâches — jamais un nombre fixe global ni un cumul total.

// Durée par défaut d'une tâche, utilisée UNIQUEMENT en repli quand aucune tâche du projet n'a
// encore de durée définie. 30 min = créneau de travail typique dans Naya (et durée par défaut
// appliquée à la génération via estimatedDuration). Dès qu'il existe de vraies durées, on les utilise.
export const DEFAULT_TASK_DURATION_MIN = 30;

// Marge de tolérance au-dessus du seuil "confortable" avant de crier à la surcharge.
// Le seuil confortable = ce qui tient PILE dans le budget ; on n'alerte pas pour quelques tâches
// de plus (variation normale) → bande de 25 %.
export const OVERCOMMIT_TOLERANCE = 0.25;

// Moyenne des durées réelles (minutes). Repli documenté si aucune durée valide.
export function averageTaskDurationMin(durations: Array<number | null | undefined>): number {
  const valid = durations.map((d) => Number(d)).filter((d) => Number.isFinite(d) && d > 0);
  if (valid.length === 0) return DEFAULT_TASK_DURATION_MIN;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

export interface OvercommitStatus {
  dailyTimeBudgetHours: number; // budget effectif (repli neutre si non défini)
  avgTaskDurationMin: number;   // moyenne réelle des tâches du projet, ou repli
  threshold: number;            // nb de tâches "confortable" qui tient dans le budget
  limit: number;                // seuil de déclenchement (threshold + tolérance)
  taskCount: number;
  overcommitted: boolean;       // vrai SEULEMENT si CE projet dépasse SON propre seuil
}

// Formule explicite (par projet) :
//   budgetMin = budgetHeures × 60
//   threshold = floor(budgetMin / dureeMoyenne)      ← nb de tâches qui tient dans le budget/jour
//   limit     = round(threshold × (1 + TOLERANCE))   ← au-delà = surcharge
//   overcommitted = taskCount > limit
// Exemples : 4 h, tâches 30 min → 240/30 = 8 (seuil), limit 10 → 9 tâches N'ALERTE PAS.
//            1 h, tâches 30 min → 60/30  = 2 (seuil), limit 3.
export function evaluateProjectOvercommit(
  taskCount: number,
  dailyTimeBudgetHours: number | null | undefined,
  taskDurations: Array<number | null | undefined>,
): OvercommitStatus {
  const bRaw = Number(dailyTimeBudgetHours);
  const budgetH = Number.isFinite(bRaw) && bRaw > 0 ? bRaw : DEFAULT_BUDGET_H;
  const avg = averageTaskDurationMin(taskDurations);
  const threshold = Math.max(1, Math.floor((budgetH * 60) / avg));
  const limit = Math.round(threshold * (1 + OVERCOMMIT_TOLERANCE));
  return {
    dailyTimeBudgetHours: budgetH,
    avgTaskDurationMin: avg,
    threshold,
    limit,
    taskCount,
    overcommitted: taskCount > limit,
  };
}
