// Placement d'une campagne dans l'agenda : posts (répartis par semaine) et leurs tâches de
// production (dérivées de chaque post, à rebours de sa publication), puis les autres tâches
// générées (phases, jours travaillés, indisponibilités, 3 tâches par jour, créneaux).
//
// Partagé par `/launch`, `/regenerate-content`, `/resume`, `/redeploy` et « repenser » ; ce
// qui diffère entre eux est passé en paramètre (fenêtre [debut, fin], contrôle de créneaux).
import { localWallClock } from '../../utils/timezone';
import { formatDate as campaignDateToStr, addDays as campaignAddDays } from "../../utils/dateUtils";
import {
  etapesProductionPourPost, jourDeProduction, jourDuPost, postAProduire,
  estTacheContenuGeneree, estTacheProspection, mapFormatToPostFormat,
} from "./production";

export const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DEFAULT_WORK_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);

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
  if (f.includes('carousel') || f.includes('carrousel')) return 'carousel';
  return 'post';
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
  /** Posts d'une campagne (`storage.getContent(userId, limit, projectId, campaignId)`). */
  getContent?(userId: string, limit?: number, projectId?: number, campaignId?: number): Promise<any[]>;
  /** Tâches reliées à ces posts (`tasks.content_id`), faites ou non. */
  getTasksForContents?(userId: string, contentIds: number[]): Promise<any[]>;
}

export interface CampagnePlacable {
  id: number;
  projectId?: number | null;
  phases?: unknown;
  generatedTasks?: unknown;
  contentPlan?: unknown;
}

/**
 * Rend la méthode `nom` de `deps` LIÉE à `deps`. En production, `deps` est l'objet
 * `storage` (une instance de classe) : une méthode extraite sans `bind` perd son `this`
 * et plante au premier appel interne (`this.…`) — c'est ce qui a vidé deux campagnes
 * repensées le 7 oct. 2026 (« Cannot read properties of undefined (reading
 * 'checkSlotAvailability') »).
 */
