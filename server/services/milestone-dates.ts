/**
 * Placement LOGIQUE des jalons dans le planning.
 *
 * Un jalon n'est pas une tâche horaire : c'est un repère/échéance. Sa date d'affichage
 * est calculée par priorité décroissante (cf. design « Échéance en haut du jour ») :
 *   1. jalon terminé        → sa date de réalisation (completedAt)
 *   2. date cible explicite → targetDate
 *   3. condition de durée   → activé (activatedAt) + N jours
 *   4. dernière tâche liée  → max(scheduledDate des tâches du jalon)
 *   5. jalon dont il dépend → date du jalon bloquant + 1 jour
 *   6. sinon                → null (« à dater »)
 *
 * Fonctions PURES (aucun accès DB) → testables unitairement.
 */

/** Convertit une Date/ISO/chaîne en "YYYY-MM-DD" (UTC), ou null. */
export function toDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10) || null;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Ajoute `days` jours à une date "YYYY-MM-DD" (calcul en UTC, sans dérive de fuseau). */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface MilestoneDateInput {
  status: string;
  targetDate?: string | null;
  completedAt?: Date | string | null;
  activatedAt?: Date | string | null;
  durationDays?: number | null; // issu d'une condition duration_elapsed
  linkedTaskDates?: (string | null | undefined)[]; // scheduledDate des tâches liées
  depDate?: string | null; // date logique déjà résolue du jalon dont celui-ci dépend
}

/** Renvoie la date logique d'affichage du jalon ("YYYY-MM-DD") ou null si indatable. */
export function deriveMilestoneDate(m: MilestoneDateInput): string | null {
  // 1. Terminé → sa date de réalisation.
  if (m.status === "completed") {
    return toDateStr(m.completedAt) || (m.targetDate ? m.targetDate.slice(0, 10) : null);
  }
  // 2. Date cible explicite.
  if (m.targetDate) return m.targetDate.slice(0, 10);
  // 3. Condition de durée : activé + N jours.
  if (m.durationDays != null && m.activatedAt) {
    const base = toDateStr(m.activatedAt);
    if (base) return addDays(base, m.durationDays);
  }
  // 4. Juste après la dernière tâche qui mène au jalon.
  const taskDates = (m.linkedTaskDates || []).filter((d): d is string => !!d).map((d) => d.slice(0, 10));
  if (taskDates.length) return taskDates.sort()[taskDates.length - 1];
  // 5. Après le jalon dont il dépend.
  if (m.depDate) return addDays(m.depDate.slice(0, 10), 1);
  // 6. Indatable → bac « à dater ».
  return null;
}
