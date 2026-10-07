// Placement d'une campagne dans l'agenda : tâches (phases, sous-tâches, jours travaillés,
// indisponibilités, 3 tâches par jour, créneaux) et posts (répartis par semaine).
//
// Extrait des routes `/launch`, `/regenerate-content` et `/redeploy`, qui en portaient
// chacune une copie. Comportement conservé tel quel ; ce qui diffère entre les routes est
// passé en paramètre (fenêtre [debut, fin], contrôle de créneaux en base).
import { formatDate as campaignDateToStr, addDays as campaignAddDays } from "../../utils/dateUtils";

export const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_WORK_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);

export function parseWorkDays(csv: string | null | undefined): Set<string> {
  if (csv === null || csv === undefined) return DEFAULT_WORK_DAYS;
  if (csv.trim() === '') return new Set<string>();
  const days = csv.split(',').map(d => d.trim().toLowerCase()).filter(d => DAY_ABBRS.includes(d));
  return new Set(days);
}

export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function computePhaseRanges(
  phases: Array<{ number: number }>,
  startDate: Date,
  campaignDurationDays: number
): Record<number, { start: Date; end: Date }> {
  const sorted = [...phases].sort((a, b) => a.number - b.number);
  const totalPhases = sorted.length;
  if (totalPhases === 0) return {};
  const daysPerPhase = Math.max(1, Math.floor(campaignDurationDays / totalPhases));
  const result: Record<number, { start: Date; end: Date }> = {};

  sorted.forEach((phase, idx) => {
    const phaseStartDay = idx * daysPerPhase;
    const isLast = idx === totalPhases - 1;
    const phaseEndDay = isLast ? campaignDurationDays - 1 : (idx + 1) * daysPerPhase - 1;

    result[phase.number] = {
      start: campaignAddDays(startDate, phaseStartDay),
      end: campaignAddDays(startDate, phaseEndDay),
    };
  });

  return result;
}

export function assignPublicationDates(
  phaseTasks: Array<any>,
  phaseStart: Date,
  phaseEnd: Date,
  isWorkDayFn: (d: string) => boolean
): Date[] {
  const n = phaseTasks.length;
  const phaseDays = Math.max(1, Math.round((phaseEnd.getTime() - phaseStart.getTime()) / 86400000));
  return phaseTasks.map((_, idx) => {
    const targetDayOffset = Math.round((idx + 1) * phaseDays / (n + 1));
    let pubDate = campaignAddDays(phaseStart, targetDayOffset);
    if (pubDate > phaseEnd) pubDate = new Date(phaseEnd);
    if (pubDate < phaseStart) pubDate = new Date(phaseStart);
    for (let tries = 0; tries < 14; tries++) {
      if (isWorkDayFn(campaignDateToStr(pubDate))) break;
      pubDate = campaignAddDays(pubDate, 1);
    }
    return pubDate;
  });
}

export function mapFormatToContentType(format: string): string {
  const f = format.toLowerCase();
  if (f.includes('email') || f.includes('newsletter')) return 'email';
  if (f.includes('article') || f.includes('blog')) return 'article';
  if (f.includes('story') || f.includes('reel') || f.includes('video')) return 'story';
  if (f.includes('carousel')) return 'carousel';
  return 'post';
}

export interface SubTask {
  title: string;
  description: string;
  type: string;
  taskEnergyType: string;
  estimatedDuration: number;
  daysBeforePublication: number;
}