function requis<K extends keyof PlacementDeps>(deps: PlacementDeps, nom: K): NonNullable<PlacementDeps[K]> {
  const f = deps[nom];
  if (typeof f !== "function") throw new Error(`PlacementDeps.${String(nom)} manquant`);
  return (f as Function).bind(deps) as NonNullable<PlacementDeps[K]>;
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
 * Grille des créneaux en mémoire : prochain créneau libre par jour, initialisé depuis les
 * tâches existantes, heures de travail et pause déjeuner de l'utilisatrice.
 */
function grilleCreneaux(prefs: any, existingTasks: any[]) {
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

  return {
    aDeLaPlace(dateStr: string, durationMin: number): boolean {
      const slot = dayNextSlot.get(dateStr) ?? DAY_START;
      const adjusted = (slot < LUNCH_END && slot + durationMin > LUNCH_START) ? LUNCH_END : slot;
      return adjusted + durationMin <= DAY_END;
    },
    attribuer(dateStr: string, durationMin: number): string {
      let slot = dayNextSlot.get(dateStr) ?? DAY_START;
      if (slot < LUNCH_END && slot + durationMin > LUNCH_START) slot = LUNCH_END;
      dayNextSlot.set(dateStr, slot + durationMin + BUFFER);
      return minToHHMM(slot);
    },
    /** L'heure réellement écrite diffère de l'heure attribuée : la grille la suit. */
    caler(dateStr: string, hhmm: string, durationMin: number) {
      dayNextSlot.set(dateStr, hhmmToMin(hhmm) + durationMin + BUFFER);
    },
    /** Un créneau fixe (la publication) occupe la grille s'il recouvre le prochain créneau. */
    occuper(dateStr: string, hhmm: string, durationMin: number) {
      const debut = hhmmToMin(hhmm);
      const fin = debut + durationMin + BUFFER;
      const next = dayNextSlot.get(dateStr) ?? DAY_START;
      if (debut <= next && fin > next) dayNextSlot.set(dateStr, fin);
    },
  };
}
type Grille = ReturnType<typeof grilleCreneaux>;

/** Heure attribuée en mémoire, revérifiée en base si demandé (lancements concurrents). */
async function heureDeCreneau(
  deps: PlacementDeps, grille: Grille, userId: string, dateStr: string, duree: number, controleCreneaux: boolean,
): Promise<string> {
  const inMemoryTime = grille.attribuer(dateStr, duree);
  if (!controleCreneaux) return inMemoryTime;
  const slotCheck = await requis(deps, 'checkSlotAvailability')(userId, dateStr, inMemoryTime, duree);
  const scheduledTime = (!slotCheck.available && slotCheck.nextAvailableTime) ? slotCheck.nextAvailableTime : inMemoryTime;
  if (scheduledTime !== inMemoryTime) grille.caler(dateStr, scheduledTime, duree);
  return scheduledTime;
}

/**
 * Crée les tâches générées de la campagne entre `debut` et `fin` (phases réparties sur la
 * fenêtre, jours travaillés, indisponibilités, 3 tâches par jour).
 *
 * Seules les tâches HORS CONTENU et HORS PROSPECTION du texte généré sont placées, une
 * tâche par entrée :
 * - la production des posts dérive des posts eux-mêmes (`placerTachesProductionPosts`),
 *   reliée par `content_id` et planifiée à rebours de chaque publication ;
 * - la prospection est automatisée par le pipeline de prospection : le planning ne doit
 *   pas demander d'écrire des messages à la main.
 *
 * `controleCreneaux` (défaut : oui) vérifie chaque créneau en base avant d'écrire
 * (`checkSlotAvailability`) ; `/redeploy` ne le faisait pas et continue de s'en passer.
 *
 * `bornerA` (défaut : aucune borne, comportement historique de launch/redeploy) : aucune
 * tâche n'est créée après ce jour. Sans elle, la recherche de créneau (jusqu'à 30 jours)
 * peut déborder après `fin`.
 */
export async function placerTachesCampagne(
  deps: PlacementDeps,
  { userId, campaign, debut, fin, controleCreneaux = true, bornerA }: {
    userId: string; campaign: CampagnePlacable; debut: Date; fin: Date; controleCreneaux?: boolean; bornerA?: Date;
  },
): Promise<{ creees: number }> {
  const borneStr = bornerA ? campaignDateToStr(bornerA) : null;
  const apresBorne = (ds: string): boolean => borneStr !== null && ds > borneStr;
  const startDate = debut;
  const campaignDays = Math.round((fin.getTime() - debut.getTime()) / 86400000);
  const startStr = campaignDateToStr(startDate);
  const endDateStr = campaignDateToStr(fin);

  const existingTasks = await requis(deps, 'getTasksInRange')(userId, startStr, endDateStr);
  const { prefs, isWorkDay } = await joursTravailles(deps, userId, startStr, endDateStr);
  const grille = grilleCreneaux(prefs, existingTasks);

  const phases = (campaign.phases || []) as Array<{ number: number; name: string; duration: string }>;
  const phaseRanges = computePhaseRanges(phases, startDate, campaignDays);

  const generatedTasks = ((campaign.generatedTasks || []) as Array<{
    title: string; description: string; type: string; category: string;
    priority: number; estimatedDuration: number; taskEnergyType: string; phase?: number;
  }>).filter((t) => t && !estTacheContenuGeneree(t) && !estTacheProspection(t));

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
  const campaignDayAvailable = (dateStr: string, durationMin: number): boolean =>
    (campaignDayCounts.get(dateStr) || 0) < CAMPAIGN_DAY_CAP && grille.aDeLaPlace(dateStr, durationMin);

  const sortedPhaseNums = Object.keys(tasksByPhase).map(Number).sort((a, b) => a - b);

  for (const phaseNum of sortedPhaseNums) {
    const phaseTasks = tasksByPhase[phaseNum];
    const phaseRange = phaseRanges[phaseNum] || { start: startDate, end: campaignAddDays(startDate, 7) };
    const dates = assignPublicationDates(phaseTasks, phaseRange.start, phaseRange.end, isWorkDay);

    for (let taskIdx = 0; taskIdx < phaseTasks.length; taskIdx++) {
      const task = phaseTasks[taskIdx];
      const duree = task.estimatedDuration || 30;
      let scheduledDate = new Date(dates[taskIdx]);
      if (scheduledDate < phaseRange.start) scheduledDate = new Date(phaseRange.start);
      if (scheduledDate < startDate) scheduledDate = new Date(startDate);

      let safety = 0;
      let foundSlot = false;
      while (safety < 30) {
        const ds = campaignDateToStr(scheduledDate);
        if (apresBorne(ds)) break;
        if (isWorkDay(ds) && campaignDayAvailable(ds, duree)) { foundSlot = true; break; }
        scheduledDate = campaignAddDays(scheduledDate, 1);
        safety++;
      }
      if (!foundSlot) {
        console.warn(`Campaign ${campaign.id}: could not find a slot for "${task.title}" within 30-day search`);
        continue;
      }

      const scheduledDateStr = campaignDateToStr(scheduledDate);
      campaignDayCounts.set(scheduledDateStr, (campaignDayCounts.get(scheduledDateStr) || 0) + 1);
      const scheduledTime = await heureDeCreneau(deps, grille, userId, scheduledDateStr, duree, controleCreneaux);

      await requis(deps, 'createTask')({
        userId,
        projectId: campaign.projectId ?? undefined,
        campaignId: campaign.id,
        title: task.title,
        description: task.description,
        type: task.type || 'planning',
        category: task.category || 'planning',
        priority: task.priority || 2,
        estimatedDuration: duree,
        taskEnergyType: task.taskEnergyType,
        source: 'campaign',
        scheduledDate: scheduledDateStr,
        scheduledTime,
        scheduledEndTime: minToHHMM(hhmmToMin(scheduledTime) + duree),
        completed: false,
      });
      tasksCreated++;
    }
  }

  return { creees: tasksCreated };
}

// ─── Production des posts ────────────────────────────────────────────────────

export interface PostPlacable {
  id: number;
  title?: string | null;
  postFormat?: string | null;
  contentType?: string | null;
  autoPost?: boolean | null;
  scheduledFor?: Date | string | null;
  projectId?: number | null;
  campaignId?: number | null;
  publishedAt?: unknown;
  postStatus?: string | null;
  contentStatus?: string | null;
}

const aujourdhuiLocal = () => campaignDateToStr(new Date());
const plusJours = (ds: string, n: number) => campaignDateToStr(campaignAddDays(new Date(ds + 'T00:00:00'), n));
// Heure de Paris : le serveur tourne en UTC, `getHours()` décalait « Publier » de 2 h.
const heureDuPost = (d: Date | string) => minToHHMM(localWallClock('Europe/Paris', new Date(d)).minuteOfDay);

/**
 * Crée les tâches de production de chaque post à venir et non publié, reliées au post
 * (`contentId`), planifiées À REBOURS depuis sa publication (voir `etapesProductionPourPost`).
 *
 * Elles ont une échéance : le plafond de 3 tâches par jour ne s'applique pas, une étape
 * n'est jamais placée après le post ni dans le passé, et n'est jamais abandonnée. Un jour
 * sans place (heures de travail) fait reculer l'étape vers un jour travaillé plus tôt qui en
 * a, sans passer avant l'étape précédente du même post ; sinon elle reste sur son jour
 * (le re-tassage `fixOverlappingTasks` des routes s'en charge).
 *
 * `existantes` : tâches déjà reliées à ces posts ; une étape dont le libellé y figure
 * (faite ou non) n'est pas recréée — c'est ce qui rend le placement idempotent.
 */
export async function placerTachesProductionPosts(
  deps: PlacementDeps,
  { userId, posts, aujourdhui = aujourdhuiLocal(), controleCreneaux = true, existantes = [] }: {
    userId: string; posts: PostPlacable[]; aujourdhui?: string; controleCreneaux?: boolean;
    existantes?: Array<{ contentId?: number | null; title?: string | null }>;
  },
): Promise<{ creees: number }> {
  const aProduire = posts
    .filter((p) => typeof p?.id === 'number' && postAProduire(p, aujourdhui))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
  if (aProduire.length === 0) return { creees: 0 };

  const dejaLa = new Map<number, string[]>();
  for (const t of existantes) {
    if (typeof t.contentId !== 'number') continue;
    dejaLa.set(t.contentId, [...(dejaLa.get(t.contentId) || []), t.title || '']);
  }

  const dernierJour = jourDuPost(aProduire[aProduire.length - 1].scheduledFor!);
  const existingTasks = await requis(deps, 'getTasksInRange')(userId, aujourdhui, dernierJour);
  const { prefs, isWorkDay } = await joursTravailles(deps, userId, aujourdhui, dernierJour);
  const grille = grilleCreneaux(prefs, existingTasks);

  const aCreer = (post: PostPlacable, cle: string) =>
    !(dejaLa.get(post.id) || []).some((t) => t.startsWith(`${cle} — `));

  // Les publications ont une heure fixe (celle du post) : elles réservent leur créneau
  // avant que les étapes de préparation ne remplissent les journées.
  for (const post of aProduire) {
    const pub = etapesProductionPourPost(post).find((e) => e.publication);
    if (pub && aCreer(post, pub.cle)) grille.occuper(jourDuPost(post.scheduledFor!), heureDuPost(post.scheduledFor!), pub.duree);
  }

  let creees = 0;
  for (const post of aProduire) {
    const jourPost = jourDuPost(post.scheduledFor!);
    let plancher = aujourdhui;
    for (const etape of etapesProductionPourPost(post)) {
      let jour: string;
      let heure: string;
      if (etape.publication) {
        jour = jourPost;
        heure = heureDuPost(post.scheduledFor!);
      } else {
        jour = jourDeProduction({
          cible: plusJours(jourPost, -etape.joursAvant), jourPost, aujourdhui, estTravaille: isWorkDay, plancher,
        });
        if (!grille.aDeLaPlace(jour, etape.duree)) {
          for (let d = plusJours(jour, -1); d >= plancher; d = plusJours(d, -1)) {
            if (isWorkDay(d) && grille.aDeLaPlace(d, etape.duree)) { jour = d; break; }
          }
        }
        heure = '';
      }
      plancher = jour;
      if (!aCreer(post, etape.cle)) continue;
      if (!etape.publication) heure = await heureDeCreneau(deps, grille, userId, jour, etape.duree, controleCreneaux);

      await requis(deps, 'createTask')({
        userId,
        projectId: post.projectId ?? undefined,
        campaignId: post.campaignId ?? undefined,
        contentId: post.id,
        title: etape.titre,
        description: etape.description,
        type: 'content',
        category: 'engagement',
        priority: 2,
        estimatedDuration: etape.duree,
        taskEnergyType: etape.energie,
        source: 'campaign',
        scheduledDate: jour,
        scheduledTime: heure,
        scheduledEndTime: minToHHMM(hhmmToMin(heure) + etape.duree),
        completed: false,
      });
      creees++;
    }
  }
  return { creees };
}

/**
 * Idempotent : pour chaque post à venir et non publié de la campagne, crée les tâches de
 * production qui manquent (une étape déjà présente, faite ou non, n'est pas recréée).
 * Sert à `/resume`, `/redeploy` et au script de rattrapage des campagnes existantes.
 */
export async function placerTachesProductionPourCampagne(
  deps: PlacementDeps,
  { userId, campaignId, aujourdhui = aujourdhuiLocal(), controleCreneaux = true }: {
    userId: string; campaignId: number; aujourdhui?: string; controleCreneaux?: boolean;
  },
): Promise<{ creees: number }> {
  const posts = ((await requis(deps, 'getContent')(userId, 100000, undefined, campaignId)) as PostPlacable[])
    .filter((p) => typeof p?.id === 'number' && postAProduire(p, aujourdhui));
  if (posts.length === 0) return { creees: 0 };
  const existantes = await requis(deps, 'getTasksForContents')(userId, posts.map((p) => p.id));
  return placerTachesProductionPosts(deps, { userId, posts, aujourdhui, controleCreneaux, existantes });
}

/**
 * Crée les posts du plan de contenu, répartis sur les jours travaillés de chaque semaine à
 * partir de `debut`, PUIS les tâches de production de chacun (`placerTachesProductionPosts`) :
 * un post n'est jamais créé sans ses tâches. `fin` borne seulement la lecture des
 * indisponibilités (défaut : un an).
 * `bornerA` (défaut : aucune borne, comportement historique) : un post dont le jour calculé
 * tombe après ce jour n'est pas créé.
 * Jamais de publication automatique : le texte d'un post de campagne est une consigne.
 */
export async function placerPostsCampagne(
  deps: PlacementDeps,
  { userId, campaign, debut, fin, bornerA, aujourdhui, controleCreneaux = true }: {
    userId: string; campaign: CampagnePlacable; debut: Date; fin?: Date; bornerA?: Date;
    aujourdhui?: string; controleCreneaux?: boolean;
  },
): Promise<{ crees: number; tachesProduction: number }> {
  const borneStr = bornerA ? campaignDateToStr(bornerA) : null;
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
  const postsCrees: PostPlacable[] = [];
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
      if (borneStr !== null && dayStr > borneStr) continue;
      const usageCount = dayUsageCounts.get(dayStr) || 0;
      dayUsageCounts.set(dayStr, usageCount + 1);
      const hour = HOURS[usageCount % HOURS.length];

      const pieceDate = new Date(dayStr + 'T00:00:00');
      pieceDate.setHours(hour, 0, 0, 0);

      const ligne = {
        userId,
        projectId: campaign.projectId ?? undefined,
        campaignId: campaign.id,
        title: piece.angle,
        body: piece.copyDirections,
        platform: piece.platform,
        contentType: mapFormatToContentType(piece.format),
        postFormat: mapFormatToPostFormat(piece.format),
        pillar: piece.pillar,
        goal: piece.goal,
        status: 'draft',
        contentStatus: 'idea',
        scheduledFor: pieceDate,
        // JAMAIS de publication automatique pour un post de campagne : son texte est
        // une consigne de rédaction, pas un post. Le 6 oct. 2026, 19 posts ainsi créés
        // étaient prêts à partir seuls sur Instagram et LinkedIn (défaut de la colonne).
        autoPost: false,
      };
      const cree = await requis(deps, 'createContent')(ligne);
      postsCrees.push({ ...ligne, ...(cree || {}) });
      crees++;
    }
  }

  const { creees: tachesProduction } = await placerTachesProductionPosts(deps, {
    userId, posts: postsCrees, aujourdhui, controleCreneaux,
  });
  return { crees, tachesProduction };
}
