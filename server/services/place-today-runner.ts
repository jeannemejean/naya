import { storage } from "../storage";
import { placeTasksFromNow, minutesToHHMM } from "./day-placement";

// Place les tâches du JOUR restées sans heure dans les créneaux libres à partir de nowMin.
// Partagé par POST /api/tasks/place-today et « Reporter à aujourd'hui ». placeTasksFromNow
// saute les tâches déjà datées (jamais replacées).
export async function runPlaceToday(
  userId: string,
  today: string,
  nowMin: number,
): Promise<{ placed: number; unplaced: number }> {
  const prefs: any = await storage.getUserPreferences(userId);
  const hhmm = (s: string): number => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  const workDayStartStr = prefs?.workDayStart || "09:00";
  const workDayEndStr = prefs?.workDayEnd || "18:00";

  const todayTasks = (await storage.getTasksInRange(userId, today, today))
    .filter((t: any) => t.type !== "milestone" && t.source !== "milestone" && !t.completed);

  const nullTimeCount = (todayTasks as any[]).filter((t) => !t.scheduledTime).length;
  if (nullTimeCount === 0) return { placed: 0, unplaced: 0 };

  const candidates = (todayTasks as any[]).map((t) => ({
    id: t.id as number,
    durationMin: t.estimatedDuration || 30,
    currentScheduledTime: t.scheduledTime ?? null,
  }));

  // Créneaux occupés : tâches déjà datées + pause déjeuner + pauses + agenda Google.
  const used: Array<{ start: number; end: number }> = [];
  for (const t of todayTasks as any[]) {
    if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
      const s = hhmm(t.scheduledTime);
      const e = (t.scheduledEndTime && /^\d{2}:\d{2}$/.test(t.scheduledEndTime)) ? hhmm(t.scheduledEndTime) : s + (t.estimatedDuration || 30);
      used.push({ start: s, end: e });
    }
  }
  if (prefs?.lunchBreakEnabled !== false && prefs?.lunchBreakStart && prefs?.lunchBreakEnd) {
    used.push({ start: hhmm(prefs.lunchBreakStart), end: hhmm(prefs.lunchBreakEnd) });
  }
  for (const b of (Array.isArray(prefs?.breaks) ? prefs.breaks : [])) {
    if (b?.start && b?.end) used.push({ start: hhmm(b.start), end: hhmm(b.end) });
  }
  try {
    const { getCalendarBlockedRanges } = await import("./google-calendar");
    const calRanges = await getCalendarBlockedRanges(userId, today);
    for (const r of calRanges as any[]) used.push({ start: r.start, end: r.end });
  } catch { /* best-effort : agenda absent → ignoré */ }

  const { placed, unplaced } = placeTasksFromNow(candidates, {
    workDayStartMin: hhmm(workDayStartStr),
    workDayEndMin: hhmm(workDayEndStr),
    nowMin,
    usedRanges: used,
  });

  for (const p of placed) {
    await storage.updateTask(p.id, {
      scheduledTime: minutesToHHMM(p.startMin),
      scheduledEndTime: minutesToHHMM(p.endMin),
      scheduledDate: today,
    } as any);
  }
  return { placed: placed.length, unplaced: unplaced.length };
}
