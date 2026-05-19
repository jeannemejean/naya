import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

async function main() {
  const rows = await db.select({
    id: tasks.id, scheduledTime: tasks.scheduledTime,
    scheduledEndTime: tasks.scheduledEndTime,
    estimatedDuration: tasks.estimatedDuration,
    title: tasks.title, completed: tasks.completed,
  }).from(tasks).where(and(
    eq(tasks.userId, 'qNCa68cbCCGcMAcLWmehk'),
    eq(tasks.scheduledDate, '2026-05-15'),
  ));

  rows.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
  console.log(`Total tasks on 2026-05-15: ${rows.length}`);
  for (const t of rows) {
    console.log(`  id=${t.id} ${t.scheduledTime || 'NO-TIME'} → ${t.scheduledEndTime || '?'} (${t.estimatedDuration}min) [${t.completed ? '✓' : ' '}] "${(t.title||'').substring(0,50)}"`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