export function decomposeContentTask(task: {
  title: string; description: string; type: string;
  taskEnergyType: string; estimatedDuration: number; phase?: number;
}): SubTask[] {
  const t = task.title.toLowerCase();
  const isContentTask =
    t.includes('publish') || t.includes('post') || t.includes('write') ||
    t.includes('create') || t.includes('carousel') || t.includes('reel') ||
    t.includes('article') || t.includes('newsletter') || t.includes('email') ||
    t.includes('caption') || t.includes('content') || t.includes('video') ||
    task.type === 'content';

  if (!isContentTask) {
    return [{ ...task, daysBeforePublication: 0 }];
  }

  const isVideo = t.includes('video') || t.includes('reel') || t.includes('reels');
  const isNewsletter = t.includes('newsletter') || t.includes('email');
  const isArticle = t.includes('article') || t.includes('blog');
  const isCarousel = t.includes('carousel') || t.includes('slides');

  if (isVideo) {
    return [
      { title: `Script — ${task.title}`, description: `Write the script and structure the narrative. ${task.description}`, type: 'content', taskEnergyType: 'deep_work', estimatedDuration: 45, daysBeforePublication: -5 },
      { title: `Shoot/record — ${task.title}`, description: `Film or record the video content.`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 90, daysBeforePublication: -3 },
      { title: `Edit & caption — ${task.title}`, description: `Edit the video, add captions and music/sound.`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 60, daysBeforePublication: -1 },
      { title: `Schedule & publish — ${task.title}`, description: `Program the video with final caption copy and hashtags.`, type: 'content', taskEnergyType: 'execution', estimatedDuration: 20, daysBeforePublication: 0 },
    ];
  }

  if (isNewsletter || isArticle) {
    return [
      { title: `Outline — ${task.title}`, description: `Structure the key arguments and sections. ${task.description}`, type: 'content', taskEnergyType: 'deep_work', estimatedDuration: 30, daysBeforePublication: -4 },
      { title: `Write — ${task.title}`, description: `Write the full draft.`, type: 'content', taskEnergyType: 'deep_work', estimatedDuration: 90, daysBeforePublication: -2 },
      { title: `Edit & format — ${task.title}`, description: `Proofread, format, add visuals or links.`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 30, daysBeforePublication: -1 },
      { title: `Schedule — ${task.title}`, description: `Send or schedule with final subject line/caption.`, type: 'content', taskEnergyType: 'execution', estimatedDuration: 15, daysBeforePublication: 0 },
    ];
  }

  if (isCarousel) {
    return [
      { title: `Angle & structure — ${task.title}`, description: `Define the hook, slide structure and key message. ${task.description}`, type: 'content', taskEnergyType: 'deep_work', estimatedDuration: 30, daysBeforePublication: -3 },
      { title: `Write copy — ${task.title}`, description: `Write the copy for each slide.`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 45, daysBeforePublication: -2 },
      { title: `Design slides — ${task.title}`, description: `Create the visual design for all slides.`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 60, daysBeforePublication: -1 },
      { title: `Schedule — ${task.title}`, description: `Post or schedule with caption and hashtags.`, type: 'content', taskEnergyType: 'execution', estimatedDuration: 15, daysBeforePublication: 0 },
    ];
  }

  return [
    { title: `Write copy — ${task.title}`, description: `Write and refine the post copy. ${task.description}`, type: 'content', taskEnergyType: 'creative', estimatedDuration: 30, daysBeforePublication: -1 },
    { title: `Publish — ${task.title}`, description: `Post with final copy, visuals, and hashtags.`, type: 'content', taskEnergyType: 'execution', estimatedDuration: 15, daysBeforePublication: 0 },
  ];
}

// ─── Placement ───────────────────────────────────────────────────────────────

/** Les fonctions de `storage` utilisées par le placement (injectables pour les tests). */
export interface PlacementDeps {
  getUserPreferences(userId: string): Promise<any>;
  getDayAvailabilityRange(userId: string, startDate: string, endDate: string): Promise<any[]>;
  getTasksInRange?(userId: string, startDate: string, endDate: string): Promise<any[]>;
  checkSlotAvailability?(userId: string, date: string, startTime: string, durationMinutes: number): Promise<{ available: boolean; nextAvailableTime?: string }>;
  createTask?(task: any): Promise<any>;
  createContent?(content: any): Promise<any>;
}

export interface CampagnePlacable {
  id: number;
  projectId?: number | null;
  phases?: unknown;
  generatedTasks?: unknown;
  contentPlan?: unknown;
}

function requis<T>(f: T | undefined, nom: string): T {
  if (!f) throw new Error(`PlacementDeps.${nom} manquant`);
  return f;
}

async function joursTravailles(deps: PlacementDeps, userId: string, debutStr: string, finStr: string) {
  const prefs = await deps.getUserPreferences(userId);
  const workDaySet = parseWorkDays(prefs?.workDays);
  const availability = await deps.getDayAvailabilityRange(userId, debutStr, finStr);
  const offDates = new Set<string>(
    availability.filter((a: any) => a.dayType === 'off').map((a: any) => a.date as string)
  );
  const isWorkDay = (dateStr: string): boolean => {
    if (offDates.has(dateStr)) return false;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return workDaySet.has(DAY_ABBRS[dow]);
  };
  return { prefs, isWorkDay };
}

