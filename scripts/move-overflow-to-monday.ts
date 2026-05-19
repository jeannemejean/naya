/**
 * Déplace les tâches qui débordent du 15 mai vers le lundi 18 mai.
 * Calcule des créneaux séquentiels propres sans passer par findFirstFreeSlot.
 */
import { db } from '../server/db';
import { tasks } from '../shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

function parseMin(hhmm: string) { const [h,m]=hhmm.split(':').map(Number); return h*60+(m||0); }
function formatMin(min: number) { return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const WORK_START = parseMin('09:00');
  const WORK_END = parseMin('18:00');
  const LUNCH_START = parseMin('12:00');
  const LUNCH_END = parseMin('14:00'); // actual user pref
  const BUFFER = 5;

  // Step 1: Reset all May 15 tasks — nullify time, then resequence
  const may15 = await db.select({
    id: tasks.id, scheduledTime: tasks.scheduledTime, estimatedDuration: tasks.estimatedDuration, title: tasks.title,
  }).from(tasks).where(and(
    eq(tasks.userId, userId), eq(tasks.scheduledDate, '2026-05-15'), eq(tasks.completed, false)
  ));

  console.log(`Total tâches May 15: ${may15.length}`);

  // Sort by current time (or id as tiebreaker)
  may15.sort((a, b) => {
    const ta = a.scheduledTime ? parseMin(a.scheduledTime) : 9999;
    const tb = b.scheduledTime ? parseMin(b.scheduledTime) : 9999;
    return ta - tb || a.id - b.id;
  });

  // Assign sequential slots on May 15 and May 18
  let cursor = WORK_START;
  let currentDate = '2026-05-15';

  const skipLunch = (start: number, dur: number) => {
    if (start < LUNCH_END && start + dur > LUNCH_START) return LUNCH_END;
    return start;
  };

  const advanceIfFull = (start: number, dur: number): { date: string; start: number } => {
    if (start + dur <= WORK_END) return { date: currentDate, start };
    // Overflow → Monday May 18
    return { date: '2026-05-18', start: WORK_START };
  };

  let may18Cursor = WORK_START;

  for (const task of may15) {
    const dur = task.estimatedDuration || 30;
    const adjusted = skipLunch(cursor, dur);

    if (adjusted + dur <= WORK_END) {
      // Fits on May 15
      const endTime = formatMin(adjusted + dur);
      await db.update(tasks).set({ scheduledDate: '2026-05-15', scheduledTime: formatMin(adjusted), scheduledEndTime: endTime })
        .where(eq(tasks.id, task.id));
      console.log(`  May15  id=${task.id} ${formatMin(adjusted)}→${endTime} (${dur}min) "${(task.title||'').substring(0,45)}"`);
      cursor = adjusted + dur + BUFFER;
    } else {
      // Move to May 18
      const may18Start = skipLunch(may18Cursor, dur);
      const endTime = formatMin(may18Start + dur);
      await db.update(tasks).set({ scheduledDate: '2026-05-18', scheduledTime: formatMin(may18Start), scheduledEndTime: endTime })
        .where(eq(tasks.id, task.id));
      console.log(`  May18  id=${task.id} ${formatMin(may18Start)}→${endTime} (${dur}min) "${(task.title||'').substring(0,45)}"`);
      may18Cursor = may18Start + dur + BUFFER;
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
