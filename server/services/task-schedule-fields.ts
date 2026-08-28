/**
 * Dérivation des champs d'horaire d'une tâche.
 *
 * `scheduledEndTime` est une valeur DÉRIVÉE de (`scheduledTime`, `estimatedDuration`).
 * Elle était recalculée à la main, en ligne, à chaque endroit qui touchait à l'horaire —
 * et donc oubliée dès qu'un chemin ne modifiait qu'un des deux champs (le
 * redimensionnement d'une carte n'envoie que la durée). L'heure de fin restait alors
 * périmée, et la grille affichait une carte qui ne correspondait plus à ses données.
 */

const HHMM = /^\d{2}:\d{2}$/;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * Heure de fin (HH:MM) d'une tâche, ou `null` si elle n'a pas d'heure de début
 * exploitable. Bornée à 23:59 : une heure de fin « 24:15 » n'est pas lisible par la
 * grille et ne veut rien dire.
 */
export function resolveScheduledEndTime(
  scheduledTime: string | null | undefined,
  durationMin: number | null | undefined,
): string | null {
  if (!scheduledTime || !HHMM.test(scheduledTime)) return null;

  const [h, m] = scheduledTime.split(':').map(Number);
  const endMin = Math.min(h * 60 + m + (durationMin || 30), LAST_MINUTE_OF_DAY);

  return `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
}

/** Forme minimale nécessaire pour décider si une tâche bloque un créneau. */
export interface SchedulableTaskRow {
  completed: boolean | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedDuration: number | null;
}

/**
 * Créneaux des tâches TERMINÉES, groupés par date, à passer en `blockedRanges` au
 * re-tassage.
 *
 * Une tâche terminée reste affichée dans la grille : son créneau est donc occupé du
 * point de vue de l'utilisateur. Le planificateur doit le voir pareil, sinon cocher une
 * tâche rend son créneau réattribuable et la suivante s'empile dessus — un chevauchement
 * que rien ne corrige, puisque le re-tassage est lui aussi aveugle aux tâches terminées.
 */
export function blockedRangesByDate(
  rows: SchedulableTaskRow[],
): Map<string, { start: number; end: number }[]> {
  const byDate = new Map<string, { start: number; end: number }[]>();

  for (const row of rows) {
    if (!row.completed || !row.scheduledDate) continue;
    if (!row.scheduledTime || !HHMM.test(row.scheduledTime)) continue;

    const [h, m] = row.scheduledTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (row.estimatedDuration || 30);
    if (end <= start) continue;

    if (!byDate.has(row.scheduledDate)) byDate.set(row.scheduledDate, []);
    byDate.get(row.scheduledDate)!.push({ start, end });
  }

  return byDate;
}
