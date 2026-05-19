import { db } from '../server/db';
import { tasks, userPreferences } from '../shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const today = '2026-05-17';
  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).then(r => r[0]);
  
  const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const workDaySet = new Set((prefs?.workDays || 'mon,tue,wed,thu,fri').split(',').map((d: string) => d.trim()));
  
  const allTasks = await db.select({
    id: tasks.id, title: tasks.title, scheduledDate: tasks.scheduledDate,
    scheduledTime: tasks.scheduledTime, completed: tasks.completed,
  }).from(tasks).where(and(eq(tasks.userId, userId), isNotNull(tasks.scheduledDate), eq(tasks.completed, false)));

  console.log('=== P1: workDays =', prefs?.workDays);
  const onWeekend = allTasks.filter(t => {
    const dow = new Date(t.scheduledDate! + 'T00:00:00').getDay();
    return !workDaySet.has(DAY_ABBRS[dow]);
  });
  console.log(`Tâches sur jours non-ouvrés: ${onWeekend.length}`);
  for (const t of onWeekend) {
    const dow = new Date(t.scheduledDate! + 'T00:00:00').getDay();
    console.log(`  id=${t.id} ${t.scheduledDate} (${DAY_ABBRS[dow]}) "${(t.title||'').substring(0,50)}"`);
  }

  console.log('\n=== P2: Tâches en retard (< today ' + today + ') ===');
  const overdue = allTasks.filter(t => t.scheduledDate! < today);
  console.log(`Total: ${overdue.length}`);
  for (const t of overdue) console.log(`  id=${t.id} ${t.scheduledDate} ${t.scheduledTime || 'NO-TIME'} "${(t.title||'').substring(0,50)}"`);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
