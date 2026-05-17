/**
 * Migration one-shot : assigne une scheduled_time à toutes les tâches qui ont
 * une scheduled_date mais pas de scheduled_time.
 * Respecte workDayStart/workDayEnd/lunchBreak/workDays de chaque user.
 */
import { db } from '../server/db';
import { tasks, userPreferences } from '../shared/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';

const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}
function formatMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

async function findSlotForUser(
  userId: string,
  fromDate: string,
  durationMinutes: number,
  prefsMap: Map<string, any>,
  alreadyAssigned: Map<string, Array<{ start: number; end: number }>>
): Promise<{ date: string; time: string }> {
  const prefs = prefsMap.get(userId);
  const DAY_START = parseMin(prefs?.workDayStart || '09:00');
  const DAY_END = parseMin(prefs?.workDayEnd || '18:00');
  const LUNCH_START = parseMin(prefs?.lunchBreakStart || '12:00');
  const LUNCH_END = parseMin(prefs?.lunchBreakEnd || '13:00');
  const lunchEnabled = prefs?.lunchBreakEnabled !== false;
  const workDaysCsv = prefs?.workDays || 'mon,tue,wed,thu,fri';
  const workDaySet = new Set(workDaysCsv.split(',').map((d: string) => d.trim().toLowerCase()));

  const parseUTC = (ds: string) => { const [y,m,d] = ds.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
  const isWorkDay = (ds: string) => workDaySet.has(DAY_ABBRS[parseUTC(ds).getUTCDay()]);
  const nextDay = (ds: string): string => { const d = parseUTC(ds); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); };

  let currentDate = fromDate;
  for (let guard = 0; guard < 14; guard++) {
    if (!isWorkDay(currentDate)) { currentDate = nextDay(currentDate); continue; }

    // Intervalles déjà occupés en DB pour ce jour
    const dayKey = `${userId}__${currentDate}`;
    const occupied = [...(alreadyAssigned.get(dayKey) || [])].sort((a, b) => a.start - b.start);

    let candidate = DAY_START;
    while (candidate + durationMinutes <= DAY_END) {
      const candidateEnd = candidate + durationMinutes;
      if (lunchEnabled && candidate < LUNCH_END && candidateEnd > LUNCH_START) { candidate = LUNCH_END; continue; }
      const blocking = occupied.find(r => candidate < r.end && candidateEnd > r.start);
      if (!blocking) {
        // Réserve ce créneau pour les prochaines tâches de la même passe
        const slots = alreadyAssigned.get(dayKey) || [];
        slots.push({ start: candidate, end: candidateEnd });
        alreadyAssigned.set(dayKey, slots);
        return { date: currentDate, time: formatMin(candidate) };
      }
      candidate = blocking.end;
    }
    currentDate = nextDay(currentDate);
  }

  return { date: fromDate, time: formatMin(parseMin(prefsMap.get(userId)?.workDayStart || '09:00')) };
}

async function main() {
  console.log('── assign-missing-times migration ────────────────────────────────');

  // 1. Tâches cibles : scheduled_date non nulle, scheduled_time nulle, non complétées
  const targets = await db.select({
    id: tasks.id,
    userId: tasks.userId,
    scheduledDate: tasks.scheduledDate,
    estimatedDuration: tasks.estimatedDuration,
    title: tasks.title,
  }).from(tasks).where(
    and(
      eq(tasks.completed, false),
      isNotNull(tasks.scheduledDate),
      isNull(tasks.scheduledTime),
    )
  );

  console.log(`Tâches sans heure : ${targets.length}`);
  if (targets.length === 0) {
    console.log('✅  Rien à faire.');
    process.exit(0);
  }

  // 2. Charger les prefs de tous les users concernés
  const allPrefs = await db.select().from(userPreferences);
  const prefsMap = new Map<string, any>(allPrefs.map(p => [p.userId, p]));

  // 3. Charger les créneaux déjà occupés en DB (tâches avec heure existante)
  const occupied: Map<string, Array<{ start: number; end: number }>> = new Map();
  const existingScheduled = await db.select({
    userId: tasks.userId,
    scheduledDate: tasks.scheduledDate,
    scheduledTime: tasks.scheduledTime,
    estimatedDuration: tasks.estimatedDuration,
  }).from(tasks).where(
    and(
      eq(tasks.completed, false),
      isNotNull(tasks.scheduledDate),
      isNotNull(tasks.scheduledTime),
    )
  );

  for (const t of existingScheduled) {
    if (!t.scheduledDate || !t.scheduledTime || !/^\d{2}:\d{2}$/.test(t.scheduledTime)) continue;
    const key = `${t.userId}__${t.scheduledDate}`;
    const start = parseMin(t.scheduledTime);
    const end = start + (t.estimatedDuration || 30);
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key)!.push({ start, end });
  }

  // 4. Trier les cibles par (userId, scheduledDate) pour traiter dans l'ordre
  targets.sort((a, b) => {
    const ua = a.userId.localeCompare(b.userId);
    if (ua !== 0) return ua;
    return (a.scheduledDate || '').localeCompare(b.scheduledDate || '');
  });

  let updated = 0;
  for (const task of targets) {
    if (!task.scheduledDate) continue;
    const duration = task.estimatedDuration || 30;
    const slot = await findSlotForUser(task.userId, task.scheduledDate, duration, prefsMap, occupied);

    const [h, m] = slot.time.split(':').map(Number);
    const endMin = h * 60 + m + duration;
    const endTime = formatMin(endMin);

    await db.update(tasks).set({
      scheduledDate: slot.date,
      scheduledTime: slot.time,
      scheduledEndTime: endTime,
    }).where(eq(tasks.id, task.id));

    console.log(`  ASSIGNED  id=${task.id} "${(task.title || '').substring(0, 40)}" ${task.scheduledDate} → ${slot.date} ${slot.time}`);
    updated++;
  }

  console.log('\n── Résultat ──────────────────────────────────────────────────────');
  console.log(`Tâches mises à jour : ${updated}`);
  console.log('✅  Migration terminée.');
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
