import { db } from '../server/db';
import { tasks, userPreferences } from '../shared/schema';
import { eq, and, lt, isNotNull } from 'drizzle-orm';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const today = '2026-05-17';

  // P1: workDays value
  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).then(r => r[0]);
  console.log('=== P1: workDays ===');
  console.log(`workDays: "${prefs?.workDays}"`);
  console.log(`planningStatus: "${prefs?.planningStatus}"`);
  console.log(`planningPausedAt: "${prefs?.planningPausedAt}"`);

  // P1: tasks on weekend
  const weekendTasks = await db.execute({
    sql: `SELECT id, title, scheduled_date, scheduled_time, completed FROM tasks 
          WHERE user_id = $1 AND completed = false AND scheduled_date IS NOT NULL
          AND (EXTRACT(DOW FROM scheduled_date::date) IN (0, 6))
          ORDER BY scheduled_date`,
    args: [userId]
  } as any).catch(() => null);

  // Alternative approach
  const allTasks = await db.select({
    id: tasks.id, title: tasks.title, scheduledDate: tasks.scheduledDate, 
    scheduledTime: tasks.scheduledTime, completed: tasks.completed
  }).from(tasks).where(and(eq(tasks.userId, userId), isNotNull(tasks.scheduledDate), eq(tasks.completed, false)));
  
  const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const workDaySet = new Set((prefs?.workDays || 'mon,tue,wed,thu,fri').split(',').map(d => d.trim()));
  
  const onWeekend = allTasks.filter(t => {
    if (!t.scheduledDate) return false;
    const dow = new Date(t.scheduledDate + 'T00:00:00').getDay();
    return !workDaySet.has(DAY_ABBRS[dow]);
  });
  console.log(`\nTâches sur jours non-ouvrés: ${onWeekend.length}`);
  for (const t of onWeekend) console.log(`  id=${t.id} ${t.scheduledDate} (${DAY_ABBRS[new Date(t.scheduledDate!+'T00:00:00').getDay()]}) "${(t.title||'').substring(0,50)}"`);

  // P2: overdue tasks
  console.log('\n=== P2: Tâches en retard (avant aujourd\'hui) ===');
  const overdue = allTasks.filter(t => t.scheduledDate && t.scheduledDate < today);
  console.log(`Tâches overdue: ${overdue.length}`);
  for (const t of overdue) console.log(`  id=${t.id} ${t.scheduledDate} ${t.scheduledTime || 'NO-TIME'} "${(t.title||'').substring(0,50)}"`);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
