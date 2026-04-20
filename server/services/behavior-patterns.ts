import { storage } from '../storage';

export interface BehaviorPattern {
  bestTaskTypeByHour: Record<string, string>;        // "09:00" -> "content"
  worstCompletionByDayOfWeek: Record<string, string[]>; // "monday" -> ["admin"]
  averageCompletionRateByCategory: Record<string, number>; // "admin" -> 0.45
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Analyse 90 jours d'historique de tâches pour détecter les patterns de complétion.
 * Appeler une fois par semaine (cron dimanche minuit UTC).
 */
export async function analyzeBehaviorPatterns(userId: string): Promise<BehaviorPattern> {
  const taskHistory = await storage.getTaskHistory(userId, 90);

  // Pattern 1 : meilleur type de tâche par créneau horaire
  const completionByHourAndCat: Record<string, Record<string, { done: number; total: number }>> = {};

  for (const task of taskHistory) {
    if (!task.scheduledTime) continue;
    const cat = (task as any).taskCategory || (task as any).category;
    if (!cat) continue;
    const hour = task.scheduledTime.substring(0, 5);

    if (!completionByHourAndCat[hour]) completionByHourAndCat[hour] = {};
    if (!completionByHourAndCat[hour][cat]) completionByHourAndCat[hour][cat] = { done: 0, total: 0 };
    completionByHourAndCat[hour][cat].total++;
    if (task.completed) completionByHourAndCat[hour][cat].done++;
  }

  const bestTaskTypeByHour: Record<string, string> = {};
  for (const [hour, categories] of Object.entries(completionByHourAndCat)) {
    let bestCat = '';
    let bestRate = -1;
    for (const [cat, stats] of Object.entries(categories)) {
      if (stats.total < 3) continue;
      const rate = stats.done / stats.total;
      if (rate > bestRate) { bestRate = rate; bestCat = cat; }
    }
    if (bestCat) bestTaskTypeByHour[hour] = bestCat;
  }

  // Pattern 2 : catégories mal complétées par jour de semaine
  const completionByDayAndCat: Record<string, Record<string, { done: number; total: number }>> = {};

  for (const task of taskHistory) {
    if (!task.scheduledDate) continue;
    const cat = (task as any).taskCategory || (task as any).category;
    if (!cat) continue;
    const day = DAY_NAMES[new Date(task.scheduledDate + 'T12:00:00').getDay()];

    if (!completionByDayAndCat[day]) completionByDayAndCat[day] = {};
    if (!completionByDayAndCat[day][cat]) completionByDayAndCat[day][cat] = { done: 0, total: 0 };
    completionByDayAndCat[day][cat].total++;
    if (task.completed) completionByDayAndCat[day][cat].done++;
  }

  const worstCompletionByDayOfWeek: Record<string, string[]> = {};
  for (const [day, categories] of Object.entries(completionByDayAndCat)) {
    const poor = Object.entries(categories)
      .filter(([_, stats]) => stats.total >= 3 && stats.done / stats.total < 0.4)
      .map(([cat]) => cat);
    if (poor.length > 0) worstCompletionByDayOfWeek[day] = poor;
  }

  // Pattern 3 : taux de complétion global par catégorie
  const globalByCat: Record<string, { done: number; total: number }> = {};
  for (const task of taskHistory) {
    const cat = (task as any).taskCategory || (task as any).category;
    if (!cat) continue;
    if (!globalByCat[cat]) globalByCat[cat] = { done: 0, total: 0 };
    globalByCat[cat].total++;
    if (task.completed) globalByCat[cat].done++;
  }

  const averageCompletionRateByCategory: Record<string, number> = {};
  for (const [cat, stats] of Object.entries(globalByCat)) {
    if (stats.total >= 5) {
      averageCompletionRateByCategory[cat] = stats.done / stats.total;
    }
  }

  const patterns: BehaviorPattern = {
    bestTaskTypeByHour,
    worstCompletionByDayOfWeek,
    averageCompletionRateByCategory,
  };

  await storage.updateUserPreferences(userId, { behaviorPatterns: patterns });
  return patterns;
}

/**
 * Formate les patterns comportementaux pour injection dans buildNayaContext().
 */
export function formatBehaviorPatternsForContext(patterns: BehaviorPattern, todayDayName: string): string {
  const poorToday = patterns.worstCompletionByDayOfWeek[todayDayName] ?? [];

  const lowCompletionCats = Object.entries(patterns.averageCompletionRateByCategory)
    .filter(([_, rate]) => rate < 0.5)
    .map(([cat, rate]) => `${cat} (${Math.round(rate * 100)}% complètes)`)
    .join(', ');

  const optimalSlots = Object.entries(patterns.bestTaskTypeByHour)
    .slice(0, 6)
    .map(([h, cat]) => `- ${h} : ${cat}`)
    .join('\n');

  const lines: string[] = [`## Patterns comportementaux réels (basé sur 90 jours)`];

  if (lowCompletionCats) {
    lines.push(`Taux de complétion faible pour : ${lowCompletionCats}`);
  }
  if (poorToday.length > 0) {
    lines.push(`Catégories à éviter le ${todayDayName} (historiquement non complétées) : ${poorToday.join(', ')}`);
  }
  if (optimalSlots) {
    lines.push(`Créneaux optimaux par type de tâche :\n${optimalSlots}`);
  }

  if (poorToday.length > 0) {
    lines.push(`Instruction : ne génère pas de tâches de type ${poorToday.join(' ou ')} si des alternatives existent.`);
  } else {
    lines.push('Instruction : tiens compte de ces patterns pour choisir le type et le moment des tâches.');
  }

  return lines.join('\n');
}
