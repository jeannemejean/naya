/**
 * Naya Auto-Planner
 * ─────────────────────────────────────────────────────────────────
 * Runs silently every morning at 06:00 for every onboarded user.
 * Generates the day's tasks automatically — no button, no friction.
 *
 * Rules (non-negotiable):
 * 1. Never overwrite existing tasks for a day that already has ≥2 tasks
 * 2. Never generate tasks for a locked milestone
 * 3. Never generate on a non-work day (respects userPreferences.workDays)
 * 4. Collision-safe: seeds slot from the end of the last existing task
 * 5. Silently skips users on error — one failure must not block others
 */

import { storage } from '../storage';
import { generateDailyTasks } from './openai';
import { buildNayaContext } from './naya-context';
import { CLAUDE_MODELS } from './claude';
import { getCalendarBlockedRanges } from './google-calendar';

// Guard: prevents concurrent auto-planner runs from exhausting the DB pool
let isAutoplannerRunning = false;

// ─── Helpers ─────────────────────────────────────────────────────

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseWorkDays(csv: string | null | undefined): Set<string> {
  if (!csv) return new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  return new Set(csv.toLowerCase().split(',').map(s => s.trim()));
}

function dayOfWeekName(dateStr: string): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date(dateStr + 'T00:00:00').getDay()];
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Rollover: déplace les tâches incomplètes des jours passés ───

/**
 * Prend toutes les tâches incomplètes planifiées AVANT aujourd'hui
 * et les déplace sur aujourd'hui (ou le prochain jour de travail),
 * en réassignant les créneaux horaires séquentiellement.
 *
 * Cap: max 6 tâches ramenées par exécution pour ne pas surcharger.
 */
/**
 * Construit la liste des plages bloquées d'une journée :
 * tâches existantes + pause déjeuner (si activée).
 */
function buildBlockedRanges(
  existingTasks: any[],
  prefs: any
): Array<{ start: number; end: number }> {
  const blocked: Array<{ start: number; end: number }> = [];

  // Tâches déjà planifiées
  for (const t of existingTasks) {
    if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
      const start = hhmmToMin(t.scheduledTime);
      blocked.push({ start, end: start + ((t.estimatedDuration as number) || 30) });
    }
  }

  // Pause déjeuner
  if (prefs?.lunchBreakEnabled !== false) {
    const lunchStart = hhmmToMin(prefs?.lunchBreakStart || '12:00');
    const lunchEnd   = hhmmToMin(prefs?.lunchBreakEnd   || '13:00');
    if (lunchEnd > lunchStart) blocked.push({ start: lunchStart, end: lunchEnd });
  }

  return blocked;
}

/**
 * Trouve le prochain créneau libre ≥ fromMin qui ne chevauche aucune plage bloquée
 * et se termine avant dayEndMin. Retourne -1 si impossible.
 */
function findNextFreeSlot(
  fromMin: number,
  duration: number,
  blocked: Array<{ start: number; end: number }>,
  dayEndMin: number
): number {
  let slot = fromMin;
  let safety = 0;
  while (safety < 48) { // max 48 tentatives (24h × 2)
    const overlapping = blocked.find(r => slot < r.end && slot + duration > r.start);
    if (!overlapping) break;
    slot = overlapping.end; // saute après le bloc
    safety++;
  }
  return slot + duration <= dayEndMin ? slot : -1;
}

function nextWorkDay(fromDate: string, workDays: Set<string>): string {
  const d = new Date(fromDate + 'T00:00:00');
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1);
    const name = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
    if (workDays.has(name)) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return fromDate; // fallback (ne devrait pas arriver)
}

