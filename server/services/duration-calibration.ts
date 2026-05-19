import { storage } from '../storage';

export type DurationCalibrationMap = Record<string, number>; // category -> ratio (ex: 0.7 = finit en 70% du temps estimé)

/**
 * Calcule le ratio réel/estimé par catégorie de tâche pour un user.
 * Appeler une fois par semaine (cron dimanche 23h UTC).
 */
export async function computeDurationCalibration(userId: string): Promise<DurationCalibrationMap> {
  const completedTasks = await storage.getCompletedTasksWithDuration(userId, 60);

  const byCategory: Record<string, number[]> = {};
  for (const task of completedTasks) {
    if (!task.actualDuration || !task.estimatedDuration) continue;
    const cat = (task as any).taskCategory || (task as any).category || 'general';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(task.actualDuration / task.estimatedDuration);
  }

  // Médiane par catégorie (ignore les outliers mieux que la moyenne)
  const calibration: DurationCalibrationMap = {};
  for (const [cat, ratios] of Object.entries(byCategory)) {
    if (ratios.length < 3) continue; // pas assez de données
    ratios.sort((a, b) => a - b);
    calibration[cat] = ratios[Math.floor(ratios.length / 2)];
  }

  await storage.updateUserPreferences(userId, { durationCalibration: calibration });
  return calibration;
}

/**
 * Ajuste une durée estimée selon le calibrage réel de l'utilisateur.
 * Utilisée dans generateForUser() avant d'assigner les créneaux.
 */
export function applyCalibration(
  estimatedMin: number,
  category: string,
  calibration: DurationCalibrationMap,
): number {
  const ratio = calibration[category] ?? calibration['general'] ?? 1.0;
  const adjusted = Math.round(estimatedMin * ratio);
  // Plancher à 10 min, plafond à 240 min
  return Math.max(10, Math.min(240, adjusted));
}

/**
 * Formate le calibrage pour l'injection dans le prompt IA.
 */
export function formatCalibrationForPrompt(calibration: DurationCalibrationMap): string {
  const entries = Object.entries(calibration);
  if (entries.length === 0) return '';
  const lines = entries.map(([cat, ratio]) => {
    const pct = Math.round((ratio - 1) * 100);
    const label = pct < 0 ? `finit ${Math.abs(pct)}% plus vite` : `prend ${pct}% plus de temps`;
    return `  ${cat}: ${label} (ratio ${ratio.toFixed(2)})`;
  });
  return `Calibrage durée réelle (basé sur les tâches passées) :\n${lines.join('\n')}\nAjuste tes estimations en conséquence.`;
}
