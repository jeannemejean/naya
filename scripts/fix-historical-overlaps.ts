/**
 * One-shot migration: réordonne toutes les tâches historiques qui se chevauchent.
 * Pour chaque (user_id, scheduled_date), trie par scheduled_time et décale en chaîne.
 * Ne touche pas aux tâches complétées ni aux tâches sans scheduled_time.
 */
import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

const BUFFER_MIN = 5;   // minutes entre deux tâches
const DAY_END_MIN = 18 * 60; // 18:00 — cap maximum

function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

async function main() {
  console.log('── Naya historical overlap migration ─────────────────────────────');

  // Charge toutes les tâches incomplètes avec un scheduled_time
  const allTasks = await db.select({
    id: tasks.id,
    userId: tasks.userId,
    scheduledDate: tasks.scheduledDate,
    scheduledTime: tasks.scheduledTime,
    estimatedDuration: tasks.estimatedDuration,
    title: tasks.title,
  }).from(tasks).where(
    and(
      eq(tasks.completed, false),
      isNotNull(tasks.scheduledDate),
      isNotNull(tasks.scheduledTime),
    )
  );

  console.log(`Tâches chargées : ${allTasks.length}`);

  // Groupe par (userId, scheduledDate)
  const groups = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    if (!t.scheduledDate || !t.scheduledTime || !/^\d{2}:\d{2}$/.test(t.scheduledTime)) continue;
    const key = `${t.userId}__${t.scheduledDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  console.log(`Groupes (user × date) : ${groups.size}`);

  let totalFixed = 0;
  let groupsWithOverlap = 0;

  for (const [key, group] of Array.from(groups.entries())) {
    // Trie par heure croissante
    group.sort((a, b) => parseMin(a.scheduledTime!) - parseMin(b.scheduledTime!));

    let cursor = -1;
    let hadOverlap = false;

    for (const task of group) {
      const start = parseMin(task.scheduledTime!);
      const dur = task.estimatedDuration || 30;

      if (cursor !== -1 && start < cursor) {
        // Chevauchement détecté
        hadOverlap = true;
        if (cursor + dur <= DAY_END_MIN) {
          // Décale à cursor si ça rentre dans la journée
          const newStart = cursor;
          const newEnd = newStart + dur;
          await db.update(tasks).set({
            scheduledTime: formatMin(newStart),
            scheduledEndTime: formatMin(newEnd),
          }).where(eq(tasks.id, task.id));
          console.log(`  MOVED   id=${task.id} "${(task.title||'').substring(0,40)}" ${task.scheduledDate} ${task.scheduledTime} → ${formatMin(newStart)}`);
          cursor = newEnd + BUFFER_MIN;
        } else {
          // Plus de place dans la journée → dé-planifie
          await db.update(tasks).set({
            scheduledTime: null,
            scheduledEndTime: null,
          }).where(eq(tasks.id, task.id));
          console.log(`  UNSCHD  id=${task.id} "${(task.title||'').substring(0,40)}" ${task.scheduledDate} — overflow`);
          cursor = DAY_END_MIN; // bloque le reste
        }
        totalFixed++;
      } else {
        cursor = start + dur + BUFFER_MIN;
      }
    }

    if (hadOverlap) groupsWithOverlap++;
  }

  console.log('\n── Résultat ───────────────────────────────────────────────────────');
  console.log(`Groupes avec chevauchements : ${groupsWithOverlap}`);
  console.log(`Tâches déplacées            : ${totalFixed}`);
  console.log(totalFixed === 0 ? '✅  Aucun chevauchement historique trouvé.' : `✅  Migration terminée — ${totalFixed} tâches réordonnées.`);
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