export async function rolloverStaleTasks(
  userId: string,
  targetDate: string
): Promise<{ moved: number }> {
  const prefs = await storage.getUserPreferences(userId);
  const workDays = parseWorkDays(prefs?.workDays);
  const workDayStart = (prefs as any)?.workDayStart || '09:00';
  const workDayEnd = (prefs as any)?.workDayEnd || '18:00';
  const dayEndMin = hhmmToMin(workDayEnd);

  // Si on est après workDayEnd - 60 min, planifier sur le prochain jour ouvré
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isLateInDay = nowMin >= dayEndMin - 60;

  const scheduleDate = isLateInDay
    ? nextWorkDay(targetDate, workDays)
    : (workDays.has(dayOfWeekName(targetDate)) ? targetDate : nextWorkDay(targetDate, workDays));

  // Charger toutes les tâches incomplètes d'avant targetDate (30 jours de lookback)
  const lookbackDate = (() => {
    const d = new Date(targetDate + 'T00:00:00');
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const yesterday = (() => {
    const d = new Date(targetDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Inclure également les tâches d'aujourd'hui dans le passé (si on planifie sur demain)
  const rangeEnd = isLateInDay ? targetDate : yesterday;

  const staleTasks = await storage.getTasksInRange(userId, lookbackDate, rangeEnd).catch(() => []);

  const incomplete = (staleTasks as any[])
    .filter(t => !t.completed && t.scheduledDate && t.scheduledDate <= rangeEnd)
    .sort((a, b) => (a.priority || 5) - (b.priority || 5))
    .slice(0, 8); // cap à 8 quand on a plus de place

  if (incomplete.length === 0) return { moved: 0 };

  // Créneaux déjà occupés sur scheduleDate + pause déjeuner + calendrier Google
  const scheduledDayTasks = await storage.getTasksInRange(userId, scheduleDate, scheduleDate).catch(() => []);
  const blockedRanges = buildBlockedRanges(scheduledDayTasks as any[], prefs);
  const calBlocked = await getCalendarBlockedRanges(userId, scheduleDate).catch(() => []);
  blockedRanges.push(...calBlocked);

  // Point de départ : après le dernier créneau existant, jamais dans le passé
  const latestExisting = blockedRanges.reduce((max, r) => Math.max(max, r.end), hhmmToMin(workDayStart));
  const isSchedulingToday = scheduleDate === targetDate;
  const minSlot = isSchedulingToday ? Math.max(nowMin + 15, latestExisting) : latestExisting;
  let curSlot = minSlot;

  let moved = 0;
  for (const task of incomplete) {
    const duration = task.estimatedDuration || 30;

    const slot = findNextFreeSlot(curSlot, duration, blockedRanges, dayEndMin);
    if (slot === -1) continue; // plus de place ce jour-là

    await storage.updateTask(task.id, {
      scheduledDate: scheduleDate,
      scheduledTime: minToHHMM(slot),
    });

    blockedRanges.push({ start: slot, end: slot + duration });
    curSlot = slot + duration + 5;
    moved++;
  }

  console.log(`[AutoPlanner] Rollover for ${userId}: moved ${moved} stale tasks → ${scheduleDate}`);
  return { moved };
}

// ─── Core: generate tasks for one user on a given date ───────────

async function generateForUser(userId: string, dateStr: string): Promise<void> {
  // 1. Load brand DNA — skip user if not onboarded
  const brandDna = await storage.getBrandDna(userId);
  if (!brandDna) return;

  // 2. Load preferences
  const prefs = await storage.getUserPreferences(userId);
  const workDays = parseWorkDays(prefs?.workDays);

  // 3. Check if today is a work day
  const dayName = dayOfWeekName(dateStr);
  if (!workDays.has(dayName)) return;

  // 4. Check availability overrides
  const avail = await storage.getDayAvailability(userId, dateStr).catch(() => null);
  if (avail?.dayType === 'off') return;

  // 5. Check how many tasks already exist for this date
  const existingTasks = await storage.getTasks(userId, new Date(dateStr + 'T00:00:00'));
  const scheduledForToday = (existingTasks as any[]).filter(
    (t: any) => t.scheduledDate === dateStr && !t.completed
  );
  if (scheduledForToday.length > 0) return; // Journée déjà planifiée — ne pas régénérer

  // 6. Load active milestones to enforce conditional blocking
  const projects = await storage.getProjects(userId);
  const activeMilestoneProjectIds = new Set<number>();
  const allMilestones = await Promise.all(
    projects.map(p => storage.getMilestones(p.id, userId).catch(() => [] as any[]))
  );
  projects.forEach((project, i) => {
    const milestones = allMilestones[i];
    const hasActiveMilestone = milestones.some((m: any) =>
      ['unlocked', 'active'].includes(m.status)
    );
    if (hasActiveMilestone || milestones.length === 0) {
      activeMilestoneProjectIds.add(project.id);
    }
  });

  // 7. Determine which projects to generate for
  const activeProjectId = prefs?.activeProjectId ?? null;
  const projectsToProcess = activeProjectId
    ? projects.filter(p => p.id === activeProjectId)
    : projects.filter(p => activeMilestoneProjectIds.has(p.id)).slice(0, 3);

  if (projectsToProcess.length === 0 && projects.length > 0) {
    // All projects have locked milestones — generate general tasks
    projectsToProcess.push(projects[0]);
  }

  // 8. Load context data
  const [recentContent, recentOutreach] = await Promise.all([
    storage.getContent(userId, 10).catch(() => []),
    storage.getOutreachMessages(userId).catch(() => []),
  ]);

  const workDayStart = (prefs as any)?.workDayStart || '09:00';
  const workDayEnd = (prefs as any)?.workDayEnd || '18:00';

  // Dynamic capacity: actual available work time × energy factor ÷ avg task duration
  const workStartMin = hhmmToMin(workDayStart);
  const workEndMin   = hhmmToMin(workDayEnd);
  const totalWorkMin = workEndMin - workStartMin;

  const lunchEnabled  = (prefs as any)?.lunchBreakEnabled !== false;
  const lunchStartMin = hhmmToMin((prefs as any)?.lunchBreakStart || '12:00');
  const lunchEndMin   = hhmmToMin((prefs as any)?.lunchBreakEnd   || '13:00');
  const lunchMin = lunchEnabled ? Math.max(0, lunchEndMin - lunchStartMin) : 0;

  const availableMin = Math.max(60, totalWorkMin - lunchMin);

  const energyFactor =
    prefs?.currentEnergyLevel === 'depleted' ? 0.4 :
    prefs?.currentEnergyLevel === 'low'      ? 0.6 :
    prefs?.currentEnergyLevel === 'medium'   ? 0.8 :
    1.0;

  const AVG_TASK_MIN = 45;
  const dynamicMaxTotal = Math.max(1, Math.min(8, Math.floor((availableMin * energyFactor) / AVG_TASK_MIN)));
  const maxTasksPerProject = Math.max(1, Math.floor(dynamicMaxTotal / Math.max(projectsToProcess.length, 1)));

  // 9. Slot-collision guard: tâches existantes + pause déjeuner + calendrier Google
  const blockedRanges = buildBlockedRanges(scheduledForToday, prefs);
  const calBlocked = await getCalendarBlockedRanges(userId, dateStr).catch(() => []);
  blockedRanges.push(...calBlocked);
  const latestEnd = blockedRanges.reduce((max, r) => Math.max(max, r.end), hhmmToMin(workDayStart));
  let curSlot = latestEnd;

  // 10. Generate and persist tasks for each project
  for (const project of projectsToProcess) {
    try {
      // Build full context for this project
      const projectData = project.id ? await storage.getProject(project.id, userId) : null;
      const activeGoals = project.id
        ? await storage.getActiveGoalsForProject(project.id).catch(() => [])
        : [];
      const stratProfile = project.id
        ? await storage.getProjectStrategyProfile(project.id).catch(() => null)
        : null;

      const projectContext = projectData ? {
        projectId: projectData.id,
        projectType: projectData.type,
        projectName: projectData.name,
        monetizationIntent: projectData.monetizationIntent,
        activeGoalTitle: activeGoals[0]?.title,
        activeGoalSuccessMode: activeGoals[0]?.successMode,
        currentStage: (stratProfile as any)?.currentStage,
      } : undefined;

      const result = await generateDailyTasks({
        userId,
        projectContext: projectContext as any,
        brandDna: {
          businessType: brandDna.businessType,
          businessModel: brandDna.businessModel,
          revenueUrgency: brandDna.revenueUrgency,
          targetAudience: brandDna.targetAudience,
          corePainPoint: brandDna.corePainPoint,
          audienceAspiration: brandDna.audienceAspiration,
          authorityLevel: brandDna.authorityLevel,
          communicationStyle: brandDna.communicationStyle,
          uniquePositioning: brandDna.uniquePositioning,
          platformPriority: brandDna.platformPriority,
          currentPresence: brandDna.currentPresence,
          primaryGoal: brandDna.primaryGoal,
          contentBandwidth: brandDna.contentBandwidth,
          successDefinition: brandDna.successDefinition,
          offers: brandDna.offers || '',
          businessName: brandDna.businessName ?? undefined,
          editorialTerritory: brandDna.editorialTerritory || '',
          brandVoiceKeywords: brandDna.brandVoiceKeywords as string[] || [],
          brandVoiceAntiKeywords: brandDna.brandVoiceAntiKeywords as string[] || [],
          activeBusinessPriority: brandDna.activeBusinessPriority || '',
          revenueTarget: brandDna.revenueTarget || '',
        },
        recentContent: recentContent as any[],
        recentOutreach: recentOutreach as any[],
        activeGoals: activeGoals.map(g => ({
          id: g.id,
          title: g.title,
          successMode: g.successMode,
          goalType: g.goalType,
          dueDate: g.dueDate ?? null,
        })),
        weeklyGoals: {},
        completedTasksToday: [],
        workDayStart,
        workDayEnd,
        maxTasks: maxTasksPerProject,
      });

      if (!result || !Array.isArray((result as any).tasks)) continue;

      // Persist tasks with collision-safe slot assignment (respects lunch break)
      for (const taskData of (result as any).tasks) {
        const duration = taskData.estimatedDuration || 30;
        const workEndMin = hhmmToMin(workDayEnd);

        const slotMin = findNextFreeSlot(curSlot, duration, blockedRanges, workEndMin);
        if (slotMin === -1) continue; // plus de place ce jour-là

        const scheduledTime = minToHHMM(slotMin);
        blockedRanges.push({ start: slotMin, end: slotMin + duration });
        curSlot = slotMin + duration + 5; // 5-min buffer

        await storage.createTask({
          userId,
          projectId: project.id ?? undefined,
          goalId: (() => {
            const idx = typeof (taskData as any).goalIndex === 'number' ? (taskData as any).goalIndex : 0;
            return activeGoals[idx]?.id ?? activeGoals[0]?.id ?? undefined;
          })(),
          title: taskData.title,
          description: taskData.description || '',
          type: taskData.type || 'planning',
          category: taskData.category || 'planning',
          priority: taskData.priority || 3,
          estimatedDuration: duration,
          scheduledDate: dateStr,
          scheduledTime,
          taskEnergyType: taskData.taskEnergyType || 'execution',
          setupCost: taskData.setupCost || 'low',
          canBeFragmented: taskData.canBeFragmented ?? false,
          recommendedTimeOfDay: taskData.recommendedTimeOfDay || 'morning',
          activationPrompt: taskData.activationPrompt || null,
          source: 'auto',
          completed: false,
        } as any);
      }
    } catch (projectError: any) {
      console.error(`[AutoPlanner] Error generating for project ${project.id}:`, projectError.message);
      // Continue with next project
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Run auto-planning for all onboarded users.
 * Called by the cron job and optionally via admin endpoint.
 */
/** Génère la liste des N prochains jours de travail à partir de startDate. */
function nextWorkingDates(startDate: string, count: number, workDays: Set<string>): string[] {
  const dates: string[] = [];
  const d = new Date(startDate + 'T00:00:00');
  while (dates.length < count) {
    const name = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (workDays.has(name)) dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export async function runDailyAutoPlanner(dateStr?: string): Promise<{ processed: number; skipped: number; errors: number }> {
  if (isAutoplannerRunning) {
    console.log('[AutoPlanner] Already running, skipping concurrent invocation');
    return { processed: 0, skipped: 0, errors: 0 };
  }
  isAutoplannerRunning = true;

  const startDate = dateStr || todayString();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const userIds = await storage.getActiveUserIds();
    console.log(`[AutoPlanner] Starting run from ${startDate} — ${userIds.length} users`);

    for (const userId of userIds) {
      try {
        // 1. Rollover des tâches incomplètes des jours passés
        await rolloverStaleTasks(userId, startDate).catch(e =>
          console.error(`[AutoPlanner] Rollover failed for ${userId}:`, e.message)
        );

        // 2. Générer les 7 prochains jours de travail
        const prefs = await storage.getUserPreferences(userId);
        const workDays = parseWorkDays(prefs?.workDays);
        const dates = nextWorkingDates(startDate, 7, workDays);

        for (const date of dates) {
          await generateForUser(userId, date).catch(e =>
            console.error(`[AutoPlanner] Generate failed for ${userId} on ${date}:`, e.message)
          );
        }

        processed++;
      } catch (err: any) {
        console.error(`[AutoPlanner] Failed for user ${userId}:`, err.message);
        errors++;
      }
    }

    console.log(`[AutoPlanner] Done — processed: ${processed}, skipped: ${skipped}, errors: ${errors}`);
  } finally {
    // Always release the guard, even if an unexpected error occurs
    isAutoplannerRunning = false;
  }

  return { processed, skipped, errors };
}

/**
 * Schedule the auto-planner to run every day at 06:00 server time.
 * Call once on server startup.
 */
export function scheduleAutoPlanner(): void {
  const scheduleNextRun = () => {
    const now = new Date();
    const next6am = new Date(now);
    next6am.setUTCHours(6, 0, 0, 0);

    // If 6am UTC already passed today, schedule for tomorrow
    if (next6am <= now) {
      next6am.setDate(next6am.getDate() + 1);
    }

    const msUntil6am = next6am.getTime() - now.getTime();
    console.log(`[AutoPlanner] Next morning run at ${next6am.toISOString()} (in ${Math.round(msUntil6am / 60000)}min)`);

    setTimeout(async () => {
      try {
        await runDailyAutoPlanner();
      } catch (err) {
        console.error('[AutoPlanner] Error during daily run:', err);
      }
      scheduleNextRun();
    }, msUntil6am);
  };

  scheduleNextRun();
}

/**
 * End-of-day rollover: moves all incomplete tasks from today → next work day.
 * Runs at 17:00 UTC (= ~19:00 Paris / CEST).
 */
async function runEndOfDayRollover(): Promise<void> {
  const today = todayString();
  const userIds = await storage.getActiveUserIds().catch(() => [] as string[]);
  console.log(`[Rollover] End-of-day run for ${userIds.length} users`);

  for (const userId of userIds) {
    try {
      const prefs = await storage.getUserPreferences(userId);
      const workDays = parseWorkDays(prefs?.workDays);

      // Tâches incomplètes de today et avant (lookback 30j)
      const lookback = (() => {
        const d = new Date(today + 'T00:00:00');
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      })();

      const staleTasks = await storage.getTasksInRange(userId, lookback, today).catch(() => []);
      const incomplete = (staleTasks as any[]).filter(t => !t.completed && t.scheduledDate && t.scheduledDate <= today);

      if (incomplete.length === 0) continue;

      // Toujours planifier sur le prochain jour de travail (la journée est terminée)
      const scheduleDate = nextWorkDay(today, workDays);
      const scheduledDayTasks = await storage.getTasksInRange(userId, scheduleDate, scheduleDate).catch(() => []);
      const blockedRanges = buildBlockedRanges(scheduledDayTasks as any[], prefs);
      const calBlocked = await getCalendarBlockedRanges(userId, scheduleDate).catch(() => []);
      blockedRanges.push(...calBlocked);

      const workDayStart = (prefs as any)?.workDayStart || '09:00';
      const workDayEnd = (prefs as any)?.workDayEnd || '18:00';
      const dayEndMin = hhmmToMin(workDayEnd);

      let curSlot = blockedRanges.reduce((max, r) => Math.max(max, r.end), hhmmToMin(workDayStart));

      let moved = 0;
      for (const task of incomplete.sort((a: any, b: any) => (a.priority || 5) - (b.priority || 5))) {
        const dur = task.estimatedDuration || 30;
        // Sauter les plages bloquées
        let attempts = 0;
        while (attempts++ < 20) {
          const overlap = blockedRanges.find(r => curSlot < r.end && curSlot + dur > r.start);
          if (!overlap) break;
          curSlot = overlap.end;
        }
        if (curSlot + dur > dayEndMin) break; // plus de place

        const newTime = minToHHMM(curSlot);
        await storage.updateTask(task.id, {
          scheduledDate: scheduleDate,
          scheduledTime: newTime,
        }).catch(e => console.error(`[Rollover] updateTask ${task.id} failed:`, e.message));

        blockedRanges.push({ start: curSlot, end: curSlot + dur });
        curSlot += dur;
        moved++;
      }

      if (moved > 0) console.log(`[Rollover] Moved ${moved} tasks → ${scheduleDate} for user ${userId}`);
    } catch (err: any) {
      console.error(`[Rollover] Error for user ${userId}:`, err.message);
    }
  }
}

export function scheduleEndOfDayRollover(): void {
  const scheduleNextRun = () => {
    const now = new Date();
    // 17:00 UTC = ~19:00 Paris (CEST, UTC+2)
    const next17utc = new Date(now);
    next17utc.setUTCHours(17, 0, 0, 0);

    if (next17utc <= now) {
      next17utc.setDate(next17utc.getDate() + 1);
    }

    const msUntil = next17utc.getTime() - now.getTime();
    console.log(`[Rollover] Next end-of-day run at ${next17utc.toISOString()} (in ${Math.round(msUntil / 60000)}min)`);

    setTimeout(async () => {
      try {
        await runEndOfDayRollover();
      } catch (err) {
        console.error('[Rollover] Error during end-of-day run:', err);
      }
      scheduleNextRun();
    }, msUntil);
  };

  scheduleNextRun();
}
