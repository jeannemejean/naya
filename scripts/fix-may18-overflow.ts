import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';

  // Check what's on May 19 already
  const may19 = await db.select({ scheduledTime: tasks.scheduledTime, estimatedDuration: tasks.estimatedDuration })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.scheduledDate, '2026-05-19'), eq(tasks.completed, false)));
  
  const parseMin = (hhmm: string) => { const [h,m] = hhmm.split(':').map(Number); return h*60+(m||0); };
  const formatMin = (min: number) => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
  const LUNCH_START = 720; // 12:00
  const LUNCH_END = 840;  // 14:00 (user pref)
  const skipLunch = (s: number, d: number) => (s < LUNCH_END && s+d > LUNCH_START) ? LUNCH_END : s;

  // Compute occupied on May 19
  const occupied = may19
    .filter(t => t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime))
    .map(t => ({ start: parseMin(t.scheduledTime!), end: parseMin(t.scheduledTime!) + (t.estimatedDuration || 30) }))
    .sort((a, b) => a.start - b.start);
  
  let cursor = 540; // 09:00
  if (occupied.length > 0) cursor = Math.max(...occupied.map(o => o.end)) + 5;

  // Move tasks 139 and 133 to May 19
  for (const [taskId, dur] of [[139, 45], [133, 40]] as [number, number][]) {
    const start = skipLunch(cursor, dur);
    const end = start + dur;
    await db.update(tasks).set({ scheduledDate: '2026-05-19', scheduledTime: formatMin(start), scheduledEndTime: formatMin(end) })
      .where(eq(tasks.id, taskId));
    console.log(`  MOVED id=${taskId} → May19 ${formatMin(start)}→${formatMin(end)} (${dur}min)`);
    cursor = end + 5;
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
