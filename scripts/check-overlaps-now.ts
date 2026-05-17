import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';

async function main() {
  const rows = await db.select({
    id: tasks.id, userId: tasks.userId,
    scheduledDate: tasks.scheduledDate, scheduledTime: tasks.scheduledTime,
    estimatedDuration: tasks.estimatedDuration, title: tasks.title,
  }).from(tasks).where(and(eq(tasks.completed, false), isNotNull(tasks.scheduledDate), isNotNull(tasks.scheduledTime)));

  const parseMin = (hhmm: string) => { const [h,m] = hhmm.split(':').map(Number); return h*60+(m||0); };
  const fmt = (min: number) => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;

  const groups = new Map<string, typeof rows>();
  for (const t of rows) {
    if (!t.scheduledDate || !t.scheduledTime || !/^\d{2}:\d{2}$/.test(t.scheduledTime)) continue;
    const k = `${t.userId}__${t.scheduledDate}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  let overlapCount = 0;
  for (const [key, group] of Array.from(groups.entries())) {
    group.sort((a, b) => parseMin(a.scheduledTime!) - parseMin(b.scheduledTime!));
    let cursor = -1;
    for (const t of group) {
      const start = parseMin(t.scheduledTime!);
      const end = start + (t.estimatedDuration || 30);
      if (cursor !== -1 && start < cursor) {
        console.log(`OVERLAP [${key}] id=${t.id} ${t.scheduledTime}→${fmt(end)} (cursor=${fmt(cursor)}) "${(t.title||'').substring(0,40)}"`);
        overlapCount++;
      }
      cursor = end;
    }
  }

  if (overlapCount === 0) console.log('✅  Aucun chevauchement en DB.');
  else console.log(`\n❌  ${overlapCount} chevauchements.`);

  // Tâches sans heure restantes
  const withoutTime = await db.select({ id: tasks.id, scheduledDate: tasks.scheduledDate, title: tasks.title })
    .from(tasks).where(and(eq(tasks.completed, false), isNotNull(tasks.scheduledDate), isNull(tasks.scheduledTime)));
  if (withoutTime.length > 0) {
    console.log(`\n⚠️  ${withoutTime.length} tâches sans heure restantes :`);
    for (const t of withoutTime) console.log(`  id=${t.id} ${t.scheduledDate} "${(t.title||'').substring(0,40)}"`);
  } else {
    console.log('✅  Aucune tâche sans heure restante.');
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
