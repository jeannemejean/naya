export interface GoalWithProgress {
  id: number;
  title: string;
  goalType?: string | null;
  successMode?: string | null;
  targetDate?: string | Date | null;
  dueDate?: string | Date | null;
  completedTasks?: number;
  totalTasks?: number;
  [key: string]: any;
}

/**
 * Score entre 0 (pas urgent) et 1 (critique).
 * Combine urgence temporelle × travail restant.
 */
export function computeGoalUrgencyScore(goal: GoalWithProgress): number {
  const completed = goal.completedTasks ?? 0;
  const total = goal.totalTasks ?? 0;
  const progressRatio = total > 0 ? completed / total : 0;
  const remainingWork = 1 - progressRatio;

  // Urgence temporelle
  let timeScore = 0;
  const deadline = goal.targetDate || goal.dueDate;
  if (deadline) {
    const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline as string);
    const daysUntilDue = Math.max(0, Math.floor(
      (deadlineDate.getTime() - Date.now()) / 86400000,
    ));
    // Exponentiel : dépasse 0.5 en dessous de 30 jours, proche de 1 en dessous de 7 jours
    timeScore = daysUntilDue === 0 ? 1 : Math.min(1, 30 / daysUntilDue);
  }

  const rawScore = (timeScore * 0.6) + (remainingWork * 0.4);
  return Math.min(1, rawScore);
}

/**
 * Formate les objectifs avec leur score d'urgence pour le prompt IA.
 */
export function formatGoalsWithUrgency(goals: GoalWithProgress[]): string {
  if (goals.length === 0) return 'Aucun objectif actif.';
  return goals
    .map(g => {
      const score = computeGoalUrgencyScore(g);
      const urgencyLabel =
        score > 0.8 ? '🚨 CRITIQUE' :
        score > 0.5 ? '⚠️ URGENT' :
        score > 0.2 ? '📌 ACTIF' : '✓ OK';
      const completed = g.completedTasks ?? 0;
      const total = g.totalTasks ?? 0;
      const rawDeadline = g.targetDate || g.dueDate;
      const deadlineStr = rawDeadline
        ? (rawDeadline instanceof Date ? rawDeadline.toISOString().slice(0, 10) : String(rawDeadline))
        : null;
      return `- ${urgencyLabel} [score: ${score.toFixed(2)}] ${g.title}
  Progression: ${completed}/${total} tâches
  ${deadlineStr ? `Échéance: ${deadlineStr}` : "Pas d'échéance"}`;
    })
    .join('\n');
}