/**
 * Crée les tâches générées de la campagne entre `debut` et `fin` (phases réparties sur la
 * fenêtre, sous-tâches décomposées, jours travaillés, indisponibilités, 3 tâches par jour).
 *
 * `controleCreneaux` (défaut : oui) vérifie chaque créneau en base avant d'écrire
 * (`checkSlotAvailability`) ; `/redeploy` ne le faisait pas et continue de s'en passer.
 */
export async function placerTachesCampagne(
  deps: PlacementDeps,
  { userId, campaign, debut, fin, controleCreneaux = true }: {
    userId: string; campaign: CampagnePlacable; debut: Date; fin: Date; controleCreneaux?: boolean;
  },
): Promise<{ creees: number }> {
  const startDate = debut;
  const campaignDays = Math.round((fin.getTime() - debut.getTime()) / 86400000);
  const startStr = campaignDateToStr(startDate);
  const endDateStr = campaignDateToStr(fin);

  const existingTasks = await requis(deps.getTasksInRange, 'getTasksInRange')(userId, startStr, endDateStr);
  const { prefs, isWorkDay } = await joursTravailles(deps, userId, startStr, endDateStr);

  // Heures de travail de l'utilisateur
  const DAY_START = hhmmToMin(prefs?.workDayStart || '09:00');
  const DAY_END = hhmmToMin(prefs?.workDayEnd || '18:00');
  const LUNCH_START = hhmmToMin(prefs?.lunchBreakStart || '12:00');
  const LUNCH_END = hhmmToMin(prefs?.lunchBreakEnd || '13:00');
  const BUFFER = 15;

  const dayNextSlot = new Map<string, number>();
  for (const t of existingTasks) {
    if (!t.scheduledDate) continue;
    const existing = dayNextSlot.get(t.scheduledDate) ?? DAY_START;
    if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
      const startMin = hhmmToMin(t.scheduledTime);
      const endMin = startMin + (t.estimatedDuration || 30) + BUFFER;
      if (endMin > existing) dayNextSlot.set(t.scheduledDate, endMin);
    }
  }

  const dayHasCapacity = (dateStr: string, durationMin: number): boolean => {
    const slot = dayNextSlot.get(dateStr) ?? DAY_START;
    const adjusted = (slot < LUNCH_END && slot + durationMin > LUNCH_START) ? LUNCH_END : slot;
    return adjusted + durationMin <= DAY_END;
  };

  const assignSlot = (dateStr: string, durationMin: number): string => {
    let slot = dayNextSlot.get(dateStr) ?? DAY_START;
    if (slot < LUNCH_END && slot + durationMin > LUNCH_START) {
      slot = LUNCH_END;
    }
    dayNextSlot.set(dateStr, slot + durationMin + BUFFER);
    return minToHHMM(slot);
  };

  const phases = (campaign.phases || []) as Array<{ number: number; name: string; duration: string }>;
  const phaseRanges = computePhaseRanges(phases, startDate, campaignDays);

  const generatedTasks = (campaign.generatedTasks || []) as Array<{
    title: string; description: string; type: string; category: string;
    priority: number; estimatedDuration: number; taskEnergyType: string; phase?: number;
  }>;

  const tasksByPhase: Record<number, typeof generatedTasks> = {};
  for (const t of generatedTasks) {
    const p = parseInt(String(t.phase), 10) || 1;
    if (!tasksByPhase[p]) tasksByPhase[p] = [];
    tasksByPhase[p].push(t);
  }

  let tasksCreated = 0;
  const CAMPAIGN_DAY_CAP = 3;
  const campaignDayCounts = new Map<string, number>();
  for (const t of existingTasks) {
    if (!t.scheduledDate) continue;
    campaignDayCounts.set(t.scheduledDate, (campaignDayCounts.get(t.scheduledDate) || 0) + 1);
  }

  const campaignDayAvailable = (dateStr: string, durationMin: number): boolean => {
    return (campaignDayCounts.get(dateStr) || 0) < CAMPAIGN_DAY_CAP
      && dayHasCapacity(dateStr, durationMin);
  };

  const sortedPhaseNums = Object.keys(tasksByPhase).map(Number).sort((a, b) => a - b);

  for (const phaseNum of sortedPhaseNums) {
    const phaseTasks = tasksByPhase[phaseNum];
    const phaseRange = phaseRanges[phaseNum] || { start: startDate, end: campaignAddDays(startDate, 7) };

    const publicationDates = assignPublicationDates(phaseTasks, phaseRange.start, phaseRange.end, isWorkDay);

    for (let taskIdx = 0; taskIdx < phaseTasks.length; taskIdx++) {
      const originalTask = phaseTasks[taskIdx];
      const publicationDate = publicationDates[taskIdx];
      const subTasks = decomposeContentTask(originalTask);

      // BACKWARD SCHEDULING FIX: on verrouille d'abord la date de publication (décalage 0)
      const pubTaskIndex = subTasks.findIndex(st => (st.daysBeforePublication || 0) === 0);
      let lockedPublicationDate: Date | null = null;

      if (pubTaskIndex !== -1) {
        let pubDate = new Date(publicationDate);
        if (pubDate < phaseRange.start) pubDate = new Date(phaseRange.start);
        if (pubDate < startDate) pubDate = new Date(startDate);

        let safety = 0;
        let foundPubSlot = false;
        while (safety < 30) {
          const ds = campaignDateToStr(pubDate);
          if (isWorkDay(ds) && campaignDayAvailable(ds, subTasks[pubTaskIndex].estimatedDuration)) {
            foundPubSlot = true;
            break;
          }
          pubDate = campaignAddDays(pubDate, 1);
          safety++;
        }

        if (foundPubSlot) {
          lockedPublicationDate = pubDate;
        } else {
          console.warn(`Campaign ${campaign.id}: could not find publication slot for "${originalTask.title}" within 30-day search`);
          continue; // on saute toute la tâche de contenu si la publication ne peut pas être placée
        }
      }

      // Les sous-tâches, dans l'ordre, ancrées sur la date de publication verrouillée
      let lastSubtaskDate: Date | null = null;
      for (let subIdx = 0; subIdx < subTasks.length; subIdx++) {
        const sub = subTasks[subIdx];
        const offset = typeof sub.daysBeforePublication === 'number' ? sub.daysBeforePublication : 0;

        let scheduledDate: Date;
        if (subIdx === pubTaskIndex && lockedPublicationDate) {
          scheduledDate = lockedPublicationDate;
        } else if (lockedPublicationDate) {
          scheduledDate = campaignAddDays(lockedPublicationDate, offset);
        } else {
          scheduledDate = campaignAddDays(publicationDate, offset);
        }

        if (scheduledDate < phaseRange.start) scheduledDate = new Date(phaseRange.start);
        if (scheduledDate < startDate) scheduledDate = new Date(startDate);
        if (lastSubtaskDate && scheduledDate <= lastSubtaskDate) {
          scheduledDate = campaignAddDays(lastSubtaskDate, 1);
        }

        let safety = 0;
        let foundSlot = false;
        while (safety < 30) {
          const ds = campaignDateToStr(scheduledDate);
          if (isWorkDay(ds) && campaignDayAvailable(ds, sub.estimatedDuration)) { foundSlot = true; break; }

          if (lockedPublicationDate && subIdx !== pubTaskIndex && scheduledDate >= lockedPublicationDate) {
            console.warn(`Campaign ${campaign.id}: subtask "${sub.title}" would be scheduled on or after publication date. Skipping.`);
            break;
          }

          scheduledDate = campaignAddDays(scheduledDate, 1);
          safety++;
        }

        if (!foundSlot) {
          console.warn(`Campaign ${campaign.id}: could not find valid slot for sub-task "${sub.title}" within 30-day search`);
          continue;
        }

        lastSubtaskDate = scheduledDate;
        const scheduledDateStr = campaignDateToStr(scheduledDate);
        campaignDayCounts.set(scheduledDateStr, (campaignDayCounts.get(scheduledDateStr) || 0) + 1);

        const inMemoryTime = assignSlot(scheduledDateStr, sub.estimatedDuration);
        let scheduledTime = inMemoryTime;
        if (controleCreneaux) {
          // On vérifie en base (lancements concurrents) après le créneau calculé en mémoire
          const slotCheck = await requis(deps.checkSlotAvailability, 'checkSlotAvailability')(
            userId, scheduledDateStr, inMemoryTime, sub.estimatedDuration
          );
          scheduledTime = (!slotCheck.available && slotCheck.nextAvailableTime)
            ? slotCheck.nextAvailableTime
            : inMemoryTime;
          // On garde la table en mémoire cohérente avec ce qui a été écrit
          if (scheduledTime !== inMemoryTime) {
            const [sh, sm] = scheduledTime.split(':').map(Number);
            dayNextSlot.set(scheduledDateStr, sh * 60 + sm + sub.estimatedDuration + BUFFER);
          }
        }
        const scheduledEndTime = minToHHMM(hhmmToMin(scheduledTime) + sub.estimatedDuration);

        await requis(deps.createTask, 'createTask')({
          userId,
          projectId: campaign.projectId ?? undefined,
          campaignId: campaign.id,
          title: sub.title,
          description: sub.description,
          type: sub.type || 'content',
          category: originalTask.category || 'planning',
          priority: originalTask.priority || 2,
          estimatedDuration: sub.estimatedDuration,
          taskEnergyType: sub.taskEnergyType,
          source: 'campaign',
          scheduledDate: scheduledDateStr,
          scheduledTime,
          scheduledEndTime,
          completed: false,
        });
        tasksCreated++;
      }
    }
  }

  return { creees: tasksCreated };
}

