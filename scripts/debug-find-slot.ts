import { db } from '../server/db';
import { tasks, userPreferences } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const userId = 'qNCa68cbCCGcMAcLWmehk';
  const fromDate = '2026-05-15';
  const durationMinutes = 45;

  const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).then(r => r[0] || null);
  console.log('prefs.workDays:', prefs?.workDays);
  console.log('prefs.workDayEnd:', prefs?.workDayEnd);
  console.log('prefs.lunchBreakEnd:', prefs?.lunchBreakEnd);

  const parseMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
  const formatMin = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  const DAY_START = parseMin(prefs?.workDayStart || '09:00');
  const DAY_END = parseMin(prefs?.workDayEnd || '18:00');
  const LUNCH_START = parseMin(prefs?.lunchBreakStart || '12:00');
  const LUNCH_END = parseMin(prefs?.lunchBreakEnd || '13:00');
  const lunchEnabled = prefs?.lunchBreakEnabled !== false;

  const workDaysCsv = prefs?.workDays || 'mon,tue,wed,thu,fri';
  const DAY_ABBRS_LOCAL = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const workDaySet = new Set(workDaysCsv.split(',').map((d: string) => d.trim().toLowerCase()));
  const isWorkDay = (ds: string) => workDaySet.has(DAY_ABBRS_LOCAL[new Date(ds + 'T00:00:00').getDay()]);
  const nextDay = (ds: string): string => {
    const d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  console.log(`\nDAY_START=${DAY_START} DAY_END=${DAY_END} LUNCH=${LUNCH_START}-${LUNCH_END} lunchEnabled=${lunchEnabled}`);

  let currentDate = fromDate;
  for (let guard = 0; guard < 14; guard++) {
    const isWD = isWorkDay(currentDate);
    console.log(`\nGuard ${guard}: ${currentDate} (${isWD ? 'work' : 'skip'})`);
    if (!isWD) { currentDate = nextDay(currentDate); continue; }

    const dayTasks = await db.select({ scheduledTime: tasks.scheduledTime, estimatedDuration: tasks.estimatedDuration })
      .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.scheduledDate, currentDate), eq(tasks.completed, false)));

    const occupied = dayTasks
      .filter(t => t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime))
      .map(t => ({ start: parseMin(t.scheduledTime!), end: parseMin(t.scheduledTime!) + (t.estimatedDuration || 30) }))
      .sort((a, b) => a.start - b.start);

    console.log(`  DB tasks: ${dayTasks.length}, with valid time: ${occupied.length}`);
    console.log(`  Occupied:`, occupied.map(o => `${formatMin(o.start)}-${formatMin(o.end)}`).join(', '));

    let candidate = DAY_START;
    let iterations = 0;
    while (candidate + durationMinutes <= DAY_END && iterations < 200) {
      iterations++;
      const candidateEnd = candidate + durationMinutes;
      if (lunchEnabled && candidate < LUNCH_END && candidateEnd > LUNCH_START) {
        console.log(`    [lunch skip] candidate ${formatMin(candidate)} → ${formatMin(LUNCH_END)}`);
        candidate = LUNCH_END;
        continue;
      }
      const blocking = occupied.find(r => candidate < r.end && candidateEnd > r.start);
      if (!blocking) {
        console.log(`  ✅ Found: ${currentDate} ${formatMin(candidate)}`);
        process.exit(0);
      }
      candidate = blocking.end;
    }
    console.log(`  Day full at candidate=${formatMin(candidate)} (${candidate}+${durationMinutes}=${candidate+durationMinutes} vs ${DAY_END})`);
    currentDate = nextDay(currentDate);
  }

  console.log('\n❌ Fallback reached!');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
