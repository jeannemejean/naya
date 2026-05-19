import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  for (const date of ['2026-05-15', '2026-05-18']) {
    const rows = await db.select({
      id: tasks.id, scheduledTime: tasks.scheduledTime, scheduledEndTime: tasks.scheduledEndTime,
      estimatedDuration: tasks.estimatedDuration, title: tasks.title,
    }).from(tasks).where(and(eq(tasks.userId, 'qNCa68cbCCGcMAcLWmehk'), eq(tasks.scheduledDate, date), eq(tasks.completed, false)));
    rows.sort((a, b) => (a.scheduledTime||'').localeCompare(b.scheduledTime||''));
    console.log(`\n=== ${date} (${rows.length} tasks) ===`);
    for (const t of rows) {
      const s = t.scheduledTime || 'NO-TIME';
      const e = t.scheduledEndTime || '?';
      const flag = e > '18:00' ? ' ⚠️ OVERFLOW' : '';
      console.log(`  id=${t.id} ${s}→${e} (${t.estimatedDuration}min)${flag} "${(t.title||'').substring(0,50)}"`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