/**
 * Crée les posts du plan de contenu, répartis sur les jours travaillés de chaque semaine à
 * partir de `debut`. `fin` borne seulement la lecture des indisponibilités (défaut : un an).
 * Jamais de publication automatique : le texte d'un post de campagne est une consigne.
 */
export async function placerPostsCampagne(
  deps: PlacementDeps,
  { userId, campaign, debut, fin }: { userId: string; campaign: CampagnePlacable; debut: Date; fin?: Date },
): Promise<{ crees: number }> {
  const startDate = debut;
  const finFenetre = fin ?? campaignAddDays(startDate, 365);
  const { isWorkDay } = await joursTravailles(deps, userId, campaignDateToStr(startDate), campaignDateToStr(finFenetre));

  const contentPlan = (campaign.contentPlan || []) as Array<{
    phase: number; week: string; platform: string; format: string;
    angle: string; pillar: string; goal: string; copyDirections: string;
  }>;

  // Regroupe les pièces par numéro de semaine
  const contentByWeek = new Map<number, typeof contentPlan>();
  for (const piece of contentPlan) {
    let weekNum = 1;
    const wMatch = piece.week.match(/[Ww]eek\s*(\d+)/);
    const mMatch = piece.week.match(/[Mm]onth\s*(\d+)/);
    if (wMatch) weekNum = parseInt(wMatch[1]);
    else if (mMatch) weekNum = (parseInt(mMatch[1]) - 1) * 4 + 1;
    if (!contentByWeek.has(weekNum)) contentByWeek.set(weekNum, []);
    contentByWeek.get(weekNum)!.push(piece);
  }

  let crees = 0;
  // Les heures varient pour éviter les doublons exacts : 9h, 11h, 14h, 16h
  const HOURS = [9, 11, 14, 16];
  for (const [weekNum, pieces] of Array.from(contentByWeek.entries())) {
    const weekStart = campaignAddDays(startDate, (weekNum - 1) * 7);
    const workDaysInWeek: string[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = campaignDateToStr(campaignAddDays(weekStart, d));
      if (isWorkDay(dateStr)) workDaysInWeek.push(dateStr);
    }
    if (workDaysInWeek.length === 0) {
      // Repli : le mercredi de la semaine
      workDaysInWeek.push(campaignDateToStr(campaignAddDays(weekStart, 2)));
    }

    const dayUsageCounts = new Map<string, number>();
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const dayStr = workDaysInWeek[i % workDaysInWeek.length];
      const usageCount = dayUsageCounts.get(dayStr) || 0;
      dayUsageCounts.set(dayStr, usageCount + 1);
      const hour = HOURS[usageCount % HOURS.length];

      const pieceDate = new Date(dayStr + 'T00:00:00');
      pieceDate.setHours(hour, 0, 0, 0);

      await requis(deps.createContent, 'createContent')({
        userId,
        projectId: campaign.projectId ?? undefined,
        campaignId: campaign.id,
        title: piece.angle,
        body: piece.copyDirections,
        platform: piece.platform,
        contentType: mapFormatToContentType(piece.format),
        pillar: piece.pillar,
        goal: piece.goal,
        status: 'draft',
        contentStatus: 'idea',
        scheduledFor: pieceDate,
        // JAMAIS de publication automatique pour un post de campagne : son texte est
        // une consigne de rédaction, pas un post. Le 6 oct. 2026, 19 posts ainsi créés
        // étaient prêts à partir seuls sur Instagram et LinkedIn (défaut de la colonne).
        autoPost: false,
      });
      crees++;
    }
  }
  return { crees };
}
