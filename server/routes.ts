import { savoirPourCampagne } from "./services/memory/savoir-campagne";
import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "node:crypto";
import { storage } from "./storage";
import { pool, db } from "./db";
import { waitlist, taskPrompts, tasks, readingCards, readingQueries, content, projectLinks, campaigns, projects, prospectionCampaigns, leads } from "@shared/schema";
import { eq, and, inArray, or, gte, desc, sql, count, isNull } from "drizzle-orm";
import { remplacerReferencesNumerotees } from "./services/references-taches";
import { runReadingRoom } from "./services/reading/runner";
import { statutApresReponse } from "./services/reading/statut";
import { setupAuth, isAuthenticated, hashPassword, verifyPassword, generateUserId, generateJWT } from "./auth";
import { registerLivrablesRoutes } from "./routes-livrables";
import { 
  generateContent, 
  generateDailyTasks, 
  generateStrategyInsights, 
  generateOutreachMessage,
  analyzeContentPerformance,
  generateMonthlyPlan,
  generateWeeklyRefinement,
  generateCampaignStrategy,
  generateCampaignContent,
  generateCampaignTasks,
  type CampaignStrategy,
  generateWeeklyBriefing,
  getMemoryContext,
} from "./services/openai";
import { callClaude, callClaudeWithContext, CLAUDE_MODELS } from "./services/claude";
import { imposerLangueDuCompte } from "./services/garde-langue";
import { extractToMemory } from "./services/memory/extract";
import { refuserTache } from "./services/refus/service";
import { refusDeps } from "./services/refus/deps";
import { estRaisonRefus, ligneContexteRefus } from "./services/refus/pur";
import { filtrerEditionTache } from "./services/taches/edition";
import { refuserPost } from "./services/refus-post/service";
import { refusPostDeps } from "./services/refus-post/deps";
import { estRaisonRefusPost, estPublieOuEnCours } from "./services/refus-post/pur";
import { resolveSubjectBrand } from "./services/memory/brand-resolve";
import { pickAllowedProjectFields, validateProjectPatchFields, ALLOWED_PROJECT_PATCH_FIELDS } from "./services/project-fields";
import { isValidStage, buildSituationPrompt } from "./services/project-summary";
import { resolveStrategyWeekKey } from "@shared/strategy-week";
import { normalizeLanguage } from "@shared/language";
import { budgetWeight, taskCapForBudget } from "./services/task-allocation";
import { runPlaceToday } from "./services/place-today-runner";
import { selectOverdueTasks } from "./services/overdue-tasks";
import { evaluateProjectOvercommit } from "./services/overcommit";
import { stripe, getOrCreateCustomer, createCheckoutSession, createPortalSession, fetchSubscription } from "./services/stripe";
import { syncSubscriptionFromStripe, redeemAccessCode } from "./services/billing";
import { hasNayaAccess } from "./services/access";
import { ajouterDependance } from "./services/dependances";
import { dateDeRetassage, aujourdhuiParis } from "./services/repack-from";
import {
  apercuRepenser, lancerRepenser, registreRepenser, repenserEnCours, StatutIncompatible, DejaEnCours,
  CONSIGNE_MAX as CONSIGNE_REPENSER_MAX, type RepenserDeps,
} from "./services/campagne/repenser";
import { lecturesRepenser, transactionRepenser } from "./services/campagne/repenser-db";
import { getProspectionPlan, getLinkedInRequestsThisWeek, buildProspectionStatus } from "./services/prospection-access";
import { runCampaignSearch, enrichProspects, prospectionErrorResponse, resolveFounderName } from "./services/prospection-pipeline";
import { generateStepMessage, combineInstructions } from "./services/sequence-message";
import { etatGardeApercu } from "./services/sequence-distinct";
import { requireActiveSubscription, gateNayaAccess } from "./middleware/require-subscription";
import { checkAndUnlockMilestones, confirmMilestone, createMilestoneChain } from "./services/milestone-engine";
import { processCompanionMessage } from "./services/companion";
import { contextualRecommendationsEngine } from "./services/contextual-recommendations";
import { runRealismValidation } from "./services/realism";
import { taskPreGenerationService } from "./services/task-pre-generation";
import { NAYA_SYSTEM_VOICE } from "./naya-voice";
import { destinationPourTache } from "./services/task-destination";
import { peutEtreContacte } from "./services/prospection-validation";
import { verrouDeTache } from "./services/task-lock";
import { etatConnexion } from "./services/social-connection-state";
import { deposerDossier, listerDossiers, dossierExiste, retirerDossier } from "./services/memory/deposer-dossier";
import { indexerManquants, depsReelles, sonderEmbeddings, compterManquants, invaliderSonde } from "./services/memory/indexer-manquants";
import { extraireTextePdf, titreDepuisNomFichier, normaliserTitre, titreParDefaut } from "./services/memory/extraire-pdf";
import { valideLien } from "./services/brand-links/links";
import type { Articulation } from "./services/brand-links/links";
import { articulationsDisponibles } from "./services/brand-links/articulation";
import { detecterCollision, detecterCollisionLot } from "./services/brand-links/collision";
import type { CollisionLot } from "./services/brand-links/collision";
import { importerTexte, ReponseIllisible } from "./services/content-import/import";
import { rejeterCampagne, CampagneIntrouvable, trierContenus, trierTaches } from "./services/campaign-reject/rejeter";
import { preferencesDeLaMarque, formaterPreferences, type Preference } from "./services/campaign-reject/preferences";
import { MAX_CARACTERES } from "./services/content-import/parse";
import { LIMITE_CONTENUS_MAX } from "./services/content-limit";
import { annoterVerrous, prerequisManquants } from "./services/task-lock-annotate";
import { construireContenuDepuisTache, VALEUR_A_PRECISER, CHAMPS_DEDUCTIBLES } from "./services/task-to-content";
import { deduireChampsContenu } from "./services/content-deduction";
import { unansweredStreak, shouldReduceFrequency } from "./services/result-capture/throttle";
import { buildImmediateInsight, type TaskAnswer } from "./services/result-capture/insight";
import { insightIfChanged } from "./services/result-capture/insight-if-changed";
import { selectAlarmsToPost } from "./services/result-capture/select-alarms";
import { rememberObservations } from "./services/result-capture/observation-writer";

function stripMarkdownJSON(raw: string | null | undefined): string {
  if (!raw) return '{}';
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }
  cleaned = cleaned.trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let start = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) start = firstBrace;
  else if (firstBracket !== -1) start = firstBracket;
  if (start > 0) cleaned = cleaned.slice(start);
  return cleaned;
}
import { companyResearchService } from "./services/company-research";
import { socialMediaService } from "./services/social-integrations";
import {
  getInstagramAuthUrl, exchangeInstagramCode,
  getLinkedInAuthUrl,  exchangeLinkedInCode,
  getTwitterAuthUrl,   exchangeTwitterCode,
  getTikTokAuthUrl,    exchangeTikTokCode,
  isPlatformConfigured,
} from "./services/social-oauth";
import { leadScrapingService } from "./services/lead-scraping";
import { emailMarketingService } from "./services/email-marketing";
import { parseMilestoneTrigger, checkMilestoneTriggers } from "./services/milestone-intelligence";
import { formatDate as sharedFormatDate, addDays as sharedAddDays } from "./utils/dateUtils";
import { contenuEstPublie } from "./services/campaign-reject/rejeter";
import {
  DAY_ABBRS, parseWorkDays, hhmmToMin, minToHHMM, computePhaseRanges, assignPublicationDates,
  decomposeContentTask, DEFAULT_WORK_DAYS, placerTachesCampagne, placerPostsCampagne,
} from "./services/campagne/placement";
import { parisHourOf, parisTodayString } from "./utils/timezone";
import { generateGoalTasks } from "./services/goal-tasks";
import { generateSearchBrief, generateSequence, generateLeadCriteria } from "./services/prospection";
import { generateSequencePlan, CONDITIONS as SEQUENCE_STEP_CONDITIONS } from "./services/sequence-plan";
import { parseCsv, mapLeadRow } from "./services/csv";
import { encryptToken, decryptToken } from "./services/token-crypto";
import { getSenderStatus, createSingleSender } from "./services/sendgrid-senders";
import { serpConfigured, sourceLeadsFromQueries } from "./services/serp";
import { isAiBlocked } from "./services/usage";
import { linkedinConfigured, generateConnectLink, listUnipileAccounts } from "./services/linkedin";
import { deriveMilestoneDate } from "./services/milestone-dates";
import { r2Configured, createUploadUrl } from "./services/r2-storage";
import { analyzeStatusNote } from "./services/ritual-analyze";
import { materializeRituals } from "./services/ritual-materialize";
import { isValidTimeOfDay, areValidDays } from "./services/rituals";
import { ingestSignals } from "./services/reception/ingest";
import { parseReceptionCsv } from "./services/reception/sources/manual";
import type { ReceptionSignal } from "./services/reception/types";
import {
  parseReceptionIntOrNull,
  parseReceptionSentiment,
  parseReceptionMeasuredAt,
} from "./services/reception/validate-input";
import { attributeConversion } from "./services/attribution/attribute-conversion";
import { refreshReceptionForContents } from "./services/reception/recompute";
import { randomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { 
  insertBrandDnaSchema, 
  insertTaskSchema, 
  insertContentSchema, 
  insertLeadSchema, 
  insertOutreachMessageSchema,
  insertSavedArticleSchema,
  updateSavedArticleSchema,
  updateLeadSchema,
  toggleReadSchema,
  toggleFavoriteSchema,
  insertSocialAccountSchema,
  updateSocialAccountSchema,
  insertMediaLibrarySchema,
  updateMediaLibrarySchema,
  insertProjectSchema,
  insertProjectGoalSchema,
  insertProjectStrategyProfileSchema,
  insertQuickCaptureSchema,
  insertTargetPersonaSchema,
  insertTaskScheduleEventSchema,
  insertClientSchema,
  insertMilestoneTriggerSchema,
} from "@shared/schema";
import { articleAnalysisService } from "./services/article-analysis";
import { runDailyAutoPlanner, rolloverStaleTasks } from "./services/auto-planner";
import { preferencesDeFinOnboarding } from "./services/planning-start";
import { appliquerEtatFait, idEvenementValide, lireFaits, marquerFait, retirerFait } from "./services/agenda/faits";
import { resolveScheduledEndTime } from "./services/task-schedule-fields";
import {
  getAuthUrl,
  exchangeCodeForTokens,
  getCalendarEvents,
  getCalendarBlockedRanges,
} from './services/google-calendar';
import { 
  detectUserPersona, 
  analyzeTargetPersona, 
  matchPersonaStrategy,
  TARGET_PERSONA_LIBRARY
} from "./services/persona-intelligence";
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Helper: fetch project + persona context for AI generation
async function fetchAIContext(userId: string, projectIdOverride?: number | null): Promise<{
  projectContext: {
    projectId?: number;
    projectType?: string;
    projectName?: string;
    monetizationIntent?: string;
    activeGoalTitle?: string;
    activeGoalSuccessMode?: string;
    currentStage?: string;
  };
  personaContext: {
    userPersonaName?: string;
    userPersonaOutputStyle?: string;
    targetPersonaName?: string;
    targetPersonaDecisionTriggers?: string[];
    targetPersonaPersuasionDrivers?: string[];
    targetPersonaPreferredChannels?: string[];
  };
}> {
  try {
    const prefs = await storage.getUserPreferences(userId);
    const projectId = projectIdOverride !== undefined ? projectIdOverride : prefs?.activeProjectId;

    let projectContext: any = {};
    let personaContext: any = {};

    if (projectId) {
      const project = await storage.getProject(projectId, userId);
      if (project) {
        const goals = await storage.getActiveGoalsForProject(projectId);
        const topGoal = goals[0];
        const stratProfile = await storage.getProjectStrategyProfile(projectId);
        projectContext = {
          projectId: projectId ?? undefined, // CRITIQUE : sert à buildNayaContext(userId, projectId) →
                     // contexte DU projet, pas du principal. Sans lui, tous héritaient d'Agence JMD.
          projectType: project.type,
          projectName: project.name,
          monetizationIntent: project.monetizationIntent,
          activeGoalTitle: topGoal?.title,
          activeGoalSuccessMode: topGoal?.successMode,
          currentStage: stratProfile?.currentStage,
        };

        // Target persona for this project
        const targetPersonas = await storage.getTargetPersonas(userId, projectId);
        const tp = targetPersonas[0];
        if (tp) {
          personaContext.targetPersonaName = tp.name;
          personaContext.targetPersonaDecisionTriggers = tp.decisionTriggers || [];
          personaContext.targetPersonaPersuasionDrivers = tp.persuasionDrivers || [];
          personaContext.targetPersonaPreferredChannels = tp.preferredChannels || [];
        }
      }
    }

    // User persona
    const userPersonaResult = await storage.getLatestPersonaAnalysis(userId, 'user');
    if (userPersonaResult?.analysisResult) {
      const ar = userPersonaResult.analysisResult as any;
      personaContext.userPersonaName = ar.personaName;
      personaContext.userPersonaOutputStyle = ar.outputStyleGuidelines;
    }

    return { projectContext, personaContext };
  } catch {
    return { projectContext: {}, personaContext: {} };
  }
}

// Helper: build operating profile summary string for AI prompts
async function getOperatingProfileSummary(userId: string): Promise<string> {
  try {
    const [profile, personaAnalysis] = await Promise.all([
      storage.getUserOperatingProfile(userId).catch(() => null),
      storage.getLatestPersonaAnalysis(userId, 'user').catch(() => null),
    ]);
    const parts: string[] = [];
    const personaName = (personaAnalysis?.analysisResult as any)?.personaName;
    if (personaName) parts.push(`Persona: ${personaName}`);
    if (profile?.energyRhythm) parts.push(`Works best as a ${profile.energyRhythm.replace('-', ' ')}`);
    if (profile?.planningStyle) parts.push(`Planning style: ${profile.planningStyle}`);
    if (profile?.activationStyle) parts.push(`Activation style: ${profile.activationStyle.replace(/-/g, ' ')}`);
    if (profile?.encouragementStyle) parts.push(`Responds best to ${profile.encouragementStyle.replace(/-/g, ' ')} encouragement`);
    if (profile?.avoidanceTriggers?.length) parts.push(`Tends to avoid: ${profile.avoidanceTriggers.join(', ')}`);
    if (profile?.selfDescribedFriction) parts.push(`Self-described friction: "${profile.selfDescribedFriction}"`);
    return parts.length ? `User operating profile: ${parts.join('. ')}.` : '';
  } catch {
    return '';
  }
}


// Helper: build positive effectiveness context from completed task feedback signals
function buildPositiveEffectivenessContext(completedSignals: any[]): string {
  if (!completedSignals || completedSignals.length < 3) return '';
  try {
    // Group by taskType and taskCategory to find reliable completion patterns
    const typeCounts: Record<string, { count: number; delaySum: number; varianceSum: number; varianceCount: number }> = {};
    for (const f of completedSignals) {
      const key = [f.taskType, f.taskCategory].filter(Boolean).join('/') || 'general';
      if (!typeCounts[key]) typeCounts[key] = { count: 0, delaySum: 0, varianceSum: 0, varianceCount: 0 };
      typeCounts[key].count++;
      if (typeof f.completionDelayDays === 'number') typeCounts[key].delaySum += f.completionDelayDays;
      if (typeof f.actualDurationVariance === 'number') {
        typeCounts[key].varianceSum += f.actualDurationVariance;
        typeCounts[key].varianceCount++;
      }
    }
    const insights: string[] = [];
    for (const [type, stats] of Object.entries(typeCounts)) {
      if (stats.count < 3) continue;
      const avgDelay = stats.delaySum / stats.count;
      const avgVariance = stats.varianceCount > 0 ? stats.varianceSum / stats.varianceCount : 0;
      let line = `User reliably completes ${type} tasks`;
      if (avgDelay <= 0) line += ' on time or early';
      else if (avgDelay <= 1) line += ' (occasionally 1 day late)';
      if (stats.varianceCount > 0 && avgVariance < -10) line += ' — tends to finish faster than estimated';
      else if (stats.varianceCount > 0 && avgVariance > 15) line += ' — often takes longer than estimated';
      insights.push(line);
    }
    return insights.length > 0 ? insights.join('. ') + '.' : '';
  } catch {
    return '';
  }
}

// Helper: smart due date from text content
function parseDueDateFromText(text: string): Date {
  const lower = text.toLowerCase();
  const now = new Date();
  if (/\btoday\b|\bnow\b|\basap\b|\bright now\b|\bthis morning\b|\bthis afternoon\b|\btonight\b/.test(lower)) {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    return today;
  }
  if (/\btomorrow\b/.test(lower)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }
  if (/\bthis week\b|\bend of week\b|\bby friday\b/.test(lower)) {
    const friday = new Date();
    const day = friday.getDay();
    const daysUntilFriday = day <= 5 ? 5 - day : 6;
    friday.setDate(friday.getDate() + daysUntilFriday);
    friday.setHours(9, 0, 0, 0);
    return friday;
  }
  // Default: today (immediate-intent items)
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  return today;
}

function clampToFloor(date: string, floor: string): string {
  return date >= floor ? date : floor;
}

function parseClientToday(body: any): string {
  const raw = body?.clientToday;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // If it's late in the evening (after 8 PM), schedule for tomorrow instead
  const now = new Date();
  const currentHour = now.getHours();

  let candidateDate = new Date(now);
  if (currentHour >= 20) {
    // After 8 PM, use tomorrow as the base date for scheduling
    candidateDate.setDate(candidateDate.getDate() + 1);
  }

  // Skip weekends - keep moving forward until we find a weekday
  const dayOfWeek = candidateDate.getDay();
  if (dayOfWeek === 0) {
    // Sunday -> move to Monday
    candidateDate.setDate(candidateDate.getDate() + 1);
  } else if (dayOfWeek === 6) {
    // Saturday -> move to Monday
    candidateDate.setDate(candidateDate.getDate() + 2);
  }

  return sharedFormatDate(candidateDate);
}

// After AI generates tasks (some may have past dates), redistribute them forward
// so no day exceeds dailyCap and no task lands before floor.

function rebalanceTasksForward(
  tasks: any[],
  floor: string,
  endDate: string,
  dailyCap = 5,
  existingDayCounts?: Map<string, number>,
  overflowDays = 0,
  allowedDays?: Set<string>,
  offDates?: Set<string>,
): any[] {
  if (!tasks.length) return tasks;

  const workDaySet = allowedDays || DEFAULT_WORK_DAYS;

  if (workDaySet.size === 0) {
    return tasks.map(t => ({ ...t, _unschedulable: true }));
  }

  const clamped = tasks.map(t => ({ ...t, scheduledDate: clampToFloor(t.scheduledDate || floor, floor) }));

  const localDateStr = sharedFormatDate;

  function dateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const cur = new Date(start + 'T00:00:00');
    const last = new Date(end + 'T00:00:00');
    while (cur <= last) {
      dates.push(localDateStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }

  const minOverflow = overflowDays > 0 ? overflowDays : 14;
  const effectiveEnd = (() => {
    const d = new Date(endDate + 'T00:00:00');
    d.setDate(d.getDate() + minOverflow);
    return localDateStr(d);
  })();

  const allDates = dateRange(floor, effectiveEnd);
  const orderedDates = allDates.filter(d => {
    if (offDates && offDates.has(d)) return false;
    const dow = new Date(d + 'T00:00:00').getDay();
    return workDaySet.has(DAY_ABBRS[dow]);
  });

  if (orderedDates.length === 0) {
    return tasks.map(t => ({ ...t, _unschedulable: true }));
  }

  const slotUsage = new Map<string, number>();
  for (const d of orderedDates) slotUsage.set(d, existingDayCounts?.get(d) || 0);

  const sorted = [...clamped].sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));

  const result: any[] = [];
  const clampToWorkDay = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    for (let tries = 0; tries < 60; tries++) {
      if (workDaySet.has(DAY_ABBRS[d.getDay()])) return localDateStr(d);
      d.setDate(d.getDate() + 1);
    }
    return orderedDates[0];
  };

  for (const task of sorted) {
    let assigned = false;
    const preferred = clampToWorkDay(task.scheduledDate);
    if (slotUsage.has(preferred) && (slotUsage.get(preferred)! < dailyCap)) {
      slotUsage.set(preferred, (slotUsage.get(preferred) ?? 0) + 1);
      result.push({ ...task, scheduledDate: preferred });
      assigned = true;
    } else {
      for (const d of orderedDates) {
        if (d >= preferred && (slotUsage.get(d) ?? 0) < dailyCap) {
          slotUsage.set(d, (slotUsage.get(d) ?? 0) + 1);
          result.push({ ...task, scheduledDate: d });
          assigned = true;
          break;
        }
      }
    }
    if (!assigned) {
      result.push({ ...task, scheduledDate: orderedDates[orderedDates.length - 1], _unschedulable: true });
    }
  }
  return result;
}

// ─── Task Prompts — deux fenêtres distinctes, exportées et nommées ─────────────────
// Une seule constante (30) servait autrefois à la fois à la soupape et au retour
// immédiat — voir revue finale, défaut Important 3. Les deux besoins sont trop
// différents pour partager une fenêtre : les séparer rend chacune ajustable
// indépendamment sans devoir re-raisonner sur l'autre.

// La soupape (`unansweredStreak`) ne regarde jamais plus que les `SEUIL_SOUPAPE` (3)
// alarmes échues les plus récentes — elle s'arrête à la première réponse rencontrée.
// 10 lignes laissent une marge confortable (plusieurs jours sans réponse, alarmes
// dédupliquées par jour) sans jamais peser sur la requête. DÉFAUT RÉVISABLE.
export const SOUPAPE_TASK_PROMPTS_LOOKBACK = 10;

// Le retour immédiat (`buildImmediateInsight`) exige au moins `MIN_OBSERVATIONS` (5)
// réponses de CHAQUE côté (matin/après-midi), ou par catégorie — donc potentiellement
// 10+ réponses répondues avant qu'un motif soit même observable. À 7-8 alarmes/jour,
// l'ancienne fenêtre de 30 lignes (alarmes brutes, répondues ou non) couvrait à peine
// 4 jours, et les non-répondues occupaient une partie de cette fenêtre : la règle
// matin/après-midi risquait de n'être jamais atteignable. 200 lignes couvrent environ
// 3 à 4 semaines même avec beaucoup d'ignorées — largement de quoi accumuler 5
// réponses de chaque côté une fois l'usage installé. DÉFAUT RÉVISABLE.
export const INSIGHT_TASK_PROMPTS_LOOKBACK = 200;

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check (Railway, monitoring)
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error('[health] DB connection error:', err.message);
      res.status(503).json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() });
    }
  });

  // ── Config publique (no auth) ──────────────────────────────────────
  app.get('/api/config', (_req, res) => {
    res.json({ waitlistMode: process.env.WAITLIST_MODE === 'true' });
  });

  // ── Waitlist ────────────────────────────────────────────────────────
  app.post('/api/waitlist', async (req, res) => {
    try {
      const { email, language, description } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'invalid_email' });
      }
      const existing = await db.select({ id: waitlist.id })
        .from(waitlist)
        .where(eq(waitlist.email, email.trim().toLowerCase()))
        .limit(1);
      if (existing.length > 0) {
        return res.json({ error: 'already_registered' });
      }
      await db.insert(waitlist).values({
        email: email.trim().toLowerCase(),
        language: language || 'fr',
        source: 'landing',
        description: description?.trim() || null,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[waitlist] error:', error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Admin waitlist (protégé par ADMIN_SECRET) ───────────────────────
  app.get('/admin/waitlist', async (req, res) => {
    const secret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.query.secret;
    if (!secret || provided !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const entries = await db.select().from(waitlist).orderBy(waitlist.createdAt);
      const total = entries.length;
      const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Naya Waitlist (${total})</title>
<style>body{font-family:monospace;padding:2rem;background:#f7f5ee}h1{font-size:1rem;letter-spacing:.2em;text-transform:uppercase;color:#5a5235}table{width:100%;border-collapse:collapse;margin-top:1rem}th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #ddd;font-size:.85rem}th{background:#eae8df;color:#5a5235}tr:hover{background:#f0ede3}</style>
</head><body>
<h1>Waitlist — ${total} inscrit${total > 1 ? 's' : ''}</h1>
<table><thead><tr><th>#</th><th>Email</th><th>Langue</th><th>Source</th><th>Date</th></tr></thead><tbody>
${entries.map((e, i) => `<tr><td>${i + 1}</td><td>${e.email}</td><td>${e.language || 'fr'}</td><td>${e.source || 'landing'}</td><td>${e.createdAt ? new Date(e.createdAt).toLocaleString('fr-FR') : '—'}</td></tr>`).join('')}
</tbody></table></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ─── Meta / Facebook signed_request helper ─────────────────────────────────
  // Décode ET vérifie la signature HMAC-SHA256 du signed_request envoyé par Meta.
  // Réf : https://developers.facebook.com/docs/facebook-login/guides/advanced/data-deletion-callback
  function parseSignedRequest(signedRequest: string): { user_id?: string } | null {
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!appSecret) {
      console.error('[Meta] INSTAGRAM_APP_SECRET absent — impossible de vérifier le signed_request');
      return null;
    }
    const [encodedSig, payload] = signedRequest.split('.');
    if (!encodedSig || !payload) return null;

    // base64url → base64
    const b64url = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest();
    const providedSig = Buffer.from(b64url(encodedSig), 'base64');

    if (
      expectedSig.length !== providedSig.length ||
      !crypto.timingSafeEqual(expectedSig, providedSig)
    ) {
      console.error('[Meta] signed_request : signature invalide');
      return null;
    }
    try {
      return JSON.parse(Buffer.from(b64url(payload), 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }

  // ─── Meta / Facebook data deletion callback (RGPD + Platform Terms) ─────────
  // Meta appelle cette URL quand un utilisateur demande la suppression de ses données.
  app.post('/api/meta/data-deletion', async (req, res) => {
    try {
      const signedRequest = req.body?.signed_request;
      if (!signedRequest) return res.status(400).json({ error: 'missing signed_request' });

      const decoded = parseSignedRequest(signedRequest);
      if (!decoded) return res.status(400).json({ error: 'invalid_signed_request' });

      const facebookUserId = decoded.user_id;
      const confirmationCode = `naya-del-${Date.now()}-${facebookUserId || 'unknown'}`;

      // Suppression effective des comptes sociaux Meta liés à cet utilisateur.
      if (facebookUserId) {
        try {
          const removed = await storage.deleteSocialAccountsByPlatformUserId(facebookUserId);
          console.log(`[Meta] Data deletion ${facebookUserId} : ${removed} compte(s) social(aux) supprimé(s) — code ${confirmationCode}`);
        } catch (e: any) {
          console.error(`[Meta] Échec suppression pour ${facebookUserId}:`, e.message);
        }
      }

      // Meta exige une URL de statut + un code de confirmation traçable.
      res.json({
        url: `https://hellonaya.app/data-deletion?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
      });
    } catch (err: any) {
      console.error('[Meta] Data deletion error:', err.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET version pour vérification manuelle / page de statut
  app.get('/api/meta/data-deletion', (_req, res) => {
    res.json({ status: 'ok', description: 'Meta data deletion callback endpoint' });
  });

  // ─── Meta / Facebook deauthorize callback ──────────────────────────────────
  // Meta appelle cette URL quand un utilisateur retire l'app de ses paramètres.
  // On révoque immédiatement les tokens stockés pour cet utilisateur Meta.
  app.post('/api/meta/deauthorize', async (req, res) => {
    try {
      const signedRequest = req.body?.signed_request;
      if (!signedRequest) return res.status(400).json({ error: 'missing signed_request' });

      const decoded = parseSignedRequest(signedRequest);
      if (!decoded) return res.status(400).json({ error: 'invalid_signed_request' });

      if (decoded.user_id) {
        const removed = await storage.deleteSocialAccountsByPlatformUserId(decoded.user_id);
        console.log(`[Meta] Deauthorize ${decoded.user_id} : ${removed} compte(s) révoqué(s)`);
      }
      res.sendStatus(200);
    } catch (err: any) {
      console.error('[Meta] Deauthorize error:', err.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Admin: trigger auto-planner manually (for testing / debug)
  app.post('/api/admin/auto-plan', isAuthenticated, async (req: any, res) => {
    try {
      const { date } = req.body;
      const result = await runDailyAutoPlanner(date);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Stripe webhook (corps brut monté dans index.ts) ───────────────────────
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
      console.error("[Stripe] signature webhook invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotence : on ignore un event déjà traité.
    if (await storage.isStripeEventProcessed(event.id)) return res.json({ received: true });

    async function resolveUserId(sub: any): Promise<string | undefined> {
      let uid = sub.metadata?.nayaUserId as string | undefined;
      if (!uid) {
        const customer = await stripe.customers.retrieve(sub.customer as string) as any;
        uid = customer?.metadata?.nayaUserId;
      }
      return uid;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as any;
          const userId = session.metadata?.nayaUserId;
          if (userId && session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            await syncSubscriptionFromStripe(userId, sub);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as any;
          const uid = await resolveUserId(sub);
          if (uid) await syncSubscriptionFromStripe(uid, sub);
          break;
        }
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription as string) as any;
            const uid = await resolveUserId(sub);
            if (uid) await syncSubscriptionFromStripe(uid, sub);
          }
          break;
        }
      }
      await storage.markStripeEventProcessed(event.id);
      res.json({ received: true });
    } catch (err: any) {
      console.error("[Stripe] erreur traitement webhook:", err.message);
      res.status(500).json({ error: "webhook_handler_failed" });
    }
  });

  // Auth middleware
  await setupAuth(app);

  // Gate d'abonnement global : protège toutes les routes de données métier.
  // (auth, billing, stripe, meta, oauth, waitlist, health, admin sont en allowlist)
  app.use(gateNayaAccess);

  // ─── Google Calendar OAuth ────────────────────────────────────────────────

  // GET /api/calendar/status — check if user has connected Google Calendar
  app.get('/api/calendar/status', isAuthenticated, async (req: any, res) => {
    try {
      const connected = await storage.hasGoogleCalendarToken(req.userId);
      res.json({ connected });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/calendar/oauth/url — get Google consent URL
  app.get('/api/calendar/oauth/url', isAuthenticated, async (req: any, res) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ message: 'Google Calendar not configured on this server' });
      }
      (req.session as any).calendarOAuthUserId = req.userId;
      const url = getAuthUrl();
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/calendar/oauth/callback — Google redirects here after consent
  app.get('/api/calendar/oauth/callback', async (req: any, res) => {
    const code = req.query.code as string;
    const userId = (req.session as any)?.calendarOAuthUserId || req.session?.userId;
    if (!code || !userId) {
      return res.redirect('/?calendar=error');
    }
    try {
      await exchangeCodeForTokens(userId, code);
      delete (req.session as any).calendarOAuthUserId;
      res.redirect('/settings?calendar=connected');
    } catch (err: any) {
      console.error('[GCal] OAuth callback error:', err.message);
      res.redirect('/settings?calendar=error');
    }
  });

  // GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD — fetch events
  app.get('/api/calendar/events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const start = req.query.start as string || new Date().toISOString().slice(0, 10);
      const end = req.query.end as string || start;
      const events = await getCalendarEvents(userId, start, end);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/calendar/disconnect — remove stored tokens
  app.delete('/api/calendar/disconnect', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteGoogleCalendarToken(req.userId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Social OAuth ────────────────────────────────────────────────────────────

  // GET /api/social/oauth/:platform/url — génère l'URL de consentement
  app.get('/api/social/oauth/:platform/url', isAuthenticated, async (req: any, res) => {
    const { platform } = req.params;
    const validPlatforms = ['instagram', 'linkedin', 'twitter', 'tiktok'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: "social_connect_failed", message: `Plateforme non supportée: ${platform}` });
    }
    if (!isPlatformConfigured(platform as any)) {
      return res.status(503).json({
        error: "social_not_configured",
        message: `${platform} n'est pas encore configuré sur ce serveur. Ajoute les variables d'environnement.`,
        notConfigured: true,
      });
    }
    try {
      const state = `${req.userId}:${Date.now()}`;
      (req.session as any).socialOAuthState = state;
      (req.session as any).socialOAuthUserId = req.userId;

      let url: string;
      if (platform === 'instagram') {
        url = getInstagramAuthUrl(state);
      } else if (platform === 'linkedin') {
        url = getLinkedInAuthUrl(state);
      } else if (platform === 'tiktok') {
        url = getTikTokAuthUrl(state);
      } else {
        // twitter — génère un code_verifier simple
        const codeVerifier = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        (req.session as any).twitterCodeVerifier = codeVerifier;
        url = getTwitterAuthUrl(state, codeVerifier);
      }
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: "social_connect_failed", message: err.message });
    }
  });

  // GET /api/social/oauth/:platform/callback — reçoit le code, échange le token
  app.get('/api/social/oauth/:platform/callback', async (req: any, res) => {
    const { platform } = req.params;
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      console.error(`[Social OAuth] ${platform} error:`, error);
      return res.redirect(`/settings?social=${platform}&status=error&reason=${encodeURIComponent(error)}`);
    }

    // Récupérer userId depuis la session OU depuis le state (fallback si session perdue)
    const sessionUserId = (req.session as any)?.socialOAuthUserId || (req.session as any)?.userId;
    const stateUserId = state?.split(':')[0];
    const userId = sessionUserId || stateUserId;

    if (!code) {
      return res.redirect(`/settings?social=${platform}&status=error&reason=missing_code`);
    }
    if (!userId) {
      return res.redirect(`/settings?social=${platform}&status=error&reason=missing_session`);
    }

    try {
      if (platform === 'instagram') {
        await exchangeInstagramCode(userId, code);
      } else if (platform === 'linkedin') {
        await exchangeLinkedInCode(userId, code);
      } else if (platform === 'tiktok') {
        await exchangeTikTokCode(userId, code);
      } else if (platform === 'twitter') {
        const codeVerifier = (req.session as any)?.twitterCodeVerifier || '';
        await exchangeTwitterCode(userId, code, codeVerifier);
        delete (req.session as any).twitterCodeVerifier;
      }
      delete (req.session as any).socialOAuthState;
      delete (req.session as any).socialOAuthUserId;
      res.redirect(`/settings?social=${platform}&status=connected`);
    } catch (err: any) {
      console.error(`[Social OAuth] ${platform} callback error:`, err.message);
      res.redirect(`/settings?social=${platform}&status=error&reason=${encodeURIComponent(err.message)}`);
    }
  });

  // GET /api/social/status — état de connexion de tous les réseaux
  // Liste des comptes sociaux connectés (avec IDs) pour le composer multi-réseaux.
  // Inclut profils + pages LinkedIn + IG/FB/TikTok.
  app.get('/api/social/accounts', isAuthenticated, async (req: any, res) => {
    try {
      const accounts = await storage.getSocialAccounts(req.userId);
      res.json(
        accounts
          .filter((a: any) => a.isActive)
          .map((a: any) => ({
            id: a.id,
            platform: a.platform,                                   // instagram|facebook|linkedin|linkedin_page_<id>|tiktok
            basePlatform: a.platform.startsWith('linkedin') ? 'linkedin' : a.platform,
            accountName: a.accountName,
            isPage: a.platform.startsWith('linkedin_page_'),
          })),
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/social/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const accounts = await storage.getSocialAccounts(userId);
      const status: Record<string, { connected: boolean; etat: string; accountName?: string; expiresAt?: Date; configured: boolean }> = {};

      for (const platform of ['instagram', 'linkedin', 'tiktok'] as const) {
        const account = accounts.find(a => a.platform === platform && a.isActive);
        // Compter les pages LinkedIn connectées
        const linkedinPages = platform === 'linkedin'
          ? accounts.filter(a => a.platform.startsWith('linkedin_page_') && a.isActive)
          : [];
        // ETAT REEL, pas `!!account`.
        //
        // `is_active` ne dit pas si la connexion marche : il dit qu'elle n'a pas ete revoquee
        // depuis l'application. Le 18 septembre, les deux comptes de la production portaient
        // is_active = true avec des jetons morts depuis 56 et 26 jours, et l'ecran Reglages
        // affichait « Connecte ». La route renvoyait meme `expiresAt` — que personne ne lisait.
        const etat = account
          ? etatConnexion({
              accessToken: (account as any).accessToken,
              isActive: account.isActive,
              expiresAt: (account as any).expiresAt ?? null,
              now: new Date(),
            })
          : 'absente' as const;

        status[platform] = {
          configured: isPlatformConfigured(platform),
          // `connected` veut dire UTILISABLE. Un jeton expire ne l'est pas.
          connected: etat === 'connectee' || etat === 'expire_bientot' || etat === 'echeance_inconnue',
          etat,
          accountName: account?.accountName,
          expiresAt: account?.expiresAt || undefined,
          ...(platform === 'linkedin' && linkedinPages.length > 0 && {
            pagesCount: linkedinPages.length,
          }),
        };
      }
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/social/disconnect/:platform — déconnecte un réseau
  app.delete('/api/social/disconnect/:platform', isAuthenticated, async (req: any, res) => {
    try {
      const { platform } = req.params;
      const userId = req.userId;
      const account = await storage.getSocialAccountByPlatform(userId, platform);
      if (!account) return res.status(404).json({ message: 'Compte non trouvé' });
      await storage.deleteSocialAccount(account.id, userId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "missing_credentials", message: "Email and password are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "email_already_registered", message: "Email already registered" });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const userId = generateUserId();

      await storage.upsertUser({
        id: userId,
        email,
        hashedPassword,
        emailVerified: false,
        firstName: firstName || null,
        lastName: lastName || null,
        profileImageUrl: null,
      });

      // Create session (web)
      req.session.userId = userId;

      const user = await storage.getUser(userId);
      const { hashedPassword: _, ...userWithoutPassword } = user!;

      // JWT pour mobile
      const token = generateJWT(userId);
      res.json({ ...userWithoutPassword, token });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "register_failed", message: "Failed to register user" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "missing_credentials", message: "Email and password are required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user || !user.hashedPassword) {
        return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      }

      // Verify password
      const isValid = await verifyPassword(password, user.hashedPassword);
      if (!isValid) {
        return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
      }

      // Create session (web)
      req.session.userId = user.id;

      // JWT pour mobile
      const token = generateJWT(user.id);

      const { hashedPassword, ...userWithoutPassword } = user;
      res.json({ ...userWithoutPassword, token });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "login_failed", message: "Failed to login" });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      req.session.destroy((err) => {
        if (err) {
          console.error("Logout error:", err);
          return res.status(500).json({ message: "Failed to logout" });
        }
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out successfully" });
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ message: "Failed to logout" });
    }
  });

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const sub = await storage.getSubscription(userId);
      const allowed = hasNayaAccess(user, sub ?? null);
      const aiBlocked = await isAiBlocked(userId).catch(() => false);
      const prefs = await storage.getUserPreferences(userId).catch(() => undefined);
      const { hashedPassword, ...userWithoutPassword } = user;
      res.json({
        ...userWithoutPassword,
        // Langue du compte : fait autorité sur le cache du navigateur (cf. useLanguageSync).
        // `undefined` signifie « ce compte n'a pas d'avis » — pas d'écrasement d'une
        // préférence choisie côté navigateur (ex. sur la landing publique avant inscription).
        // JSON.stringify retire alors le champ de la réponse, et le garde
        // `if (!language) return;` de useLanguageSync laisse le cache décider.
        // Le français reste le défaut via client/src/lib/i18n.ts et via la colonne en base.
        language: normalizeLanguage(prefs?.language) ?? undefined,
        access: {
          allowed,
          status: sub?.status ?? null,
          trialEndsAt: sub?.trialEndsAt ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        },
        ai: { blocked: aiBlocked }, // booléen seulement — aucun montant exposé
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ─── Billing (Stripe) ──────────────────────────────────────────────────────
  app.post("/api/billing/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const existing = await storage.getSubscription(user.id);
      const customerId = await getOrCreateCustomer({
        existingCustomerId: existing?.stripeCustomerId,
        email: user.email,
        userId: user.id,
      });
      if (!existing?.stripeCustomerId) {
        await storage.upsertSubscription({ userId: user.id, stripeCustomerId: customerId });
      }
      const url = await createCheckoutSession({ customerId, userId: user.id });
      res.json({ url });
    } catch (err: any) {
      console.error("[Billing] checkout error:", err.message);
      res.status(500).json({ message: "checkout_failed" });
    }
  });

  app.get("/api/billing/sync", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await storage.getSubscription(req.userId);
      if (sub?.stripeSubscriptionId) {
        const fresh = await fetchSubscription(sub.stripeSubscriptionId);
        await syncSubscriptionFromStripe(req.userId, fresh);
      } else if (sub?.stripeCustomerId) {
        const list = await stripe.subscriptions.list({ customer: sub.stripeCustomerId, limit: 1 });
        if (list.data[0]) await syncSubscriptionFromStripe(req.userId, list.data[0]);
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Billing] sync error:", err.message);
      res.status(500).json({ message: "sync_failed" });
    }
  });

  app.post("/api/billing/portal", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await storage.getSubscription(req.userId);
      if (!sub?.stripeCustomerId) return res.status(400).json({ message: "no_customer" });
      const url = await createPortalSession(sub.stripeCustomerId);
      res.json({ url });
    } catch (err: any) {
      console.error("[Billing] portal error:", err.message);
      res.status(500).json({ message: "portal_failed" });
    }
  });

  app.post("/api/billing/redeem-code", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") return res.status(400).json({ message: "code_required" });
      const result = await redeemAccessCode(req.userId, code);
      if (!result.ok) return res.status(400).json({ message: result.reason });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Billing] redeem error:", err.message);
      res.status(500).json({ message: "redeem_failed" });
    }
  });

  // ── Dossiers de recherche (fil `savoir`) — RESERVE AU PROPRIETAIRE ──────────
  //
  // Demande de Jeanne : « un endroit ou je pourrais renseigner des dossiers qui
  // permettraient a Naya de mieux comprendre a quoi ressemble une bonne prospection », et
  // des dossiers sur ce qui fonctionne en digital pour que sa creation de contenu soit
  // « plus pointue, moins generique ».
  //
  // Le controle de role est le MEME que pour les codes d'acces : `user.role === "owner"`.
  app.post("/api/savoir/dossiers", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });

      const { contenu, projectId } = req.body ?? {};
      // " — " sépare le titre du morceau en mémoire : on l'évite dans le titre. Sans titre :
      // horodatage, pour que deux collages anonymes ne se télescopent pas.
      const titre = normaliserTitre(typeof req.body?.titre === "string" ? req.body.titre : "") || titreParDefaut();
      if (typeof contenu !== "string" || !contenu.trim()) {
        return res.status(400).json({ message: "contenu_requis" });
      }

      // Même titre qu'un dossier non retiré : on refuse (retirer d'abord, puis redéposer).
      if (await dossierExiste(req.userId, titre)) {
        return res.status(409).json({ message: "deja_depose" });
      }

      const r = await deposerDossier({
        userId: req.userId,
        projectId: typeof projectId === "number" && Number.isInteger(projectId) && projectId > 0 ? projectId : null,
        titre,
        contenu,
      });

      // `morceaux: 0` n'est pas une erreur : c'est un document sans texte exploitable.
      // On le DIT, au lieu de renvoyer un succes muet.
      res.json({ ...r, message: r.morceaux === 0 ? "aucun_contenu_exploitable" : "depose" });
    } catch (e: any) {
      console.error("[Savoir] depot impossible:", e?.message ?? e);
      res.status(500).json({ message: e.message });
    }
  });

  // Ce que Naya a appris — pour relire, et pour pouvoir retirer.
  app.get("/api/savoir/dossiers", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const rows = await listerDossiers(req.userId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Dépôt de PDF (1 à 10 fichiers, 10 Mo chacun — limite appliquée par multer AVANT toute
  // extraction). Un fichier en échec n'empêche pas les autres d'être déposés.
  app.post("/api/savoir/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
    upload.array("fichiers", 10)(req, res, async (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "fichier_trop_lourd" });
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({ message: "trop_de_fichiers" });
        }
        return res.status(400).json({ message: "envoi_invalide" });
      }
      try {
        const fichiers = (req.files as Express.Multer.File[] | undefined) ?? [];
        if (fichiers.length === 0) return res.status(400).json({ message: "aucun_fichier" });
        const pid = Number(req.body?.projectId);
        const projectId = Number.isInteger(pid) && pid > 0 ? pid : null;
        const resultats: { fichier: string; titre: string; statut: string; morceaux?: number }[] = [];
        for (const f of fichiers) {
          // multer décode les noms en latin1 : on rétablit l'UTF-8 (accents).
          const nom = Buffer.from(f.originalname, "latin1").toString("utf8");
          const titre = titreDepuisNomFichier(nom);
          const fin = (statut: string, morceaux?: number) =>
            resultats.push({ fichier: nom, titre, statut, ...(morceaux !== undefined ? { morceaux } : {}) });
          try {
            // Certains navigateurs/OS envoient octet-stream ou rien : la signature %PDF- tranche.
            if (!["application/pdf", "application/octet-stream", ""].includes(f.mimetype)) { fin("pas_un_pdf"); continue; }
            if (f.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") { fin("pas_un_pdf"); continue; }
            // Doublon refusé AVANT d'analyser le fichier.
            if (await dossierExiste(req.userId, titre)) { fin("deja_depose"); continue; }
            const ex = await extraireTextePdf(f.buffer);
            if (ex.statut !== "ok") { fin(ex.statut); continue; }
            const r = await deposerDossier({
              userId: req.userId,
              projectId,
              titre,
              contenu: ex.texte,
            });
            if (r.morceaux === 0) { fin("pas_de_texte"); continue; }
            fin("depose", r.morceaux);
          } catch (e: any) {
            console.error("[Savoir] pdf en échec:", e?.message ?? e);
            fin("illisible");
          }
        }
        res.json({ resultats });
      } catch (e: any) {
        console.error("[Savoir] depot pdf impossible:", e?.message ?? e);
        res.status(500).json({ message: e.message });
      }
    });
  });

  // État de l'indexation (sonde fournisseur mise en cache 5 min + nombre de souvenirs sans vecteur).
  app.get("/api/savoir/index", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const [sonde, manquants] = await Promise.all([sonderEmbeddings({ forcer: req.query?.forcer === "1" }), compterManquants(req.userId)]);
      res.json({ ...sonde, manquants });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Rattrape les souvenirs sans vecteur.
  app.post("/api/savoir/index", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const r = await indexerManquants(depsReelles, req.userId);
      res.json(r);
    } catch (e: any) {
      console.error("[Savoir] indexation impossible:", e?.message ?? e);
      res.status(500).json({ message: e.message });
    } finally {
      invaliderSonde();
    }
  });

  // Retrait d'un dossier : invalidation (superseded_at), jamais de suppression.
  app.delete("/api/savoir/dossiers", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const titre = req.body?.titre;
      if (typeof titre !== "string" || !titre.trim()) return res.status(400).json({ message: "titre_requis" });
      const retires = await retirerDossier(req.userId, titre);
      if (retires === 0) return res.status(404).json({ message: "introuvable" });
      res.json({ retires });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Owner only — création de codes d'accès (testeurs)
  app.post("/api/admin/access-codes", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const { code, label, maxRedemptions, expiresAt } = req.body;
      if (!code || typeof code !== "string") return res.status(400).json({ message: "code_required" });
      const created = await storage.createAccessCode({
        code: code.trim(),
        label,
        maxRedemptions: maxRedemptions ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      res.json(created);
    } catch (err: any) {
      console.error("[Admin] create code error:", err.message);
      res.status(500).json({ message: "create_code_failed" });
    }
  });

  // Brand DNA routes
  app.get('/api/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      // `?? null` : res.json(undefined) envoie un 200 au corps VIDE, que le client ne
      // sait pas parser (écran d'erreur pour tout compte sans ADN, ex. après réinit).
      res.json(brandDna ?? null);
    } catch (error) {
      console.error("Error fetching brand DNA:", error);
      res.status(500).json({ message: "Failed to fetch brand DNA" });
    }
  });

  app.post('/api/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDnaData = insertBrandDnaSchema.parse({ ...req.body, userId });
      const brandDna = await storage.upsertBrandDna(brandDnaData);
      
      // Generate welcome tasks immediately after Brand DNA completion
      console.log('Brand DNA completed, generating strategic welcome tasks...');
      try {
        await taskPreGenerationService.generateWelcomeTasks(userId, brandDna);
        console.log('Welcome tasks generated successfully');
      } catch (taskError) {
        console.error('Welcome task generation failed:', taskError);
      }

      // Auto-create first project from Brand DNA if user has none
      try {
        const existingProjects = await storage.getProjects(userId);
        if (existingProjects.length === 0) {
          // Infer project type from business type
          let projectType = "Business";
          const bizType = (brandDna.businessType || "").toLowerCase();
          if (bizType.includes("personal brand") || bizType.includes("creator") || bizType.includes("influencer")) {
            projectType = "Personal Brand";
          } else if (bizType.includes("coaching") || bizType.includes("course")) {
            projectType = "Personal Brand";
          }

          // Infer monetization intent from revenue urgency
          let monetizationIntent = "exploratory";
          const urgency = (brandDna.revenueUrgency || "").toLowerCase();
          if (urgency.includes("asap") || urgency.includes("need") || urgency.includes("critical")) {
            monetizationIntent = "revenue-now";
          } else if (urgency.includes("scale") || urgency.includes("grow")) {
            monetizationIntent = "authority-building";
          }

          const project = await storage.createProject({
            userId,
            name: brandDna.businessName || "My First Project",
            icon: projectType === "Personal Brand" ? "✨" : "🚀",
            color: "#6366f1",
            type: projectType,
            description: brandDna.uniquePositioning || undefined,
            monetizationIntent,
            priorityLevel: "primary",
            projectStatus: "active",
            isPrimary: true,
          });

          // Create project strategy profile from brand DNA
          await storage.upsertProjectStrategyProfile({
            projectId: project.id,
            projectIntent: brandDna.primaryGoal || undefined,
            successDefinition: brandDna.successDefinition || undefined,
            operatingMode: "grow",
            targetAudience: brandDna.targetAudience || undefined,
            corePainPoint: brandDna.corePainPoint || undefined,
            audienceAspiration: brandDna.audienceAspiration || undefined,
            communicationStyle: brandDna.communicationStyle || undefined,
            uniquePositioning: brandDna.uniquePositioning || undefined,
            contentPillars: brandDna.contentPillars || undefined,
            platformPriority: brandDna.platformPriority || undefined,
          });

          // Set active project in user preferences
          await storage.upsertUserPreferences(userId, { activeProjectId: project.id });

          console.log('Auto-created first project:', project.name);

          // Detect user persona and save
          const personaResult = detectUserPersona(brandDna);
          const archetypes = await storage.getUserPersonaArchetypes();
          const matchedArchetype = archetypes.find(a => a.name === personaResult.personaName);
          
          await storage.savePersonaAnalysisResult({
            userId,
            projectId: project.id,
            personaType: 'user',
            inputContext: { brandDnaId: brandDna.id },
            analysisResult: {
              personaName: personaResult.personaName,
              personaId: matchedArchetype?.id,
              confidence: personaResult.confidence,
              reasoning: personaResult.reasoning,
              outputStyleGuidelines: personaResult.outputStyleGuidelines,
            },
          });

          // Analyze and save target persona
          if (brandDna.targetAudience) {
            const targetProfile = analyzeTargetPersona(
              brandDna.targetAudience,
              brandDna.corePainPoint || "",
              brandDna.audienceAspiration || "",
              { type: projectType, monetizationIntent }
            );
            await storage.createTargetPersona({
              userId,
              projectId: project.id,
              name: targetProfile.name,
              industry: targetProfile.industry,
              jobTitle: targetProfile.jobTitle,
              companySize: targetProfile.companySize,
              motivations: targetProfile.motivations,
              frustrations: targetProfile.frustrations,
              decisionTriggers: targetProfile.decisionTriggers,
              persuasionDrivers: targetProfile.persuasionDrivers,
              preferredChannels: targetProfile.preferredChannels,
              isAiGenerated: true,
            });
          }
        }
      } catch (projectError) {
        console.error('Auto project creation failed:', projectError);
      }
      
      res.json(brandDna);
    } catch (error) {
      console.error("Error saving brand DNA:", error);
      res.status(500).json({ message: "Failed to save brand DNA" });
    }
  });

  // PATCH /api/brand-dna — update any subset of brand DNA fields
  app.patch('/api/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const existing = await storage.getBrandDna(userId);
      if (!existing) return res.status(404).json({ message: "Brand DNA not found" });
      const updated = await storage.upsertBrandDna({ ...existing, ...req.body, userId });
      res.json(updated);
    } catch (error) {
      console.error("Error updating brand DNA:", error);
      res.status(500).json({ message: "Failed to update brand DNA" });
    }
  });

  // GET /api/projects/:id/brand-dna — get project-specific Brand DNA
  app.get('/api/projects/:id/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project id" });
      const dna = await storage.getBrandDnaForProject(userId, projectId);
      res.json(dna || null);
    } catch (error) {
      console.error("Error fetching project brand DNA:", error);
      res.status(500).json({ message: "Failed to fetch project brand DNA" });
    }
  });

  // PATCH /api/projects/:id/brand-dna — create or update project-specific Brand DNA
  app.patch('/api/projects/:id/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project id" });
      const updated = await storage.upsertBrandDnaForProject(userId, projectId, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating project brand DNA:", error);
      res.status(500).json({ message: "Failed to update project brand DNA" });
    }
  });

  // POST /api/brand-dna/refresh-intelligence — generate Naya intelligence summary
  app.post('/api/brand-dna/refresh-intelligence', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      let projectId: number | null = null;
      if (req.body.projectId !== undefined && req.body.projectId !== null) {
        projectId = parseInt(req.body.projectId);
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: "Invalid projectId" });
      }

      // Le DNA propre au projet peut être absent (ex. le projet PRINCIPAL utilise le DNA
      // global). Dans ce cas on retombe sur le global au lieu de renvoyer 404 — c'était la
      // cause réelle de « échec du rafraîchissement » sur Agence JMD (projet principal).
      const projectDna = projectId ? await storage.getBrandDnaForProject(userId, projectId) : null;
      const globalDna = await storage.getBrandDna(userId);
      const dna = projectDna ?? globalDna;
      if (!dna) return res.status(404).json({ message: "Brand DNA not found" });
      // On écrit le résumé là où le DNA existe vraiment : sur le DNA du projet s'il en a un,
      // sinon sur le DNA global (cas du projet principal).
      const writeToProject = projectId !== null && projectDna !== null;

      const prompt = `Write a strategic intelligence brief (200–300 words) in first person (addressing the business owner as "you").

Cover these sections:
1. Core position — what makes this business distinctive and who it serves
2. Three communication angles — the most resonant narrative directions for content and outreach
3. Two to three content formats — the best-fit formats for their platform and bandwidth
4. Main growth lever — the single highest-impact action they should double down on right now
5. One blind spot — a strategic risk or gap worth watching

Write in clear, direct language. Be specific — reference actual offers, audience, and positioning from the business context above. Avoid generic business advice. This summary is used by Naya to generate better, more targeted content and task recommendations.`;

      // Appel IA avec un petit retry (robustesse face aux aléas réseau/transitoires).
      // (Le résumé est du TEXTE libre, pas du JSON — il n'y a donc pas de JSON.parse ici.)
      let summary = "";
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          summary = await callClaudeWithContext({
            userId,
            projectId,
            userMessage: prompt,
            model: CLAUDE_MODELS.smart,
            max_tokens: 2000,
            additionalSystemContext: 'You are Naya\'s strategic intelligence engine. You write sharp, specific, actionable strategic summaries for independent builders.',
          });
          if (summary && summary.trim().length > 0) { lastErr = null; break; }
          lastErr = new Error("Empty summary returned");
        } catch (e: any) {
          lastErr = e;
          console.error(`[refresh-intelligence] attempt ${attempt} failed:`, e?.message);
        }
      }
      if (lastErr || !summary) throw (lastErr || new Error("Empty summary"));

      let updated;
      if (writeToProject) {
        updated = await storage.upsertBrandDnaForProject(userId, projectId as number, {
          nayaIntelligenceSummary: summary,
          lastStrategyRefreshAt: new Date(),
        });
      } else {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, projectId: _pid, ...brandDnaFields } = dna;
        updated = await storage.upsertBrandDna({
          ...brandDnaFields,
          nayaIntelligenceSummary: summary,
          lastStrategyRefreshAt: new Date(),
          userId: userId as string,
        } as any);
      }

      res.json({ summary, updatedAt: updated.lastStrategyRefreshAt, projectId });
    } catch (error: any) {
      // Logue la VRAIE cause (pas un message générique) pour diagnostic.
      console.error("Error refreshing intelligence:", error?.stack || error?.message || error);
      const detail = process.env.NODE_ENV !== 'production' ? { detail: error?.message } : {};
      res.status(500).json({ message: "Failed to refresh intelligence", ...detail });
    }
  });

  // ─── New Three-Layer Onboarding Endpoint ────────────────────────────────────

  app.post('/api/onboarding', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { operatingProfile, primaryProject, additionalProjects = [] } = req.body;

      if (!primaryProject?.name) {
        return res.status(400).json({ message: "Primary project name is required" });
      }

      // 1. Save operating profile (if any fields provided)
      const hasProfile = operatingProfile && Object.values(operatingProfile).some(v =>
        v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
      );
      if (hasProfile) {
        await storage.upsertUserOperatingProfile(userId, operatingProfile);
      }

      // 2. Save brand DNA from primary project data
      const brandDnaData = insertBrandDnaSchema.parse({
        userId,
        businessName: primaryProject.name,
        website: primaryProject.website || null,
        linkedinProfile: primaryProject.linkedinProfile || null,
        instagramHandle: primaryProject.instagramHandle || null,
        businessType: primaryProject.businessType || 'Independent Professional',
        businessModel: primaryProject.businessModel || 'services',
        revenueUrgency: primaryProject.revenueUrgency || 'growing-steadily',
        targetAudience: primaryProject.targetAudience || '',
        corePainPoint: primaryProject.corePainPoint || '',
        audienceAspiration: primaryProject.audienceAspiration || '',
        authorityLevel: primaryProject.authorityLevel || '',
        communicationStyle: primaryProject.communicationStyle || '',
        uniquePositioning: primaryProject.uniquePositioning || '',
        platformPriority: primaryProject.platformPriority || '',
        currentPresence: primaryProject.currentPresence || '',
        primaryGoal: primaryProject.primaryGoal || '',
        contentBandwidth: primaryProject.contentBandwidth || '',
        successDefinition: primaryProject.successDefinition || '',
        currentChallenges: primaryProject.currentChallenges || null,
        pastSuccess: primaryProject.pastSuccess || null,
        inspiration: primaryProject.inspiration || null,
        offers: primaryProject.offers || null,
        priceRange: primaryProject.priceRange || null,
        clientJourney: primaryProject.clientJourney || null,
        brandVoiceKeywords: primaryProject.brandVoiceKeywords || [],
        brandVoiceAntiKeywords: primaryProject.brandVoiceAntiKeywords || [],
        editorialTerritory: primaryProject.editorialTerritory || null,
        competitorLandscape: primaryProject.competitorLandscape || null,
      });
      const brandDna = await storage.upsertBrandDna(brandDnaData);

      // 3. Always create a fresh primary project (never reuse after reset)
      let primaryProjectRecord: any;

      let projectType = "Business";
      const bizType = (primaryProject.businessType || "").toLowerCase();
      if (bizType.includes("personal brand") || bizType.includes("creator") || bizType.includes("influencer")) {
        projectType = "Personal Brand";
      } else if (bizType.includes("coaching") || bizType.includes("course") || bizType.includes("education")) {
        projectType = "Personal Brand";
      } else if (bizType.includes("creative") || bizType.includes("studio") || bizType.includes("design")) {
        projectType = "Creative";
      }

      let monetizationIntent = "exploratory";
      const urgency = (primaryProject.revenueUrgency || "").toLowerCase();
      if (urgency.includes("asap") || urgency.includes("need") || urgency.includes("critical") || urgency.includes("revenue-now")) {
        monetizationIntent = "revenue-now";
      } else if (urgency.includes("scale") || urgency.includes("grow") || urgency.includes("authority")) {
        monetizationIntent = "authority-building";
      }

      primaryProjectRecord = await storage.createProject({
        userId,
        name: primaryProject.name,
        icon: projectType === "Personal Brand" ? "✨" : projectType === "Creative" ? "🎨" : "🚀",
        color: "#6366f1",
        type: projectType,
        description: primaryProject.uniquePositioning || undefined,
        monetizationIntent,
        priorityLevel: "primary",
        projectStatus: "active",
        isPrimary: true,
      });

      // 4. Create/update strategy profile for primary project
      await storage.upsertProjectStrategyProfile({
        projectId: primaryProjectRecord.id,
        projectIntent: primaryProject.primaryGoal || undefined,
        successDefinition: primaryProject.successDefinition || undefined,
        operatingMode: "grow",
        mainConstraint: undefined,
        targetAudience: primaryProject.targetAudience || undefined,
        corePainPoint: primaryProject.corePainPoint || undefined,
        audienceAspiration: primaryProject.audienceAspiration || undefined,
        communicationStyle: primaryProject.communicationStyle || undefined,
        uniquePositioning: primaryProject.uniquePositioning || undefined,
        platformPriority: primaryProject.platformPriority || undefined,
      });

      // 5. Create initial goal for primary project if provided
      if (primaryProject.initialGoalTitle) {
        await storage.createProjectGoal({
          projectId: primaryProjectRecord.id,
          title: primaryProject.initialGoalTitle,
          description: primaryProject.initialGoalTarget || undefined,
          goalType: primaryProject.initialGoalType || 'quarterly',
          successMode: 'exploration',
          timeframe: primaryProject.initialGoalTimeframe || undefined,
          status: 'active',
        });
      }

      // 6. Marque active + planning démarré (lève une pause ou une date future héritée
      //    d'avant une réinitialisation — voir preferencesDeFinOnboarding).
      await storage.upsertUserPreferences(userId, preferencesDeFinOnboarding(primaryProjectRecord.id));

      // 7. Persona detection for primary project
      try {
        const personaResult = detectUserPersona(brandDna);
        const archetypes = await storage.getUserPersonaArchetypes();
        const matchedArchetype = archetypes.find(a => a.name === personaResult.personaName);
        await storage.savePersonaAnalysisResult({
          userId,
          projectId: primaryProjectRecord.id,
          personaType: 'user',
          inputContext: { brandDnaId: brandDna.id },
          analysisResult: {
            personaName: personaResult.personaName,
            personaId: matchedArchetype?.id,
            confidence: personaResult.confidence,
            reasoning: personaResult.reasoning,
            outputStyleGuidelines: personaResult.outputStyleGuidelines,
          },
        });
        if (brandDna.targetAudience) {
          const targetProfile = analyzeTargetPersona(
            brandDna.targetAudience,
            brandDna.corePainPoint || "",
            brandDna.audienceAspiration || "",
            { type: projectType, monetizationIntent }
          );
          await storage.createTargetPersona({
            userId,
            projectId: primaryProjectRecord.id,
            name: targetProfile.name,
            industry: targetProfile.industry,
            jobTitle: targetProfile.jobTitle,
            companySize: targetProfile.companySize,
            motivations: targetProfile.motivations,
            frustrations: targetProfile.frustrations,
            decisionTriggers: targetProfile.decisionTriggers,
            persuasionDrivers: targetProfile.persuasionDrivers,
            preferredChannels: targetProfile.preferredChannels,
            isAiGenerated: true,
          });
        }
      } catch (personaErr) {
        console.error('Persona detection failed:', personaErr);
      }

      // 8. Create additional projects
      const additionalProjectColors = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
      const typeIcons: Record<string, string> = {
        "Business": "💼", "Creative": "🎨", "Personal Brand": "✨",
        "Learning": "📚", "Lifestyle": "🌿", "Life / Routine": "🔄", "Personal": "🙏",
      };
      for (let i = 0; i < Math.min(additionalProjects.length, 5); i++) {
        const ap = additionalProjects[i];
        if (!ap?.name) continue;
        try {
          const apProject = await storage.createProject({
            userId,
            name: ap.name,
            icon: typeIcons[ap.type] || "📁",
            color: additionalProjectColors[i % additionalProjectColors.length],
            type: ap.type || "Personal",
            description: ap.description || undefined,
            monetizationIntent: ap.intent === "revenue" ? "revenue-now" : ap.intent === "exploration" ? "exploratory" : "none",
            priorityLevel: "secondary",
            projectStatus: "active",
            isPrimary: false,
          });
          if (ap.goalTitle) {
            await storage.createProjectGoal({
              projectId: apProject.id,
              title: ap.goalTitle,
              description: undefined,
              goalType: 'milestone',
              successMode: ap.intent === 'personal-growth' ? 'exploration' : ap.intent === 'wellbeing' ? 'wellbeing' : 'exploration',
              timeframe: ap.goalTimeframe || undefined,
              status: 'active',
            });
          }
          // Create lightweight strategy profile
          await storage.upsertProjectStrategyProfile({
            projectId: apProject.id,
            projectIntent: ap.intent || undefined,
            operatingMode: "explore",
          });

          // Brand DNA PROPRE au projet — un projet additionnel est souvent un AUTRE business
          // (ex. un blog de cuisine ≠ une agence de com mode). On NE doit PAS hériter de
          // l'identité du projet principal. On renseigne les champs connus et on VIDE
          // explicitement les champs substantiels (audience, douleur, positionnement…) pour
          // qu'ils ne soient pas recopiés depuis le DNA global. L'utilisateur les affine
          // ensuite par projet (page Stratégie / réglages).
          await storage.upsertProjectBrandDnaClean(userId, apProject.id, {
            businessName: ap.name,
            website: null, linkedinProfile: null, instagramHandle: null,
            businessType: ap.type || 'Independent Professional',
            businessModel: '',
            revenueUrgency: ap.intent === 'revenue' ? 'growing-steadily' : 'exploratory',
            targetAudience: '',
            corePainPoint: '',
            audienceAspiration: '',
            authorityLevel: '',
            communicationStyle: '',
            uniquePositioning: ap.description || ap.name,
            platformPriority: '',
            currentPresence: '',
            primaryGoal: ap.goalTitle || '',
            contentBandwidth: '',
            successDefinition: '',
            currentChallenges: null, pastSuccess: null, inspiration: null,
            offers: null, priceRange: null, clientJourney: null,
            brandVoiceKeywords: [], brandVoiceAntiKeywords: [],
            editorialTerritory: null, competitorLandscape: null,
          } as any).catch((e: any) => console.error(`Project DNA for "${ap.name}" failed:`, e?.message));
        } catch (apErr) {
          console.error(`Failed to create additional project "${ap.name}":`, apErr);
        }
      }

      // 9. Generate welcome tasks
      try {
        await taskPreGenerationService.generateWelcomeTasks(userId, brandDna);
      } catch (taskErr) {
        console.error('Welcome task generation failed:', taskErr);
      }

      res.json({ success: true, primaryProjectId: primaryProjectRecord.id, brandDnaId: brandDna.id });
    } catch (error) {
      console.error("Error in onboarding:", error);
      res.status(500).json({ message: "Onboarding failed. Please try again." });
    }
  });

  // ─── Client Routes ──────────────────────────────────────────────────────────

  app.get('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid projectId" });
      }
      const clientList = await storage.getClients(userId, projectId);
      res.json(clientList);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.post('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const data = insertClientSchema.parse({ ...req.body, userId });
      const client = await storage.createClient(data);
      res.json(client);
    } catch (error) {
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch('/api/clients/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.getClient(id);
      if (!client || client.userId !== req.userId) {
        return res.status(404).json({ message: "Client not found" });
      }
      const updated = await storage.updateClient(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete('/api/clients/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.getClient(id);
      if (!client || client.userId !== req.userId) {
        return res.status(404).json({ message: "Client not found" });
      }
      await storage.deleteClient(id);
      res.json({ message: "Client deleted" });
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  app.get('/api/clients/:id/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.getClient(id);
      if (!client || client.userId !== req.userId) {
        return res.status(404).json({ message: "Client not found" });
      }
      const tasks = await storage.getClientTasks(id);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching client tasks:", error);
      res.status(500).json({ message: "Failed to fetch client tasks" });
    }
  });

  // ─── Project Routes ─────────────────────────────────────────────────────────

  app.get('/api/projects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const projectsList = await storage.getProjects(userId, limit, offset);
      res.json(projectsList);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.post('/api/projects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectData = insertProjectSchema.parse({ ...req.body, userId });
      const existingProjects = await storage.getProjects(userId);
      if (existingProjects.length === 0) {
        projectData.isPrimary = true;
        projectData.priorityLevel = 'primary';
      }
      const project = await storage.createProject(projectData);
      if (existingProjects.length === 0) {
        await storage.upsertUserPreferences(userId, { activeProjectId: project.id });
      }
      res.json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  // Statut de surcharge PAR PROJET (jamais un cumul global) : pour chaque projet, on compare le
  // nombre de ses tâches du jour à un seuil dérivé de SON budget temps/jour et de la durée
  // moyenne RÉELLE de ses tâches. overcommitted=true seulement si CE projet dépasse SON seuil.
  // IMPORTANT : doit être déclarée AVANT `/api/projects/:id` sinon le param `:id` capte "overcommit".
  app.get('/api/projects/overcommit', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const today = (typeof req.query.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.clientToday))
        ? (req.query.clientToday as string)
        : new Date().toISOString().slice(0, 10);

      const projects = await storage.getProjects(userId);
      const todayTasks = (await storage.getTasksInRange(userId, today, today))
        .filter((t: any) => t.type !== 'milestone' && t.source !== 'milestone' && !t.completed && !t.archivedAt);

      const byProject = new Map<number, any[]>();
      for (const t of todayTasks as any[]) {
        if (t.projectId == null) continue;
        if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
        byProject.get(t.projectId)!.push(t);
      }

      const result = projects.map((p: any) => {
        const tasks = byProject.get(p.id) || [];
        const status = evaluateProjectOvercommit(
          tasks.length,
          p.dailyTimeBudgetHours,
          tasks.map((t: any) => t.estimatedDuration),
        );
        return { projectId: p.id, projectName: p.name, ...status };
      });
      res.json(result);
    } catch (error: any) {
      console.error('GET /api/projects/overcommit error:', error?.message);
      res.status(500).json({ message: 'Failed to compute overcommit status' });
    }
  });

  app.get('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const goals = await storage.getProjectGoals(project.id);
      const strategyProfile = await storage.getProjectStrategyProfile(project.id);
      res.json({ ...project, goals, strategyProfile });
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.patch('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      // Sécurité : seuls les champs whitelistés sont appliqués (pas de userId/id/isPrimary
      // arbitraire). Les champs hors-liste sont ignorés.
      const picked = pickAllowedProjectFields(req.body);
      // Puis validés : une fenêtre d'attribution aberrante est figée POUR TOUJOURS sur les
      // conversions déclarées ensuite. On refuse en 400 en nommant le champ, plutôt que de
      // laisser passer une valeur qui ne crédite personne — ou de faire 500 sur une valeur
      // non numérique, ce qui ferait perdre les AUTRES champs de la même sauvegarde.
      const validated = validateProjectPatchFields(picked);
      if (!validated.ok) {
        return res.status(400).json({ message: validated.message, field: validated.field });
      }
      const project = await storage.updateProject(parseInt(req.params.id), userId, validated.fields);
      if (!project) return res.status(404).json({ message: "Project not found" });
      res.json(project);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.patch('/api/projects/:id/strategy-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "not_found" });

      const { currentStage } = req.body || {};
      if (currentStage !== undefined && !isValidStage(currentStage)) {
        return res.status(400).json({ message: "invalid_stage" });
      }

      const patch: Record<string, unknown> = {};
      if (currentStage !== undefined) patch.currentStage = currentStage;

      const strategyProfile = await storage.updateProjectStrategyProfileFields(project.id, patch);
      res.json({ strategyProfile });
    } catch (error) {
      console.error("Error updating project strategy profile:", error);
      res.status(500).json({ message: "Failed to update project strategy profile" });
    }
  });

  app.post('/api/projects/:id/situation', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "not_found" });
      if (await isAiBlocked(userId)) return res.status(429).json({ message: "ai_monthly_limit_reached" });

      const text = await callClaudeWithContext({
        userId,
        projectId: project.id,
        userMessage: buildSituationPrompt(project.name),
        max_tokens: 700,
      });
      res.json({ text });
    } catch (error) {
      console.error("Error building project situation:", error);
      res.status(500).json({ message: "Failed to build project situation" });
    }
  });

  app.delete('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const deleted = await storage.deleteProject(parseInt(req.params.id), userId);
      if (!deleted) return res.status(404).json({ message: "Project not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.post('/api/projects/:id/set-primary', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.setPrimaryProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      await storage.upsertUserPreferences(userId, { activeProjectId: project.id });
      res.json(project);
    } catch (error) {
      console.error("Error setting primary project:", error);
      res.status(500).json({ message: "Failed to set primary project" });
    }
  });

  // Project goals
  app.get('/api/projects/:id/goals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const goals = await storage.getProjectGoals(project.id);
      res.json(goals);
    } catch (error) {
      console.error("Error fetching goals:", error);
      res.status(500).json({ message: "Failed to fetch goals" });
    }
  });

  app.post('/api/projects/:id/goals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const cleaned = Object.fromEntries(
        Object.entries({ ...req.body, projectId: project.id }).map(([k, v]) => [k, v === '' ? undefined : v])
      );
      const goalData = insertProjectGoalSchema.parse(cleaned);
      const goal = await storage.createProjectGoal(goalData);
      res.json(goal);
    } catch (error) {
      console.error("Error creating goal:", error);
      res.status(500).json({ message: "Failed to create goal" });
    }
  });

  app.patch('/api/projects/:id/goals/:goalId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const cleaned = Object.fromEntries(
        Object.entries(req.body).map(([k, v]) => [k, v === '' ? undefined : v])
      );
      const goal = await storage.updateProjectGoal(parseInt(req.params.goalId), cleaned);
      if (!goal) return res.status(404).json({ message: "Goal not found" });
      res.json(goal);
    } catch (error) {
      console.error("Error updating goal:", error);
      res.status(500).json({ message: "Failed to update goal" });
    }
  });

  app.delete('/api/projects/:id/goals/:goalId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const deleted = await storage.deleteProjectGoal(parseInt(req.params.goalId));
      if (!deleted) return res.status(404).json({ message: "Goal not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting goal:", error);
      res.status(500).json({ message: "Failed to delete goal" });
    }
  });

  // POST /api/projects/:id/notes — crée une note liée à un projet
  app.post('/api/projects/:id/notes', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ message: 'ID projet invalide' });
      const { content } = req.body;

      if (!content?.trim()) {
        return res.status(400).json({ message: 'content requis' });
      }

      const note = await storage.createCaptureEntry({
        userId,
        projectId,
        content: content.trim(),
        captureType: 'note',
        classifiedType: 'note',
        isProcessed: false,
        routingStatus: 'inbox',
      } as any);

      res.json(note);
    } catch (error) {
      console.error('POST /api/projects/:id/notes error:', error);
      res.status(500).json({ message: 'Erreur création note' });
    }
  });

  // Génère un plan de tâches actionnables depuis un objectif
  app.post('/api/goals/:goalId/generate-tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const goalId = parseInt(req.params.goalId);
      const goal = await storage.getProjectGoal(goalId);
      if (!goal) return res.status(404).json({ message: "Goal not found" });

      const generatedTasks = await generateGoalTasks(userId, goalId);
      const saved: any[] = [];
      for (const t of generatedTasks) {
        const task = await storage.createTask({
          userId,
          projectId: goal.projectId,
          goalId: goalId,
          title: t.title,
          description: t.description || null,
          taskType: t.taskType || "generic",
          actionData: t.actionData || null,
          type: t.type || "planning",
          category: t.category || "planning",
          priority: t.priority || 2,
          estimatedDuration: t.estimatedDuration || 30,
          taskEnergyType: t.taskEnergyType || null,
          scheduledDate: t.scheduledDate || null,
          source: "goal",
          completed: false,
        } as any);
        saved.push(task);
      }
      res.json({ tasks: saved, count: saved.length });
    } catch (e: any) {
      console.error('[goals/generate-tasks]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/goals/:id/progress — task completion stats for a goal
  app.get('/api/goals/:id/progress', isAuthenticated, async (req: any, res) => {
    try {
      const goalId = parseInt(req.params.id);
      if (isNaN(goalId)) return res.status(400).json({ message: 'Invalid goalId' });
      const goal = await storage.getProjectGoal(goalId);
      if (!goal) return res.status(404).json({ message: 'Goal not found' });
      const progress = await storage.getGoalProgress(goalId);
      const percent = progress.total > 0
        ? Math.round((progress.completed / progress.total) * 100)
        : 0;
      res.json({ goalId, title: goal.title, ...progress, percent });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Project strategy profile
  app.get('/api/projects/:id/strategy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const profile = await storage.getProjectStrategyProfile(project.id);
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching strategy profile:", error);
      res.status(500).json({ message: "Failed to fetch strategy profile" });
    }
  });

  app.put('/api/projects/:id/strategy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const profileData = insertProjectStrategyProfileSchema.parse({ ...req.body, projectId: project.id });
      const profile = await storage.upsertProjectStrategyProfile(profileData);
      res.json(profile);
    } catch (error) {
      console.error("Error upserting strategy profile:", error);
      res.status(500).json({ message: "Failed to save strategy profile" });
    }
  });

  // Project AI recommendations (Enhanced with contextual intelligence)
  app.post('/api/projects/:id/recommendations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const project = await storage.getProject(parseInt(req.params.id), userId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const goals = await storage.getActiveGoalsForProject(project.id);
      const tasks = await storage.getTasks(userId, new Date());
      const incompleteTasks = tasks.filter(t => !t.completed);

      // Get contextual recommendations based on user behavior patterns
      const contextualRecs = await contextualRecommendationsEngine.generateRecommendations(
        userId,
        project.id
      );

      // Build context-aware rule-based recommendations
      const urgentGoals = goals.filter(g => {
        if (!g.dueDate) return false;
        const daysLeft = Math.ceil((new Date(g.dueDate).getTime() - Date.now()) / 86400000);
        return daysLeft <= 14 && daysLeft >= 0;
      });

      const ruleBased = [];

      // Goal deadline recommendations (only if contextual didn't already cover it)
      for (const goal of urgentGoals.slice(0, 2)) {
        const daysLeft = goal.dueDate
          ? Math.ceil((new Date(goal.dueDate).getTime() - Date.now()) / 86400000)
          : null;
        ruleBased.push({
          type: 'deadline',
          priority: 'high',
          title: `${goal.title} — ${daysLeft} days left`,
          description: `This ${goal.successMode} goal is approaching. ${
            goal.successMode === 'revenue' ? 'Focus on conversion activities and direct outreach today.' :
            goal.successMode === 'visibility' ? 'Prioritize publishing and engagement activities.' :
            goal.successMode === 'consistency' ? 'Stay on track — consistency is the goal, not perfection.' :
            'Make meaningful progress before the deadline.'
          }`,
          action: goal.successMode === 'revenue' ? 'Review your pipeline and follow up with warm leads' :
                  goal.successMode === 'visibility' ? 'Schedule 2-3 content pieces for this week' :
                  'Complete at least one key task related to this goal today',
        });
      }

      // Monetization-based recommendation
      if (project.monetizationIntent === 'revenue-now' && incompleteTasks.length === 0) {
        ruleBased.push({
          type: 'action',
          priority: 'medium',
          title: 'Revenue pipeline needs attention',
          description: 'You have no active tasks for a revenue-critical project. Consider generating today\'s tasks or adding a direct outreach activity.',
          action: 'Generate daily tasks or add a manual outreach task',
        });
      }

      // Exploration/passion project recommendation
      if (project.monetizationIntent === 'none' || project.monetizationIntent === 'exploratory') {
        if (goals.length === 0) {
          ruleBased.push({
            type: 'setup',
            priority: 'low',
            title: 'Define what success looks like',
            description: 'This project doesn\'t have goals yet. Even exploratory projects benefit from a clear intention — even if it\'s just "create without pressure" or "experiment weekly".',
            action: 'Add one exploratory goal to give this project direction',
          });
        }
      }

      // Merge contextual and rule-based recommendations
      // Prioritize contextual (behavior-based) over rule-based
      let allRecommendations = [...contextualRecs, ...ruleBased];

      // Remove duplicates based on title similarity
      allRecommendations = allRecommendations.filter((rec, index, self) =>
        index === self.findIndex(r => r.title === rec.title)
      );

      // Fallback if no recommendations
      if (allRecommendations.length === 0) {
        allRecommendations.push({
          type: 'momentum',
          priority: 'low',
          title: 'Keep the momentum going',
          description: `${project.name} is on track. Focus on consistency and build on your recent progress.`,
          action: 'Review your active goals and update their progress',
        });
      }

      // Return top 5 recommendations
      const recommendations = allRecommendations.slice(0, 5);

      res.json({
        projectId: project.id,
        projectName: project.name,
        recommendations
      });
    } catch (error) {
      console.error("Error generating recommendations:", error);
      res.status(500).json({ message: "Failed to generate recommendations" });
    }
  });

  // ─── User Preferences Routes ─────────────────────────────────────────────────

  app.get('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs || {
        userId,
        activeProjectId: null,
        defaultView: 'list',
        timezone: 'UTC',
        workDays: 'mon,tue,wed,thu,fri',
        lunchBreakEnabled: true,
        lunchBreakStart: '12:00',
        lunchBreakEnd: '13:00',
        workDayStart: '09:00',
        workDayEnd: '18:00',
      });
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.patch('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.upsertUserPreferences(userId, req.body);
      res.json(prefs);
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // ── Planning Pause / Resume / Restart ──────────────────────────────
  app.post('/api/planning/fix-overlaps', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const fixed = await storage.fixOverlappingTasks(userId, todayStr);
      res.json({ fixed });
    } catch (error) {
      res.status(500).json({ message: "Failed to fix overlapping tasks" });
    }
  });

  app.post('/api/planning/daily-feedback', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { date, signal } = req.body;

      const ALLOWED = ['on_track', 'felt_overloaded', 'tasks_wrong'];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !ALLOWED.includes(signal)) {
        return res.status(400).json({ message: 'date (YYYY-MM-DD) et signal valides requis' });
      }

      // Le contexte est dérivé côté serveur : le client ne sait pas ce qui compte.
      const dayTasks = await storage.getTasksInRange(userId, date, date);
      const prefs = await storage.getUserPreferences(userId).catch(() => null);

      await storage.recordDailyRhythmFeedback({
        userId,
        feedbackDate: date,
        signal,
        taskCount: dayTasks.length,
        plannedMinutes: dayTasks.reduce((sum, t) => sum + (t.estimatedDuration || 30), 0),
        bufferMin: prefs?.bufferMin ?? 10,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Error recording daily feedback:', error);
      res.status(500).json({ message: 'Failed to record daily feedback' });
    }
  });

  app.post('/api/planning/pause', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.upsertUserPreferences(userId, {
        planningStatus: 'paused',
        planningPausedAt: new Date(),
      });
      res.json({ planningStatus: prefs.planningStatus });
    } catch (error) {
      res.status(500).json({ message: "Failed to pause planning" });
    }
  });

  app.post('/api/planning/resume', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const prefs = await storage.upsertUserPreferences(userId, {
        planningStatus: 'active',
        planningStartDate: todayStr,
      });
      res.json({ planningStatus: prefs.planningStatus });
    } catch (error) {
      res.status(500).json({ message: "Failed to resume planning" });
    }
  });

  app.post('/api/planning/restart', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      // 1. Réactiver AVANT le rollover : rolloverStaleTasks se saute lui-même
      //    si la planification est en pause — or c'est souvent le cas de départ.
      const prefs = await storage.upsertUserPreferences(userId, {
        planningStatus: 'active',
        planningStartDate: todayStr,
        dailyBriefDate: null as any,
        dailyBriefContent: null,
        dailyBriefDismissed: false,
      });

      // 2. Repartir de zéro sur le futur.
      const deleted = await storage.deleteIncompleteFutureTasks(userId, todayStr);

      // Le rituel survit au redémarrage : on le re-matérialise immédiatement.
      await materializeRituals(userId, todayStr).catch((e: any) =>
        console.error('[planning/restart] materializeRituals:', e?.message),
      );

      // 3. Reprogrammer TOUTES les tâches en retard. Le passage quotidien en
      //    remonte 8 max, donc au-delà elles stagnent indéfiniment. Un redémarrage
      //    doit justement les reprendre : elles ne sont pas en cause, l'utilisateur
      //    a décroché sans mettre son planning en pause.
      const { moved } = await rolloverStaleTasks(userId, todayStr, {
        limit: Infinity,
        deferralMode: 'reset', // repartir de zéro efface aussi l'ardoise des reports
      });

      res.json({ planningStatus: prefs.planningStatus, tasksDeleted: deleted, tasksRescheduled: moved });
    } catch (error) {
      console.error("Error restarting planning:", error);
      res.status(500).json({ message: "Failed to restart planning" });
    }
  });

  app.post('/api/planning/reset', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { fromDate } = req.body;
      if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        return res.status(400).json({ message: "fromDate is required (YYYY-MM-DD)" });
      }
      const archived = await storage.archiveIncompleteFutureTasks(userId, fromDate);
      await storage.upsertUserPreferences(userId, {
        planningStatus: 'active',
        planningStartDate: fromDate,
      });

      // La question de Naya passe par les MESSAGES EN ATTENTE, comme toutes ses autres
      // paroles. Elle transitait auparavant par un evenement client dont le contenu
      // atterrissait dans le champ de saisie : Jeanne voyait la question de Naya a la place
      // de son propre texte, et elle disparaissait au moindre rechargement.
      //
      // Depose APRES l'archivage : proposer d'en parler avant d'avoir fait le travail
      // ferait parler Naya d'une remise a zero qui n'a pas eu lieu.
      //
      // Non bloquant : les taches sont deja archivees a ce stade. Echouer ici laisserait
      // croire que rien n'a ete fait, et un second clic archiverait une seconde fois.
      await storage.createPendingMessage({
        userId,
        message: "On repart de zéro. Avant de replanifier, dis-moi : est-ce que tes objectifs ou projets ont changé depuis la dernière fois ?",
        triggerType: 'planning_reset',
        relatedTaskId: null,
      }).catch((e: any) => console.error('[PlanningReset] message non depose:', e?.message ?? e));

      res.json({ archived, fromDate });
    } catch (error) {
      res.status(500).json({ message: "Failed to reset planning" });
    }
  });

  // ── Energy Level endpoints ──────────────────────────────────────────
  app.get('/api/user/energy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.getUserPreferences(userId);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const isStale = prefs?.energyUpdatedDate !== todayStr;
      res.json({
        energyLevel: isStale ? 'high' : (prefs?.currentEnergyLevel || 'high'),
        emotionalContext: isStale ? null : (prefs?.currentEmotionalContext || null),
        updatedDate: prefs?.energyUpdatedDate || null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get energy level" });
    }
  });

  app.patch('/api/user/energy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { energyLevel, emotionalContext } = req.body;
      const validLevels = ['high', 'medium', 'low', 'depleted'];
      if (!energyLevel || !validLevels.includes(energyLevel)) {
        return res.status(400).json({ message: "Invalid energy level. Must be: high, medium, low, or depleted" });
      }
      const validContextEnums = ['grief', 'transition', 'peak', 'recovery'];
      let normalizedContext: string | null = null;
      if (typeof emotionalContext === 'string' && emotionalContext.trim()) {
        const trimmed = emotionalContext.trim();
        const lower = trimmed.toLowerCase();
        const matchedEnum = validContextEnums.find(v => lower === v || lower.includes(v));
        normalizedContext = matchedEnum || (trimmed.length <= 500 ? trimmed : trimmed.slice(0, 500));
      }
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const prefs = await storage.upsertUserPreferences(userId, {
        currentEnergyLevel: energyLevel,
        currentEmotionalContext: normalizedContext,
        energyUpdatedDate: todayStr,
      });
      res.json({
        energyLevel: prefs.currentEnergyLevel,
        emotionalContext: prefs.currentEmotionalContext,
        updatedDate: prefs.energyUpdatedDate,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update energy level" });
    }
  });

  // ── Daily Brief endpoints ──────────────────────────────────────────
  app.get('/api/tasks/daily-brief', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.getUserPreferences(userId);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (prefs?.dailyBriefDate === todayStr && prefs.dailyBriefContent) {
        return res.json({
          date: todayStr,
          content: prefs.dailyBriefContent,
          dismissed: prefs.dailyBriefDismissed || false,
        });
      }
      res.json(null);
    } catch (error) {
      res.status(500).json({ message: "Failed to get daily brief" });
    }
  });

  app.post('/api/tasks/daily-brief', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.json({ needsOnboarding: true });
      }
      const prefs = await storage.getUserPreferences(userId);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (prefs?.planningStatus === 'paused') {
        return res.json({ paused: true, message: "La planification est en pause." });
      }

      const forceRefresh = req.body?.refresh === true || req.query?.refresh === 'true';
      if (!forceRefresh && prefs?.dailyBriefDate === todayStr && prefs.dailyBriefContent) {
        return res.json({ date: todayStr, content: prefs.dailyBriefContent, dismissed: prefs.dailyBriefDismissed || false });
      }

      const [todayTasks, recentContent, activeCampaigns] = await Promise.all([
        storage.getTasksInRange(userId, todayStr, todayStr),
        storage.getContent(userId, 5),
        storage.getCampaigns(userId).catch(() => [] as any[]),
      ]);

      const incompleteTasks = todayTasks.filter((t: any) => !t.completed);
      const completedTasks = todayTasks.filter((t: any) => t.completed);

      let carryoverTasks: any[] = [];
      try {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        const yesterdayTasks = await storage.getTasksInRange(userId, yesterdayStr, yesterdayStr);
        carryoverTasks = (yesterdayTasks || []).filter((t: any) => !t.completed);
      } catch {}

      const briefEnergyStale = prefs?.energyUpdatedDate !== todayStr;
      const energyLevel = briefEnergyStale ? 'high' : (prefs?.currentEnergyLevel || 'high');
      const emotionalContext = briefEnergyStale ? '' : (prefs?.currentEmotionalContext || '');

      let memoryBlock = '';
      try { memoryBlock = await getMemoryContext(userId); } catch {}

      let briefCandidates = [...incompleteTasks];
      if (energyLevel === 'low' || energyLevel === 'depleted') {
        const briefEnergyPriority: Record<string, number> = { admin: 0, creative: 1, logistics: 2, execution: 3, social: 4, deep_work: 5 };
        briefCandidates.sort((a: any, b: any) => {
          const ea = briefEnergyPriority[a.taskEnergyType] ?? 3;
          const eb = briefEnergyPriority[b.taskEnergyType] ?? 3;
          if (ea !== eb) return ea - eb;
          return (a.priority || 5) - (b.priority || 5);
        });
      } else {
        briefCandidates.sort((a: any, b: any) => (a.priority || 5) - (b.priority || 5));
      }
      const topTasks = briefCandidates
        .slice(0, 3)
        .map((t: any) => `- ${t.title} (${t.type || 'task'}, ~${t.estimatedDuration || 30}min, energy: ${t.taskEnergyType || 'execution'})`);

      const carryoverLines = carryoverTasks
        .slice(0, 1)
        .map((t: any) => `- ${t.title}`);

      let upcomingMilestone = '';
      try {
        const runningCampaigns = activeCampaigns.filter((c: any) => c.status === 'active' || c.status === 'running');
        for (const campaign of runningCampaigns.slice(0, 3)) {
          const phases = campaign.phases as any[];
          if (!phases?.length) continue;
          for (const phase of phases) {
            if (phase.endDate && phase.endDate >= todayStr) {
              upcomingMilestone = `Campaign "${campaign.name}" — phase "${phase.name || phase.title || 'Next phase'}" ends ${phase.endDate}`;
              break;
            }
          }
          if (upcomingMilestone) break;
          if (campaign.endDate && campaign.endDate >= todayStr) {
            upcomingMilestone = `Campaign "${campaign.name}" ends ${campaign.endDate}`;
            break;
          }
        }
      } catch {}

      const [operatingProfile, personaAnalysis] = await Promise.all([
        storage.getUserOperatingProfile(userId).catch(() => null),
        storage.getLatestPersonaAnalysis(userId, 'user').catch(() => null),
      ]);

      const personaName = (personaAnalysis?.analysisResult as any)?.personaName;
      const personaContext = personaName
        ? `- User persona: ${personaName}`
        : '';
      const avoidanceContext = (operatingProfile as any)?.avoidanceTriggers?.length
        ? `- Known avoidance triggers: ${((operatingProfile as any).avoidanceTriggers as string[]).join(', ')}`
        : '';
      const rhythmContext = (operatingProfile as any)?.energyRhythm
        ? `- Energy rhythm: ${(operatingProfile as any).energyRhythm}`
        : '';

      const briefSystemPrompt = `${NAYA_SYSTEM_VOICE}

RÈGLES D'ÉNERGIE :
- high : ambitieux, clair, direct. Référence la vision globale.
- medium : pratique, ancré. Favorise la dynamique sur la perfection.
- low : doux, permissif. 1-2 tâches max. Admin/créatif plutôt que deep work.
- depleted : compassionnel. Se reposer, c'est productif. Se montrer, c'est déjà beaucoup.

TA VOIX :
- Ne dis jamais "Il semble que...", "Voici un résumé...", "Super !"
- Parle à la 2e personne.
- Sois directe mais humaine. Pas corporate. Pas robot-cheerful.
- Si un déclencheur d'évitement est pertinent aujourd'hui, nomme-le doucement.
- Si persona Builder : valide le passage à l'action, alerte contre les rabbit holes.
- Si persona Stratège : relie la journée à la vision long terme.
- Si persona Créatif : donne la permission de suivre l'énergie, mais ancre sur un livrable.
- Si persona Analytique : donne une logique claire pour l'ordre des priorités.

IMPÉRATIF : réponds avec du JSON valide, et rien d'autre.`;

      const briefPrompt = `CE QUE TU SAIS D'ELLE :
- Énergie aujourd'hui : ${energyLevel}
${emotionalContext ? `- Comment elle se sent : ${emotionalContext}` : ''}
${personaContext}
${rhythmContext}
${avoidanceContext}
- Type de business : ${brandDna.businessType || 'Entrepreneur indépendante'}
- Tâches aujourd'hui : ${incompleteTasks.length} en attente, ${completedTasks.length} faites
${topTasks.length > 0 ? `\nTÂCHES DU JOUR :\n${topTasks.join('\n')}` : '\nAucune tâche planifiée pour aujourd\'hui.'}
${carryoverLines.length > 0 ? `\nRESTANT D'HIER :\n${carryoverLines.join('\n')}` : ''}
${upcomingMilestone ? `\nÀ VENIR :\n- ${upcomingMilestone}` : ''}
${memoryBlock}

Retourne du JSON valide (uniquement du JSON, rien d'autre) :
{
  "greeting": "1-2 phrases d'intro. Personnelle, directe, humaine. En français.",
  "topTasks": ["titre tâche 1", "titre tâche 2", "titre tâche 3"],
  "carryovers": ["tâche importante non faite hier — ou tableau vide"],
  "strategicReminder": "Une phrase reliant aujourd'hui à la vision. Si jalon proche, le mentionner.",
  "energyAdvice": "Une phrase pratique sur comment avancer aujourd'hui selon l'énergie."
}`;

      try {
        const briefRaw = await callClaudeWithContext({
          userId,
          projectId: prefs?.activeProjectId ?? null,
          userMessage: briefPrompt,
          model: CLAUDE_MODELS.fast,
          max_tokens: 1000,
          additionalSystemContext: `
RÈGLES ÉNERGIE :
- high : ambitieux, clair, direct. Référence la vision globale.
- medium : pratique, ancré. Favorise la dynamique sur la perfection.
- low : doux, permissif. 1-2 tâches max. Admin/créatif plutôt que deep work.
- depleted : compassionnel. Se reposer, c'est productif. Se montrer, c'est déjà beaucoup.

Réponds UNIQUEMENT avec du JSON valide. Aucun texte avant ou après.`,
        });
        const rawBrief = JSON.parse(briefRaw || "{}");
        const briefContent = {
          greeting: typeof rawBrief.greeting === 'string' ? rawBrief.greeting : '',
          topTasks: Array.isArray(rawBrief.topTasks) ? rawBrief.topTasks.slice(0, 3) : [],
          carryovers: Array.isArray(rawBrief.carryovers) ? rawBrief.carryovers.slice(0, 1) : [],
          strategicReminder: typeof rawBrief.strategicReminder === 'string' ? rawBrief.strategicReminder : '',
          energyAdvice: typeof rawBrief.energyAdvice === 'string' ? rawBrief.energyAdvice : '',
        };

        await storage.upsertUserPreferences(userId, {
          dailyBriefDate: todayStr,
          dailyBriefContent: briefContent,
          dailyBriefDismissed: false,
        });

        res.json({ date: todayStr, content: briefContent, dismissed: false });
      } catch (aiError: any) {
        const fallbackBrief = {
          greeting: energyLevel === 'depleted'
            ? "It's okay to go gentle today. You're still showing up."
            : energyLevel === 'low'
            ? "Today's a lighter day — and that's fine. Focus on what matters most."
            : `Ready to make today count. You have ${incompleteTasks.length} task${incompleteTasks.length !== 1 ? 's' : ''} lined up.`,
          topTasks: briefCandidates.slice(0, 3).map((t: any) => t.title),
          carryovers: carryoverTasks.slice(0, 1).map((t: any) => t.title),
          strategicReminder: "Every small step compounds. Stay focused on what moves the needle.",
          energyAdvice: energyLevel === 'depleted'
            ? "Consider doing just one admin task today, or resting entirely."
            : energyLevel === 'low'
            ? "Pick your single most important task and protect your energy for it."
            : "You've got a solid runway today. Tackle the deep work first.",
        };

        await storage.upsertUserPreferences(userId, {
          dailyBriefDate: todayStr,
          dailyBriefContent: fallbackBrief,
          dailyBriefDismissed: false,
        });

        res.json({ date: todayStr, content: fallbackBrief, dismissed: false });
      }
    } catch (error) {
      console.error("Error generating daily brief:", error);
      res.status(500).json({ message: "Failed to generate daily brief" });
    }
  });

  app.patch('/api/tasks/daily-brief/dismiss', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      await storage.upsertUserPreferences(userId, { dailyBriefDismissed: true });
      res.json({ dismissed: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to dismiss daily brief" });
    }
  });

  // ─── Day Availability Routes ─────────────────────────────────────────────────

  app.get('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { startDate, endDate, date } = req.query as Record<string, string>;
      if (date) {
        const row = await storage.getDayAvailability(userId, date);
        return res.json(row || null);
      }
      if (startDate && endDate) {
        const rows = await storage.getDayAvailabilityRange(userId, startDate, endDate);
        return res.json(rows);
      }
      res.status(400).json({ message: 'Provide date or startDate+endDate query params' });
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });

  app.put('/api/availability/:date', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { date } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Invalid date format' });
      const row = await storage.upsertDayAvailability(userId, date, req.body);
      res.json(row);
    } catch (error) {
      console.error("Error upserting availability:", error);
      res.status(500).json({ message: "Failed to update availability" });
    }
  });

  // ─── User Operating Profile Routes ──────────────────────────────────────────

  app.get('/api/me/operating-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const profile = await storage.getUserOperatingProfile(userId);
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching operating profile:", error);
      res.status(500).json({ message: "Failed to fetch operating profile" });
    }
  });

  app.patch('/api/me/operating-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const profile = await storage.upsertUserOperatingProfile(userId, req.body);
      res.json(profile);
    } catch (error) {
      console.error("Error updating operating profile:", error);
      res.status(500).json({ message: "Failed to update operating profile" });
    }
  });

  app.delete('/api/me/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      await storage.deleteBrandDna(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting brand DNA:", error);
      res.status(500).json({ message: "Failed to reset onboarding" });
    }
  });

  app.delete('/api/me/onboarding-reset', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      await storage.resetUserOnboardingState(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error resetting onboarding state:", error);
      const detail = process.env.NODE_ENV !== 'production'
        ? { message: error?.message, constraint: error?.constraint, detail: error?.detail }
        : { message: "Failed to reset onboarding" };
      res.status(500).json(detail);
    }
  });

  // ─── Rituels récurrents ─────────────────────────────────────────────────────

  app.post('/api/projects/:id/status-note/analyze', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id, 10);
      const { note } = req.body ?? {};
      if (typeof note !== 'string') {
        return res.status(400).json({ message: "note requise" });
      }

      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      // La note est enregistrée quoi qu'il arrive : l'analyse est un bonus,
      // son échec ne doit jamais faire perdre ce que l'utilisateur a écrit.
      await storage.updateProject(projectId, userId, { statusNote: note });

      if (await isAiBlocked(userId)) {
        return res.status(429).json({ message: "ai_monthly_limit_reached" });
      }

      const analysis = await analyzeStatusNote({
        userId, projectId, note, projectName: project.name,
      });
      res.json(analysis);
    } catch (error: any) {
      console.error("Error analyzing status note:", error);
      res.status(500).json({ message: "Analyse impossible" });
    }
  });

  app.get('/api/projects/:id/rituals', isAuthenticated, async (req: any, res) => {
    try {
      const rituals = await storage.getRituals(req.userId, parseInt(req.params.id, 10));
      res.json(rituals);
    } catch (error) {
      console.error("Error fetching rituals:", error);
      res.status(500).json({ message: "Lecture des rituels impossible" });
    }
  });

  app.post('/api/rituals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId, title, days, startTime, durationMinutes } = req.body ?? {};

      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ message: "title requis" });
      }
      if (typeof startTime !== 'string' || !isValidTimeOfDay(startTime)) {
        return res.status(400).json({ message: "startTime requis (HH:MM)" });
      }
      const duration = Number(durationMinutes);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 480) {
        return res.status(400).json({ message: "durationMinutes invalide" });
      }
      // "days" est optionnel : s'il est fourni, il doit être une liste de jours valide.
      // S'il est absent, le défaut mon-ven s'applique plus bas (comportement inchangé).
      if (typeof days === 'string' && days.trim() && !areValidDays(days)) {
        return res.status(400).json({ message: "days invalide (jours attendus : mon..sun)" });
      }
      if (projectId != null) {
        const project = await storage.getProject(Number(projectId), userId);
        if (!project) return res.status(404).json({ message: "Projet introuvable" });
      }

      const ritual = await storage.createRitual({
        userId,
        projectId: projectId != null ? Number(projectId) : null,
        title: title.trim(),
        days: typeof days === 'string' && days.trim() ? days.trim() : 'mon,tue,wed,thu,fri',
        startTime,
        durationMinutes: duration,
      });

      // Matérialiser les 14 prochains jours pour que l'effet soit visible tout de suite.
      const today = new Date();
      let materialized = 0;
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        materialized += await materializeRituals(userId, ds);
      }

      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await storage.fixOverlappingTasks(userId, todayStr).catch((e: any) =>
        console.error('[rituals] fixOverlappingTasks:', e?.message),
      );

      res.json({ ritual, materialized });
    } catch (error) {
      console.error("Error creating ritual:", error);
      res.status(500).json({ message: "Création du rituel impossible" });
    }
  });

  app.post('/api/rituals/:id/deactivate', isAuthenticated, async (req: any, res) => {
    try {
      const ok = await storage.deactivateRitual(parseInt(req.params.id, 10), req.userId);
      if (!ok) return res.status(404).json({ message: "Rituel introuvable" });
      res.json({ deactivated: true });
    } catch (error) {
      console.error("Error deactivating ritual:", error);
      res.status(500).json({ message: "Désactivation impossible" });
    }
  });

  app.get('/api/me/behavioral-signals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const signals = await storage.getBehavioralSignals(userId);
      res.json(signals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch behavioral signals" });
    }
  });

  // ─── Dev/Admin Endpoints (dev only) ──────────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/dev/users', async (_req, res) => {
      try {
        const { db } = await import('./db.js');
        const { users } = await import('@shared/schema');
        const allUsers = await db.select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          createdAt: users.createdAt,
        }).from(users);
        res.json(allUsers);
      } catch (error) {
        res.status(500).json({ message: "Failed to list users" });
      }
    });

    app.delete('/api/dev/users/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const deleted = await storage.deleteUser(userId);
        res.json({ success: deleted, userId });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ message: "Failed to delete user" });
      }
    });

    app.post('/api/dev/reset-onboarding', isAuthenticated, async (req: any, res) => {
      try {
        const userId = req.userId;
        await storage.resetUserOnboardingState(userId);
        res.json({ success: true, message: "Full onboarding reset complete. Visit / to re-run onboarding." });
      } catch (error: any) {
        console.error("Dev reset error:", error);
        res.status(500).json({ message: error?.message || "Failed to reset onboarding", constraint: error?.constraint, detail: error?.detail });
      }
    });
  }

  // ─── Milestone Trigger Routes ─────────────────────────────────────────────────

  app.get('/api/milestone-triggers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { status } = req.query;
      const triggers = await storage.getMilestoneTriggers(userId, status as string | undefined);
      res.json(triggers);
    } catch (error) {
      console.error("Error fetching milestone triggers:", error);
      res.status(500).json({ message: "Failed to fetch milestone triggers" });
    }
  });

  app.post('/api/milestone-triggers/preview', isAuthenticated, async (req: any, res) => {
    try {
      const { rawCondition, projectName } = req.body;
      if (!rawCondition || typeof rawCondition !== 'string') {
        return res.status(400).json({ message: "rawCondition is required" });
      }
      const parsed = await parseMilestoneTrigger(rawCondition, { projectName });
      res.json(parsed);
    } catch (error) {
      console.error("Error previewing milestone trigger:", error);
      res.status(500).json({ message: "Failed to parse trigger" });
    }
  });

  app.post('/api/milestone-triggers', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { rawCondition, projectId, conditionType, conditionSummary, conditionKeywords, tasksToUnlock, schedulingMode } = req.body;
      if (!rawCondition || typeof rawCondition !== 'string') {
        return res.status(400).json({ message: "rawCondition is required" });
      }

      const trigger = await storage.createMilestoneTrigger({
        userId,
        projectId: projectId || null,
        rawCondition,
        conditionType: conditionType || "keyword",
        conditionSummary: conditionSummary || rawCondition.substring(0, 100),
        conditionKeywords: conditionKeywords || [],
        tasksToUnlock: tasksToUnlock || [],
        schedulingMode: schedulingMode || "flexible",
        status: "watching",
      });

      res.json(trigger);
    } catch (error) {
      console.error("Error creating milestone trigger:", error);
      res.status(500).json({ message: "Failed to create milestone trigger" });
    }
  });

  app.patch('/api/milestone-triggers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const existing = await storage.getMilestoneTrigger(id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ message: "Trigger not found" });
      }
      const updates: Record<string, any> = {};
      if (req.body.status) updates.status = req.body.status;
      if (req.body.rawCondition) updates.rawCondition = req.body.rawCondition;
      if (req.body.conditionSummary) updates.conditionSummary = req.body.conditionSummary;
      const updated = await storage.updateMilestoneTrigger(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating milestone trigger:", error);
      res.status(500).json({ message: "Failed to update milestone trigger" });
    }
  });

  app.delete('/api/milestone-triggers/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMilestoneTrigger(id, userId);
      if (!deleted) return res.status(404).json({ message: "Trigger not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting milestone trigger:", error);
      res.status(500).json({ message: "Failed to delete milestone trigger" });
    }
  });

  // ─── Project Milestones (Jalons Conditionnels) ───────────────────────────────

  // GET /api/projects/:id/milestones
  app.get('/api/projects/:id/milestones', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      const milestones = await storage.getMilestones(projectId, userId);
      // Enrichir avec conditions
      const enriched = await Promise.all(milestones.map(async m => ({
        ...m,
        conditions: await storage.getMilestoneConditions(m.id),
      })));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching milestones:", error);
      res.status(500).json({ message: "Échec de la récupération des jalons" });
    }
  });

  // POST /api/projects/:id/milestones
  app.post('/api/projects/:id/milestones', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      const { title, description, milestoneType, order, targetDate } = req.body;
      if (!title) return res.status(400).json({ message: "title requis" });
      const milestone = await storage.createMilestone({
        projectId,
        userId,
        title,
        description: description || null,
        milestoneType: milestoneType || 'action',
        order: order ?? 0,
        status: 'locked',
        targetDate: targetDate || null,
      });
      res.json(milestone);
    } catch (error) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ message: "Échec de la création du jalon" });
    }
  });

  // POST /api/projects/:id/milestone-chain — création en bloc depuis le Companion
  app.post('/api/projects/:id/milestone-chain', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id);
      if (isNaN(projectId)) return res.status(400).json({ message: "projectId invalide" });
      const { milestones } = req.body;
      if (!Array.isArray(milestones) || milestones.length === 0) {
        return res.status(400).json({ message: "milestones[] requis" });
      }
      // Vérifier que chaque jalon a un title
      const valid = milestones.every((m: any) => typeof m?.title === 'string' && m.title.trim());
      if (!valid) return res.status(400).json({ message: "Chaque jalon doit avoir un title" });
      // Vérifier que le projet appartient à l'utilisateur
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });
      const chain = await createMilestoneChain(projectId, userId, milestones);
      res.json(chain);
    } catch (error: any) {
      console.error("Error creating milestone chain:", error);
      res.status(500).json({
        message: "Échec de la création de la chaîne de jalons",
        detail: error?.message || String(error),
      });
    }
  });

  // ── Les liens entre marques ─────────────────────────────────────────────────
  // Spec : docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md
  //
  // Rappel de la règle centrale : l'ABSENCE de lien est une interdiction. Ces
  // endpoints ne créent donc jamais de lien implicite, et supprimer un lien ne
  // touche aucune campagne existante.

  app.get('/api/projects/:id/links', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id, 10);
      if (isNaN(projectId)) return res.status(400).json({ message: "Identifiant de projet invalide" });
      // Une marque d'autrui est INTROUVABLE, pas interdite : un 403 confirmerait son existence.
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      const [sortants, entrants] = await Promise.all([
        db.select().from(projectLinks)
          .where(and(eq(projectLinks.userId, userId), eq(projectLinks.fromProjectId, projectId)))
          .orderBy(desc(projectLinks.createdAt)),
        db.select().from(projectLinks)
          .where(and(eq(projectLinks.userId, userId), eq(projectLinks.toProjectId, projectId)))
          .orderBy(desc(projectLinks.createdAt)),
      ]);
      res.json({ sortants, entrants });
    } catch (error) {
      console.error('[Liens] GET /api/projects/:id/links:', error);
      res.status(500).json({ message: "Failed to fetch brand links" });
    }
  });

  app.post('/api/projects/:id/links', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const fromProjectId = parseInt(req.params.id, 10);
      const toProjectId = parseInt(req.body?.toProjectId, 10);
      if (isNaN(fromProjectId) || isNaN(toProjectId)) {
        return res.status(400).json({ message: "Identifiants de projet invalides" });
      }

      const validation = valideLien({ fromProjectId, toProjectId });
      if (!validation.ok) return res.status(400).json({ message: validation.raison });

      // LES DEUX marques doivent appartenir à l'utilisateur. Sans ce double contrôle,
      // l'endpoint devient un oracle d'énumération des identifiants de projet.
      const [depuis, vers] = await Promise.all([
        storage.getProject(fromProjectId, userId),
        storage.getProject(toProjectId, userId),
      ]);
      if (!depuis || !vers) return res.status(404).json({ message: "Projet introuvable" });

      const [link] = await db.insert(projectLinks).values({
        userId,
        fromProjectId,
        toProjectId,
        roleAmont: typeof req.body?.roleAmont === 'string' ? req.body.roleAmont.trim() || null : null,
        roleAval: typeof req.body?.roleAval === 'string' ? req.body.roleAval.trim() || null : null,
        nature: typeof req.body?.nature === 'string' ? req.body.nature.trim() || null : null,
        audiencesRecoupent: req.body?.audiencesRecoupent === true,
      }).returning();

      res.json({ link });
    } catch (error: any) {
      // L'index unique (userId, fromProjectId, toProjectId) refuse un lien déjà déclaré.
      if (error?.code === '23505') {
        return res.status(409).json({ message: "Ce lien existe déjà dans ce sens" });
      }
      console.error('[Liens] POST /api/projects/:id/links:', error);
      res.status(500).json({ message: "Failed to create brand link" });
    }
  });

  app.patch('/api/project-links/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Identifiant invalide" });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const champ of ['roleAmont', 'roleAval', 'nature'] as const) {
        if (typeof req.body?.[champ] === 'string') patch[champ] = req.body[champ].trim() || null;
      }
      if (typeof req.body?.audiencesRecoupent === 'boolean') {
        patch.audiencesRecoupent = req.body.audiencesRecoupent;
      }
      if (Object.keys(patch).length === 1) return res.status(400).json({ message: "Rien à modifier" });

      const [link] = await db.update(projectLinks).set(patch)
        .where(and(eq(projectLinks.id, id), eq(projectLinks.userId, req.userId)))
        .returning();
      if (!link) return res.status(404).json({ message: "Lien introuvable" });
      res.json({ link });
    } catch (error) {
      console.error('[Liens] PATCH /api/project-links/:id:', error);
      res.status(500).json({ message: "Failed to update brand link" });
    }
  });

  app.delete('/api/project-links/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Identifiant invalide" });
      // Supprimer un lien ne touche AUCUNE campagne : les articulations déjà décidées
      // restent telles quelles, l'utilisatrice les a validées à leur création.
      const [supprime] = await db.delete(projectLinks)
        .where(and(eq(projectLinks.id, id), eq(projectLinks.userId, req.userId)))
        .returning({ id: projectLinks.id });
      if (!supprime) return res.status(404).json({ message: "Lien introuvable" });
      res.json({ ok: true });
    } catch (error) {
      console.error('[Liens] DELETE /api/project-links/:id:', error);
      res.status(500).json({ message: "Failed to delete brand link" });
    }
  });

  // PATCH /api/milestones/:id
  app.patch('/api/milestones/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const milestone = await storage.getMilestone(id);
      if (!milestone || milestone.userId !== userId) {
        return res.status(404).json({ message: "Jalon introuvable" });
      }
      const updated = await storage.updateMilestone(id, req.body);
      // Si le statut change → vérifier les déverrouillages en cascade
      if (req.body.status === 'completed') {
        await checkAndUnlockMilestones(milestone.projectId, userId);
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating milestone:", error);
      res.status(500).json({ message: "Échec de la mise à jour du jalon" });
    }
  });

  // POST /api/milestones/:id/confirm — confirmation manuelle
  app.post('/api/milestones/:id/confirm', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const milestone = await storage.getMilestone(id);
      if (!milestone || milestone.userId !== userId) {
        return res.status(404).json({ message: "Jalon introuvable" });
      }
      const updated = await confirmMilestone(id);
      res.json(updated);
    } catch (error) {
      console.error("Error confirming milestone:", error);
      res.status(500).json({ message: "Échec de la confirmation du jalon" });
    }
  });

  // DELETE /api/milestones/:id
  app.delete('/api/milestones/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMilestone(id, userId);
      if (!deleted) return res.status(404).json({ message: "Jalon introuvable" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting milestone:", error);
      res.status(500).json({ message: "Échec de la suppression du jalon" });
    }
  });

  // POST /api/milestone-conditions/:id/fulfill
  app.post('/api/milestone-conditions/:id/fulfill', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const condition = await storage.fulfillCondition(id);
      if (!condition) return res.status(404).json({ message: "Condition introuvable" });
      // Vérifier si le jalon parent peut se déverrouiller
      const milestone = await storage.getMilestone(condition.milestoneId);
      if (milestone) {
        await checkAndUnlockMilestones(milestone.projectId, userId);
      }
      res.json(condition);
    } catch (error) {
      console.error("Error fulfilling condition:", error);
      res.status(500).json({ message: "Échec de la validation de la condition" });
    }
  });

  // ─── Push Notifications ──────────────────────────────────────────────────────

  app.post('/api/notifications/register', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { expoPushToken } = req.body;
      if (!expoPushToken) return res.status(400).json({ message: "expoPushToken requis" });
      await storage.upsertUser({ id: userId, expoPushToken } as any);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Erreur enregistrement token" });
    }
  });

  // ─── Companion IA ────────────────────────────────────────────────────────────

  app.post('/api/companion/chat', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (await isAiBlocked(userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      const { message, context, conversationHistory } = req.body;

      if (!message?.trim()) {
        return res.status(400).json({ message: "message requis" });
      }

      // Enrichir le contexte avec les projets réels chargés depuis la DB
      const userProjects = await storage.getProjects(userId);

      // Injecter les tâches abandonnées (deferred 3x+) — concept 100% server-side
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const in7Days = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
      const lookbackDate = new Date(now);
      lookbackDate.setDate(lookbackDate.getDate() - 14);
      const lookback = lookbackDate.toISOString().slice(0, 10);

      const [recentTasks, upcomingRawTasks, prefs, brandDna] = await Promise.all([
        storage.getTasksInRange(userId, lookback, today).catch(() => []),
        storage.getTasksInRange(userId, today, in7Days).catch(() => []),
        storage.getUserPreferences(userId).catch(() => null),
        storage.getBrandDna(userId).catch(() => null),
      ]);

      const staleTasks = (recentTasks as any[])
        .filter(t => !t.completed && (t.learnedAdjustmentCount || 0) >= 3)
        .map(t => ({ id: t.id, title: t.title, learnedAdjustmentCount: t.learnedAdjustmentCount as number }))
        .slice(0, 8);

      const upcomingTasks = (upcomingRawTasks as any[])
        .filter((t: any) => !t.completed && String(t.scheduledDate).slice(0, 10) > today)
        .slice(0, 10)
        .map((t: any) => ({ title: t.title, date: String(t.scheduledDate).slice(0, 10), time: t.scheduledTime || undefined, taskId: t.id }));

      // Trouver le jalon actif du projet actif
      const clientContext = context || {};
      const activeProjectId = clientContext.activeProject?.id || (userProjects[0] as any)?.id;
      let activeMilestone = null;
      if (activeProjectId) {
        const milestones = await storage.getMilestones(activeProjectId, userId).catch(() => []);
        const found = (milestones as any[]).find(m => m.status === 'active' || m.status === 'unlocked');
        if (found) activeMilestone = { id: found.id, title: found.title, status: found.status };
      }

      const enrichedContext = {
        currentDate: today,
        currentTime: now.toTimeString().slice(0, 5),
        ...(clientContext),
        availableProjects: userProjects.slice(0, 15).map((p: any) => ({ id: p.id, name: p.name, type: p.type })),
        ...(staleTasks.length > 0 ? { staleTasks } : {}),
        energyLevel: prefs?.currentEnergyLevel || 'high',
        upcomingTasks,
        activeMilestone,
        brandDnaSummary: (brandDna as any)?.nayaIntelligenceSummary || null,
      };

      const response = await processCompanionMessage(userId, {
        message,
        context: enrichedContext,
        conversationHistory: conversationHistory || [],
      });

      res.json(response);

      // Mémoire (Phase 2, best-effort) : extraire de ce tour de conversation.
      // Routage de marque (BRIEF-FIX-ROUTAGE-MARQUE) : la marque-sujet est la marque
      // NOMMÉE dans la conversation (message + historique), PAS le projet actif (faillible).
      const convoText = [...(conversationHistory || []).map((m: any) => m?.content || ""), message].join("\n");
      const subject = resolveSubjectBrand(convoText, (userProjects as any[]).map((p) => ({ id: p.id, name: p.name })));
      console.info(`[brand-routing] companion active=${activeProjectId ?? "null"} subject=${subject.projectId ?? "null"} matched=[${subject.matched.join(", ")}] ambiguous=${subject.ambiguous}`);
      extractToMemory({
        userId,
        projectId: activeProjectId ?? null,        // audit only
        subjectProjectId: subject.projectId,        // marque-sujet résolue (ou null → cap/reception sautés)
        sourceText: `Utilisateur : ${message}\nNaya : ${(response as any)?.message ?? ""}`,
        sourceType: "companion",
      }).catch(() => {});
    } catch (error: any) {
      console.error("Companion chat error:", error?.message || error);
      res.status(500).json({ message: "Erreur du Companion", detail: error?.message });
    }
  });

  app.get('/api/companion/history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const history = await storage.getCompanionHistory(userId, 30);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Erreur de récupération" });
    }
  });

  // GET /api/companion/context — contexte enrichi pour le companion mobile
  app.get('/api/companion/context', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const today = new Date().toISOString().slice(0, 10);
      const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const [prefs, todayTasks, upcomingTasks, projects, brandDna] = await Promise.all([
        storage.getUserPreferences(userId),
        storage.getTasksInRange(userId, today, today),
        storage.getTasksInRange(userId, today, in7Days),
        storage.getProjects(userId),
        storage.getBrandDna(userId),
      ]);

      const activeProject = (projects as any[]).find((p: any) => p.projectStatus === 'active') || projects[0] || null;

      // Trouver le premier jalon active ou unlocked du projet actif
      let activeMilestone = null;
      if (activeProject) {
        const milestones = await storage.getMilestones(activeProject.id, userId);
        activeMilestone = (milestones as any[]).find(m => m.status === 'active' || m.status === 'unlocked') || null;
        if (activeMilestone) {
          activeMilestone = { id: activeMilestone.id, title: activeMilestone.title, status: activeMilestone.status };
        }
      }

      res.json({
        energyLevel: prefs?.currentEnergyLevel || 'high',
        todayTasks: (todayTasks as any[]).filter((t: any) => !t.completed).slice(0, 10),
        upcomingTasks: (upcomingTasks as any[])
          .filter((t: any) => !t.completed && String(t.scheduledDate).slice(0, 10) > today)
          .slice(0, 20)
          .map((t: any) => ({ title: t.title, date: t.scheduledDate, time: t.scheduledTime || undefined, taskId: t.id })),
        activeMilestone,
        activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
        brandDnaSummary: (brandDna as any)?.nayaIntelligenceSummary || null,
      });
    } catch (error) {
      console.error('GET /api/companion/context error:', error);
      res.status(500).json({ message: 'Erreur contexte companion' });
    }
  });

  // POST /api/transcribe — transcription audio via Whisper
  app.post('/api/transcribe', isAuthenticated, upload.single('audio'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Fichier audio requis (champ "audio")' });
      }

      const { OpenAI } = await import('openai');
      const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Créer un File à partir du buffer (Node.js 20+ global File)
      const audioFile = new File([req.file.buffer], 'recording.m4a', { type: req.file.mimetype || 'audio/m4a' });

      const transcription = await openaiClient.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'fr',
      });

      res.json({ text: transcription.text });
    } catch (error: any) {
      console.error('POST /api/transcribe error:', error);
      res.status(500).json({ message: 'Erreur de transcription' });
    }
  });

  // Task lists (créées par le Companion)
  app.post('/api/task-lists', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { title, projectId, linkedTaskId, linkedDate, listType, items = [] } = req.body;
      const list = await storage.createTaskList({ userId, title, projectId, linkedTaskId, linkedDate, listType, createdByCompanion: true });
      for (let i = 0; i < items.length; i++) {
        await storage.createTaskListItem({ listId: list.id, title: items[i].title, order: i });
      }
      const full = await storage.getTaskList(list.id, userId);
      res.json(full);
    } catch (error) {
      res.status(500).json({ message: "Erreur création liste" });
    }
  });

  app.patch('/api/task-list-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateTaskListItem(id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Erreur mise à jour item" });
    }
  });

  // ─── Quick Capture Routes ────────────────────────────────────────────────────

  app.get('/api/capture', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { processed } = req.query;
      const processedBool = processed === 'true' ? true : processed === 'false' ? false : undefined;
      const entries = await storage.getCaptureEntries(userId, processedBool);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching capture entries:", error);
      res.status(500).json({ message: "Failed to fetch capture entries" });
    }
  });

  app.post('/api/capture', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const captureData = insertQuickCaptureSchema.parse({ ...req.body, userId });
      const entry = await storage.createCaptureEntry(captureData);

      res.json(entry);

      // Mémoire (Phase 2, best-effort, fire-and-forget) : extraire les faits durables.
      // Routage de marque : marque-sujet = marque NOMMÉE dans le texte de la capture ;
      // sinon les faits cap/reception sont sautés (jamais devinés).
      (async () => {
        const capProjects = await storage.getProjects(userId).catch(() => []);
        const capSubject = resolveSubjectBrand(entry.content, (capProjects as any[]).map((p) => ({ id: p.id, name: p.name })));
        await extractToMemory({
          userId,
          projectId: entry.projectId ?? null,        // audit only
          subjectProjectId: capSubject.projectId,
          sourceText: entry.content,
          sourceType: "capture",
          sourceCaptureId: entry.id,
        });
      })().catch(() => {});

      const conditionalPattern = /\b(quand|when|si|if|dès que|once|après|after)\b/i;
      if (conditionalPattern.test(entry.content.trim())) {
        (async () => {
          try {
            const prefs = await storage.getUserPreferences(userId);
            const trigger = await storage.createMilestoneTrigger({
              userId,
              projectId: entry.projectId ?? prefs?.activeProjectId ?? null,
              rawCondition: entry.content,
              conditionType: "keyword",
              status: "watching",
            });
            await storage.updateCaptureEntry(entry.id, userId, {
              classifiedType: 'milestone_trigger',
              routingStatus: 'routed',
              routedTo: `milestone:${trigger.id}`,
              aiSummary: entry.content.substring(0, 100),
            });
            const parsed = await parseMilestoneTrigger(entry.content);
            await storage.updateMilestoneTrigger(trigger.id, {
              conditionType: parsed.conditionType,
              conditionSummary: parsed.conditionSummary,
              conditionKeywords: parsed.conditionKeywords,
              tasksToUnlock: parsed.tasksToUnlock,
              schedulingMode: parsed.schedulingMode,
            });
            await storage.updateCaptureEntry(entry.id, userId, {
              aiSummary: parsed.conditionSummary || entry.content.substring(0, 100),
            });
          } catch (err) {
            console.error("Milestone trigger parse from capture failed:", err);
          }
        })();
        return;
      }

      // Async AI classification — fire and forget, do not block response
      (async () => {
        try {
          const { classifyCapture, generateActivationPrompt } = await import('./services/openai.js');
          const result = await classifyCapture(entry.content);
          const updates: Record<string, any> = {
            classifiedType: result.type,
            aiSummary: result.summary,
          };

          if (result.type === 'task' && result.isActionable) {
            const prefs = await storage.getUserPreferences(userId);
            const profile = await storage.getUserOperatingProfile(userId);
            const dueDate = parseDueDateFromText(entry.content);
            // Generate activation prompt if user has operating profile
            let activationPrompt: string | null = null;
            if (profile) {
              activationPrompt = await generateActivationPrompt(
                result.summary || entry.content.substring(0, 100),
                profile.activationStyle || undefined,
                profile.avoidanceTriggers || undefined
              );
            }
            const newTask = await storage.createTask({
              title: result.summary || entry.content.substring(0, 100),
              description: entry.content,
              type: 'admin',
              category: 'planning',
              priority: 3,
              userId,
              projectId: entry.projectId ?? prefs?.activeProjectId ?? null,
              dueDate,
              completed: false,
              activationPrompt,
            } as any);
            updates.convertedToTaskId = newTask.id;
            updates.routingStatus = 'routed';
            updates.routedTo = `task:${newTask.id}`;
            updates.isProcessed = true;
          } else if (result.type === 'emotional_signal' || result.type === 'behavioral_insight') {
            // Store as a behavioral signal for Naya's memory
            try {
              await storage.createBehavioralSignal({
                userId,
                signalType: result.type,
                content: entry.content,
                aiInterpretation: result.summary,
                linkedContext: result.linkedContext || null,
                captureEntryId: entry.id,
              });
              // If it's a behavioral insight about avoidance, update the operating profile
              if (result.type === 'behavioral_insight' && result.linkedContext) {
                const profile = await storage.getUserOperatingProfile(userId);
                const existing = profile?.avoidanceTriggers || [];
                if (!existing.includes(result.linkedContext)) {
                  await storage.upsertUserOperatingProfile(userId, {
                    avoidanceTriggers: [...existing, result.linkedContext],
                  });
                }
              }
            } catch (_) {}
            updates.routingStatus = 'inbox';
            updates.routedTo = result.type;
          } else {
            updates.routingStatus = 'inbox';
            updates.routedTo = result.type;
          }

          await storage.updateCaptureEntry(entry.id, userId, updates);
        } catch (err) {
          // Fallback: rule-based classification (already inside classifyCapture, but belt+suspenders)
          try {
            const text = entry.content.toLowerCase();
            const actionVerbs = ['write', 'call', 'send', 'review', 'create', 'finish', 'follow up', 'draft', 'schedule', 'prepare', 'edit', 'post', 'reach out', 'reply', 'update', 'fix', 'build', 'buy', 'get'];
            const isAction = actionVerbs.some(v => text.startsWith(v));
            const isIdea = text.includes('idea') || text.includes('what if') || text.includes('could we');
            const isReminder = /\btomorrow\b|\bnext week\b|\bat \d/.test(text);
            const type = isAction ? 'task' : isIdea ? 'idea' : isReminder ? 'reminder' : 'note';
            await storage.updateCaptureEntry(entry.id, userId, { classifiedType: type, routingStatus: 'inbox', routedTo: type });
          } catch (_) {}
        }
      })();
    } catch (error) {
      console.error("Error creating capture entry:", error);
      res.status(500).json({ message: "Failed to create capture entry" });
    }
  });

  app.post('/api/capture/clear-routed', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const entries = await storage.getCaptureEntries(userId, false);
      const routed = entries.filter((e: any) => e.routingStatus === 'routed');
      await Promise.all(routed.map((e: any) => storage.updateCaptureEntry(e.id, userId, { routingStatus: 'dismissed', isProcessed: true })));
      res.json({ cleared: routed.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear routed entries" });
    }
  });

  app.patch('/api/capture/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const entry = await storage.updateCaptureEntry(parseInt(req.params.id), userId, req.body);
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      res.json(entry);
    } catch (error) {
      console.error("Error updating capture entry:", error);
      res.status(500).json({ message: "Failed to update capture entry" });
    }
  });

  app.delete('/api/capture/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const deleted = await storage.deleteCaptureEntry(parseInt(req.params.id), userId);
      if (!deleted) return res.status(404).json({ message: "Entry not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting capture entry:", error);
      res.status(500).json({ message: "Failed to delete capture entry" });
    }
  });

  // ─── Task Schedule Events ────────────────────────────────────────────────────

  app.post('/api/task-schedule-events', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const eventData = insertTaskScheduleEventSchema.parse({ ...req.body, userId });
      const event = await storage.createScheduleEvent(eventData);
      res.json(event);
    } catch (error) {
      console.error("Error creating schedule event:", error);
      res.status(500).json({ message: "Failed to create schedule event" });
    }
  });

  app.get('/api/task-schedule-events/:taskId', isAuthenticated, async (req: any, res) => {
    try {
      const events = await storage.getScheduleEvents(parseInt(req.params.taskId));
      res.json(events);
    } catch (error) {
      console.error("Error fetching schedule events:", error);
      res.status(500).json({ message: "Failed to fetch schedule events" });
    }
  });

  // ─── Persona Intelligence Routes ─────────────────────────────────────────────

  app.post('/api/persona/detect-user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) return res.status(400).json({ message: "Complete onboarding first" });
      
      const result = detectUserPersona(brandDna);
      const archetypes = await storage.getUserPersonaArchetypes();
      const matchedArchetype = archetypes.find(a => a.name === result.personaName);

      const saved = await storage.savePersonaAnalysisResult({
        userId,
        personaType: 'user',
        inputContext: { brandDnaId: brandDna.id },
        analysisResult: {
          personaName: result.personaName,
          personaId: matchedArchetype?.id,
          confidence: result.confidence,
          reasoning: result.reasoning,
          outputStyleGuidelines: result.outputStyleGuidelines,
        },
      });
      res.json(saved);
    } catch (error) {
      console.error("Error detecting user persona:", error);
      res.status(500).json({ message: "Failed to detect user persona" });
    }
  });

  app.get('/api/persona/my-persona', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const result = await storage.getLatestPersonaAnalysis(userId, 'user');
      res.json(result || null);
    } catch (error) {
      console.error("Error fetching persona:", error);
      res.status(500).json({ message: "Failed to fetch persona" });
    }
  });

  app.get('/api/persona/archetypes', isAuthenticated, async (req: any, res) => {
    try {
      const archetypes = await storage.getUserPersonaArchetypes();
      res.json(archetypes);
    } catch (error) {
      console.error("Error fetching archetypes:", error);
      res.status(500).json({ message: "Failed to fetch archetypes" });
    }
  });

  app.post('/api/persona/analyze-target', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { targetAudience, corePainPoint, audienceAspiration, projectId, description } = req.body;
      
      // Allow plain text description as a quick entry
      const audienceText = description || targetAudience || "";
      const painText = corePainPoint || "";
      const aspirationText = audienceAspiration || "";
      
      let projectContext;
      if (projectId) {
        const project = await storage.getProject(parseInt(projectId), userId);
        if (project) {
          projectContext = { type: project.type, monetizationIntent: project.monetizationIntent || undefined };
        }
      }
      
      const profile = analyzeTargetPersona(audienceText, painText, aspirationText, projectContext);
      
      const saved = await storage.createTargetPersona({
        userId,
        projectId: projectId ? parseInt(projectId) : undefined,
        name: profile.name,
        industry: profile.industry,
        jobTitle: profile.jobTitle,
        companySize: profile.companySize,
        motivations: profile.motivations,
        frustrations: profile.frustrations,
        decisionTriggers: profile.decisionTriggers,
        persuasionDrivers: profile.persuasionDrivers,
        preferredChannels: profile.preferredChannels,
        isAiGenerated: true,
      });
      
      res.json({ ...saved, messagingApproach: profile.messagingApproach });
    } catch (error) {
      console.error("Error analyzing target persona:", error);
      res.status(500).json({ message: "Failed to analyze target persona" });
    }
  });

  app.get('/api/persona/target-personas', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId } = req.query;
      const personas = await storage.getTargetPersonas(userId, projectId ? parseInt(projectId as string) : undefined);
      res.json(personas);
    } catch (error) {
      console.error("Error fetching target personas:", error);
      res.status(500).json({ message: "Failed to fetch target personas" });
    }
  });

  app.delete('/api/persona/target-personas/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const deleted = await storage.deleteTargetPersona(parseInt(req.params.id), userId);
      if (!deleted) return res.status(404).json({ message: "Target persona not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting target persona:", error);
      res.status(500).json({ message: "Failed to delete target persona" });
    }
  });

  app.post('/api/persona/match-strategy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { userPersonaName, targetPersonaName, projectId, goalId } = req.body;
      
      let projectType = "Business";
      let monetizationIntent = "exploratory";
      let goalSuccessMode = "visibility";

      if (projectId) {
        const project = await storage.getProject(parseInt(projectId), userId);
        if (project) {
          projectType = project.type;
          monetizationIntent = project.monetizationIntent || "exploratory";
        }
      }

      if (goalId) {
        const goals = projectId ? await storage.getProjectGoals(parseInt(projectId)) : [];
        const goal = goals.find(g => g.id === parseInt(goalId));
        if (goal) goalSuccessMode = goal.successMode;
      }
      
      const match = matchPersonaStrategy(
        userPersonaName || "Builder",
        targetPersonaName || "Startup Founder",
        projectType,
        monetizationIntent,
        goalSuccessMode
      );
      
      res.json(match);
    } catch (error) {
      console.error("Error matching strategy:", error);
      res.status(500).json({ message: "Failed to match strategy" });
    }
  });

  // Tasks routes
  /**
   * Annote une liste de taches avec leur verrou de sequence, pour que l'interface puisse
   * afficher le cadenas et le nom de ce qui bloque.
   *
   * Charge les prerequis ABSENTS de la liste : une chaine s'etale souvent sur plusieurs
   * jours, et un prerequis de la veille passerait sinon pour introuvable — donc non bloquant.
   *
   * Ne leve jamais : si les dependances sont illisibles, les taches sont renvoyees sans
   * verrou plutot que pas du tout.
   */
  async function avecVerrous<T extends { id: number; title?: string | null; completed?: boolean | null }>(
    taches: T[],
  ): Promise<any[]> {
    try {
      if (!taches.length) return taches as any[];
      const dependances = await storage.getTaskDependenciesForIds(taches.map(t => t.id)) as any[];
      if (!dependances.length) {
        return taches.map(t => ({ ...t, verrouillee: false, bloqueePar: [] }));
      }
      const etats = new Map<number, { title: string | null; completed: boolean | null }>();
      for (const id of prerequisManquants(taches, dependances)) {
        const p = await storage.getTask(id).catch(() => undefined);
        if (p) etats.set(id, { title: (p as any).title ?? null, completed: (p as any).completed ?? null });
      }
      return annoterVerrous({ taches, dependances, etats });
    } catch (e: any) {
      console.error('[Verrou] annotation impossible:', e?.message ?? e);
      return taches as any[];
    }
  }

  app.get('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { date, projectId, campaignId } = req.query;
      const pid = projectId ? parseInt(projectId as string) : undefined;
      let cid: number | undefined;
      if (campaignId) {
        const parsed = Number(campaignId);
        if (Number.isFinite(parsed) && parsed > 0) cid = parsed;
      }
      const { start, end } = req.query;
      // Plage de dates (calendrier mobile)
      if (start && end && !cid) {
        const startStr = (start as string).slice(0, 10);
        const endStr = (end as string).slice(0, 10);
        const tasks = await storage.getTasksInRange(userId, startStr, endStr, pid);
        return res.json(await avecVerrous(tasks as any[]));
      }
      // Date unique (onglet Aujourd'hui)
      if (date && !cid) {
        const dateStr = (date as string).slice(0, 10);
        const tasks = await storage.getTasksInRange(userId, dateStr, dateStr, pid);
        return res.json(await avecVerrous(tasks as any[]));
      }
      const dueDate = cid ? undefined : new Date();
      const tasks = await storage.getTasks(userId, dueDate, pid, cid);
      res.json(await avecVerrous(tasks as any[]));
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get('/api/dashboard/tomorrow-preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.getUserPreferences(userId);
      const projectId = prefs?.activeProjectId ?? undefined;
      const data = await storage.getTomorrowPreviewData(userId, projectId ?? undefined);
      const project = projectId ? await storage.getProject(projectId, userId) : null;
      res.json({ ...data, projectContext: project?.name ?? 'All projects' });
    } catch (error) {
      console.error("Error fetching tomorrow preview:", error);
      res.status(500).json({ message: "Failed to fetch tomorrow preview" });
    }
  });

  app.get('/api/dashboard/schedule-preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const prefs = await storage.getUserPreferences(userId);
      const projectId = prefs?.activeProjectId ?? undefined;

      const now = new Date();
      const today = sharedFormatDate(now);
      const in7Days = new Date(now);
      in7Days.setDate(now.getDate() + 7);
      const endDate = sharedFormatDate(in7Days);

      const [tasksInRange, availability, allProjects] = await Promise.all([
        storage.getTasksInRange(userId, today, endDate, projectId),
        storage.getDayAvailabilityRange(userId, today, endDate),
        storage.getProjects(userId),
      ]);

      const projectMap: Record<number, { name: string; color: string }> = {};
      for (const p of allProjects) {
        projectMap[p.id] = { name: p.name, color: p.color || '#6366f1' };
      }

      const approachingDeadlines: Array<{ id: number; title: string; dueDate: Date | null; projectName: string; projectColor: string | null }> = [];
      const targetProjects = projectId ? allProjects.filter(p => p.id === projectId) : allProjects;
      const allGoals = await Promise.all(
        targetProjects.map(p => storage.getActiveGoalsForProject(p.id).catch(() => []))
      );
      targetProjects.forEach((p, i) => {
        for (const g of allGoals[i]) {
          if (g.dueDate) {
            const dueDate = new Date(g.dueDate);
            if (dueDate >= now && dueDate <= in7Days) {
              approachingDeadlines.push({ id: g.id, title: g.title, dueDate: g.dueDate, projectName: p.name, projectColor: p.color });
            }
          }
        }
      });

      interface ScheduleTaskDTO {
        id: number;
        title: string;
        scheduledDate: string | null;
        scheduledTime: string | null;
        estimatedDuration: number | null;
        taskEnergyType: string | null;
        priority: number;
        projectId: number | null;
        completed: boolean;
        projectName: string | null;
        projectColor: string | null;
      }

      const tasksByDate: Record<string, ScheduleTaskDTO[]> = {};
      for (const task of tasksInRange) {
        const date = task.scheduledDate || today;
        if (!tasksByDate[date]) tasksByDate[date] = [];
        tasksByDate[date].push({
          id: task.id,
          title: task.title,
          scheduledDate: task.scheduledDate,
          scheduledTime: task.scheduledTime,
          estimatedDuration: task.estimatedDuration,
          taskEnergyType: task.taskEnergyType,
          priority: task.priority,
          projectId: task.projectId,
          completed: task.completed,
          projectName: task.projectId ? projectMap[task.projectId]?.name : null,
          projectColor: task.projectId ? projectMap[task.projectId]?.color : null,
        });
      }

      const availabilityMap: Record<string, string> = {};
      for (const a of availability) {
        availabilityMap[a.date] = a.dayType;
      }

      res.json({
        tasksByDate,
        availabilityMap,
        approachingDeadlines,
        projectMap,
      });
    } catch (error) {
      console.error("Error fetching schedule preview:", error);
      res.status(500).json({ message: "Failed to fetch schedule preview" });
    }
  });

  // ===== SCHEDULING VALIDATION HELPERS =====

  /**
   * Check if a task overlaps with existing tasks on the same day
   * Returns the conflicting task if there's an overlap, null otherwise
   */
  async function checkTaskOverlap(
    userId: string,
    taskDate: string,
    scheduledTime: string,
    estimatedDuration: number,
    excludeTaskId?: number
  ): Promise<any | null> {
    try {
      const existingTasks = await storage.getTasksInRange(userId, taskDate, taskDate);
      const incompleteTasks = existingTasks.filter((t: any) =>
        !t.completed && (!excludeTaskId || t.id !== excludeTaskId)
      );

      // Parse the new task's time
      const [newHour, newMinute] = scheduledTime.split(':').map(Number);
      const newStart = newHour * 60 + newMinute; // minutes from midnight
      const newEnd = newStart + estimatedDuration;

      // Check each existing task for overlap
      for (const task of incompleteTasks) {
        if (!task.scheduledTime || !task.estimatedDuration) continue;

        const [existingHour, existingMinute] = task.scheduledTime.split(':').map(Number);
        const existingStart = existingHour * 60 + existingMinute;
        const existingEnd = existingStart + task.estimatedDuration;

        // Check for overlap: new task starts before existing ends AND new task ends after existing starts
        if (newStart < existingEnd && newEnd > existingStart) {
          return task; // Conflict found
        }
      }

      return null; // No overlap
    } catch (error) {
      console.error('Error checking task overlap:', error);
      return null; // On error, allow the task (fail open)
    }
  }

  /**
   * Validate task scheduling constraints
   */
  async function validateTaskScheduling(
    userId: string,
    taskData: any,
    excludeTaskId?: number
  ): Promise<{ valid: boolean; error?: string }> {
    // Check if scheduledDate and scheduledTime are provided
    if (!taskData.scheduledDate || !taskData.scheduledTime) {
      return { valid: true }; // Unscheduled tasks are allowed
    }

    // Get user's work preferences
    const prefs = await storage.getUserPreferences(userId).catch(() => null);
    const workDaySet = parseWorkDays(prefs?.workDays);

    const scheduledDow = new Date(taskData.scheduledDate + 'T00:00:00').getDay();
    const scheduledDayAbbr = DAY_ABBRS[scheduledDow];
    const DAY_FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const scheduledDayFull = DAY_FULL_NAMES[scheduledDow];

    if (!workDaySet.has(scheduledDayAbbr)) {
      return {
        valid: false,
        error: `${scheduledDayFull} is not one of your work days.`,
      };
    }

    // Check for task overlap
    if (taskData.estimatedDuration) {
      const conflict = await checkTaskOverlap(
        userId,
        taskData.scheduledDate,
        taskData.scheduledTime,
        taskData.estimatedDuration,
        excludeTaskId
      );

      if (conflict) {
        return {
          valid: false,
          error: `Time conflict: This task overlaps with "${conflict.title}" (${conflict.scheduledTime}, ${conflict.estimatedDuration}min)`
        };
      }
    }

    return { valid: true };
  }

  // ===== END SCHEDULING VALIDATION HELPERS =====

  app.post('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const taskData = insertTaskSchema.parse({ ...req.body, userId });

      // Weekend check — still a hard reject (don't silently move to a work day)
      if (taskData.scheduledDate) {
        const prefs = await storage.getUserPreferences(userId).catch(() => null);
        const workDaySet = parseWorkDays(prefs?.workDays);
        const dow = new Date(taskData.scheduledDate + 'T00:00:00').getDay();
        if (!workDaySet.has(DAY_ABBRS[dow])) {
          const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          return res.status(400).json({ message: `${names[dow]} is not one of your work days.` });
        }
      }

      // Auto-assign time: date définie mais pas d'heure → trouver le premier créneau libre
      if (taskData.scheduledDate && !taskData.scheduledTime) {
        const slot = await storage.findFirstFreeSlot(userId, taskData.scheduledDate, taskData.estimatedDuration || 30);
        taskData.scheduledDate = slot.date;
        taskData.scheduledTime = slot.time;
        const [h, m] = slot.time.split(':').map(Number);
        const endMin = h * 60 + m + (taskData.estimatedDuration || 30);
        taskData.scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      }

      // Slot conflict — auto-shift to next available time, never reject
      if (taskData.scheduledDate && taskData.scheduledTime && taskData.estimatedDuration) {
        const check = await storage.checkSlotAvailability(
          userId, taskData.scheduledDate, taskData.scheduledTime, taskData.estimatedDuration
        );
        if (!check.available && check.nextAvailableTime) {
          taskData.scheduledTime = check.nextAvailableTime;
          const [h, m] = check.nextAvailableTime.split(':').map(Number);
          const endMin = h * 60 + m + taskData.estimatedDuration;
          taskData.scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`;
        }
      }

      const task = await storage.createTask(taskData);
      res.json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch('/api/tasks/workspace/:entryId', isAuthenticated, async (req: any, res) => {
    try {
      const entryId = parseInt(req.params.entryId);
      const { content, title } = req.body;
      const entry = await storage.updateWorkspaceEntry(entryId, { content, title });
      res.json(entry);
    } catch (error) {
      console.error("Error updating workspace entry:", error);
      res.status(500).json({ message: "Failed to update workspace entry" });
    }
  });

  app.get('/api/tasks/:id/workspace', isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const entries = await storage.getWorkspaceEntries(taskId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching workspace entries:", error);
      res.status(500).json({ message: "Failed to fetch workspace entries" });
    }
  });

  app.post('/api/tasks/:id/workspace', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const taskId = parseInt(req.params.id);
      const { projectId, type, intent, title, source, content } = req.body;
      const entry = await storage.createWorkspaceEntry({
        taskId,
        userId,
        projectId: projectId ?? null,
        type: type ?? "notes",
        intent: intent ?? null,
        title: title ?? null,
        source: source ?? "task",
        content: content ?? "",
      });

      // Routage vers la destination utile (lot D).
      //
      // Tout ce bloc est enveloppe : la note est DEJA enregistree a ce stade. Le routage est
      // un benefice, jamais une condition. Un modele indisponible, un quota depasse ou une
      // ecriture refusee ne doivent pas transformer un enregistrement reussi en erreur.
      let routage: { destination: string; contentId?: number } = { destination: "espace_de_travail" };
      try {
        const tache = await storage.getTask(taskId);
        // Verification d'appartenance : le parametre d'URL vient du client.
        if (tache && (tache as any).userId === userId) {
          const destination = destinationPourTache((tache as any).type);
          routage = { destination };

          if (destination === "content") {
            const deduit = await deduireChampsContenu({
              userId,
              projectId: projectId ?? (tache as any).projectId ?? null,
              titreTache: (tache as any).title ?? "",
              titreNote: title ?? "",
              texte: content ?? "",
            });

            const { ligne } = construireContenuDepuisTache({
              tache: {
                id: taskId,
                projectId: projectId ?? (tache as any).projectId ?? null,
                type: (tache as any).type ?? null,
                title: (tache as any).title ?? "",
              },
              note: { title: title ?? "", content: content ?? "" },
              deduit,
            });

            if (ligne) {
              // Un contenu existe deja pour cette tache : on le met a jour plutot que d'en
              // creer un second. Sans cela, chaque clic sur Enregistrer ajouterait un
              // brouillon identique au calendrier.
              const existant = await storage.getContentBySourceTask(userId, taskId);
              const enregistre = existant
                ? await storage.updateContent(existant.id, ligne as any)
                : await storage.createContent({ ...ligne, userId, autoPost: false } as any); // brouillon issu d'une tâche : jamais publié seul
              routage = { destination, contentId: enregistre.id };
            }
          }
        }
      } catch (e: any) {
        console.error(`[Routage] tache ${taskId} non routee:`, e?.message ?? e);
      }

      res.json({ ...entry, routage });
    } catch (error) {
      console.error("Error creating workspace entry:", error);
      res.status(500).json({ message: "Failed to create workspace entry" });
    }
  });

  // PATCH /api/tasks/bulk-reschedule — déplace toutes les tâches incomplètes de fromDate vers toDate
  app.patch('/api/tasks/bulk-reschedule', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { fromDate, toDate } = req.body;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: 'fromDate et toDate requis (format YYYY-MM-DD)' });
      }

      const tasks = await storage.getTasksInRange(userId, fromDate, fromDate);
      const toMove = (tasks as any[]).filter((t: any) => !t.completed);

      let updated = 0;
      for (const task of toMove) {
        await storage.updateTask(task.id, { scheduledDate: toDate });
        updated++;
      }

      res.json({ updated });
    } catch (error) {
      console.error('PATCH /api/tasks/bulk-reschedule error:', error);
      res.status(500).json({ message: 'Erreur reprogrammation' });
    }
  });

  app.patch('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { id } = req.params;

      // Propriété AVANT toute écriture : un identifiant fictif (événement d'agenda, jalon
      // virtuel) ou la tâche d'un autre compte → 404, rien n'est modifié.
      if (!/^\d+$/.test(String(id))) return res.status(404).json({ message: 'task_not_found' });
      const taskId = parseInt(id);
      const currentTask = await storage.getTask(taskId);
      if (!currentTask || (currentTask as any).userId !== userId) {
        return res.status(404).json({ message: 'task_not_found' });
      }

      // Liste blanche : on n'écrit jamais `userId`, `id`, `projectId`… venus du corps.
      const filtre = filtrerEditionTache(req.body);
      if (!filtre.ok) return res.status(400).json({ message: filtre.erreur });
      const updates: any = filtre.updates;

      // If updating schedule-related fields, apply slot-safe logic
      const touchesSchedule = !!(updates.scheduledDate || updates.scheduledTime || updates.estimatedDuration);
      let ancienneDate: string | null = null;
      if (touchesSchedule) {
        ancienneDate = currentTask.scheduledDate ?? null;

        const merged = { ...currentTask, ...updates, userId };

        // Weekend check — hard reject
        if (merged.scheduledDate) {
          const prefs = await storage.getUserPreferences(userId).catch(() => null);
          const workDaySet = parseWorkDays(prefs?.workDays);
          const dow = new Date(merged.scheduledDate + 'T00:00:00').getDay();
          if (!workDaySet.has(DAY_ABBRS[dow])) {
            const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            return res.status(400).json({ message: `${names[dow]} is not one of your work days.` });
          }
        }

        // Auto-assign time: date définie mais pas d'heure → trouver le premier créneau libre
        if (merged.scheduledDate && !merged.scheduledTime) {
          const slot = await storage.findFirstFreeSlot(userId, merged.scheduledDate, merged.estimatedDuration || 30);
          updates.scheduledDate = slot.date;
          updates.scheduledTime = slot.time;
          merged.scheduledDate = slot.date;
          merged.scheduledTime = slot.time;
          // `scheduledEndTime` est dérivée plus bas, une seule fois pour tous les chemins.
        }

        // Slot conflict — auto-shift
        if (merged.scheduledDate && merged.scheduledTime && merged.estimatedDuration) {
          const check = await storage.checkSlotAvailability(
            userId, merged.scheduledDate, merged.scheduledTime, merged.estimatedDuration, taskId
          );
          if (!check.available && check.nextAvailableTime) {
            updates.scheduledTime = check.nextAvailableTime;
            merged.scheduledTime = check.nextAvailableTime;
          }
        }

        // `scheduledEndTime` est DÉRIVÉE : on la recalcule dès que l'heure ou la durée
        // bouge, quel que soit le chemin. Sans ça, redimensionner une carte (qui n'envoie
        // que `estimatedDuration`) laissait une heure de fin périmée en base.
        updates.scheduledEndTime = resolveScheduledEndTime(
          merged.scheduledTime,
          merged.estimatedDuration,
        );
      }

      // Normalise completedAt : si completed=true, on force un vrai Date (pas une string ISO)
      const safeUpdates: any = { ...updates };
      if (safeUpdates.completed === true) {
        safeUpdates.completedAt = new Date();
      }
      // Retire completedAt si c'est une string (envoyée par vieux clients)
      if (typeof safeUpdates.completedAt === 'string') {
        safeUpdates.completedAt = new Date(safeUpdates.completedAt);
      }

      const task = await storage.updateTask(taskId, safeUpdates);

      // Règle du projet : tout chemin de (re)planification se termine par le filet
      // idempotent. Cette route ne le faisait pas — déplacer ou redimensionner une carte
      // pouvait donc laisser la journée en chevauchement jusqu'au prochain passage d'un
      // worker (toutes les 15 min), voire durablement si aucun worker ne tournait.
      // On repart du MIN(ancienne, nouvelle date) : un prérequis déplacé de mardi à jeudi
      // doit recharger le mercredi, sinon son dépendant reste devant lui.
      const depuis = touchesSchedule ? dateDeRetassage(ancienneDate, task?.scheduledDate) : null;
      if (depuis) {
        await storage.fixOverlappingTasks(userId, depuis).catch((e: any) =>
          console.error('[tasks:patch] fixOverlappingTasks:', e?.message),
        );
      }

      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  /**
   * Charge les dependances d'une tache et applique le verrou de sequence.
   *
   * Une dependance introuvable ne bloque pas : voir task-lock.ts. Une lecture qui echoue non
   * plus — on ne verrouille pas le travail de quelqu'un parce qu'une requete a rate.
   */
  async function verrouPourTache(taskId: number) {
    const dependances = await storage.getTaskDependencies(taskId).catch(() => [] as any[]);
    if (!dependances.length) return { verrouillee: false, bloqueePar: [] as { id: number; titre: string }[] };

    const prerequis = new Map<number, { title: string | null; completed: boolean | null }>();
    for (const d of dependances as any[]) {
      const id = d?.dependsOnTaskId;
      if (typeof id !== 'number') continue;
      const t = await storage.getTask(id).catch(() => undefined);
      if (t) prerequis.set(id, { title: (t as any).title ?? null, completed: (t as any).completed ?? null });
    }
    return verrouDeTache({ dependances: dependances as any[], prerequis, tacheId: taskId });
  }

  app.post('/api/tasks/:id/complete', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;

      // VERROU DE SEQUENCE : on ne coche pas une etape dont la precedente ne l'est pas.
      const verrou = await verrouPourTache(parseInt(id));
      if (verrou.verrouillee) {
        return res.status(409).json({ message: 'task_locked', bloqueePar: verrou.bloqueePar });
      }

      const task = await storage.completeTask(parseInt(id));
      res.json(task);
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  // Événements Google Agenda marqués « faits » dans Naya (voir server/services/agenda/faits.ts).
  app.post('/api/agenda/evenements/:eventId/fait', isAuthenticated, async (req: any, res) => {
    try {
      const { eventId } = req.params;
      if (!idEvenementValide(eventId)) return res.status(400).json({ message: 'invalid_event_id' });
      const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : null;
      await marquerFait(req.userId, eventId, date);
      res.json({ eventId, fait: true });
    } catch (error: any) {
      console.error('[agenda] marquer fait:', error?.message);
      res.status(500).json({ message: 'agenda_update_failed' });
    }
  });

  app.delete('/api/agenda/evenements/:eventId/fait', isAuthenticated, async (req: any, res) => {
    try {
      const { eventId } = req.params;
      if (!idEvenementValide(eventId)) return res.status(400).json({ message: 'invalid_event_id' });
      await retirerFait(req.userId, eventId);
      res.json({ eventId, fait: false });
    } catch (error: any) {
      console.error('[agenda] retirer fait:', error?.message);
      res.status(500).json({ message: 'agenda_update_failed' });
    }
  });

  app.post('/api/tasks/:id/toggle', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      // Un identifiant fictif (événement d'agenda injecté, jalon virtuel) ou une tâche d'un
      // autre compte n'est pas une tâche à cocher ici : 404 propre, jamais 500.
      if (!/^\d+$/.test(String(id))) return res.status(404).json({ message: 'task_not_found' });
      const taskBefore = await storage.getTask(parseInt(id));
      if (!taskBefore || (taskBefore as any).userId !== userId) {
        return res.status(404).json({ message: 'task_not_found' });
      }

      // VERROU DE SEQUENCE, dans le sens COCHER uniquement. Decocher reste toujours
      // possible : sans cela, une coche donnee par erreur deviendrait definitive, et
      // l'utilisatrice se retrouverait a debloquer une suite qu'elle n'a pas faite.
      if (taskBefore && !(taskBefore as any).completed) {
        const verrou = await verrouPourTache(parseInt(id));
        if (verrou.verrouillee) {
          return res.status(409).json({ message: 'task_locked', bloqueePar: verrou.bloqueePar });
        }
      }

      const task = await storage.toggleTaskCompletion(parseInt(id));

      // Capture completion signal when task flips to completed
      if (task.completed && taskBefore && !taskBefore.completed) {
        try {
          const completedAt = task.completedAt ? new Date(task.completedAt) : new Date();
          let completionDelayDays: number | null = null;
          if (task.scheduledDate) {
            const scheduledMs = new Date(task.scheduledDate).getTime();
            const completedMs = completedAt.getTime();
            completionDelayDays = Math.max(0, Math.floor((completedMs - scheduledMs) / (1000 * 60 * 60 * 24)));
          }
          const actualDurationVariance = (task.actualDuration != null && task.estimatedDuration != null)
            ? task.actualDuration - task.estimatedDuration
            : null;
          const timesRescheduled = task.learnedAdjustmentCount || 0;
          await storage.createTaskFeedback({
            taskId: task.id,
            taskTitle: task.title,
            taskType: task.type,
            taskCategory: task.category,
            taskSource: task.source,
            userId,
            projectId: task.projectId ?? null,
            feedbackType: 'completed',
            reason: 'task_done',
            freeText: null,
            completionDelayDays,
            actualDurationVariance,
            timesRescheduled,
          } as any);
        } catch { /* don't fail toggle if signal capture fails */ }
      }

      res.json(task);
    } catch (error) {
      console.error("Error toggling task:", error);
      res.status(500).json({ message: "Failed to toggle task" });
    }
  });

  // ─── Monthly Plan Generation ─────────────────────────────────────────────────
  app.post('/api/tasks/generate-monthly', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId: projectIdFromBody, month, year } = req.body;
      const floor = parseClientToday(req.body);

      // Get project-specific Brand DNA if projectId is specified, otherwise use global
      let brandDna = await storage.getBrandDna(userId);
      if (!brandDna) return res.status(400).json({ message: "Brand DNA not configured." });

      if (projectIdFromBody) {
        const projectSpecificDna = await storage.getBrandDnaForProject(userId, projectIdFromBody);
        if (projectSpecificDna) {
          brandDna = projectSpecificDna;
        }
      }

      const now = new Date();
      const targetMonth = { year: year ?? now.getFullYear(), month: month ?? (now.getMonth() + 1) };
      const monthStart = `${targetMonth.year}-${String(targetMonth.month).padStart(2, '0')}-01`;
      const lastDay = new Date(targetMonth.year, targetMonth.month, 0).getDate();
      const monthEnd = `${targetMonth.year}-${String(targetMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [operatingProfileSummary, existingMonthTasks] = await Promise.all([
        getOperatingProfileSummary(userId),
        storage.getTasksInRange(userId, monthStart, monthEnd, projectIdFromBody ?? undefined),
      ]);

      const { projectContext, personaContext } = await fetchAIContext(userId, projectIdFromBody ?? undefined);
      const goals = projectIdFromBody
        ? await storage.getProjectGoals(projectIdFromBody).catch(() => [])
        : [];
      const activeGoals = (goals as any[]).filter((g: any) => g.status === 'active');

      const aiResult = await generateMonthlyPlan({
        userId,
        brandDna: { businessType: brandDna.businessType, businessModel: brandDna.businessModel, revenueUrgency: brandDna.revenueUrgency, targetAudience: brandDna.targetAudience, corePainPoint: brandDna.corePainPoint, uniquePositioning: brandDna.uniquePositioning, contentBandwidth: (brandDna as any).contentBandwidth } as any,
        projectContext,
        goals: activeGoals.map((g: any) => ({ title: g.title, description: g.description, goalType: g.goalType, successMode: g.successMode, dueDate: g.dueDate })),
        existingTaskCount: existingMonthTasks.length,
        operatingProfileSummary,
        targetMonth,
        todayFloor: floor,
      });

      const deferDate = new Date(targetMonth.year, targetMonth.month, 1); // next month 1st as safety defer
      const deferTarget = clampToFloor(sharedFormatDate(deferDate), floor);

      const replanPrefs = await storage.getUserPreferences(userId);
      const replanWorkDays = parseWorkDays(replanPrefs?.workDays);
      // Les dépendances de l'IA sont exprimées par index dans `aiResult.tasks`. On pose cet
      // index d'origine (`__srcIndex`) AVANT le rééquilibrage et le filtre `_unschedulable` :
      // le filtre retire des tâches et décale tous les index suivants, donc `savedTasks[i]`
      // relierait des paires arbitraires. Même technique que l'auto-planner.
      const finalTasks = rebalanceTasksForward(
        aiResult.tasks.map((t: any, __srcIndex: number) => ({ ...t, __srcIndex })),
        floor, monthEnd, 5, undefined, 0, replanWorkDays,
      ).filter((t: any) => !t._unschedulable);

      // Group rebalanced tasks by date for realism validation
      const tasksByDate = new Map<string, any[]>();
      for (const t of finalTasks) {
        const d = t.scheduledDate;
        if (!tasksByDate.has(d)) tasksByDate.set(d, []);
        tasksByDate.get(d)!.push(t);
      }

      // Run realism per date group (on rebalanced/clamped tasks)
      const realismReports: Record<string, any> = {};
      for (const [date, dayTasks] of Array.from(tasksByDate.entries())) {
        const existingMinutes = (existingMonthTasks as any[])
          .filter((t: any) => t.scheduledDate === date)
          .reduce((s: number, t: any) => s + (t.estimatedDuration || 0), 0);
        const { realismReport } = runRealismValidation({
          candidateTasks: dayTasks.map((t: any) => ({ title: t.title, estimatedDuration: t.estimatedDuration || 30, taskEnergyType: t.taskEnergyType || 'admin', priority: t.priority || 3, canBeFragmented: t.canBeFragmented !== false, workflowGroup: t.workflowGroup, scheduledDate: date })),
          existingTaskMinutes: existingMinutes,
          operatingProfile: { energyRhythm: (await storage.getUserOperatingProfile(userId).catch(() => null))?.energyRhythm ?? undefined, contentBandwidth: (brandDna as any)?.contentBandwidth },
          workflowSuggestions: aiResult.workflowSuggestions || [],
          targetDate: date,
          deferTarget,
        });
        realismReports[date] = realismReport;
      }

      // Save tasks
      const savedTasks: any[] = [];
      // index d'origine (dans la sortie IA) → id de la tâche réellement créée
      const idParIndexSource = new Map<number, number>();
      // Titres dans l'ordre d'origine de la sortie IA (avant filtre/rééquilibrage) : « Task 2 »
      // dans une description vise l'index 1 de cette liste, pas de `finalTasks`.
      const titresLotMensuel: string[] = (aiResult.tasks || []).map((t: any) => t?.title ?? '');
      for (const taskData of finalTasks) {
        const task = await storage.createTask({
          userId,
          title: taskData.title,
          description: remplacerReferencesNumerotees(taskData.description, titresLotMensuel),
          type: taskData.type,
          category: taskData.category,
          priority: taskData.priority,
          source: 'generated',
          scheduledDate: taskData.scheduledDate,
          dueDate: new Date(taskData.scheduledDate),
          estimatedDuration: taskData.estimatedDuration || null,
          taskEnergyType: taskData.taskEnergyType || 'execution',
          setupCost: taskData.setupCost || null,
          canBeFragmented: taskData.canBeFragmented !== false,
          recommendedTimeOfDay: taskData.recommendedTimeOfDay || null,
          workflowGroup: taskData.workflowGroup || null,
          activationPrompt: taskData.activationPrompt
            ? remplacerReferencesNumerotees(taskData.activationPrompt, titresLotMensuel)
            : null,
          ...(projectIdFromBody ? { projectId: projectIdFromBody } : {}),
        } as any);
        savedTasks.push(task);
        idParIndexSource.set(taskData.__srcIndex, task.id);
      }

      // Save dependency links : une tâche écartée (non plaçable) n'a pas d'entrée dans la Map,
      // la dépendance qui la cite est omise au lieu de glisser sur sa voisine.
      for (const dep of aiResult.dependencies || []) {
        try {
          const fromId = idParIndexSource.get(dep.taskIndex);
          const toId = idParIndexSource.get(dep.dependsOnIndex);
          if (fromId && toId) {
            const ok = await ajouterDependance(userId, fromId, toId, dep.relationType || 'blocked_by');
            if (ok === false) console.warn(`[generate-monthly] dépendance refusée ${fromId} -> ${toId}`);
          }
        } catch { /* non-fatal */ }
      }

      // Après la pose des dépendances (elles viennent d'être créées) : précédences + anti-chevauchement
      // dès le plancher de génération (aujourd'hui côté client, ou début de mois).
      await storage.fixOverlappingTasks(userId, floor).catch((e: any) =>
        console.error('[generate-monthly] retassage:', e?.message),
      );

      res.json({ tasks: savedTasks, realismReports, monthlyRationale: aiResult.monthlyRationale });
    } catch (error) {
      console.error("Error generating monthly plan:", error);
      res.status(500).json({ message: "Failed to generate monthly plan" });
    }
  });

  // ─── Weekly Refinement ────────────────────────────────────────────────────────
  app.post('/api/tasks/generate-weekly', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId: projectIdFromBody, weekStart: weekStartParam } = req.body;
      const floor = parseClientToday(req.body);

      // Get project-specific Brand DNA if projectId is specified, otherwise use global
      let brandDna = await storage.getBrandDna(userId);
      if (!brandDna) return res.status(400).json({ message: "Brand DNA not configured." });

      if (projectIdFromBody) {
        const projectSpecificDna = await storage.getBrandDnaForProject(userId, projectIdFromBody);
        if (projectSpecificDna) {
          brandDna = projectSpecificDna;
        }
      }

      // Compute Monday of current or specified week
      const referenceDate = weekStartParam ? new Date(weekStartParam) : (() => {
        const d = new Date();
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
      })();
      referenceDate.setHours(0, 0, 0, 0);
      const weekStart = sharedFormatDate(referenceDate);
      const weekEndDate = new Date(referenceDate);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const weekEnd = sharedFormatDate(weekEndDate);

      const [operatingProfileSummary, weekTasks, deps] = await Promise.all([
        getOperatingProfileSummary(userId),
        storage.getTasksInRange(userId, weekStart, weekEnd, projectIdFromBody ?? undefined),
        storage.getTaskDependenciesForUser(userId, projectIdFromBody ?? undefined),
      ]);

      const { projectContext } = await fetchAIContext(userId, projectIdFromBody ?? undefined);
      const goals = projectIdFromBody
        ? await storage.getProjectGoals(projectIdFromBody).catch(() => [])
        : [];

      const completed = (weekTasks as any[]).filter((t: any) => t.completed);
      const incomplete = (weekTasks as any[]).filter((t: any) => !t.completed);

      // Detect blocked chains
      const depMap = new Map<number, string>();
      for (const d of (deps as any[])) {
        depMap.set(d.taskId, d.dependsOnTaskId);
      }
      const taskMap = new Map((weekTasks as any[]).map((t: any) => [t.id, t]));
      const blockedChains = incomplete.filter((t: any) => {
        const blockedById = depMap.get(t.id);
        if (!blockedById) return false;
        const blocker = taskMap.get(Number(blockedById));
        return blocker && !blocker.completed;
      }).map((t: any) => {
        const blockerTask = taskMap.get(Number(depMap.get(t.id)));
        return { taskId: t.id, taskTitle: t.title, blockedBy: blockerTask?.title || 'Unknown' };
      });

      const aiResult = await generateWeeklyRefinement({
        userId,
        brandDna: { businessType: brandDna.businessType, contentBandwidth: (brandDna as any).contentBandwidth } as any,
        projectContext,
        goals: (goals as any[]).filter((g: any) => g.status === 'active').map((g: any) => ({ title: g.title, goalType: g.goalType, successMode: g.successMode })),
        completedThisWeek: completed.map((t: any) => ({ id: t.id, title: t.title, type: t.type, category: t.category, scheduledDate: t.scheduledDate })),
        incompleteThisWeek: incomplete.map((t: any) => ({ id: t.id, title: t.title, type: t.type, category: t.category, scheduledDate: t.scheduledDate, workflowGroup: t.workflowGroup })),
        blockedChains,
        operatingProfileSummary,
        weekStart,
        weekEnd,
        todayFloor: floor,
      });

      // Apply reschedules
      const rescheduled: any[] = [];
      for (const r of aiResult.reschedules || []) {
        try {
          const safeDate = clampToFloor(r.newDate, floor);
          const updated = await storage.updateTask(r.taskId, { scheduledDate: safeDate, dueDate: new Date(safeDate) } as any);
          rescheduled.push({ taskId: r.taskId, newDate: safeDate });
        } catch { /* non-fatal */ }
      }

      // Create new fill-in tasks
      const newTasksSaved: any[] = [];
      for (const taskData of (aiResult.newTasks || []).slice(0, 3)) {
        try {
          const safeDate = clampToFloor(taskData.scheduledDate || weekStart, floor);
          const task = await storage.createTask({
            userId,
            title: taskData.title,
            description: taskData.description,
            type: taskData.type,
            category: taskData.category,
            priority: taskData.priority,
            source: 'generated',
            scheduledDate: safeDate,
            dueDate: new Date(safeDate),
            estimatedDuration: taskData.estimatedDuration || null,
            taskEnergyType: taskData.taskEnergyType || 'execution',
            setupCost: taskData.setupCost || null,
            canBeFragmented: taskData.canBeFragmented !== false,
            recommendedTimeOfDay: taskData.recommendedTimeOfDay || null,
            workflowGroup: taskData.workflowGroup || null,
            activationPrompt: taskData.activationPrompt || null,
            ...(projectIdFromBody ? { projectId: projectIdFromBody } : {}),
          } as any);
          newTasksSaved.push(task);
        } catch { /* non-fatal */ }
      }

      res.json({ reschedules: rescheduled, newTasks: newTasksSaved, weeklyRationale: aiResult.weeklyRationale });
    } catch (error) {
      console.error("Error generating weekly refinement:", error);
      res.status(500).json({ message: "Failed to generate weekly refinement" });
    }
  });

  // Place les tâches du JOUR restées sans heure (cause : génération tardive → pas de créneau
  // avant la fin de journée ; ces tâches ne sont jamais re-placées quand le jour redevient ouvert).
  // Garde-fou : on ne place que dans les créneaux libres À PARTIR DE L'HEURE COURANTE, jamais dans
  // le passé ni hors fenêtre. Une tâche qui ne rentre pas reste « À planifier ».
  app.post('/api/tasks/place-today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const hhmm = (s: string): number => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
      const today = (typeof req.body.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.clientToday))
        ? req.body.clientToday
        : new Date().toISOString().slice(0, 10);
      const nowMin = (typeof req.body.clientTime === 'string' && /^\d{2}:\d{2}$/.test(req.body.clientTime))
        ? hhmm(req.body.clientTime)
        : (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();

      const result = await runPlaceToday(userId, today, nowMin);
      // Précédences + anti-chevauchement à partir d'aujourd'hui, après le placement.
      await storage.fixOverlappingTasks(userId, today).catch((e: any) =>
        console.error('[place-today] retassage:', e?.message),
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error placing today's tasks:", error?.message);
      res.status(500).json({ message: "Failed to place tasks" });
    }
  });

  // Tâches « orphelines » : non complétées, non archivées, scheduled_date STRICTEMENT avant
  // aujourd'hui (toute semaine, y compris au-delà de la semaine courante). Surface PASSIVE —
  // aucune mutation ici, juste ce qui existe en base mais n'est plus remonté ailleurs.
  app.get('/api/tasks/overdue', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const today = (typeof req.query.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.clientToday))
        ? (req.query.clientToday as string)
        : new Date().toISOString().slice(0, 10);
      const past = await storage.getTasksInRange(userId, '2000-01-01', today);
      res.json(selectOverdueTasks(past as any[], today));
    } catch (error: any) {
      console.error('GET /api/tasks/overdue error:', error?.message);
      res.status(500).json({ message: 'Failed to fetch overdue tasks' });
    }
  });

  // Reporter une tâche en retard à AUJOURD'HUI, puis la placer dans un créneau libre (placeTasksFromNow).
  app.post('/api/tasks/:id/defer-to-today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
      const task = await storage.getTask(id);
      if (!task || task.userId !== userId) return res.status(404).json({ message: 'Task not found' });

      const hhmm = (s: string): number => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
      const today = (typeof req.body.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.clientToday))
        ? req.body.clientToday : new Date().toISOString().slice(0, 10);
      const nowMin = (typeof req.body.clientTime === 'string' && /^\d{2}:\d{2}$/.test(req.body.clientTime))
        ? hhmm(req.body.clientTime) : (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();

      // Sur aujourd'hui, sans heure, puis placement dans les créneaux libres à partir de maintenant.
      await storage.updateTask(id, { scheduledDate: today, scheduledTime: null, scheduledEndTime: null } as any);
      const placement = await runPlaceToday(userId, today, nowMin);
      await storage.fixOverlappingTasks(userId, today).catch((e: any) =>
        console.error('[defer-to-today] retassage:', e?.message),
      );
      const updated = await storage.getTask(id);
      res.json({ task: updated, placement });
    } catch (error: any) {
      console.error('POST /api/tasks/:id/defer-to-today error:', error?.message);
      res.status(500).json({ message: 'Failed to defer task' });
    }
  });

  // Récupérer les tâches ARCHIVÉES (archivedAt non nul) — surface explicite, jamais mélangée
  // aux vues actives. Optionnellement filtrée par projet (?projectId=).
  app.get('/api/tasks/archived', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      let pid: number | undefined;
      if (req.query.projectId) {
        const parsed = Number(req.query.projectId);
        if (Number.isFinite(parsed) && parsed > 0) pid = parsed;
      }
      const archived = await storage.getArchivedTasks(userId, pid);
      res.json(archived);
    } catch (error: any) {
      console.error('GET /api/tasks/archived error:', error?.message);
      res.status(500).json({ message: 'Failed to fetch archived tasks' });
    }
  });

  // Refuser une tâche : raison + explication libre → retour, souvenir, remplacement.
  app.post('/api/tasks/:id/refuser', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ message: 'invalid_task_id' });
      const taskId = parseInt(req.params.id, 10);
      const { reason, freeText: brut } = req.body ?? {};
      if (!estRaisonRefus(reason)) return res.status(400).json({ message: 'invalid_reason' });
      if (brut != null && typeof brut !== 'string') return res.status(400).json({ message: 'invalid_free_text' });
      const freeText = typeof brut === 'string' && brut.trim() ? brut.trim() : null;

      const r = await refuserTache(refusDeps, { userId, taskId, raison: reason, freeText });
      if (r.statut === 'introuvable') return res.status(404).json({ message: 'Task not found' });
      if (r.statut === 'evenement_agenda') return res.status(400).json({ message: 'agenda_event' });
      if (r.statut === 'deja_terminee') return res.status(409).json({ message: 'task_already_completed' });
      res.json({ refusee: true, remplacement: r.remplacement, ...(r.raison ? { raison: r.raison } : {}) });
    } catch (error: any) {
      console.error('POST /api/tasks/:id/refuser error:', error?.message);
      res.status(500).json({ message: 'refus_failed' });
    }
  });

  // Refuser un post : raison + explication libre → souvenir, remplacement au choix, suppression.
  app.post('/api/content/:id/refuser', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ message: 'invalid_content_id' });
      const contentId = parseInt(req.params.id, 10);
      const { reason, freeText: brut, remplacer: brutRemplacer } = req.body ?? {};
      if (!estRaisonRefusPost(reason)) return res.status(400).json({ message: 'invalid_reason' });
      if (brut != null && typeof brut !== 'string') return res.status(400).json({ message: 'invalid_free_text' });
      if (brutRemplacer !== undefined && typeof brutRemplacer !== 'boolean') return res.status(400).json({ message: 'invalid_replace' });
      const explication = typeof brut === 'string' && brut.trim() ? brut.trim() : null;
      const remplacer = brutRemplacer === undefined ? true : brutRemplacer;

      const r = await refuserPost(refusPostDeps, { userId, contentId, raison: reason, explication, remplacer });
      if (r.statut === 'introuvable') return res.status(404).json({ message: 'Content not found' });
      if (r.statut === 'deja_publie') return res.status(409).json({ message: 'already_published' });
      res.json({ refuse: true, remplacement: r.remplacement, ...(r.raison ? { raison: r.raison } : {}) });
    } catch (error: any) {
      console.error('POST /api/content/:id/refuser error:', error?.message);
      res.status(500).json({ message: 'refus_failed' });
    }
  });

  // Ignorer / archiver une tâche en retard (soft — ne supprime pas, la sort juste de la surface).
  app.post('/api/tasks/:id/archive', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
      const task = await storage.getTask(id);
      if (!task || task.userId !== userId) return res.status(404).json({ message: 'Task not found' });
      await storage.updateTask(id, { archivedAt: new Date() } as any);
      res.json({ ok: true });
    } catch (error: any) {
      console.error('POST /api/tasks/:id/archive error:', error?.message);
      res.status(500).json({ message: 'Failed to archive task' });
    }
  });

  // AI-powered daily tasks generation
  app.post('/api/tasks/generate-daily', isAuthenticated, async (req: any, res) => {

    // Helper: run AI generation with full fallback chain for one project
    async function generateForProject(
      userId: string,
      brandDna: any,
      projectContext: any,
      personaContext: any,
      recentContent: any[],
      recentOutreach: any[],
      completedTasksToday: any[],
      recentWorkspaceNotes: string,
      rejectedTasksContext?: string,
      operatingProfileSummary?: string,
      positiveEffectivenessContext?: string,
      workDayStart?: string,
      workDayEnd?: string,
      breaks?: Array<{ start: string; end: string; label?: string }>,
      maxTasks?: number,
      founderEnergyLevel?: string,
      founderEmotionalContext?: string,
    ) {
      const brandDnaInput = {
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
        currentChallenges: brandDna.currentChallenges || undefined,
        pastSuccess: brandDna.pastSuccess || undefined,
        inspiration: brandDna.inspiration || undefined,
        tone: brandDna.tone,
        contentPillars: brandDna.contentPillars || [],
        audience: brandDna.audience || "",
        painPoints: brandDna.painPoints || [],
        desires: brandDna.desires || [],
        offer: brandDna.offer || "",
        offers: brandDna.offers || "",
        businessGoal: brandDna.businessGoal || "",
        businessName: brandDna.businessName,
        website: brandDna.website,
        linkedinProfile: brandDna.linkedinProfile,
        instagramHandle: brandDna.instagramHandle,
        contentPillarsDetailed: brandDna.contentPillarsDetailed || [],
        brandVoiceKeywords: brandDna.brandVoiceKeywords || [],
        brandVoiceAntiKeywords: brandDna.brandVoiceAntiKeywords || [],
        priceRange: brandDna.priceRange || "",
        clientJourney: brandDna.clientJourney || "",
        revenueTarget: brandDna.revenueTarget || "",
        activeBusinessPriority: brandDna.activeBusinessPriority || "",
        competitorLandscape: brandDna.competitorLandscape || "",
        editorialTerritory: brandDna.editorialTerritory || "",
        geographicFocus: brandDna.geographicFocus || "",
        currentBusinessStage: brandDna.currentBusinessStage || "",
        teamStructure: brandDna.teamStructure || "",
        operationalConstraints: brandDna.operationalConstraints || "",
      };

      try {
        return await generateDailyTasks({
          userId,
          projectContext,
          personaContext,
          brandDna: brandDnaInput,
          recentContent,
          recentOutreach,
          weeklyGoals: {},
          completedTasksToday: completedTasksToday.filter((t: any) => t.completed),
          recentWorkspaceNotes,
          rejectedTasksContext,
          operatingProfileSummary,
          positiveEffectivenessContext,
          workDayStart,
          workDayEnd,
          breaks,
          maxTasks,
          energyLevel: founderEnergyLevel,
          emotionalContext: founderEmotionalContext,
        });
      } catch (aiError: any) {
        console.error("Claude AI error lors de la génération de tâches:", aiError.message);
        // Fallback statique minimal — Claude était indisponible
        return [];
      }
    }

    try {
      const userId = req.userId;
      const { projectId: projectIdFromBody, replaceExisting } = req.body;
      const todayStr = parseClientToday(req.body);

      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA not configured. Please complete onboarding first." });
      }

      const today = new Date(todayStr + 'T00:00:00');

      const [recentContent, recentOutreach, completedTasksToday] = await Promise.all([
        storage.getContent(userId, 10),
        storage.getOutreachMessages(userId),
        storage.getTasks(userId, today),
      ]);

      const weekEndStr = (() => {
        const d = new Date(todayStr + 'T00:00:00');
        const dow = d.getDay();
        const daysToSun = dow === 0 ? 0 : 7 - dow;
        d.setDate(d.getDate() + daysToSun);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

      let recentWorkspaceEntries: any[] = [];
      let recentFeedback: any[] = [];
      let operatingProfile: any = null;
      let existingWeekTasks: any[] = [];
      let weekAvailability: any[] = [];
      try {
        [recentWorkspaceEntries, recentFeedback, operatingProfile, existingWeekTasks, weekAvailability] = await Promise.all([
          storage.getRecentWorkspaceEntries(userId, undefined, 20),
          storage.getRecentTaskFeedback(userId, undefined, 30),
          storage.getUserOperatingProfile(userId),
          storage.getTasksInRange(userId, todayStr, weekEndStr),
          storage.getDayAvailabilityRange(userId, todayStr, weekEndStr),
        ]);
      } catch {}

      const weekBreaksByDate = new Map<string, Array<{ start: string; end: string; label?: string }>>();
      for (const avail of weekAvailability) {
        if (avail.breaks && Array.isArray(avail.breaks)) {
          weekBreaksByDate.set(avail.date, (avail.breaks as any[]).map((b: any) => ({
            start: b.start,
            end: b.end,
            label: b.label,
          })));
        }
      }
      const todayBreaksRaw = weekBreaksByDate.get(todayStr) || [];

      const workspaceByProject: Record<string, string[]> = {};
      for (const entry of recentWorkspaceEntries) {
        const key = entry.projectId?.toString() || 'general';
        if (!workspaceByProject[key]) workspaceByProject[key] = [];
        workspaceByProject[key].push(entry.title ? `${entry.title}: ${entry.content}` : entry.content);
      }

      // Build operating profile summary string
      const operatingProfileSummary = operatingProfile
        ? await getOperatingProfileSummary(userId)
        : '';

      // Build rejected tasks context (exclude "completed" positive signals)
      const negativeSignals = recentFeedback.filter((f: any) => ['deleted', 'dismissed', 'deferred', 'refused'].includes(f.feedbackType));
      const rejectedTasksContext = negativeSignals.length > 0
        ? negativeSignals.slice(0, 15).map((f: any) => ligneContexteRefus(f)).join('\n')
        : '';

      // Build positive effectiveness context from completion signals
      const positiveEffectivenessContext = buildPositiveEffectivenessContext(
        recentFeedback.filter((f: any) => f.feedbackType === 'completed')
      );

      // Determine which projects to generate tasks for
      const prefs = await storage.getUserPreferences(userId);
      const resolvedProjectId = projectIdFromBody !== undefined ? projectIdFromBody : (prefs?.activeProjectId ?? null);

      if (replaceExisting === true && existingWeekTasks.length > 0) {
        const staleGenerated = (existingWeekTasks as any[]).filter((t: any) =>
          !t.completed &&
          (t.source === 'generated' || t.source === 'ai') &&
          (resolvedProjectId === null || t.projectId === resolvedProjectId)
        );
        for (const t of staleGenerated) {
          await storage.updateTask(t.id, {
            scheduledDate: null,
            scheduledTime: null,
            scheduledEndTime: null,
          });
        }
        existingWeekTasks = await storage.getTasksInRange(userId, todayStr, weekEndStr);
      }

      const workDayStartStr = (prefs as any)?.workDayStart || '09:00';
      const workDayEndStr = (prefs as any)?.workDayEnd || '18:00';

      const generateDailyLunchBreak = (prefs?.lunchBreakEnabled ?? true)
        ? { start: prefs?.lunchBreakStart || '12:00', end: prefs?.lunchBreakEnd || '13:00' }
        : null;
      const lunchOverlapsToday = generateDailyLunchBreak && todayBreaksRaw.some((b: any) => {
        const hhmmToMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
        return hhmmToMin(b.start) < hhmmToMin(generateDailyLunchBreak.end) && hhmmToMin(b.end) > hhmmToMin(generateDailyLunchBreak.start);
      });
      const todayBreaks = (generateDailyLunchBreak && !lunchOverlapsToday)
        ? [...todayBreaksRaw, generateDailyLunchBreak]
        : todayBreaksRaw;
      const userWorkDaysGen = parseWorkDays(prefs?.workDays);

      const genDayTypeByDate = new Map<string, string>();
      const genOffDates = new Set<string>();
      for (const avail of weekAvailability) {
        if (avail.dayType) {
          genDayTypeByDate.set(avail.date, avail.dayType);
          if (avail.dayType === 'off') genOffDates.add(avail.date);
        }
      }

      let projectsToProcess: Array<{ id: number | null; name: string; dailyTimeBudgetHours?: number | null; category?: string | null }> = [];
      if (resolvedProjectId) {
        const sp = await storage.getProject(resolvedProjectId, userId).catch(() => null);
        projectsToProcess = [{ id: resolvedProjectId, name: sp?.name || '', dailyTimeBudgetHours: (sp as any)?.dailyTimeBudgetHours ?? null, category: (sp as any)?.category ?? null }];
      } else {
        const allProjects = await storage.getProjects(userId);
        if (allProjects.length > 0) {
          // On conserve le budget temps + catégorie pour pondérer la répartition des tâches.
          projectsToProcess = allProjects.map(p => ({ id: p.id, name: p.name, dailyTimeBudgetHours: (p as any).dailyTimeBudgetHours ?? null, category: (p as any).category ?? null }));
        } else {
          projectsToProcess = [{ id: null, name: '' }];
        }
      }

      const allCreatedTasks: any[] = [];
      let lastFocus = '';
      let lastReasoning = '';
      let lastBottleneck = '';
      let lastSuggestedNextMove = '';
      const skippedProjects: Array<{ projectId: number | null; projectName: string; reason: string }> = [];
      const accumulatedRealismReport = {
        capacityMinutes: 0,
        existingMinutes: 0,
        totalCandidateMinutes: 0,
        deferredCount: 0,
        deferredTitles: [] as string[],
        workflowBundlesDeferredCount: 0,
        contextSwitchCorrected: false,
        deepWorkDeferredCount: 0,
      };

      // ── Helper functions (hoisted before loop) ──────────────────────────
      const minutesToHHMM = (mins: number): string =>
        `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const hhmmToMinutes = (hhmm: string): number => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      const isInBreak = (startMin: number, endMin: number, breaks: Array<{ start: string; end: string }>): boolean =>
        breaks.some(b => {
          const bs = hhmmToMinutes(b.start);
          const be = hhmmToMinutes(b.end);
          return startMin < be && endMin > bs;
        });

      // ── Working hour boundaries ──────────────────────────────────────────
      const dayStartMin = hhmmToMinutes(workDayStartStr);
      const dayEndMin = hhmmToMinutes(workDayEndStr);

      // ── Client time → avoid placing tasks in the past ───────────────────
      const rawClientTime = typeof req.body.clientTime === 'string' && /^\d{2}:\d{2}$/.test(req.body.clientTime)
        ? req.body.clientTime
        : null;
      const nowFloorMin = rawClientTime ? hhmmToMinutes(rawClientTime) : dayStartMin;
      const remainingMinutesToday = Math.max(0, dayEndMin - nowFloorMin - 15);

      // ── Energy-aware task caps ──────────────────────────────────────────
      const energyUpdatedDate = prefs?.energyUpdatedDate;
      const isEnergyStale = energyUpdatedDate !== todayStr;
      const energyLevel = isEnergyStale ? 'high' : (prefs?.currentEnergyLevel || 'high');
      // WEEKLY caps: generate enough tasks to fill the entire week (Mon-Fri)
      const energyCaps: Record<string, number> = { high: 20, medium: 15, low: 10, depleted: 8 };
      const TASKS_PER_PROJECT_MAX = 6; // 6 tasks per project = enough for a full week
      const WEEKLY_TASK_CAP = energyCaps[energyLevel] || 20;
      const projectCount = projectsToProcess.length;
      // Répartition PONDÉRÉE par le budget temps/jour (au lieu d'un split égal cap/nbProjets).
      const totalBudget = projectsToProcess.reduce((s: number, pr: any) => s + budgetWeight(pr?.dailyTimeBudgetHours), 0) || 1;
      const capForProject = (pr: any): number => taskCapForBudget(pr?.dailyTimeBudgetHours, totalBudget, WEEKLY_TASK_CAP);

      const WEEKLY_PROJECT_CAP = 20; // Allow more tasks per project per week

      const existingTasksByProject = new Map<string, any[]>();
      for (const t of existingWeekTasks) {
        const key = t.projectId?.toString() || 'general';
        if (!existingTasksByProject.has(key)) existingTasksByProject.set(key, []);
        existingTasksByProject.get(key)!.push(t);
      }

      const normaliseTaskData = (taskData: any): any => {
        const validTimeOfDay = ['morning', 'afternoon', 'evening', 'flexible'];
        let tod = taskData.recommendedTimeOfDay;
        if (tod && !validTimeOfDay.includes(tod)) {
          if (/morning/i.test(tod) || /early/i.test(tod)) tod = 'morning';
          else if (/afternoon/i.test(tod) || /midday/i.test(tod)) tod = 'afternoon';
          else if (/evening/i.test(tod) || /night/i.test(tod)) tod = 'evening';
          else tod = 'flexible';
        }

        const validEnergyTypes = ['deep_work', 'creative', 'admin', 'social', 'logistics', 'execution'];
        let energy = taskData.taskEnergyType;
        if (!energy || !validEnergyTypes.includes(energy)) energy = 'execution';

        return {
          ...taskData,
          recommendedTimeOfDay: tod || 'flexible',
          taskEnergyType: energy,
          estimatedDuration: taskData.estimatedDuration || 30,
        };
      };

      // ── Collection pass — generate + validate, do NOT save yet ──────────
      type PendingTask = {
        taskData: any;
        scheduledDate: string;
        projId: number | null;
        aiResponseAny: any;
        taskIndex: number;
        projectBatchKey: string;
      };
      const allPendingTasks: PendingTask[] = [];
      const allWorkflowSugs: any[] = [];

      // PERF : on génère les projets EN PARALLÈLE (les appels IA sont le coût dominant et
      // sont indépendants — le placement vient après, séquentiellement). On collecte des
      // résultats par projet, puis on les fusionne DANS L'ORDRE (déterminisme préservé).
      type ProjResult = {
        skipped?: { projectId: number | null; projectName: string; reason: string };
        created?: any[];
        pending: PendingTask[];
        workflowSugs: any[];
        focus?: string; reasoning?: string; bottleneck?: string; suggestedNextMove?: string;
      };

      // Les rituels occupent leur créneau AVANT que l'IA ne place quoi que ce soit.
      await materializeRituals(userId, todayStr).catch((e: any) =>
        console.error('[generate-daily] materializeRituals:', e?.message),
      );

      const projResults: ProjResult[] = await Promise.all(projectsToProcess.map(async (proj): Promise<ProjResult> => {
        const projectBatchKey = proj.id?.toString() || 'general';

        const existingProjectTasks = (existingTasksByProject.get(projectBatchKey) || [])
          .filter((t: any) => !t.completed && t.type !== 'milestone' && t.source !== 'milestone');
        if (existingProjectTasks.length >= WEEKLY_PROJECT_CAP) {
          return { skipped: { projectId: proj.id, projectName: proj.name, reason: 'Already has tasks this week' }, created: existingProjectTasks, pending: [], workflowSugs: [] };
        }

        // Get project-specific Brand DNA if available, otherwise use global
        let projectBrandDna = brandDna;
        if (proj.id !== null) {
          const projectSpecificDna = await storage.getBrandDnaForProject(userId, proj.id).catch(() => null);
          if (projectSpecificDna) {
            projectBrandDna = projectSpecificDna;
          }
        }

        let aiResponse: any;
        try {
          const { projectContext, personaContext } = await fetchAIContext(userId, proj.id);
          const projectKey = proj.id?.toString() || 'general';
          const projectNotes = workspaceByProject[projectKey];
          const recentWorkspaceNotes = projectNotes?.length
            ? `${projectContext.projectName || proj.name || 'Project'} notes:\n${projectNotes.join('\n')}`
            : '';

          aiResponse = await generateForProject(
            userId, projectBrandDna, projectContext, personaContext,
            recentContent, recentOutreach, completedTasksToday, recentWorkspaceNotes,
            rejectedTasksContext, operatingProfileSummary, positiveEffectivenessContext,
            workDayStartStr, workDayEndStr, todayBreaks, capForProject(proj),
            energyLevel, isEnergyStale ? undefined : (prefs?.currentEmotionalContext || undefined),
          );
        } catch (projError: any) {
          console.error(`Task generation failed for project ${proj.id} (${proj.name}):`, projError.message);
          return { skipped: { projectId: proj.id, projectName: proj.name, reason: `AI error — will retry next time` }, pending: [], workflowSugs: [] };
        }

        if (!aiResponse?.tasks?.length) {
          return { skipped: { projectId: proj.id, projectName: proj.name, reason: 'AI returned no tasks for this project' }, pending: [], workflowSugs: [] };
        }

        const rawTasksToCreate = (aiResponse.tasks || []).slice(0, capForProject(proj));

        const aiResponseAny = aiResponse as any;
        const namespacedSugs = (aiResponseAny.workflowSuggestions || []).map((s: any) => ({
          ...s,
          label: `${projectBatchKey}::${s.label}`,
        }));
        for (const sug of namespacedSugs) {
          for (const idx of (sug.taskIndexes || [])) {
            if (rawTasksToCreate[idx]) {
              (rawTasksToCreate[idx] as any).workflowGroup = sug.label;
            }
          }
        }

        const pending: PendingTask[] = rawTasksToCreate.map((rt: any, i: number) => ({
          taskData: normaliseTaskData(rt),
          scheduledDate: todayStr,
          projId: proj.id,
          aiResponseAny,
          taskIndex: i,
          projectBatchKey,
        }));

        return {
          pending,
          workflowSugs: namespacedSugs,
          focus: aiResponse.focus,
          reasoning: aiResponse.reasoning,
          bottleneck: aiResponseAny.bottleneck,
          suggestedNextMove: aiResponseAny.suggestedNextMove,
        };
      }));

      // Fusion ordonnée (le dernier projet non vide gagne pour focus/reasoning/etc.)
      for (const r of projResults) {
        if (r.skipped) skippedProjects.push(r.skipped);
        if (r.created?.length) allCreatedTasks.push(...r.created);
        if (r.pending.length) allPendingTasks.push(...r.pending);
        if (r.workflowSugs.length) allWorkflowSugs.push(...r.workflowSugs);
        if (r.focus) lastFocus = r.focus;
        if (r.reasoning) lastReasoning = r.reasoning;
        if (r.bottleneck) lastBottleneck = r.bottleneck;
        if (r.suggestedNextMove) lastSuggestedNextMove = r.suggestedNextMove;
      }

      // ── Milestone trigger check — inject unlocked tasks into pending ──────
      let milestoneNotes: string[] = [];
      try {
        const recentCaptures = await storage.getCaptureEntries(userId, true);
        const triggeredMilestones = await checkMilestoneTriggers(userId, resolvedProjectId, {
          recentlyCompletedTasks: completedTasksToday
            .filter((t: { completed: boolean }) => t.completed)
            .map((t: { id: number; title: string }) => ({ id: t.id, title: t.title })),
          recentCaptures: recentCaptures.map((c) => ({ content: c.content })),
          recentWorkspaceNotes: Object.values(workspaceByProject).flat().join('\n'),
        });

        for (const triggered of triggeredMilestones) {
          type UnlockedTask = { title: string; description: string; type?: string; category?: string; priority?: number; estimatedDuration?: number; taskEnergyType?: string };
          const tasksToUnlock = (triggered.trigger.tasksToUnlock as UnlockedTask[]) || [];

          const matchedTaskId = triggered.matchSource === 'completed_task'
            ? completedTasksToday
                .filter((ct: { completed: boolean }) => ct.completed)
                .find((ct: { id: number; title: string }) =>
                  triggered.matchedKeywords.some(kw => ct.title.toLowerCase().includes(kw.toLowerCase()))
                )?.id ?? null
            : null;

          await storage.updateMilestoneTrigger(triggered.trigger.id, {
            status: 'triggered',
            triggeredAt: new Date(),
            triggeredByTaskId: matchedTaskId,
          });
          milestoneNotes.push(`Milestone triggered: "${triggered.trigger.conditionSummary}" (${triggered.confidence}% confidence, matched: ${triggered.matchedKeywords.join(', ')})`);

          for (let i = 0; i < tasksToUnlock.length; i++) {
            const t = tasksToUnlock[i];
            const taskData = normaliseTaskData({
              title: t.title,
              description: t.description,
              type: t.type || 'admin',
              category: t.category || 'planning',
              priority: t.priority || 3,
              estimatedDuration: t.estimatedDuration || 30,
              taskEnergyType: t.taskEnergyType || 'execution',
              setupCost: 'low',
              canBeFragmented: true,
              recommendedTimeOfDay: 'flexible',
            });
            allPendingTasks.push({
              taskData: { ...taskData, source: 'milestone_trigger', milestoneTriggerId: triggered.trigger.id },
              scheduledDate: todayStr,
              projId: triggered.trigger.projectId,
              aiResponseAny: {},
              taskIndex: allPendingTasks.length + i,
              projectBatchKey: triggered.trigger.projectId?.toString() || 'general',
            });
          }
        }
      } catch (milestoneErr) {
        console.error("Milestone trigger check failed (non-fatal):", milestoneErr);
      }

      // ── Energy-aware global task filtering (low/depleted = max 3, bias admin/creative) ──
      if ((energyLevel === 'low' || energyLevel === 'depleted') && allPendingTasks.length > 3) {
        const energyPriority: Record<string, number> = { admin: 0, creative: 1, logistics: 2, execution: 3, social: 4, deep_work: 5 };
        allPendingTasks.sort((a, b) => {
          const ea = energyPriority[a.taskData.taskEnergyType] ?? 3;
          const eb = energyPriority[b.taskData.taskEnergyType] ?? 3;
          if (ea !== eb) return ea - eb;
          return (a.taskData.priority || 5) - (b.taskData.priority || 5);
        });
        allPendingTasks.splice(3);
      }

      // ── Slot-collision guard — range-based, seeds from existing task end times ──
      // Each entry is { start, end } in minutes
      const usedRanges: Array<{ start: number; end: number }> = [];
      const existingTasksForSlots = await storage.getTasks(userId, new Date(todayStr + 'T00:00:00'));
      for (const t of existingTasksForSlots as any[]) {
        if (t.scheduledTime && !t.completed && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
          const startMin = hhmmToMinutes(t.scheduledTime);
          const endMin = startMin + (t.estimatedDuration || 30);
          usedRanges.push({ start: startMin, end: endMin });
        }
      }
      // Add Google Calendar events as blocked ranges so generated tasks never overlap appointments
      const calBlockedRanges = await getCalendarBlockedRanges(userId, todayStr).catch(() => []);
      usedRanges.push(...calBlockedRanges);

      const rangeOverlaps = (startMin: number, endMin: number) =>
        usedRanges.some(r => startMin < r.end && endMin > r.start);

      // Bug 4 fix: seed curSlot from end of last existing task, not from 09:00
      const latestExistingEndMin = usedRanges.reduce((max, r) => Math.max(max, r.end), 0);

      // Calculate minimum valid time (current time + 1 hour if scheduling for today)
      const now = new Date();
      const isSchedulingForToday = todayStr === sharedFormatDate(now);
      let minValidTime = workDayStartStr || '09:00';

      if (isSchedulingForToday) {
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const minHour = currentHour + 1;
        const currentTimePlusOne = `${String(minHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
        minValidTime = currentTimePlusOne > minValidTime ? currentTimePlusOne : minValidTime;
      }

      // Working hours boundaries (in minutes for easier comparison)
      const workDayStartMin = hhmmToMinutes(workDayStartStr || '09:00');
      const workDayEndMin = hhmmToMinutes(workDayEndStr || '18:00');
      // Bug 4: start from the later of (last existing task end) or (minValidTime)
      const seedSlotMin = Math.max(latestExistingEndMin, hhmmToMinutes(minValidTime), workDayStartMin);

      let curSlot = seedSlotMin;

      for (const pending of allPendingTasks) {
        const duration = (pending.taskData as any).estimatedDuration || 30;

        // Start from curSlot, not from 09:00 or AI suggestion
        let slotMin = curSlot;

        // Advance past any existing range that overlaps
        let safety = 0;
        while (rangeOverlaps(slotMin, slotMin + duration) && safety < 50) {
          const blocking = usedRanges.find(r => slotMin < r.end && slotMin + duration > r.start);
          if (blocking) slotMin = blocking.end;
          else slotMin += 15;
          safety++;
        }

        // If beyond working hours, push to first slot of next available day (handled later by genTryPlaceOnDate)
        if (slotMin + duration > workDayEndMin) {
          pending.taskData.scheduledTime = null;
        } else {
          const slot = minutesToHHMM(slotMin);
          usedRanges.push({ start: slotMin, end: slotMin + duration });
          curSlot = slotMin + duration;
          pending.taskData.scheduledTime = slot;
        }
      }

      // ── Single realism pass after ALL projects collected ──────────────────
      const existingTodayMinutes = existingWeekTasks
        .filter((t: any) => t.scheduledDate === todayStr)
        .reduce((sum: number, t: any) => sum + (t.estimatedDuration || 0), 0);

      // Bug 2 fix: deferTarget must be the next WORK day, not just tomorrow
      const deferDate = new Date(todayStr + 'T00:00:00');
      let deferTries = 0;
      do {
        deferDate.setDate(deferDate.getDate() + 1);
        deferTries++;
        const deferDs = `${deferDate.getFullYear()}-${String(deferDate.getMonth() + 1).padStart(2, '0')}-${String(deferDate.getDate()).padStart(2, '0')}`;
        if (userWorkDaysGen.has(DAY_ABBRS[deferDate.getDay()]) && !genOffDates.has(deferDs)) break;
      } while (deferTries < 7);
      const deferTarget = `${deferDate.getFullYear()}-${String(deferDate.getMonth() + 1).padStart(2, '0')}-${String(deferDate.getDate()).padStart(2, '0')}`;

      const { tasks: validatedTasks, realismReport } = runRealismValidation({
        candidateTasks: allPendingTasks.map((p) => ({
          title: p.taskData.title,
          estimatedDuration: p.taskData.estimatedDuration || 30,
          taskEnergyType: p.taskData.taskEnergyType || 'execution',
          priority: p.taskData.priority || 3,
          canBeFragmented: p.taskData.canBeFragmented !== false,
          workflowGroup: p.taskData.workflowGroup,
          scheduledDate: todayStr,
        })),
        existingTaskMinutes: existingTodayMinutes,
        operatingProfile: {
          energyRhythm: operatingProfile?.energyRhythm,
          contentBandwidth: brandDna?.contentBandwidth,
          avoidanceTriggers: operatingProfile?.avoidanceTriggers,
        },
        workflowSuggestions: allWorkflowSugs.map((s: any) => ({
          label: s.label,
          taskIndexes: s.taskIndexes || [],
          recommendedBlockMinutes: s.recommendedBlockMinutes || 60,
        })),
        targetDate: todayStr,
        deferTarget,
        remainingMinutesOverride: remainingMinutesToday,
      });

      Object.assign(accumulatedRealismReport, {
        capacityMinutes: realismReport.capacityMinutes,
        existingMinutes: realismReport.existingMinutes,
        totalCandidateMinutes: realismReport.totalCandidateMinutes,
        deferredCount: realismReport.deferredCount,
        deferredTitles: realismReport.deferredTitles,
        workflowBundlesDeferredCount: realismReport.workflowBundlesDeferredCount,
        contextSwitchCorrected: realismReport.contextSwitchCorrected,
        deepWorkDeferredCount: realismReport.deepWorkDeferredCount,
      });

      for (let i = 0; i < allPendingTasks.length; i++) {
        if (validatedTasks[i]) {
          allPendingTasks[i].scheduledDate = validatedTasks[i].scheduledDate;
        }
      }

      // ── Rebalance across the current week before saving ──────────────────
      const existingDayCounts = new Map<string, number>();
      for (const t of existingWeekTasks) {
        if (t.scheduledDate && !t.completed) {
          existingDayCounts.set(t.scheduledDate, (existingDayCounts.get(t.scheduledDate) || 0) + 1);
        }
      }
      const maxExistingOnAnyDay = existingDayCounts.size > 0
        ? Math.max(...Array.from(existingDayCounts.values()))
        : 0;
      const effectiveDailyCap = Math.min(6, Math.max(4, maxExistingOnAnyDay + 1));
      const rebalanced = rebalanceTasksForward(allPendingTasks, todayStr, weekEndStr, effectiveDailyCap, existingDayCounts, 0, userWorkDaysGen, genOffDates)
        .filter((t: any) => !t._unschedulable);

      const safeRebalanced = rebalanced.filter((t: any) => {
        const ds: string = t.scheduledDate || todayStr;
        const dow = new Date(ds + 'T00:00:00').getDay();
        return userWorkDaysGen.has(DAY_ABBRS[dow]) && !genOffDates.has(ds);
      });

      // ── Time assignment + save — grouped per day ──────────────────────────
      const byDate = new Map<string, PendingTask[]>();
      for (const pending of safeRebalanced as PendingTask[]) {
        const key = pending.scheduledDate || todayStr;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key)!.push(pending);
      }

      // Track saved tasks per project batch (needed for dep link creation)
      const savedByBatch = new Map<string, Array<{ task: any; taskIndex: number; aiResponseAny: any }>>();

      const genGetEffectiveWindow = (date: string): { start: number; end: number } => {
        const dt = genDayTypeByDate.get(date) || 'full';
        if (dt === 'half-am') return { start: dayStartMin, end: Math.min(hhmmToMinutes('12:00'), dayEndMin) };
        if (dt === 'half-pm') return { start: Math.max(hhmmToMinutes('13:00'), dayStartMin), end: dayEndMin };
        return { start: dayStartMin, end: dayEndMin };
      };

      const genNextWorkDay = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00');
        let tries = 0;
        do {
          d.setDate(d.getDate() + 1);
          tries++;
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (userWorkDaysGen.has(DAY_ABBRS[d.getDay()]) && !genOffDates.has(ds) && genDayTypeByDate.get(ds) !== 'off') break;
        } while (tries < 14);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };

      const genGetBreaksForDate = (d: string): Array<{ start: string; end: string }> => {
        const perDay = weekBreaksByDate.get(d) || [];
        const covered = generateDailyLunchBreak && perDay.some((b: any) => {
          const hhmmToMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
          return hhmmToMin(b.start) < hhmmToMin(generateDailyLunchBreak.end) && hhmmToMin(b.end) > hhmmToMin(generateDailyLunchBreak.start);
        });
        return (generateDailyLunchBreak && !covered) ? [...perDay, generateDailyLunchBreak] : perDay;
      };

      const genFindSlot = (
        startSlot: number, duration: number, breaks: Array<{ start: string; end: string }>, effectiveEnd: number
      ): { slot: number; found: boolean } => {
        let candidate = startSlot;
        for (let attempts = 0; attempts < 30; attempts++) {
          const candidateEnd = candidate + duration;
          if (candidateEnd > effectiveEnd) return { slot: candidate, found: false };
          if (!isInBreak(candidate, candidateEnd, breaks)) {
            return { slot: candidate, found: true };
          }
          const blockingBreak = breaks.find(b => {
            const bs = hhmmToMinutes(b.start);
            const be = hhmmToMinutes(b.end);
            return candidate < be && candidateEnd > bs;
          });
          if (blockingBreak) candidate = hhmmToMinutes(blockingBreak.end);
          else candidate += 15;
        }
        return { slot: candidate, found: false };
      };

      const genDayNextSlot = new Map<string, number>();

      const genSeedSlotForDate = (d: string): number => {
        const genWindow = genGetEffectiveWindow(d);
        const existingOnDate = (existingWeekTasks as any[]).filter(
          (t: any) => t.scheduledDate === d &&
            t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)
        );
        const latestExistingEndMin = existingOnDate.reduce((max: number, t: any) => {
          const endMin = (t.scheduledEndTime && /^\d{2}:\d{2}$/.test(t.scheduledEndTime))
            ? hhmmToMinutes(t.scheduledEndTime)
            : hhmmToMinutes(t.scheduledTime) + (t.estimatedDuration || 30);
          return Math.max(max, endMin);
        }, genWindow.start);
        const isToday = d === todayStr;
        const slot = isToday
          ? Math.max(latestExistingEndMin, nowFloorMin + 15)
          : latestExistingEndMin;
        genDayNextSlot.set(d, slot);
        return slot;
      };

      for (const date of Array.from(byDate.keys())) {
        genSeedSlotForDate(date);
      }

      const genGetSlotForDate = (d: string): number => {
        const existing = genDayNextSlot.get(d);
        if (existing !== undefined) return existing;
        return genSeedSlotForDate(d);
      };

      const genClaimSlot = (d: string, endMinute: number) => {
        genDayNextSlot.set(d, endMinute);
      };

      const genTryPlaceOnDate = (
        targetDate: string, duration: number, taskData: any
      ): { time: string | null; date: string } => {
        const window = genGetEffectiveWindow(targetDate);
        const breaksForDate = genGetBreaksForDate(targetDate);
        let curSlot = genGetSlotForDate(targetDate);

        if (taskData.scheduledTime && /^\d{2}:\d{2}$/.test(taskData.scheduledTime)) {
          const aiMin = hhmmToMinutes(taskData.scheduledTime);
          if (aiMin >= curSlot && aiMin + duration <= window.end && !isInBreak(aiMin, aiMin + duration, breaksForDate)) {
            genClaimSlot(targetDate, aiMin + duration);
            return { time: taskData.scheduledTime, date: targetDate };
          }
        }

        const result = genFindSlot(curSlot, duration, breaksForDate, window.end);
        if (result.found) {
          genClaimSlot(targetDate, result.slot + duration);
          return { time: minutesToHHMM(result.slot), date: targetDate };
        }

        return { time: null, date: targetDate };
      };

      for (const [date, dateTasks] of Array.from(byDate.entries())) {
        dateTasks.sort((a, b) => ((a.taskData as any).priority || 5) - ((b.taskData as any).priority || 5));

        for (const pending of dateTasks) {
          const taskData = pending.taskData as any;
          const duration = taskData.estimatedDuration || 30;

          let scheduledTimeVal: string | null = null;
          let finalDate = date;

          const placement = genTryPlaceOnDate(date, duration, taskData);
          if (placement.time) {
            scheduledTimeVal = placement.time;
            finalDate = placement.date;
          } else {
            let overflowTarget = date;
            for (let dayTries = 0; dayTries < 14; dayTries++) {
              overflowTarget = genNextWorkDay(overflowTarget);
              const overflowPlacement = genTryPlaceOnDate(overflowTarget, duration, {});
              if (overflowPlacement.time) {
                scheduledTimeVal = overflowPlacement.time;
                finalDate = overflowTarget;
                break;
              }
            }
          }

          // DB-backed slot verification — last line of defense against concurrent planners
          if (scheduledTimeVal && finalDate) {
            const slotCheck = await storage.checkSlotAvailability(userId, finalDate, scheduledTimeVal, duration);
            if (!slotCheck.available && slotCheck.nextAvailableTime) {
              const corrected = slotCheck.nextAvailableTime;
              genClaimSlot(finalDate, hhmmToMinutes(corrected) + duration);
              scheduledTimeVal = corrected;
            }
          }

          const scheduledEndTimeVal = scheduledTimeVal
            ? minutesToHHMM(hhmmToMinutes(scheduledTimeVal) + duration)
            : null;

          // Titres du lot IA du projet dans l'ordre d'origine (avant tri/cap) : filet contre
          // les « Task N » numérotés en prose par le modèle.
          const titresLot: string[] = ((pending.aiResponseAny?.tasks as any[]) || []).map((t: any) => t?.title ?? '');
          const task = await storage.createTask({
            userId,
            title: taskData.title,
            description: remplacerReferencesNumerotees(taskData.description, titresLot),
            type: taskData.type,
            category: taskData.category,
            priority: taskData.priority,
            source: taskData.source || 'generated',
            scheduledDate: finalDate,
            dueDate: today,
            estimatedDuration: duration,
            taskEnergyType: taskData.taskEnergyType || 'execution',
            setupCost: taskData.setupCost || null,
            canBeFragmented: taskData.canBeFragmented !== false,
            recommendedTimeOfDay: taskData.recommendedTimeOfDay || null,
            workflowGroup: taskData.workflowGroup ? taskData.workflowGroup.replace(/^[^:]*::/, '') : null,
            activationPrompt: taskData.activationPrompt
              ? remplacerReferencesNumerotees(taskData.activationPrompt, titresLot)
              : null,
            scheduledTime: scheduledTimeVal,
            scheduledEndTime: scheduledEndTimeVal,
            ...(pending.projId ? { projectId: pending.projId } : {}),
            ...(taskData.milestoneTriggerId ? { milestoneTriggerId: taskData.milestoneTriggerId } : {}),
          });

          allCreatedTasks.push(task);

          if (!savedByBatch.has(pending.projectBatchKey)) savedByBatch.set(pending.projectBatchKey, []);
          savedByBatch.get(pending.projectBatchKey)!.push({ task, taskIndex: pending.taskIndex, aiResponseAny: pending.aiResponseAny });
        }
      }

      // ── Dependency links — created after all tasks have real DB IDs ───────
      const processedBatches = new Set<string>();
      for (const pending of rebalanced as PendingTask[]) {
        const batchKey = pending.projectBatchKey;
        if (processedBatches.has(batchKey)) continue;
        processedBatches.add(batchKey);

        const batchSaved = savedByBatch.get(batchKey) || [];
        const { aiResponseAny } = pending;
        if (!aiResponseAny?.dependencies?.length) continue;

        const deps = aiResponseAny.dependencies;
        // Pas de seuil « trop de tâches bloquées » : ajouterDependance refuse les cycles,
        // donc une chaîne a toujours une première étape libre — filtrer cassait les chaînes ≥ 3.
        for (const dep of deps) {
          try {
            const fromEntry = batchSaved.find(e => e.taskIndex === dep.taskIndex);
            const toEntry = batchSaved.find(e => e.taskIndex === dep.dependsOnIndex);
            if (fromEntry?.task && toEntry?.task) {
              const ok = await ajouterDependance(
                userId,
                fromEntry.task.id,
                toEntry.task.id,
                dep.relationType || 'blocked_by',
              );
              if (ok === false) {
                console.warn(`[generate-daily] dépendance refusée ${fromEntry.task.id} -> ${toEntry.task.id}`);
              }
            }
          } catch { /* non-fatal */ }
        }
      }

      // Filet obligatoire de fin de chemin d'écriture (règle projet) : c'était le
      // SEUL chemin de (re)planification qui ne l'appelait pas — d'où des tâches
      // hors heures de travail et des tâches sans créneau qui survivaient.
      // Il garantit zéro chevauchement, le respect des horaires, et reporte au
      // jour ouvré suivant tout ce qui ne tient pas.
      await storage.fixOverlappingTasks(userId, todayStr).catch((e: any) =>
        console.error('[generate-daily] fixOverlappingTasks:', e?.message),
      );

      res.json({
        focus: lastFocus,
        reasoning: lastReasoning,
        bottleneck: lastBottleneck || undefined,
        suggestedNextMove: lastSuggestedNextMove || undefined,
        tasks: allCreatedTasks,
        realismReport: accumulatedRealismReport,
        skippedProjects: skippedProjects.length > 0 ? skippedProjects : undefined,
        milestoneNotes: milestoneNotes.length > 0 ? milestoneNotes : undefined,
      });
    } catch (error) {
      console.error("Error generating daily tasks:", error);
      res.status(500).json({ message: "Failed to generate daily tasks" });
    }
  });

  // ─── Task Feedback routes (register before :id routes) ───────────────────────
  app.get('/api/tasks/feedback', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      const feedback = await storage.getRecentTaskFeedback(userId, projectId, 30);
      res.json(feedback);
    } catch (error) {
      console.error("Error fetching task feedback:", error);
      res.status(500).json({ message: "Failed to fetch task feedback" });
    }
  });

  // Stub: update feedback impact signals (impactScore, milestoneUnlocked — reserved for future UI)
  app.patch('/api/tasks/feedback/:id', isAuthenticated, async (req: any, res) => {
    try {
      const feedbackId = parseInt(req.params.id);
      const { impactScore, milestoneUnlocked } = req.body;
      if (impactScore !== undefined && (typeof impactScore !== 'number' || impactScore < 1 || impactScore > 5)) {
        return res.status(400).json({ message: "impactScore must be 1–5" });
      }
      const update: Record<string, any> = {};
      if (impactScore !== undefined) update.impactScore = impactScore;
      if (milestoneUnlocked !== undefined) update.milestoneUnlocked = milestoneUnlocked;
      const fb = await storage.updateTaskFeedback(feedbackId, update as any);
      res.json(fb);
    } catch (error) {
      console.error("Error updating task feedback:", error);
      res.status(500).json({ message: "Failed to update task feedback" });
    }
  });

  app.post('/api/tasks/:id/feedback', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const taskId = parseInt(req.params.id);
      const { feedbackType = 'dismissed', reason, freeText } = req.body;
      const task = await storage.getTask(taskId);
      if (!task) return res.status(404).json({ message: "Task not found" });
      const fb = await storage.createTaskFeedback({
        taskId,
        taskTitle: task.title,
        taskType: task.type,
        taskCategory: task.category,
        taskSource: task.source,
        userId,
        projectId: task.projectId ?? null,
        feedbackType,
        reason,
        freeText: freeText ?? null,
      });
      res.json({ feedbackId: fb.id });
    } catch (error) {
      console.error("Error creating task feedback:", error);
      res.status(500).json({ message: "Failed to create task feedback" });
    }
  });

  app.delete('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const taskId = parseInt(req.params.id);
      const { reason, freeText, feedbackType = 'deleted' } = req.body;
      const task = await storage.getTask(taskId);
      if (!task || task.userId !== userId) return res.status(404).json({ message: "Task not found" });
      let feedbackId: number | null = null;
      if (reason) {
        const fb = await storage.createTaskFeedback({
          taskId,
          taskTitle: task.title,
          taskType: task.type,
          taskCategory: task.category,
          taskSource: task.source,
          userId,
          projectId: task.projectId ?? null,
          feedbackType,
          reason,
          freeText: freeText ?? null,
          timesRescheduled: task.learnedAdjustmentCount || 0,
        } as any);
        feedbackId = fb.id;
      }
      await storage.deleteTask(taskId);
      res.json({ deleted: true, feedbackId });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // ─── Task Dependency routes (register before :id routes) ─────────────────────
  app.get('/api/tasks/dependencies', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      const deps = await storage.getTaskDependenciesForUser(userId, projectId);
      res.json(deps);
    } catch (error) {
      console.error("Error fetching task dependencies:", error);
      res.status(500).json({ message: "Failed to fetch dependencies" });
    }
  });

  app.delete('/api/tasks/dependencies/:depId', isAuthenticated, async (req: any, res) => {
    try {
      const depId = parseInt(req.params.depId);
      await storage.deleteTaskDependency(depId);
      res.json({ deleted: true });
    } catch (error) {
      console.error("Error deleting dependency:", error);
      res.status(500).json({ message: "Failed to delete dependency" });
    }
  });

  app.get('/api/tasks/:id/dependencies', isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const deps = await storage.getTaskDependencies(taskId);
      res.json(deps);
    } catch (error) {
      console.error("Error fetching dependencies:", error);
      res.status(500).json({ message: "Failed to fetch dependencies" });
    }
  });

  app.post('/api/tasks/:id/dependencies', isAuthenticated, async (req: any, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const { dependsOnTaskId, relationType = 'blocked_by' } = req.body;
      // Point d'entrée unique : refuse auto-référence, tâche d'un autre compte, cycle, doublon.
      const ok = await ajouterDependance(req.userId, taskId, Number(dependsOnTaskId), relationType);
      if (!ok) return res.status(400).json({ message: "invalid_dependency" });
      // On relit la ligne créée pour garder la forme de réponse historique (la ligne).
      let lignes: any[] = [];
      try { lignes = (await storage.getTaskDependencies(taskId)) || []; } catch { /* la création a réussi */ }
      const dep = lignes.find((d: any) => d.dependsOnTaskId === Number(dependsOnTaskId));
      res.status(201).json(dep ?? { taskId, dependsOnTaskId: Number(dependsOnTaskId), relationType });
    } catch (error) {
      console.error("Error creating dependency:", error);
      res.status(500).json({ message: "Failed to create dependency" });
    }
  });

  // ─── Task Range query (for planning page) ────────────────────────────────────
  app.get('/api/tasks/range', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { start, end, projectId } = req.query;
      if (!start || !end) return res.status(400).json({ message: "start and end are required" });
      const pid = projectId ? parseInt(projectId as string) : undefined;
      const tasks = await storage.getTasksInRange(userId, start as string, end as string, pid);

      // Injecter les jalons actifs/débloqués comme tâches virtuelles dans la plage
      // Ils apparaissent le lundi de la semaine demandée (ou le start si pas lundi)
      try {
        const projects = pid
          ? [await storage.getProject(pid, userId)].filter(Boolean)
          : await storage.getProjects(userId);

        const milestoneTasks: any[] = [];
        const startDate = start as string;

        // Tâches réelles SANS les anciennes tâches-jalons (désormais des marqueurs « toute la journée »).
        const baseTasks = (tasks as any[]).filter(t => t.type !== 'milestone');

        // Paralléliser les queries milestones pour tous les projets
        const validProjects = projects.filter((p): p is typeof p & { id: number } => !!p?.id);
        const allMilestones = await Promise.all(
          validProjects.map(p => storage.getMilestones(p.id, userId).catch(() => []))
        );

        // Jalons visibles (verrouillés/ignorés masqués), aplatis avec leur projet.
        const flat: { project: any; m: any }[] = [];
        validProjects.forEach((project, i) => {
          for (const m of ((allMilestones[i] as any[]) || [])) {
            if (m.status === 'locked' || m.status === 'skipped') continue;
            flat.push({ project, m });
          }
        });

        if (flat.length > 0) {
          const msIds = flat.map(f => f.m.id);
          // Conditions (durée + dépendance) et stats des tâches liées (dates + progression).
          const condEntries = await Promise.all(
            flat.map(async f => [f.m.id, await storage.getMilestoneConditions(f.m.id).catch(() => [])] as const)
          );
          const condById = new Map<number, any[]>(condEntries);
          const stats: Record<number, { dates: string[]; done: number; total: number }> =
            await storage.getMilestoneTaskStats(userId, msIds).catch(() => ({}));

          const durationDaysOf = (m: any) => {
            const c = (condById.get(m.id) || []).find((x: any) => x.conditionType === 'duration_elapsed' && x.requiredDays != null);
            return c ? c.requiredDays : null;
          };
          const depIdOf = (m: any) => {
            const c = (condById.get(m.id) || []).find((x: any) => x.blockedByMilestoneId);
            return c ? c.blockedByMilestoneId : null;
          };
          const inputOf = (m: any, depDate: string | null) => ({
            status: m.status, targetDate: m.targetDate, completedAt: m.completedAt,
            activatedAt: m.activatedAt, durationDays: durationDaysOf(m),
            linkedTaskDates: (stats[m.id]?.dates) || [], depDate,
          });

          // Date logique en 2 passes (passe 2 = jalons dépendant d'un autre jalon).
          const resolved = new Map<number, string | null>();
          for (const { m } of flat) resolved.set(m.id, deriveMilestoneDate(inputOf(m, null)));
          for (const { m } of flat) {
            if (resolved.get(m.id)) continue;
            const depId = depIdOf(m);
            const depDate = depId ? (resolved.get(depId) || null) : null;
            if (depDate) resolved.set(m.id, deriveMilestoneDate(inputOf(m, depDate)));
          }

          for (const { project, m } of flat) {
            const date = resolved.get(m.id) || null;
            const prog = stats[m.id] || { done: 0, total: 0 };
            const inRange = !!date && date >= start && date <= end;
            const completed = m.status === 'completed';
            const needsAttention = m.status === 'active' || m.status === 'unlocked';
            // « à dater » = jalon actionnable sans date FUTURE ferme (date nulle ou passée).
            const undatedActionable = needsAttention && (!date || date < start);
            if (completed) {
              if (!inRange) continue; // jalon terminé → uniquement dans sa semaine de réalisation
            } else if (!inRange && !undatedActionable) {
              continue;
            }
            const showUndated = undatedActionable && !inRange;
            milestoneTasks.push({
              id: -(m.id),
              userId,
              projectId: project.id,
              milestoneId: m.id,
              milestoneStatus: m.status,
              milestoneProgress: { done: prog.done, total: prog.total },
              milestoneUndated: showUndated,
              title: m.title,
              description: m.description || '',
              type: 'milestone',
              category: 'planning',
              priority: 1,
              estimatedDuration: 45,
              scheduledDate: inRange ? (date as string) : startDate, // « à dater » → 1re colonne (flag milestoneUndated)
              scheduledTime: null, // ALL-DAY → rendu dans la bande, jamais dans la grille horaire
              source: 'milestone',
              completed: m.status === 'completed',
              _virtual: true,
            });
          }
        }

        console.log(`[tasks/range] Injecting ${milestoneTasks.length} virtual milestone tasks (all-day)`);
        const finalTasks = [...baseTasks, ...milestoneTasks];

        // Inject Google Calendar events as virtual (read-only) tasks
        try {
          const calEvents = await getCalendarEvents(userId, start as string, end as string);
          console.log(`[tasks/range] GCal: userId=${userId} start=${start} end=${end} events=${calEvents.length}`);
          let gcalIdCounter = -1000;
          const evenementsAgenda: any[] = [];
          for (const ev of calEvents) {
            if (ev.allDay) continue;
            const durationMin = (() => {
              const [sh, sm] = ev.startTime.split(':').map(Number);
              const [eh, em] = ev.endTime.split(':').map(Number);
              return (eh * 60 + em) - (sh * 60 + sm);
            })();
            evenementsAgenda.push({
              id: gcalIdCounter--,
              gcalEventId: ev.id, // stable : sert à retrouver l'état « fait » (Naya seulement)
              userId,
              title: ev.title,
              type: 'gcal_event',
              category: 'gcal_event',
              source: 'gcal',
              scheduledDate: ev.date,
              scheduledTime: ev.startTime,
              scheduledEndTime: ev.endTime,
              estimatedDuration: Math.max(durationMin, 15),
              completed: false,
              _virtual: true,
              priority: 0,
              description: ev.location ? `📍 ${ev.location}` : null,
            } as any);
          }
          // État « fait » dans Naya (l'agenda n'est jamais modifié). Lecture best-effort :
          // en cas d'échec, les événements s'affichent simplement non cochés.
          let idsFaits = new Set<string>();
          try {
            idsFaits = await lireFaits(userId, evenementsAgenda.map((e) => e.gcalEventId).filter(Boolean));
          } catch (e: any) {
            console.error('[tasks/range] état fait agenda non lu:', e?.message);
          }
          finalTasks.push(...appliquerEtatFait(evenementsAgenda, idsFaits));
        } catch (calErr: any) {
          // Non-fatal — calendar errors must never break the planning page
          console.error('[tasks/range] Calendar injection error:', calErr.message);
        }

        res.json(finalTasks);
      } catch (milestoneErr: any) {
        console.error('[tasks/range] Milestone injection error:', milestoneErr?.message || milestoneErr);
        res.json((tasks as any[]).filter(t => t.type !== 'milestone')); // fallback silencieux
      }
    } catch (error) {
      console.error("Error fetching tasks in range:", error);
      res.status(500).json({ message: "Failed to fetch tasks in range" });
    }
  });

  // POST /api/tasks/rollover — déplace les tâches incomplètes vers le prochain jour ouvré
  // Note: runDailyAutoPlanner n'est PAS déclenché ici — il tourne uniquement à 06:00 via le cron.
  // Lancer le planner à chaque chargement de dashboard provoquait des runs concurrents
  // qui épuisaient le pool de connexions Neon et bloquaient le serveur entier.
  app.post('/api/tasks/rollover', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const today = new Date().toISOString().slice(0, 10);
      const result = await rolloverStaleTasks(userId, today);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("Rollover error:", err);
      res.status(500).json({ message: "Erreur lors du rollover", detail: err?.message });
    }
  });

  // POST /api/tasks/generate — rollover léger pour la semaine visible
  // Note: runDailyAutoPlanner n'est PAS appelé ici — lancer le planner complet (7 appels Claude)
  // depuis l'UI causait des runs concurrents qui épuisaient le pool Neon et bloquaient le serveur.
  // Le planner complet tourne uniquement à 06:00 via le cron schedulé au démarrage.
  app.post('/api/tasks/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const startDate = req.body?.startDate || new Date().toISOString().slice(0, 10);
      // Rollover léger uniquement — déplace les tâches incomplètes, sans génération IA
      rolloverStaleTasks(userId, startDate).catch(e =>
        console.error('[Generate] Rollover error:', e.message)
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message });
    }
  });

  // ─── Rebalance Week ──────────────────────────────────────────────────────────
  // POST /api/tasks/rebalance — réorganise les tâches incomplètes d'un jour donné selon l'énergie
  app.post('/api/tasks/rebalance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { date, energyLevel } = req.body;
      const targetDate = date || new Date().toISOString().slice(0, 10);

      const prefs = await storage.getUserPreferences(userId);
      const workDayStart = (prefs as any)?.workDayStart || '09:00';
      const workDayEnd = (prefs as any)?.workDayEnd || '18:00';

      const hhmmToMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
      const minToHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

      const tasks = await storage.getTasksInRange(userId, targetDate, targetDate);
      const pending = (tasks as any[]).filter(t => !t.completed);

      if (!pending.length) return res.json({ rebalanced: 0 });

      // Trier selon l'énergie : low/depleted → tâches légères d'abord
      const energyPriority: Record<string, number> = {
        admin: 0, logistics: 1, social: 2, creative: 3, execution: 4, deep_work: 5,
      };
      const level = energyLevel || prefs?.currentEnergyLevel || 'high';
      const isLowEnergy = level === 'low' || level === 'depleted';

      pending.sort((a: any, b: any) => {
        if (isLowEnergy) {
          const ea = energyPriority[a.taskEnergyType] ?? 3;
          const eb = energyPriority[b.taskEnergyType] ?? 3;
          if (ea !== eb) return ea - eb;
        }
        return (a.priority || 5) - (b.priority || 5);
      });

      // Plages bloquées : pause déjeuner
      const blocked: Array<{ start: number; end: number }> = [];
      if (prefs?.lunchBreakEnabled !== false) {
        const ls = hhmmToMin((prefs as any)?.lunchBreakStart || '12:00');
        const le = hhmmToMin((prefs as any)?.lunchBreakEnd   || '13:00');
        if (le > ls) blocked.push({ start: ls, end: le });
      }

      const findSlot = (from: number, dur: number): number => {
        let s = from;
        for (let i = 0; i < 48; i++) {
          const overlap = blocked.find(b => s < b.end && s + dur > b.start);
          if (!overlap) return s;
          s = overlap.end;
        }
        return s; // fallback
      };

      // Réassigner les créneaux horaires en séquence, en sautant la pause
      // Respiration entre tâches : même lecture que le reste de la branche.
      const bufferMin = Math.max(0, (prefs as any)?.bufferMin ?? 10);
      let slot = hhmmToMin(workDayStart);
      const dayEnd = hhmmToMin(workDayEnd);
      let count = 0;

      for (const task of pending) {
        const duration = task.estimatedDuration || 30;
        slot = findSlot(slot, duration);
        if (slot + duration > dayEnd) break;
        await storage.updateTask(task.id, {
          scheduledTime: minToHHMM(slot),
          scheduledDate: targetDate,
        });
        blocked.push({ start: slot, end: slot + duration });
        slot += duration + bufferMin;
        count++;
      }

      res.json({ rebalanced: count });
    } catch (error: any) {
      console.error("Rebalance error:", error);
      res.status(500).json({ message: "Erreur lors du rebalance", detail: error?.message });
    }
  });

  app.post('/api/tasks/rebalance-week', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { weekStart, clientToday, clientTime } = req.body;
      if (!weekStart) return res.status(400).json({ message: "weekStart is required" });
      const todayStr = parseClientToday({ clientToday });
      const rawClientTime = typeof clientTime === 'string' && /^\d{2}:\d{2}$/.test(clientTime)
        ? clientTime : null;

      const weekEnd = (() => {
        const d = new Date(weekStart + 'T00:00:00');
        d.setDate(d.getDate() + 6);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

      const allTasks = await storage.getTasksInRange(userId, weekStart, weekEnd);
      const pending = allTasks.filter((t: any) => !t.completed);

      if (!pending.length) {
        return res.json({ moved: 0, days: {} });
      }

      const originalDates = new Map<number, { scheduledDate: string | null; scheduledTime: string | null }>();
      for (const t of pending) {
        originalDates.set(t.id, { scheduledDate: t.scheduledDate, scheduledTime: t.scheduledTime });
      }

      const [prefs, weekAvailability] = await Promise.all([
        storage.getUserPreferences(userId),
        storage.getDayAvailabilityRange(userId, todayStr, weekEnd),
      ]);

      const userWorkDays = parseWorkDays(prefs?.workDays);
      // Respiration entre tâches replacées : sans elle, ce chemin de rebalance-semaine
      // recolle les tâches bout-à-bout et efface le tampon inséré ailleurs (cf. finding 1).
      const gapMin = Math.max(0, (prefs as any)?.bufferMin ?? 10);

      const dayTypeByDate = new Map<string, string>();
      const offDates = new Set<string>();
      for (const avail of weekAvailability) {
        if (avail.dayType) {
          dayTypeByDate.set(avail.date, avail.dayType);
          if (avail.dayType === 'off') offDates.add(avail.date);
        }
      }

      const rebalTodayStr = todayStr;
      const rebalEnergyStale = prefs?.energyUpdatedDate !== rebalTodayStr;
      const rebalEnergyLevel = rebalEnergyStale ? 'high' : (prefs?.currentEnergyLevel || 'high');
      const rebalDailyCap = (rebalEnergyLevel === 'low' || rebalEnergyLevel === 'depleted') ? 3 : 4;

      if ((rebalEnergyLevel === 'low' || rebalEnergyLevel === 'depleted') && pending.length > 0) {
        const rebalEnergyPriority: Record<string, number> = { admin: 0, creative: 1, logistics: 2, execution: 3, social: 4, deep_work: 5 };
        pending.sort((a: any, b: any) => {
          const ea = rebalEnergyPriority[a.taskEnergyType] ?? 3;
          const eb = rebalEnergyPriority[b.taskEnergyType] ?? 3;
          if (ea !== eb) return ea - eb;
          return (a.priority || 5) - (b.priority || 5);
        });
      }

      const pendingIds = new Set(pending.map((t: any) => t.id));
      const existingDayCountsForRebal = new Map<string, number>();
      for (const t of allTasks) {
        if (t.scheduledDate && !pendingIds.has(t.id)) {
          existingDayCountsForRebal.set(
            t.scheduledDate,
            (existingDayCountsForRebal.get(t.scheduledDate) || 0) + 1
          );
        }
      }

      const rebalanced = rebalanceTasksForward(pending, todayStr, weekEnd, rebalDailyCap, existingDayCountsForRebal, 14, userWorkDays, offDates)
        .filter((t: any) => !t._unschedulable);

      const workDayStartStr = prefs?.workDayStart || '09:00';
      const workDayEndStr = prefs?.workDayEnd || '17:00';

      const globalLunchBreak = (prefs?.lunchBreakEnabled ?? true)
        ? { start: prefs?.lunchBreakStart || '12:00', end: prefs?.lunchBreakEnd || '13:00' }
        : null;

      const breaksOverlap = (a: { start: string; end: string }, b: { start: string; end: string }): boolean => {
        const hhmmToMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
        return hhmmToMin(a.start) < hhmmToMin(b.end) && hhmmToMin(a.end) > hhmmToMin(b.start);
      };

      const weekBreaksByDate = new Map<string, Array<{ start: string; end: string }>>();
      for (const avail of weekAvailability) {
        if (avail.breaks && Array.isArray(avail.breaks)) {
          weekBreaksByDate.set(avail.date, (avail.breaks as any[]).map((b: any) => ({
            start: b.start || b.startTime || '12:00',
            end: b.end || b.endTime || '13:00',
          })));
        }
      }

      const hhmmToMinutes = (hhmm: string): number => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + (m || 0);
      };
      const minutesToHHMM = (mins: number): string =>
        `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const isInBreak = (startMin: number, endMin: number, breaks: Array<{ start: string; end: string }>): boolean =>
        breaks.some(b => {
          const bs = hhmmToMinutes(b.start);
          const be = hhmmToMinutes(b.end);
          return startMin < be && endMin > bs;
        });

      const dayStartMin = hhmmToMinutes(workDayStartStr);
      const dayEndMin = hhmmToMinutes(workDayEndStr);

      const clientNowMin = rawClientTime ? hhmmToMinutes(rawClientTime) : null;

      const nextWorkDay = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00');
        let tries = 0;
        do {
          d.setDate(d.getDate() + 1);
          tries++;
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (userWorkDays.has(DAY_ABBRS[d.getDay()]) && !offDates.has(ds) && dayTypeByDate.get(ds) !== 'off') break;
        } while (tries < 14);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };

      const getBreaksForDate = (d: string): Array<{ start: string; end: string }> => {
        const perDay = weekBreaksByDate.get(d) || [];
        const covered = globalLunchBreak && perDay.some(b => breaksOverlap(b, globalLunchBreak));
        return (globalLunchBreak && !covered) ? [...perDay, globalLunchBreak] : perDay;
      };

      const findSlotAvoidingBreaks = (
        startSlot: number, duration: number, breaks: Array<{ start: string; end: string }>, effectiveEnd: number = dayEndMin
      ): { slot: number; found: boolean } => {
        let candidate = startSlot;
        for (let attempts = 0; attempts < 30; attempts++) {
          const candidateEnd = candidate + duration;
          if (candidateEnd > effectiveEnd) return { slot: candidate, found: false };
          if (!isInBreak(candidate, candidateEnd, breaks)) {
            return { slot: candidate, found: true };
          }
          const blockingBreak = breaks.find((b: any) => {
            const bs = hhmmToMinutes(b.start);
            const be = hhmmToMinutes(b.end);
            return candidate < be && candidateEnd > bs;
          });
          if (blockingBreak) candidate = hhmmToMinutes(blockingBreak.end);
          else candidate += 15;
        }
        return { slot: candidate, found: false };
      };

      const getEffectiveWindow = (date: string): { start: number; end: number } => {
        const dt = dayTypeByDate.get(date) || 'full';
        if (dt === 'half-am') return { start: dayStartMin, end: Math.min(hhmmToMinutes('12:00'), dayEndMin) };
        if (dt === 'half-pm') return { start: Math.max(hhmmToMinutes('13:00'), dayStartMin), end: dayEndMin };
        return { start: dayStartMin, end: dayEndMin };
      };

      const dayNextSlot = new Map<string, number>();

      // Seed from completed tasks
      for (const t of allTasks) {
        if (t.completed && t.scheduledDate && t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
          const endMin = (t.scheduledEndTime && /^\d{2}:\d{2}$/.test(t.scheduledEndTime))
            ? hhmmToMinutes(t.scheduledEndTime)
            : hhmmToMinutes(t.scheduledTime) + (t.estimatedDuration || 30);
          const current = dayNextSlot.get(t.scheduledDate);
          if (current === undefined || endMin > current) {
            dayNextSlot.set(t.scheduledDate, endMin);
          }
        }
      }

      // Also seed from incomplete tasks NOT being rebalanced (campaign tasks, fixed tasks).
      // These tasks keep their existing slots — the rebalancer must work around them.
      const rebalancedIds = new Set(rebalanced.map((t: any) => t.id));
      for (const t of allTasks) {
        if (!t.completed && !rebalancedIds.has(t.id) &&
            t.scheduledDate && t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
          const endMin = (t.scheduledEndTime && /^\d{2}:\d{2}$/.test(t.scheduledEndTime))
            ? hhmmToMinutes(t.scheduledEndTime)
            : hhmmToMinutes(t.scheduledTime) + (t.estimatedDuration || 30) + 15;
          const current = dayNextSlot.get(t.scheduledDate);
          if (current === undefined || endMin > current) {
            dayNextSlot.set(t.scheduledDate, endMin);
          }
        }
      }

      if (clientNowMin !== null) {
        const todayCurrent = dayNextSlot.get(todayStr);
        const todayFloor = clientNowMin + 15;
        dayNextSlot.set(todayStr, todayCurrent !== undefined ? Math.max(todayCurrent, todayFloor) : todayFloor);
      }

      const getNextSlotForDate = (date: string): number => {
        const window = getEffectiveWindow(date);
        const existing = dayNextSlot.get(date);
        if (existing !== undefined) return Math.max(existing, window.start);
        return window.start;
      };

      const claimSlot = (date: string, endMinute: number) => {
        dayNextSlot.set(date, endMinute);
      };

      const allRebalancedSorted = [...rebalanced].sort((a: any, b: any) => {
        const dateCmp = (a.scheduledDate || todayStr).localeCompare(b.scheduledDate || todayStr);
        if (dateCmp !== 0) return dateCmp;
        return (a.priority || 5) - (b.priority || 5);
      });

      let moved = 0;
      const days: Record<string, number> = {};

      for (const task of allRebalancedSorted) {
        const duration = task.estimatedDuration || 30;
        let targetDate = task.scheduledDate || todayStr;
        let scheduledTimeVal: string | null = null;
        let finalDate = targetDate;

        for (let dayTries = 0; dayTries < 14; dayTries++) {
          const window = getEffectiveWindow(finalDate);
          const effectiveEnd = window.end;
          const startSlot = getNextSlotForDate(finalDate);
          const breaksForDate = getBreaksForDate(finalDate);

          const result = findSlotAvoidingBreaks(startSlot, duration, breaksForDate, effectiveEnd);

          if (result.found) {
            scheduledTimeVal = minutesToHHMM(result.slot);
            claimSlot(finalDate, result.slot + duration + gapMin);
            break;
          }

          finalDate = nextWorkDay(finalDate);
        }

        const scheduledEndTimeVal = scheduledTimeVal
          ? minutesToHHMM(hhmmToMinutes(scheduledTimeVal) + duration)
          : null;

        const orig = originalDates.get(task.id);
        const changed = !orig || orig.scheduledDate !== finalDate || orig.scheduledTime !== scheduledTimeVal;
        if (changed) moved++;

        await storage.updateTask(task.id, {
          scheduledDate: finalDate,
          scheduledTime: scheduledTimeVal,
          scheduledEndTime: scheduledEndTimeVal,
        });

        days[finalDate] = (days[finalDate] || 0) + 1;
      }

      const scheduledTaskIds = new Set(rebalanced.map((t: any) => t.id));
      const unschedulableTasks = pending.filter((t: any) => !scheduledTaskIds.has(t.id));

      for (const task of unschedulableTasks) {
        await storage.updateTask(task.id, {
          scheduledDate: null,
          scheduledTime: null,
          scheduledEndTime: null,
        });
      }

      // Précédences + anti-chevauchement après les écritures. Départ = max(début de semaine,
      // aujourd'hui) : on ne re-tasse jamais des jours déjà passés.
      await storage.fixOverlappingTasks(userId, weekStart > todayStr ? weekStart : todayStr).catch((e: any) =>
        console.error('[rebalance-week] retassage:', e?.message),
      );

      res.json({ moved, days });
    } catch (error) {
      console.error("Error rebalancing week:", error);
      res.status(500).json({ message: "Failed to rebalance week" });
    }
  });

  app.post('/api/tasks/clear-week', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { weekStart } = req.body;
      if (!weekStart) return res.status(400).json({ message: "weekStart is required" });

      const weekEnd = (() => {
        const d = new Date(weekStart + 'T00:00:00');
        d.setDate(d.getDate() + 6);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

      const allTasks = await storage.getTasksInRange(userId, weekStart, weekEnd);
      const toClear = allTasks.filter((t: any) =>
        !t.completed &&
        (t.source === 'ai' || t.source === 'generated')
      );

      for (const task of toClear) {
        await storage.updateTask(task.id, {
          scheduledDate: null,
          scheduledTime: null,
          scheduledEndTime: null,
        });
      }

      res.json({ cleared: toClear.length });
    } catch (error) {
      console.error("Error clearing week:", error);
      res.status(500).json({ message: "Failed to clear week" });
    }
  });

  // ─── Intelligent Replan ───────────────────────────────────────────────────────
  app.post('/api/tasks/replan', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId, scope = 'today' } = req.body;
      const floor = parseClientToday(req.body);

      const today = floor;
      const scopeEnd = scope === 'week'
        ? sharedFormatDate(new Date(Date.now() + 7 * 86400000))
        : scope === 'month'
          ? sharedFormatDate(new Date(Date.now() + 30 * 86400000))
          : today;

      const [pendingTasks, completedTasks, recentFeedback, workspaceEntries, allDeps, scheduleEvents, brandDna] = await Promise.all([
        storage.getTasksInRange(userId, today, scopeEnd, projectId),
        storage.getTasks(userId, new Date(), projectId),
        storage.getRecentTaskFeedback(userId, projectId, 30),
        storage.getRecentWorkspaceEntries(userId, projectId, 20),
        storage.getTaskDependenciesForUser(userId, projectId),
        storage.getRecentScheduleEvents(userId, 40),
        storage.getBrandDna(userId),
      ]);

      const pending = pendingTasks.filter((t: any) => !t.completed);
      const completed = completedTasks.filter((t: any) => t.completed);

      // Build blocked task set from dependency chains
      const pendingIds = new Set(pending.map((t: any) => t.id));
      const blockedTaskIds = new Set<number>();
      const blockingMap: Record<number, string> = {};
      for (const dep of allDeps) {
        if (dep.relationType === 'blocked_by' && pendingIds.has(dep.dependsOnTaskId)) {
          blockedTaskIds.add(dep.taskId);
          const blocker = pending.find((t: any) => t.id === dep.dependsOnTaskId);
          blockingMap[dep.taskId] = blocker?.title ?? `Task #${dep.dependsOnTaskId}`;
        }
      }

      // Identify repeatedly-deferred tasks (moved 2+ times)
      const deferralCounts: Record<number, number> = {};
      for (const ev of scheduleEvents) {
        if (ev.changeType === 'moved' && ev.taskId) {
          deferralCounts[ev.taskId] = (deferralCounts[ev.taskId] || 0) + 1;
        }
      }
      const repeatedlyDeferred = pending.filter((t: any) => (deferralCounts[t.id] || 0) >= 2);

      const signalParts: string[] = [];
      if (completed.length > 0) signalParts.push(`COMPLETED: ${completed.map((t: any) => t.title).join(', ')}`);
      const actionable = pending.filter((t: any) => !blockedTaskIds.has(t.id));
      if (actionable.length > 0) signalParts.push(`PENDING (actionable): ${actionable.map((t: any) => t.title).join(', ')}`);
      if (blockedTaskIds.size > 0) {
        const blockedStr = Array.from(blockedTaskIds).map(id => {
          const task = pending.find((t: any) => t.id === id);
          return `${task?.title ?? 'Unknown'} (blocked by: ${blockingMap[id]})`;
        }).join(', ');
        signalParts.push(`BLOCKED: ${blockedStr}`);
      }
      if (repeatedlyDeferred.length > 0) {
        signalParts.push(`REPEATEDLY DEFERRED (user keeps pushing these — ${repeatedlyDeferred.length} task(s)): ${repeatedlyDeferred.map((t: any) => `${t.title} (moved ${deferralCounts[t.id]}x)`).join(', ')}`);
      }
      if (recentFeedback.length > 0) {
        const feedbackStr = recentFeedback.map(f => ligneContexteRefus(f as any)).join('\n');
        signalParts.push(`REJECTED FEEDBACK:\n${feedbackStr}`);
      }
      if (workspaceEntries.length > 0) {
        const notesStr = workspaceEntries.slice(0, 10).map(e => e.title ? `${e.title}: ${e.content.slice(0, 120)}` : e.content.slice(0, 120)).join('\n- ');
        signalParts.push(`WORKSPACE NOTES:\n- ${notesStr}`);
      }

      const replanSignal = signalParts.join('\n\n');
      const replanInstruction = `REPLAN MODE: Use all signals to reorganize work. Do not suggest tasks similar to rejected ones. Do not schedule blocked tasks before their prerequisites — propose completing the blocking task first. For repeatedly deferred tasks, either schedule the prerequisite or defer the full chain. Be direct and strategic.`;

      const { projectContext, personaContext } = await fetchAIContext(userId, projectId ?? null);

      const aiResult = await generateDailyTasks({
        userId,
        brandDna: brandDna as any,
        recentContent: [],
        recentOutreach: [],
        weeklyGoals: null,
        completedTasksToday: completed,
        projectContext,
        personaContext,
        recentWorkspaceNotes: replanSignal,
        rejectedTasksContext: replanInstruction,
      });

      res.json({
        suggestedTasks: aiResult.tasks,
        reasoning: aiResult.reasoning,
        blockedCount: blockedTaskIds.size,
        deferredCount: repeatedlyDeferred.length,
      });
    } catch (error) {
      console.error("Error generating replan:", error);
      res.status(500).json({ message: "Failed to generate replan" });
    }
  });

  app.post('/api/tasks/replan/apply', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { tasks: suggestedTasks, projectId, scheduledDate } = req.body;
      const floor = parseClientToday(req.body);
      const targetDate = clampToFloor(scheduledDate ?? floor, floor);

      const created = [];
      for (const taskData of (suggestedTasks || [])) {
        const task = await storage.createTask({
          userId,
          title: taskData.title,
          description: taskData.description || '',
          type: taskData.type || 'planning',
          category: taskData.category || 'planning',
          priority: taskData.priority || 3,
          source: 'replan',
          scheduledDate: targetDate,
          dueDate: new Date(targetDate),
          ...(projectId ? { projectId } : {}),
        });
        created.push(task);
      }
      // Précédences + anti-chevauchement dès la date des tâches créées.
      if (created.length > 0) {
        await storage.fixOverlappingTasks(userId, targetDate).catch((e: any) =>
          console.error('[replan/apply] retassage:', e?.message),
        );
      }
      res.json({ created, count: created.length });
    } catch (error) {
      console.error("Error applying replan:", error);
      res.status(500).json({ message: "Failed to apply replan" });
    }
  });

  // Content routes
  //
  // Plafond de `limit` : `getContent` ne rend jamais plus de `LIMITE_CONTENUS_MAX`
  // lignes, et ce plafond est EXPLICITE ici — jamais deviné depuis l'entrée. Avant
  // ce chantier, `getContent` rendait au plus 50 lignes (les plus récemment créées)
  // sans que rien ne le dise à l'appelante : coller 20 posts dans une marque qui en
  // compte 40 faisait disparaître 20 posts anciens de la vue — certains programmés
  // pour les semaines à venir — sans que la page ne le laisse voir. Le client
  // demande désormais `limit=LIMITE_CONTENUS_PAGE` (voir content-calendar.tsx) et
  // s'annonce quand la réponse en rend exactement autant.
  //
  // `LIMITE_CONTENUS_MAX` vit dans `./services/content-limit` (importé en tête de
  // fichier) plutôt qu'en constante locale ici : un test affirme son égalité avec
  // `LIMITE_CONTENUS_PAGE` côté client — voir le commentaire de ce module sur
  // pourquoi cette paire-ci est la dangereuse des trois duplications du chantier.
  app.get('/api/content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { status, limit } = req.query;

      let projectId: number | undefined;
      if (req.query.projectId !== undefined) {
        projectId = Number(req.query.projectId);
        if (!Number.isFinite(projectId) || projectId <= 0) return res.status(400).json({ message: "Invalid projectId" });
      }

      let campaignId: number | undefined;
      if (req.query.campaignId !== undefined) {
        campaignId = Number(req.query.campaignId);
        if (!Number.isFinite(campaignId) || campaignId <= 0) return res.status(400).json({ message: "Invalid campaignId" });
      }

      // `limit` hors de [1, LIMITE_CONTENUS_MAX] est un 400, pas une valeur
      // silencieusement recadrée : un appelant qui en redemande au-delà du plafond
      // accepté doit le voir, pas se croire servi.
      let limiteContenus = 50;
      if (limit !== undefined) {
        const n = Number(limit);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > LIMITE_CONTENUS_MAX) {
          return res.status(400).json({ message: `limit invalide : entier entre 1 et ${LIMITE_CONTENUS_MAX}` });
        }
        limiteContenus = n;
      }

      let content;
      if (status) {
        content = await storage.getContentByStatus(userId, status as string, projectId);
      } else {
        content = await storage.getContent(userId, limiteContenus, projectId, campaignId);
      }

      res.json(content);
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ message: "Failed to fetch content" });
    }
  });

  app.post('/api/content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const requestBody = { ...req.body, userId };
      
      // Convert string dates to Date objects for database
      if (requestBody.scheduledFor && typeof requestBody.scheduledFor === 'string') {
        requestBody.scheduledFor = new Date(requestBody.scheduledFor);
      }
      if (requestBody.publishedAt && typeof requestBody.publishedAt === 'string') {
        requestBody.publishedAt = new Date(requestBody.publishedAt);
      }
      
      // La publication automatique n'est activée que sur demande EXPLICITE : la colonne
      // vaut « oui » par défaut, et un contenu créé sans y penser partirait seul à sa date.
      requestBody.autoPost = requestBody.autoPost === true;
      const contentData = insertContentSchema.parse(requestBody);
      const content = await storage.createContent(contentData);

      // Alerte de collision : informative, jamais bloquante. Elle s'exécute APRÈS
      // l'écriture, pour qu'un échec de jugement ne puisse jamais empêcher la
      // programmation. `detecterCollision` avale déjà ses propres erreurs et rend
      // null — mais on ne s'appuie pas QUE là-dessus : le try/catch local garantit
      // que même si elle levait malgré tout, le contenu déjà écrit est quand même
      // renvoyé à l'utilisatrice, avec une réponse exploitable par le calendrier.
      let collision = null;
      if (content.scheduledFor && content.projectId) {
        try {
          collision = await detecterCollision({
            userId,
            projectId: content.projectId,
            titre: content.title,
            corps: String(content.body ?? ''),
            quand: new Date(content.scheduledFor),
          });
        } catch (collisionError) {
          console.error("Error detecting collision:", collisionError);
        }
      }
      res.json({ ...content, collision });
    } catch (error) {
      console.error("Error creating content:", error);
      res.status(500).json({ message: "Failed to create content" });
    }
  });

  // Composer multi-réseaux : crée une ligne de contenu par réseau cible (même crossPostGroupId).
  app.post('/api/content/cross-post', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { targets, caption, mediaIds, scheduledFor, autoPost, projectId, pillar, goal } = req.body || {};
      if (!Array.isArray(targets) || targets.length === 0) return res.status(400).json({ message: 'no_targets' });
      const groupId = randomUUID();
      const when = scheduledFor ? new Date(scheduledFor) : null;
      const title = (caption || 'Publication').slice(0, 80);
      const created = [];
      for (const tgt of targets) {
        const row = await storage.createContent({
          userId,
          projectId: projectId || null,
          title,
          body: caption || '',
          platform: tgt.basePlatform || tgt.platform,        // instagram|facebook|linkedin|tiktok
          contentType: tgt.format || 'feed_image',
          postFormat: tgt.format || 'feed_image',
          pillar: pillar || 'general',
          goal: goal || 'visibility',
          status: 'draft',
          contentStatus: when ? 'ready' : 'draft',
          scheduledFor: when,
          autoPost: autoPost !== false,
          postStatus: 'pending',
          mediaIds: Array.isArray(mediaIds) ? mediaIds : [],
          socialAccountId: tgt.socialAccountId || null,
          crossPostGroupId: groupId,
        } as any);
        created.push(row);
      }
      res.json({ groupId, count: created.length, items: created });
    } catch (error: any) {
      console.error('Error creating cross-post:', error);
      res.status(500).json({ message: error?.message || 'cross_post_failed' });
    }
  });

  app.patch('/api/content/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const existing = await storage.getContentById(parseInt(id), userId);
      if (!existing) return res.status(404).json({ message: "Content not found" });

      const updates = req.body;
      if (updates.scheduledFor && typeof updates.scheduledFor === 'string') {
        updates.scheduledFor = new Date(updates.scheduledFor);
      }
      if (updates.publishedAt && typeof updates.publishedAt === 'string') {
        updates.publishedAt = new Date(updates.publishedAt);
      }
      
      const content = await storage.updateContent(parseInt(id), updates);

      // Alerte de collision : informative, jamais bloquante — même garantie que sur
      // la création (voir POST /api/content). On relit l'état final (`content`,
      // rendu par `updateContent`) plutôt que `updates`, qui peut être partiel (un
      // simple changement de date n'y porte ni titre ni corps).
      let collision = null;
      if (content.scheduledFor && content.projectId) {
        try {
          collision = await detecterCollision({
            userId,
            projectId: content.projectId,
            titre: content.title,
            corps: String(content.body ?? ''),
            quand: new Date(content.scheduledFor),
          });
        } catch (collisionError) {
          console.error("Error detecting collision:", collisionError);
        }
      }
      res.json({ ...content, collision });
    } catch (error) {
      console.error("Error updating content:", error);
      res.status(500).json({ message: "Failed to update content" });
    }
  });

  app.delete('/api/content/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { id } = req.params;
      const existing = await storage.getContentById(parseInt(id), userId);
      if (!existing) return res.status(404).json({ message: "Content not found" });

      await storage.deleteContent(parseInt(id));
      res.json({ message: "Content deleted successfully" });
    } catch (error) {
      console.error("Error deleting content:", error);
      res.status(500).json({ message: "Failed to delete content" });
    }
  });

  // ---- Réception (Fil 3) ------------------------------------------------------------
  // Validation du corps JSON extraite et testée dans
  // `services/reception/validate-input.ts` (parseReceptionIntOrNull,
  // parseReceptionSentiment, parseReceptionMeasuredAt) : chaîne vide = non renseigné =
  // null, jamais un zéro fabriqué — voir ce fichier pour la justification complète.

  // Saisie d'une mesure de réception pour un contenu. Renvoie la ligne persistée en entier
  // (score, confiance, raison inclus) — jamais un simple accusé de réception muet : la
  // réception sans son verdict n'a nulle part où aller.
  app.post('/api/content/:id/reception', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid content id" });

      const existing = await storage.getContentById(id, userId);
      if (!existing) return res.status(404).json({ message: "Content not found" });

      const platform = typeof req.body?.platform === "string" ? req.body.platform.trim() : "";
      if (!platform) return res.status(400).json({ message: "platform requis" });

      const saves = parseReceptionIntOrNull(req.body?.saves, "saves");
      if ("error" in saves) return res.status(400).json({ message: saves.error });
      const shares = parseReceptionIntOrNull(req.body?.shares, "shares");
      if ("error" in shares) return res.status(400).json({ message: shares.error });
      const comments = parseReceptionIntOrNull(req.body?.comments, "comments");
      if ("error" in comments) return res.status(400).json({ message: comments.error });
      const reach = parseReceptionIntOrNull(req.body?.reach, "reach");
      if ("error" in reach) return res.status(400).json({ message: reach.error });
      const sentimentScore = parseReceptionSentiment(req.body?.sentimentScore);
      if ("error" in sentimentScore) return res.status(400).json({ message: sentimentScore.error });
      const measuredAt = parseReceptionMeasuredAt(req.body?.measuredAt);
      if ("error" in measuredAt) return res.status(400).json({ message: measuredAt.error });

      const signal: ReceptionSignal = {
        contentId: id,
        platform,
        saves: saves.value,
        shares: shares.value,
        comments: comments.value,
        reach: reach.value,
        sentimentScore: sentimentScore.value,
        measuredAt: measuredAt.value,
        source: "manual",
      };

      const result = await ingestSignals(userId, [signal]);
      if (result.errors.length > 0) {
        // ingestSignals ne jette JAMAIS — un signal en échec reste une réponse contrôlée,
        // jamais un crash 500.
        return res.status(422).json({ message: result.errors[0].message, errors: result.errors });
      }

      // On relit la ligne persistée plutôt que de recalculer le score ici : la vérité du
      // score/confiance/raison vient de ce qui a été écrit par `ingestSignals`, jamais
      // d'une seconde exécution locale qui pourrait diverger. Comparaison au jour près
      // (pas .getTime() strict) pour rester insensible à un éventuel aller-retour de fuseau
      // du driver DB sur les colonnes timestamp.
      const history = await storage.getContentReception(id, userId);
      const targetDay = measuredAt.value.toISOString().slice(0, 10);
      const saved = history.find(
        (r) => r.platform === platform && new Date(r.measuredAt).toISOString().slice(0, 10) === targetDay,
      );
      if (!saved) {
        return res.status(500).json({ message: "Mesure ingérée mais introuvable après écriture" });
      }

      res.json(saved);
    } catch (error) {
      console.error("Error ingesting content reception:", error);
      res.status(500).json({ message: "Failed to ingest content reception" });
    }
  });

  // Import d'un texte collé (calendrier de contenu écrit ailleurs) en posts du
  // calendrier éditorial. Le découpage pur vit dans services/content-import/parse.ts,
  // l'orchestration (modèle + écriture transactionnelle) dans
  // services/content-import/import.ts : cette route ne fait que valider l'entrée,
  // traduire les pannes connues, et borner `couverture` pour l'affichage.
  app.post('/api/content/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = Number(req.body?.projectId);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        return res.status(400).json({ message: "projectId invalide" });
      }

      const texte = typeof req.body?.text === "string" ? req.body.text : "";
      if (!texte.trim()) {
        return res.status(400).json({ message: "text requis" });
      }
      // Le message nomme les DEUX nombres — la limite et ce qui a été reçu — pour que
      // l'utilisatrice sache de combien couper, plutôt qu'un refus opaque.
      if (texte.length > MAX_CARACTERES) {
        return res.status(400).json({
          message: `Texte trop long : ${texte.length} caractères reçus, la limite est de ${MAX_CARACTERES}.`,
        });
      }

      // 404, jamais 403 : motif retenu dans tout ce dépôt pour ne pas révéler
      // l'existence d'un projet d'autrui (voir POST /api/projects/:id/links).
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (await isAiBlocked(userId)) {
        return res.status(429).json({ message: "ai_monthly_limit_reached" });
      }

      let resultat;
      try {
        resultat = await importerTexte({ userId, projectId, texte });
      } catch (error) {
        if (error instanceof ReponseIllisible) {
          return res.status(502).json({ message: "Le modèle a répondu quelque chose d'illisible" });
        }
        throw error;
      }

      // `couverture` est un rapport BRUT non borné (peut dépasser 1, voir le
      // commentaire de ResultatImport) : on le borne à 100 ici, pour l'affichage. Le
      // rapport brut reste dans le journal écrit par `importerTexte`.
      const couverture = Math.max(0, Math.min(100, Math.round(resultat.couverture * 100)));

      // Détection de collision du LOT : s'exécute APRÈS que les posts ont été écrits
      // et commités. Enveloppée dans un try/catch LOCAL — exactement le motif retenu
      // sur POST /api/content (ligne ~6651) : une exception ici ne doit JAMAIS
      // produire un 500 sur un import qui a réussi. `detecterCollisionLot` avale déjà
      // ses propres erreurs et rend `[]`, mais on ne s'appuie pas QUE là-dessus.
      let collisions: CollisionLot[] = [];
      const postesAvecDate = resultat.posts.filter(
        (p): p is typeof p & { scheduledFor: Date } => p.scheduledFor !== null,
      );
      if (postesAvecDate.length > 0) {
        try {
          collisions = await detecterCollisionLot({
            userId,
            projectId,
            // Le CORPS, pas le titre : la détection cherche une collision d'ANGLE, et
            // l'angle vit dans le corps (voir le commentaire de `detecterCollision`
            // dans services/brand-links/collision.ts). Un titre nu comparé aux
            // titres ET corps des voisins manquerait des collisions, en silence.
            posts: postesAvecDate.map((p) => ({ id: p.id, titre: p.title, corps: p.body, quand: p.scheduledFor })),
          });
        } catch (collisionError) {
          console.error("Error detecting batch collision:", collisionError);
        }
      }

      res.json({
        posts: resultat.posts,
        ignores: resultat.ignores,
        couverture,
        reecrit: resultat.reecrit,
        tronque: resultat.tronque,
        collisions,
      });
    } catch (error) {
      console.error("Error importing content text:", error);
      res.status(500).json({ message: "Failed to import content" });
    }
  });

  // Import CSV en masse de mesures de réception (saisie humaine — voir services/reception).
  // Best-effort : une ligne malformée ou une ligne qui échoue à l'ingestion ne bloque jamais
  // les autres. Les erreurs de parsing (par ligne) et les erreurs d'ingestion (par contenu)
  // sont toutes les deux renvoyées, jamais l'une aux dépens de l'autre.
  app.post('/api/content/reception/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
      if (!csv.trim()) return res.status(400).json({ message: "csv_required" });

      const { rows, errors: parseErrors } = parseReceptionCsv(csv);
      const signals: ReceptionSignal[] = rows.map((row) => ({ ...row, source: "csv" }));
      const ingestResult = await ingestSignals(userId, signals);

      res.json({ imported: ingestResult.written, errors: [...parseErrors, ...ingestResult.errors] });
    } catch (error) {
      console.error("Error importing content reception CSV:", error);
      res.status(500).json({ message: "Failed to import content reception CSV" });
    }
  });

  // Historique des mesures de réception d'un contenu.
  app.get('/api/content/:id/reception', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid content id" });

      const existing = await storage.getContentById(id, userId);
      if (!existing) return res.status(404).json({ message: "Content not found" });

      const history = await storage.getContentReception(id, userId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching content reception:", error);
      res.status(500).json({ message: "Failed to fetch content reception" });
    }
  });
  // ---- fin Réception (Fil 3) --------------------------------------------------------

  // ---- Attribution multi-touch (Fil 3, LOT 3B) ---------------------------------------
  // Le moteur (attributeConversion) et la doctrine complète vivent dans
  // services/attribution/. Ces routes ne font que : valider l'entrée, figer la fenêtre à
  // la création (jamais la relire depuis le projet ensuite), et lancer/relancer le calcul.

  // Déclare une conversion pour une marque et lance son attribution. La fenêtre
  // d'attribution est FIGÉE ici, une fois pour toutes, depuis `projects.attributionWindowDays`
  // (défaut 30 si non réglée) — voir attribute-conversion.ts pour pourquoi on ne la relit
  // jamais depuis le projet après coup.
  app.post('/api/conversions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;

      const projectId = parseInt(req.body?.projectId);
      if (isNaN(projectId)) return res.status(400).json({ message: "projectId invalide" });

      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const convertedAt = new Date(req.body?.convertedAt);
      if (!req.body?.convertedAt || isNaN(convertedAt.getTime())) {
        return res.status(400).json({ message: "convertedAt requis et doit être une date valide" });
      }

      let value: number | null = null;
      const rawValue = req.body?.value;
      if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
        // Même garde que parseReceptionIntOrNull : un number ou une chaîne numérique sont
        // acceptés, mais pas un booléen/objet/tableau qui coercerait silencieusement (ex.
        // Number(true) === 1).
        const n = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue.trim()) : NaN;
        if (!Number.isFinite(n)) return res.status(400).json({ message: "value doit être numérique" });
        value = n;
      }

      const conversionType = typeof req.body?.conversionType === "string" && req.body.conversionType.trim()
        ? req.body.conversionType.trim()
        : null;

      const conversion = await storage.createBrandConversion({
        projectId,
        convertedAt,
        // Figé une fois pour toutes sur la ligne — jamais relu depuis le projet après coup.
        attributionWindowDays: project.attributionWindowDays ?? 30,
        conversionType,
        value,
      });

      const attributions = await attributeConversion(conversion.id);

      // La conversion vient de CHANGER la somme des crédits de ces contenus : leurs lignes
      // `content_reception` porteraient sinon le score calculé à l'ingestion, et leurs
      // entrées mémoire continueraient de l'affirmer à la salience la plus haute du fil.
      // BEST-EFFORT et non attendu comme tel : `refreshReceptionForContents` ne lève jamais
      // (la déclaration a déjà réussi ici — la faire échouer ferait redéclarer une
      // conversion pourtant enregistrée), et le recalcul est idempotent.
      await refreshReceptionForContents(attributions.map((a) => a.contentId));

      // Une fenêtre vide (aucun contenu attribué) est un succès : la conversion existe,
      // simplement créditée à personne. Ce n'est jamais une erreur.
      res.json({ ...conversion, attributions });
    } catch (error) {
      console.error("Error creating conversion:", error);
      res.status(500).json({ message: "Failed to create conversion" });
    }
  });

  // Liste les conversions d'une marque avec leurs crédits déjà joints.
  app.get('/api/conversions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;

      const projectId = parseInt(req.query.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ message: "projectId invalide" });

      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const conversions = await storage.getBrandConversionsWithCredits(projectId);
      res.json(conversions);
    } catch (error) {
      console.error("Error fetching conversions:", error);
      res.status(500).json({ message: "Failed to fetch conversions" });
    }
  });

  // Relance l'attribution d'une conversion déjà créée. Idempotent par construction
  // (replaceConversionAttributions remplace, jamais n'ajoute) — la fenêtre reste celle
  // figée à la création, jamais recalculée depuis le projet.
  app.post('/api/conversions/:id/reattribute', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid conversion id" });

      const conversion = await storage.getBrandConversion(id);
      if (!conversion) return res.status(404).json({ message: "Conversion not found" });

      const project = await storage.getProject(conversion.projectId, userId);
      if (!project) return res.status(404).json({ message: "Conversion not found" });

      // Les contenus crédités AVANT le recalcul comptent autant que ceux d'après : un
      // contenu qui PERD son crédit garderait sinon un score gonflé par une attribution qui
      // n'existe plus. On rafraîchit donc l'union des deux.
      const avant = await storage.getConversionAttributions(id);
      const attributions = await attributeConversion(id);
      await refreshReceptionForContents([
        ...avant.map((a) => a.contentId),
        ...attributions.map((a) => a.contentId),
      ]);
      res.json({ ...conversion, attributions });
    } catch (error) {
      console.error("Error reattributing conversion:", error);
      res.status(500).json({ message: "Failed to reattribute conversion" });
    }
  });
  // ---- fin Attribution multi-touch (Fil 3, LOT 3B) -----------------------------------

  // Régénère un post de contenu en remplaçant son angle/corps en gardant platform/pillar/format
  app.post('/api/content/:id/regenerate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const { feedback } = req.body as { feedback?: string };

      const existing = await storage.getContentById(id, userId);
      if (!existing) return res.status(404).json({ message: "Contenu introuvable" });
      // Un post publié ou en cours de publication ne se réécrit pas (il est déjà parti).
      if (estPublieOuEnCours(existing as any)) {
        return res.status(409).json({ message: "already_published" });
      }

      const brandDna = await storage.getBrandDna(userId);
      const bd: any = brandDna || {};

      // Préférences apprises pour CETTE marque (refus de campagnes, de posts) — à éviter.
      let blocPreferences = "";
      if (existing.projectId) {
        try {
          const prefs = await preferencesDeLaMarque(userId, existing.projectId);
          blocPreferences = formaterPreferences(prefs);
        } catch (e: any) {
          console.error("[content/regenerate] préférences non lues:", e?.message);
        }
      }

      const systemPrompt = `Tu es Naya, spécialiste en stratégie de contenu pour entrepreneurs indépendants.
Tu génères un post de remplacement pour le content calendar. Le post DOIT:
- Refléter la voix et le positionnement de la marque
- Ne jamais critiquer ou analyser des marques qui ne sont pas clientes
- Rester dans l'expertise propre de la marque (pas de commentaire sur les concurrents)
- Être spécifique, actionnable et non générique
Réponds UNIQUEMENT en JSON valide, aucun texte en dehors.`;

      const userPrompt = `Génère un post de remplacement pour le content calendar.

POST ACTUEL À REMPLACER:
- Titre/angle: ${existing.title}
- Corps: ${existing.body}
- Plateforme: ${existing.platform}
- Format: ${existing.contentType}
- Pilier: ${existing.pillar}
- Objectif: ${existing.goal}

${feedback ? `FEEDBACK DE L'UTILISATEUR (ce qu'il ne veut pas / ce qu'il préfère):\n${feedback}\n` : ''}
CONTEXTE MARQUE:
- Positionnement: ${bd.uniquePositioning || ''}
- Audience: ${bd.targetAudience || ''}
- Style de communication: ${bd.communicationStyle || 'Professionnel'}
- Territoire éditorial: ${bd.editorialTerritory || ''}
- Keywords marque: ${(bd.brandVoiceKeywords || []).join(', ')}
- Anti-keywords: ${(bd.brandVoiceAntiKeywords || []).join(', ')}
${blocPreferences ? `\n${blocPreferences}\n` : ''}
Génère un post de remplacement en JSON:
{"title": "Nouvel angle (accroche)", "body": "Contenu du post / directions créatives (2-3 phrases)"}

Le nouveau post doit avoir un angle COMPLÈTEMENT différent de l'original, tout en restant sur la même plateforme (${existing.platform}) et le même pilier (${existing.pillar}).`;

      // Passe par la mémoire de Naya (buildNayaContext) : savoir déposé, préférences, marque.
      // Avant le 7 oct. 2026, cet appel ne voyait que l'ADN de marque — les dossiers et PDF
      // déposés par l'utilisatrice n'y entraient jamais.
      const raw = await callClaudeWithContext({
        userId,
        projectId: existing.projectId ?? null,
        userMessage: userPrompt,
        model: CLAUDE_MODELS.smart,
        max_tokens: 800,
        additionalSystemContext: systemPrompt,
      });

      let replacement: { title: string; body: string };
      try {
        replacement = JSON.parse(stripMarkdownJSON(raw));
      } catch {
        return res.status(500).json({ message: "Impossible de générer une alternative. Réessaie." });
      }

      if (typeof replacement?.title !== 'string' || typeof replacement?.body !== 'string' || !replacement.title.trim() || !replacement.body.trim()) {
        return res.status(500).json({ message: "Impossible de générer une alternative. Réessaie." });
      }
      // Garde de langue : le prompt est rédigé en français mais le compte peut être en anglais.
      const pourLangue: any = { title: replacement.title, description: replacement.body };
      await imposerLangueDuCompte([pourLangue], userId).catch(() => {});

      const updated = await storage.updateContent(id, {
        title: String(pourLangue.title).slice(0, 200),
        body: String(pourLangue.description).slice(0, 5000),
        contentStatus: 'idea',
        // Un texte réécrit n'a pas été relu : il ne part jamais seul.
        autoPost: false,
      } as any);

      res.json(updated);
    } catch (error: any) {
      console.error("[content/regenerate] Error:", error?.message);
      res.status(500).json({ message: "Erreur lors de la régénération" });
    }
  });

  // AI-powered content generation
  app.post('/api/content/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { platform, goal, pillar, topic } = req.body;

      let projectId: number | undefined;
      if (req.body.projectId !== undefined && req.body.projectId !== null) {
        projectId = Number(req.body.projectId);
        if (!Number.isFinite(projectId) || projectId <= 0) return res.status(400).json({ message: "Invalid projectId" });
      }
      
      const brandDna = projectId !== undefined
        ? await storage.getBrandDnaForProject(userId, projectId)
        : await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA not configured. Please complete onboarding first." });
      }

      const { projectContext: contentProjCtx, personaContext: contentPersonaCtx } = await fetchAIContext(userId,
        projectId
      );

      const aiResponse = await generateContent({
        userId,
        platform,
        goal,
        pillar,
        topic,
        projectContext: contentProjCtx,
        personaContext: contentPersonaCtx,
        brandDna: {
          // New comprehensive fields
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
          currentChallenges: brandDna.currentChallenges || undefined,
          pastSuccess: brandDna.pastSuccess || undefined,
          inspiration: brandDna.inspiration || undefined,
          
          // Legacy fields for backward compatibility
          tone: brandDna.tone,
          contentPillars: brandDna.contentPillars || [],
          audience: brandDna.audience || "",
          painPoints: brandDna.painPoints || [],
          desires: brandDna.desires || [],
          offer: brandDna.offer || "",
          businessGoal: brandDna.businessGoal || "",
        },
      });

      res.json(aiResponse);
    } catch (error) {
      console.error("Error generating content:", error);
      res.status(500).json({ message: "Failed to generate content" });
    }
  });

  // ── L'espace de lecture — la revue du matin ─────────────────────────────────
  // Spec : docs/superpowers/specs/2026-09-29-naya-espace-lecture-design.md

  // DEUX listes, jamais une seule. La version précédente rendait un unique tableau où
  // les fiches `kept` (sans aucune borne de date) côtoyaient celles du jour. Prise
  // isolément la requête était juste ; assemblée avec `cards.length` du dashboard elle
  // fabriquait exactement ce que le spec interdit : après un mois à garder une fiche par
  // semaine, « 4 choses à lire sur ton marché » chaque matin, y compris les matins vides,
  // c'est-à-dire un compteur de dette qui ne redescend jamais — le mode d'échec n°3 de la
  // spec (« un backlog qui s'accumule »). En séparant les deux listes à la source, aucune
  // surface ne peut plus les confondre : le jour est borné à minuit UTC, le gardé ne l'est
  // pas, et c'est l'appelant qui choisit ce qu'il compte (le dashboard : le jour, jamais
  // le gardé).
  app.get('/api/reading/today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const debutDuJour = new Date();
      debutDuJour.setUTCHours(0, 0, 0, 0);
      // relevanceScore est nullable ; un tri DESC nu placerait les NULL en tête sous
      // Postgres, donc une fiche sans score passerait devant les mieux notées.
      const parScore = sql`${readingCards.relevanceScore} DESC NULLS LAST`;

      const [duJour, gardees] = await Promise.all([
        db
          .select()
          .from(readingCards)
          .where(and(
            eq(readingCards.userId, userId),
            inArray(readingCards.status, ['proposed', 'answered']),
            gte(readingCards.createdAt, debutDuJour),
          ))
          .orderBy(parScore),
        // Les gardées n'ont volontairement pas de borne de date — c'est leur raison
        // d'être — mais elles ne sont plus jamais « ce matin ».
        db
          .select()
          .from(readingCards)
          .where(and(
            eq(readingCards.userId, userId),
            eq(readingCards.status, 'kept'),
          ))
          .orderBy(parScore),
      ]);
      res.json({ duJour, gardees });
    } catch (error) {
      console.error('[Lecture] GET /api/reading/today:', error);
      res.status(500).json({ message: 'Failed to fetch reading cards' });
    }
  });

  app.post('/api/reading/cards/:id/answer', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Identifiant invalide' });
      const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
      if (!answer) return res.status(400).json({ message: 'Réponse vide' });

      // Le statut n'est PAS écrit en dur : une fiche `kept` reste `kept` quand on y
      // répond (voir services/reading/statut.ts pour le défaut que ça ferme). L'avis et
      // sa date, eux, sont enregistrés dans les deux cas — c'est tout l'intérêt.
      const [card] = await db
        .update(readingCards)
        .set({ userAnswer: answer, answeredAt: new Date(), status: statutApresReponse })
        .where(and(eq(readingCards.id, id), eq(readingCards.userId, userId)))
        .returning();
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });

      // Mémoire best-effort : la marque est CONNUE (celle de la fiche), donc aucune
      // question de marque n'est posée. Un échec ici ne casse pas la réponse.
      extractToMemory({
        userId,
        projectId: card.projectId,
        subjectProjectId: card.projectId,
        sourceType: 'reading',
        sourceText: `À propos de « ${card.title} » (${card.url}).\nQuestion posée : ${card.question}\nAvis de la fondatrice : ${answer}`,
      }).catch((e: any) => console.error('[Lecture] extractToMemory:', e?.message));

      res.json({ card });
    } catch (error) {
      console.error('[Lecture] POST answer:', error);
      res.status(500).json({ message: 'Failed to save answer' });
    }
  });

  app.post('/api/reading/cards/:id/keep', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Identifiant invalide' });
      const [card] = await db
        .update(readingCards)
        .set({ status: 'kept' })
        .where(and(eq(readingCards.id, id), eq(readingCards.userId, req.userId)))
        .returning();
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });
      res.json({ card });
    } catch (error) {
      console.error('[Lecture] POST keep:', error);
      res.status(500).json({ message: 'Failed to keep card' });
    }
  });

  app.post('/api/reading/cards/:id/skip', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Identifiant invalide' });
      // « Passer » ne demande aucune justification et n'affiche aucune conséquence.
      // La ligne RESTE en base : c'est elle qui empêche l'URL d'être reproposée.
      await db
        .update(readingCards)
        .set({ status: 'rejected' })
        .where(and(eq(readingCards.id, id), eq(readingCards.userId, req.userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error('[Lecture] POST skip:', error);
      res.status(500).json({ message: 'Failed to skip card' });
    }
  });

  app.post('/api/reading/cards/:id/to-content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Identifiant invalide' });
      const [card] = await db
        .select()
        .from(readingCards)
        .where(and(eq(readingCards.id, id), eq(readingCards.userId, userId)));
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });
      // Garde-fou du spec : pas de brouillon tant qu'il n'y a pas d'avis. Ce qu'elle
      // publie part de SA réponse, jamais de la fiche seule.
      if (!card.userAnswer) return res.status(400).json({ message: "Aucune réponse : pas de brouillon" });

      const brouillon = await callClaudeWithContext({
        userId,
        projectId: card.projectId,
        max_tokens: 1200,
        additionalSystemContext:
          "Tu mets en forme l'avis de la fondatrice en post LinkedIn. Tu n'ajoutes AUCUNE opinion " +
          "qu'elle n'a pas exprimée : tu structures, tu resserres, tu gardes ses mots et son ton. " +
          "Pas de hashtags, pas d'emoji, pas de formule d'accroche creuse.",
        userMessage: `FAIT\n${card.factSummary}\n\nSON AVIS\n${card.userAnswer}\n\nSOURCE\n${card.url}`,
      });

      // contentType/pillar/goal : aucune base pour les déduire depuis une fiche de lecture,
      // donc VALEUR_A_PRECISER plutôt qu'une valeur plausible qui s'installerait sans bruit
      // dans les statistiques d'attribution — même arbitrage que task-to-content.ts
      // (Jeanne, 2026-09-16). platform est fixée par le prompt ci-dessus (on demande
      // explicitement un post LinkedIn), mais c'est Naya qui l'a choisie, pas
      // l'utilisatrice : elle est donc marquée déduite au même titre que les trois autres.
      const [ligne] = await db
        .insert(content)
        .values({
          userId,
          projectId: card.projectId,
          title: card.title,
          body: brouillon,
          platform: 'linkedin',
          contentType: VALEUR_A_PRECISER,
          pillar: VALEUR_A_PRECISER,
          goal: VALEUR_A_PRECISER,
          status: 'draft',
          autoPost: false, // brouillon : jamais publié seul
          deducedFields: [...CHAMPS_DEDUCTIBLES],
        })
        .returning({ id: content.id });

      res.json({ contentId: ligne.id });
    } catch (error) {
      console.error('[Lecture] POST to-content:', error);
      res.status(500).json({ message: 'Failed to create content' });
    }
  });

  app.get('/api/reading/queries', isAuthenticated, async (req: any, res) => {
    try {
      const queries = await db
        .select()
        .from(readingQueries)
        .where(eq(readingQueries.userId, req.userId))
        .orderBy(desc(readingQueries.createdAt));
      res.json({ queries });
    } catch (error) {
      console.error('[Lecture] GET queries:', error);
      res.status(500).json({ message: 'Failed to fetch queries' });
    }
  });

  app.post('/api/reading/queries', isAuthenticated, async (req: any, res) => {
    try {
      const projectId = parseInt(req.body?.projectId, 10);
      const q = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      if (!Number.isFinite(projectId) || !q) return res.status(400).json({ message: 'projectId et query requis' });
      // Le projet vient du corps de la requête : sans cette vérification, un identifiant
      // d'autrui s'insérerait quand même (aucun code ne le lit jamais, mais la ligne
      // casse l'invariant de la table ET transforme l'endpoint en oracle d'énumération —
      // une ressource d'autrui est INTROUVABLE ici, jamais « interdite », d'où 404 et non 403.
      const project = await storage.getProject(projectId, req.userId);
      if (!project) return res.status(404).json({ message: 'Projet introuvable' });
      const [query] = await db
        .insert(readingQueries)
        .values({ userId: req.userId, projectId, query: q, origin: 'manual', isActive: true })
        .returning();
      res.json({ query });
    } catch (error) {
      console.error('[Lecture] POST queries:', error);
      res.status(500).json({ message: 'Failed to create query' });
    }
  });

  app.patch('/api/reading/queries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Identifiant invalide' });
      const patch: Record<string, unknown> = {};
      if (typeof req.body?.query === 'string' && req.body.query.trim()) patch.query = req.body.query.trim();
      if (typeof req.body?.isActive === 'boolean') patch.isActive = req.body.isActive;
      if (Object.keys(patch).length === 0) return res.status(400).json({ message: 'Rien à modifier' });
      const [query] = await db
        .update(readingQueries)
        .set(patch)
        .where(and(eq(readingQueries.id, id), eq(readingQueries.userId, req.userId)))
        .returning();
      if (!query) return res.status(404).json({ message: 'Requête introuvable' });
      res.json({ query });
    } catch (error) {
      console.error('[Lecture] PATCH queries:', error);
      res.status(500).json({ message: 'Failed to update query' });
    }
  });

  app.post('/api/reading/run', isAuthenticated, async (req: any, res) => {
    try {
      // Même garde-fou de dépense que les neuf autres appels IA de ce fichier, et même
      // motif exact. Il manquait ici : cet endpoint déclenche à la demande, sans aucune
      // limite de fréquence, la seule fonctionnalité qui enchaîne 24 requêtes SERP, un
      // appel modèle par marque et un appel modèle par fiche. La revue elle-même est
      // gardée dans runReadingRoom (après l'expiration, qui reste inconditionnelle) ;
      // ici on refuse avant de dépenser.
      if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      const out = await runReadingRoom(req.userId, new Date());
      res.json(out);
    } catch (error) {
      console.error('[Lecture] POST run:', error);
      res.status(500).json({ message: 'Failed to run reading room' });
    }
  });

  // Saved articles routes (Reading Hub)
  app.get('/api/saved-articles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { category } = req.query;
      
      const articles = await storage.getSavedArticles(userId, category as string);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching saved articles:", error);
      res.status(500).json({ message: "Failed to fetch saved articles" });
    }
  });

  app.post('/api/saved-articles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;

      // Exactement le trou refermé sur POST /api/reading/queries, réouvert ici par un
      // autre chemin : cette branche a ajouté `projectId` à `savedArticles`, donc au
      // schéma d'insertion, donc un identifiant de projet arbitraire venu du corps de la
      // requête s'insère sans qu'on vérifie l'appartenance. Impact nul aujourd'hui (rien
      // ne lit encore la colonne), mais la ligne casse l'invariant de la table ET fait de
      // l'endpoint un oracle d'énumération. Vérifié AVANT l'analyse IA plus bas : on ne
      // dépense pas pour une requête qu'on va refuser. 404 et non 403 — un 403
      // confirmerait l'existence du projet d'autrui.
      const projectId = req.body?.projectId === undefined || req.body?.projectId === null
        ? null
        : parseInt(req.body.projectId, 10);
      if (projectId !== null) {
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: 'projectId invalide' });
        const project = await storage.getProject(projectId, userId);
        if (!project) return res.status(404).json({ message: 'Projet introuvable' });
      }

      // Auto-generate AI analysis for the article
      let aiAnalysis = null;
      if (req.body.url && req.body.title) {
        try {
          // Get user's Brand DNA for context
          const brandDna = await storage.getBrandDna(userId);
          if (brandDna) {
            const analysisResult = await articleAnalysisService.analyzeArticle({
              title: req.body.title,
              url: req.body.url,
              description: req.body.description,
              author: req.body.author,
              source: req.body.source
            }, brandDna);
            
            aiAnalysis = analysisResult;
          }
        } catch (analysisError) {
          console.error("AI analysis failed:", analysisError);
          // Continue without analysis
        }
      }
      
      const articleData = insertSavedArticleSchema.parse({
        ...req.body,
        userId,
        // Le projectId vérifié ci-dessus, normalisé en nombre : pas celui du corps brut,
        // sinon la vérification porterait sur une valeur et l'insertion sur une autre.
        projectId,
        aiAnalysis: aiAnalysis || req.body.aiAnalysis
      });
      
      const article = await storage.createSavedArticle(articleData);
      res.json(article);
    } catch (error) {
      console.error("Error creating saved article:", error);
      res.status(500).json({ message: "Failed to create saved article" });
    }
  });

  app.put('/api/saved-articles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const updates = updateSavedArticleSchema.parse(req.body);

      // Le MÊME trou que sur le POST, par le même chemin : `updateSavedArticleSchema`
      // dérive du schéma d'insertion, donc il a hérité de `projectId` avec cette branche.
      // Fermé de la même façon, 404 comprise — corriger l'un sans l'autre laisserait la
      // moitié de la régression en place.
      if (updates.projectId !== undefined && updates.projectId !== null) {
        const project = await storage.getProject(updates.projectId, userId);
        if (!project) return res.status(404).json({ message: 'Projet introuvable' });
      }
      
      const article = await storage.updateSavedArticle(parseInt(id), userId, updates);
      if (!article) {
        return res.status(404).json({ message: "Article not found or access denied" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error updating saved article:", error);
      res.status(500).json({ message: "Failed to update saved article" });
    }
  });

  app.delete('/api/saved-articles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      const deleted = await storage.deleteSavedArticle(parseInt(id), userId);
      if (!deleted) {
        return res.status(404).json({ message: "Article not found or access denied" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting saved article:", error);
      res.status(500).json({ message: "Failed to delete saved article" });
    }
  });

  app.patch('/api/saved-articles/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const { isRead } = toggleReadSchema.parse(req.body);
      
      const article = await storage.markArticleAsRead(parseInt(id), userId, isRead);
      if (!article) {
        return res.status(404).json({ message: "Article not found or access denied" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error updating article read status:", error);
      res.status(500).json({ message: "Failed to update article read status" });
    }
  });

  app.patch('/api/saved-articles/:id/favorite', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const { isFavorite } = toggleFavoriteSchema.parse(req.body);
      
      const article = await storage.toggleArticleFavorite(parseInt(id), userId, isFavorite);
      if (!article) {
        return res.status(404).json({ message: "Article not found or access denied" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error updating article favorite status:", error);
      res.status(500).json({ message: "Failed to update article favorite status" });
    }
  });

  // Re-analyze article with updated Brand DNA
  app.post('/api/saved-articles/:id/analyze', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      // Get the article
      const article = await storage.getSavedArticleById(parseInt(id), userId);
      if (!article) {
        return res.status(404).json({ message: "Article not found or access denied" });
      }
      
      // Get user's Brand DNA for context
      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA required for analysis" });
      }
      
      // Re-analyze the article
      const analysisResult = await articleAnalysisService.analyzeArticle({
        title: article.title,
        url: article.url,
        description: article.description || undefined,
        author: article.author || undefined,
        source: article.source || undefined
      }, brandDna);
      
      // Update the article with new analysis
      const updatedArticle = await storage.updateSavedArticle(parseInt(id), userId, {
        aiAnalysis: analysisResult
      });
      
      res.json(updatedArticle);
    } catch (error) {
      console.error("Error re-analyzing article:", error);
      res.status(500).json({ message: "Failed to re-analyze article" });
    }
  });

  // Social accounts routes
  app.get('/api/social-accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const accounts = await storage.getSafeSocialAccounts(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social accounts:", error);
      res.status(500).json({ message: "Failed to fetch social accounts" });
    }
  });

  app.post('/api/social-accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const accountData = insertSocialAccountSchema.parse({ ...req.body, userId });
      const account = await storage.createSafeSocialAccount(accountData);
      res.json(account);
    } catch (error) {
      console.error("Error creating social account:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid request data", errors: (error as any).errors });
      }
      res.status(500).json({ message: "Failed to create social account" });
    }
  });

  app.patch('/api/social-accounts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const updates = updateSocialAccountSchema.parse(req.body);
      
      const account = await storage.updateSafeSocialAccount(parseInt(id), userId, updates);
      if (!account) {
        return res.status(404).json({ message: "Social account not found or access denied" });
      }
      res.json(account);
    } catch (error) {
      console.error("Error updating social account:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid request data", errors: (error as any).errors });
      }
      res.status(500).json({ message: "Failed to update social account" });
    }
  });

  app.delete('/api/social-accounts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      const deleted = await storage.deleteSocialAccount(parseInt(id), userId);
      if (!deleted) {
        return res.status(404).json({ message: "Social account not found or access denied" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting social account:", error);
      res.status(500).json({ message: "Failed to delete social account" });
    }
  });

  app.get('/api/social-accounts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      const account = await storage.getSafeSocialAccountById(parseInt(id), userId);
      if (!account) {
        return res.status(404).json({ message: "Social account not found or access denied" });
      }
      res.json(account);
    } catch (error) {
      console.error("Error fetching social account:", error);
      res.status(500).json({ message: "Failed to fetch social account" });
    }
  });

  app.get('/api/social-accounts/platform/:platform', isAuthenticated, async (req: any, res) => {
    try {
      const { platform } = req.params;
      const userId = req.userId;
      
      // Note: This route needs the full account for internal use, but we still return safe version
      const account = await storage.getSocialAccountByPlatform(userId, platform);
      if (!account) {
        return res.status(404).json({ message: "Social account not found for this platform" });
      }
      
      // Convert to safe version before returning
      const { accessToken, refreshToken, ...safeAccount } = account;
      res.json(safeAccount);
    } catch (error) {
      console.error("Error fetching social account by platform:", error);
      res.status(500).json({ message: "Failed to fetch social account" });
    }
  });

  // Media library routes
  app.get('/api/media-library', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const media = await storage.getMediaLibrary(userId);
      res.json(media);
    } catch (error) {
      console.error("Error fetching media library:", error);
      res.status(500).json({ message: "Failed to fetch media library" });
    }
  });

  app.post('/api/media-library', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const mediaData = insertMediaLibrarySchema.parse({ ...req.body, userId });
      const media = await storage.createMediaItem(mediaData);
      res.json(media);
    } catch (error) {
      console.error("Error creating media item:", error);
      res.status(500).json({ message: "Failed to create media item" });
    }
  });

  app.patch('/api/media-library/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const updates = updateMediaLibrarySchema.parse(req.body);
      
      const media = await storage.updateMediaItem(parseInt(id), userId, updates);
      if (!media) {
        return res.status(404).json({ message: "Media item not found or access denied" });
      }
      res.json(media);
    } catch (error) {
      console.error("Error updating media item:", error);
      res.status(500).json({ message: "Failed to update media item" });
    }
  });

  app.delete('/api/media-library/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      // First get the media item to get the file URL for storage deletion
      const mediaItem = await storage.getMediaItemById(parseInt(id), userId);
      if (!mediaItem) {
        return res.status(404).json({ message: "Media item not found or access denied" });
      }
      
      // Delete from object storage first
      const objectStorageService = new ObjectStorageService();
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(mediaItem.url);
        // Delete the actual object from storage
        await objectFile.delete();
        console.log(`Successfully deleted object: ${mediaItem.url}`);
      } catch (objectError) {
        console.warn(`Failed to delete object ${mediaItem.url} from storage:`, objectError);
        // Continue with database deletion even if object deletion fails (object might not exist)
      }
      
      // Delete from database
      const deleted = await storage.deleteMediaItem(parseInt(id), userId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete media item from database" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting media item:", error);
      res.status(500).json({ message: "Failed to delete media item" });
    }
  });

  app.get('/api/media-library/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      
      const media = await storage.getMediaItemById(parseInt(id), userId);
      if (!media) {
        return res.status(404).json({ message: "Media item not found or access denied" });
      }
      res.json(media);
    } catch (error) {
      console.error("Error fetching media item:", error);
      res.status(500).json({ message: "Failed to fetch media item" });
    }
  });

  // Leads routes
  app.get('/api/leads', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { status } = req.query;
      
      let leads;
      if (status) {
        leads = await storage.getLeadsByStatus(userId, status as string);
      } else {
        leads = await storage.getLeads(userId);
      }
      
      res.json(leads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.post('/api/leads', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const leadData = insertLeadSchema.parse({ ...req.body, userId });
      const lead = await storage.createLead(leadData);
      res.json(lead);
    } catch (error) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  // Import CSV de leads en masse (style lemlist : coller/uploader une liste)
  app.post('/api/leads/import', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      if (!csv.trim()) return res.status(400).json({ message: 'csv_required' });

      let projectId: number | null = null;
      const campaignId = Number(req.body?.campaignId) || null;
      if (campaignId) {
        const campaign = await storage.getProspectionCampaign(campaignId);
        if (!campaign || campaign.userId !== userId) return res.status(404).json({ message: 'campaign_not_found' });
        projectId = (campaign as any).projectId ?? null;
      }

      const rows = parseCsv(csv);
      const mapped = rows.map(mapLeadRow).filter((l): l is NonNullable<typeof l> => l !== null);

      // Déduplication par email (parmi les leads existants de l'utilisateur).
      const existing = await storage.getLeads(userId);
      const existingEmails = new Set(existing.map(l => (l.email || '').toLowerCase()).filter(Boolean));

      let imported = 0, skipped = 0;
      for (const m of mapped) {
        const emailKey = (m.email || '').toLowerCase();
        if (emailKey && existingEmails.has(emailKey)) { skipped++; continue; }
        if (emailKey) existingEmails.add(emailKey);
        await storage.createLead({
          userId,
          projectId: projectId ?? undefined,
          prospectionCampaignId: campaignId ?? undefined,
          name: m.name || m.email || 'Sans nom',
          email: m.email ?? undefined,
          company: m.company ?? undefined,
          role: m.role ?? undefined,
          sector: m.sector ?? undefined,
          linkedinUrl: m.linkedinUrl ?? undefined,
          stage: 'identified',
          status: 'discovered',
        } as any);
        imported++;
      }
      res.json({ imported, skipped, total: mapped.length });
    } catch (e: any) {
      console.error('Error importing leads:', e.message);
      res.status(500).json({ message: 'import_failed' });
    }
  });

  // Archivage groupé (soft-delete) : { ids: number[] } → archived_at = now. Scopé userId.
  app.post('/api/leads/bulk-archive', isAuthenticated, async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((n: any) => Number.isInteger(n)) : [];
      if (ids.length === 0) return res.status(400).json({ message: 'no_ids' });
      const archived = await storage.bulkArchiveLeads(ids, req.userId);
      res.json({ archived });
    } catch (error: any) {
      console.error('Error bulk-archiving leads:', error?.message);
      res.status(500).json({ message: 'Failed to archive leads' });
    }
  });

  // Déplacement groupé vers une campagne : { ids: number[], campaignId } → prospection_campaign_id.
  app.post('/api/leads/bulk-move', isAuthenticated, async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((n: any) => Number.isInteger(n)) : [];
      const campaignId = Number(req.body?.campaignId);
      if (ids.length === 0) return res.status(400).json({ message: 'no_ids' });
      if (!Number.isInteger(campaignId)) return res.status(400).json({ message: 'invalid_campaign' });
      // La campagne cible doit appartenir à l'utilisateur.
      const campaign = await storage.getProspectionCampaign(campaignId);
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'campaign_not_found' });
      const moved = await storage.bulkMoveLeads(ids, req.userId, campaignId);
      res.json({ moved });
    } catch (error: any) {
      console.error('Error bulk-moving leads:', error?.message);
      res.status(500).json({ message: 'Failed to move leads' });
    }
  });

  app.patch('/api/leads/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const updates = updateLeadSchema.parse(req.body);
      const lead = await storage.updateLead(parseInt(id), userId, updates);

      if (!lead) {
        return res.status(404).json({ message: "Lead not found or access denied" });
      }

      // Stop-on-reply : si le lead passe à un stade « répondu/engagé », on stoppe sa séquence.
      const ENGAGED = ['connected', 'in_discussion', 'proposal_sent', 'signed'];
      if (typeof (updates as any).stage === 'string' && ENGAGED.includes((updates as any).stage)) {
        const st = await storage.getLeadSequenceState(parseInt(id));
        if (st && st.status === 'active') {
          await storage.updateLeadSequenceState(parseInt(id), { status: 'stopped_replied', repliedAt: new Date(), nextRunAt: null }).catch(() => {});
        }
      }

      res.json(lead);
    } catch (error) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  // Statut d'abonnement prospection (plan + compteur LinkedIn hebdo). Ne dévoile aucun coût interne.
  app.get('/api/prospection/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const plan = await getProspectionPlan(userId);
      // Le compteur LinkedIn n'a de sens que pour le plan enrichissement.
      const linkedinRequestsThisWeek =
        plan === "enrichissement" ? await getLinkedInRequestsThisWeek(userId) : 0;
      res.json(buildProspectionStatus({ plan, linkedinRequestsThisWeek }));
    } catch (e: any) {
      console.error("Error fetching prospection status:", e);
      res.status(500).json({ message: "Failed to fetch prospection status" });
    }
  });

  // ─── Prospection Campaign routes ─────────────────────────────────────────────
  app.get('/api/prospection/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const campaigns = await storage.getProspectionCampaigns(userId);
      res.json(campaigns);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/prospection/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const campaign = await storage.createProspectionCampaign({ ...req.body, userId });
      res.json(campaign);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch('/api/prospection/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const campaignId = Number(req.params.id);
      // Détecte un changement des consignes de rédaction PAR CAMPAGNE avant l'update, pour ne
      // purger le cache lead_step_messages QUE si elles changent (pas sur une édition sans rapport).
      const hasInstructions = req.body && Object.prototype.hasOwnProperty.call(req.body, 'messageInstructions');
      let instructionsChanged = false;
      if (hasInstructions) {
        const existing = await storage.getProspectionCampaign(campaignId);
        const prev = (existing as any)?.messageInstructions ?? null;
        const nextRaw = req.body.messageInstructions;
        const next = typeof nextRaw === 'string' ? (nextRaw.trim() || null) : (nextRaw ?? null);
        instructionsChanged = !!existing && (existing as any).userId === userId && next !== prev;
      }
      const updated = await storage.updateProspectionCampaign(campaignId, userId, req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      // Consignes par campagne modifiées → cache périmé pour cette campagne : purge ciblée.
      if (instructionsChanged) await storage.purgeLeadStepMessagesForCampaign(campaignId);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete('/api/prospection/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      await storage.deleteProspectionCampaign(Number(req.params.id), userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Génère un brief de recherche pour une campagne de prospection
  app.post('/api/prospection/campaigns/:id/search-brief', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brief = await generateSearchBrief(userId, Number(req.params.id));
      res.json(brief);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Séquences de prospection (style lemlist) ──────────────────────────────

  // Étapes de la séquence d'une campagne
  app.get('/api/prospection/campaigns/:id/sequence', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      res.json(await storage.getSequenceSteps(campaign.id));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Aperçu de la séquence rendue avec un vrai prospect (lecture/génération, AUCUN envoi).
  // Réutilise generateStepMessage (cache lead_step_messages) pour que l'aperçu et l'envoi
  // affichent exactement le même texte.
  app.get('/api/prospection/campaigns/:id/preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const campaignId = Number(req.params.id);
      const leadId = Number(req.query.leadId);
      // refresh=1 → force la régénération IA (ignore le cache lead_step_messages et l'écrase avec
      // le texte frais). Sans le flag, on sert le cache pour que l'aperçu et l'envoi coïncident.
      const force = req.query.refresh === '1';
      const campaign = await storage.getProspectionCampaign(campaignId);
      if (!campaign || (campaign as any).userId !== userId) return res.status(404).json({ message: "Campagne introuvable" });
      const steps = await storage.getSequenceSteps(campaignId);
      const lead = (await storage.getLeads(userId)).find((l) => l.id === leadId);
      if (!lead) return res.status(404).json({ message: "Prospect introuvable" });

      // Signature = PRÉNOM du créateur (jamais le nom d'agence) — même résolution que l'envoi.
      const dna = await storage.getBrandDna(userId);
      const user = await storage.getUser(userId);
      const founderName = resolveFounderName(user, dna as any);
      const campaignWithFounder = { ...campaign, founderName };
      const prefs = await storage.getUserPreferences(userId);
      const instructions = combineInstructions((prefs as any)?.messageInstructions, (campaign as any)?.messageInstructions);

      const rendered: any[] = [];
      const allSteps = steps.map((s) => ({
        id: s.id, channel: s.channel, intention: s.intention ?? null,
        condition: s.condition ?? "always", bodyTemplate: (s as any).bodyTemplate ?? null,
      }));
      // Textes produits plus haut dans CET aperçu (y compris ceux signalés trop proches,
      // qui ne sont pas en cache) : l'étape suivante doit s'en distinguer aussi.
      const produits: string[] = [];
      for (const [i, step] of steps.entries()) {
        try {
          const msg = await generateStepMessage(userId, {
            lead, campaign: campaignWithFounder,
            step: allSteps[i], steps: allSteps, previousTexts: [...produits],
            senderLastName: (user as any)?.lastName ?? null,
            useCache: !force, instructions,
          });
          produits.push(msg.body);
          rendered.push({
            stepOrder: step.stepOrder, channel: step.channel, delayDays: step.delayDays,
            intention: step.intention ?? null, condition: step.condition ?? "always",
            subject: msg.subject, body: msg.body, error: false, tropProche: !!msg.tropProche,
          });
        } catch (stepError: any) {
          // Une étape ratée (sortie IA vide/imparsable — non mise en cache) ne doit pas faire
          // échouer tout l'aperçu : on la marque error:true, l'UI proposera "régénérer".
          console.error('[prospection/preview] step failed', step.id, stepError.message);
          rendered.push({
            stepOrder: step.stepOrder, channel: step.channel, delayDays: step.delayDays,
            intention: step.intention ?? null, condition: step.condition ?? "always",
            subject: null, body: null, error: true,
          });
        }
      }
      // Garde « message trop proche » du moteur : quand il a renoncé, la raison est montrée
      // en tête de l'aperçu et l'étape bloquée est marquée.
      const garde = etatGardeApercu(lead, steps.map((s) => s.id));
      if (garde.indexBloque >= 0 && rendered[garde.indexBloque]) rendered[garde.indexBloque].bloqueParMoteur = true;
      res.json({
        lead: { id: lead.id, name: lead.name, company: lead.company },
        attention: garde.attention,
        steps: rendered,
      });
    } catch (e: any) {
      console.error('[prospection/preview]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Lead Finder IA : l'IA définit l'ICP (profil idéal) + requêtes de recherche prêtes à l'emploi.
  // Sourcing automatique uniquement si une source de données est configurée (sinon : queries seules,
  // jamais de faux leads).
  app.post('/api/prospection/campaigns/:id/find-leads', isAuthenticated, async (req: any, res) => {
    try {
      if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      // generateLeadCriteria lève après 2 tentatives ratées → capturé plus bas en 500 explicite.
      const icp = await generateLeadCriteria(req.userId, campaign.id);
      res.json({ icp, providerConfigured: serpConfigured() });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Sourcing automatique réel via Bright Data SERP API : exécute les requêtes Google X-ray
  // (profils LinkedIn) → importe les prospects trouvés dans la campagne (dédup).
  app.post('/api/prospection/campaigns/:id/source-leads', isAuthenticated, async (req: any, res) => {
    try {
      if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      if (!serpConfigured()) return res.status(400).json({ message: 'provider_not_configured' });
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });

      let queries: string[] = Array.isArray(req.body?.queries) ? req.body.queries.filter((q: any) => typeof q === 'string' && q.trim()) : [];
      if (queries.length === 0) {
        const icp = await generateLeadCriteria(req.userId, campaign.id);
        queries = icp?.googleQueries || [];
      }
      if (queries.length === 0) return res.status(400).json({ message: 'no_queries' });

      const found = await sourceLeadsFromQueries(queries, req.userId);

      // Déduplication contre les leads existants (par URL LinkedIn).
      const existing = await storage.getLeads(req.userId);
      const existingUrls = new Set(existing.map(l => ((l as any).linkedinUrl || '').toLowerCase().split('?')[0]).filter(Boolean));
      const projectId = (campaign as any).projectId ?? null;

      let imported = 0, skipped = 0;
      for (const f of found) {
        const key = f.linkedinUrl.toLowerCase();
        if (existingUrls.has(key)) { skipped++; continue; }
        existingUrls.add(key);
        await storage.createLead({
          userId: req.userId,
          projectId: projectId ?? undefined,
          prospectionCampaignId: campaign.id,
          name: f.name,
          role: f.role ?? undefined,
          company: f.company ?? undefined,
          linkedinUrl: f.linkedinUrl,
          stage: 'identified',
          status: 'discovered',
        } as any);
        imported++;
      }
      res.json({ found: found.length, imported, skipped });
    } catch (e: any) {
      console.error('[source-leads]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Pipeline complet ────────────────────────────────────────────────────
  // PHASE 1+2 : recherche adaptive + pré-filtrage + import brut (plan base, pas de quota).
  app.post('/api/prospection/campaigns/:id/search', isAuthenticated, async (req: any, res) => {
    try {
      if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      if (!serpConfigured()) return res.status(400).json({ message: 'provider_not_configured' });
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const result = await runCampaignSearch(req.userId, campaign);
      res.json(result);
    } catch (e: any) {
      console.error('[prospection/search]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // PHASE 3+4 : enrichissement + audit + message (plan enrichissement uniquement).
  // Body: { prospectIds: number[] }. Bloque en 403 (plan base ou limite LinkedIn atteinte).
  app.post('/api/prospection/campaigns/:id/enrich', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const prospectIds = Array.isArray(req.body?.prospectIds)
        ? req.body.prospectIds.filter((n: any) => Number.isInteger(n))
        : [];
      if (prospectIds.length === 0) return res.status(400).json({ message: 'no_prospects' });
      const result = await enrichProspects(req.userId, campaign, prospectIds);
      res.json(result);
    } catch (e: any) {
      const gated = prospectionErrorResponse(e);
      if (gated) return res.status(gated.status).json(gated.body);
      console.error('[prospection/enrich]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Liste les prospects d'une campagne avec leur statut d'enrichissement (deux plans).
  app.get('/api/prospection/campaigns/:id/prospects', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const prospects = await storage.getLeadsByCampaign(campaign.id, req.userId);
      res.json(prospects);
    } catch (e: any) {
      console.error('[prospection/prospects]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Génère le PLAN de séquence par IA (canal intelligent : email + LinkedIn, branches
  // conditionnelles, rationale) — Brand DNA + campagne — et le sauvegarde directement.
  app.post('/api/prospection/campaigns/:id/generate-sequence', isAuthenticated, async (req: any, res) => {
    try {
      if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      const campaignId = Number(req.params.id);
      const campaign = await storage.getProspectionCampaign(campaignId);
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const plan = await generateSequencePlan(req.userId, campaignId);
      if (plan.steps.length === 0) return res.status(502).json({ message: 'generation_failed' });
      await storage.saveSequencePlan(campaignId, req.userId, plan);
      res.json({ rationale: plan.rationale, steps: await storage.getSequenceSteps(campaignId) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Remplace toute la séquence d'une campagne (builder côté UI)
  app.put('/api/prospection/campaigns/:id/sequence', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      // Validation minimale : une étape doit porter soit un message tout fait (ancien flux —
      // builder à plat avec sujet/corps rédigés à la main), soit une intention de plan (nouveau
      // flux — timeline visuelle, Task 5 : le texte réel est généré par prospect, cf. Aperçu).
      const cleaned = steps
        .filter((s: any) => {
          const hasBody = typeof s?.bodyTemplate === 'string' && s.bodyTemplate.trim();
          const hasIntention = typeof s?.intention === 'string' && s.intention.trim();
          return hasBody || hasIntention;
        })
        .map((s: any, i: number) => ({
          stepOrder: i + 1,
          channel: s.channel === 'linkedin' ? 'linkedin' : 'email',
          delayDays: Math.max(0, Number(s.delayDays) || 0),
          subjectTemplate: s.subjectTemplate ?? null,
          bodyTemplate: typeof s.bodyTemplate === 'string' && s.bodyTemplate.trim() ? s.bodyTemplate : null,
          intention: typeof s.intention === 'string' && s.intention.trim() ? s.intention.trim() : null,
          condition: SEQUENCE_STEP_CONDITIONS.has(s.condition) ? s.condition : 'always',
        }));
      const saved = await storage.replaceSequenceSteps(campaign.id, req.userId, cleaned);
      res.json(saved);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Enrôle un lead dans la séquence de sa campagne
  // Valide un prospect : accord EXPLICITE de l'utilisatrice pour le contacter.
  // C'est la seule decision du pipeline reservee a une personne (prospection-validation.ts).
  app.post('/api/leads/:id/validate', isAuthenticated, async (req: any, res) => {
    try {
      const updated = await storage.updateLead(Number(req.params.id), req.userId, {
        validatedAt: new Date(),
      } as any);
      if (!updated) return res.status(404).json({ message: 'not_found' });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Retire la validation. Un message approuve par erreur doit pouvoir etre retenu tant qu'il
  // n'est pas parti — sans cette route, l'accord serait irrevocable.
  app.post('/api/leads/:id/unvalidate', isAuthenticated, async (req: any, res) => {
    try {
      const updated = await storage.updateLead(Number(req.params.id), req.userId, {
        validatedAt: null,
      } as any);
      if (!updated) return res.status(404).json({ message: 'not_found' });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/leads/:id/enroll', isAuthenticated, async (req: any, res) => {
    try {
      const lead = (await storage.getLeads(req.userId)).find(l => l.id === Number(req.params.id));
      if (!lead) return res.status(404).json({ message: 'not_found' });

      // LA BARRIERE. L'enrolement est la porte par laquelle un prospect entre en sequence,
      // donc le dernier point ou l'on peut encore refuser. Elle exige DEUX conditions :
      // l'etape `messages_ready` (Naya a redige) ET `validatedAt` (une personne a approuve).
      //
      // LinkedIn n'accorde aucun accord d'automatisation pour les invitations et les
      // messages : un contact part parce que quelqu'un l'a voulu, jamais parce qu'un
      // minuteur est arrive a echeance. C'est aussi la regle de ce depot depuis l'incident
      // des 14 posts publies par erreur.
      if (!peutEtreContacte({ stage: (lead as any).stage, validatedAt: (lead as any).validatedAt })) {
        return res.status(409).json({
          message: 'not_validated',
          stage: (lead as any).stage ?? null,
          validatedAt: (lead as any).validatedAt ?? null,
        });
      }

      const campaignId = Number(req.body?.campaignId) || lead.prospectionCampaignId;
      if (!campaignId) return res.status(400).json({ message: 'no_campaign' });
      const state = await storage.enrollLead(lead.id, campaignId, req.userId);
      if (!state) return res.status(400).json({ message: 'no_sequence_defined' });
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Désenrôle / met en pause un lead
  app.post('/api/leads/:id/unenroll', isAuthenticated, async (req: any, res) => {
    try {
      const state = await storage.getLeadSequenceState(Number(req.params.id));
      if (!state || state.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const updated = await storage.updateLeadSequenceState(Number(req.params.id), { status: 'paused', nextRunAt: null });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // État d'enrôlement d'un lead
  app.get('/api/leads/:id/sequence-state', isAuthenticated, async (req: any, res) => {
    try {
      const state = await storage.getLeadSequenceState(Number(req.params.id));
      if (state && state.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      res.json(state || null);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Réglages d'envoi de l'utilisateur (adresse expéditrice propre — jamais celle de l'app)
  // Résout la clé SendGrid à utiliser pour CE user (sa clé perso, sinon partagée).
  const resolveUserSendgridKey = (prefs: any): string | undefined =>
    (prefs?.prospectionSendgridApiKey ? decryptToken(prefs.prospectionSendgridApiKey) : null)
      || process.env.SENDGRID_API_KEY || undefined;

  app.get('/api/prospection/sender', isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await storage.getUserPreferences(req.userId);
      const email = prefs?.prospectionSenderEmail || '';
      const verificationStatus = email
        ? await getSenderStatus(resolveUserSendgridKey(prefs), email)
        : 'none';
      res.json({
        senderEmail: email,
        senderName: prefs?.prospectionSenderName || '',
        address: (prefs as any)?.prospectionSenderAddress || '',
        city: (prefs as any)?.prospectionSenderCity || '',
        country: (prefs as any)?.prospectionSenderCountry || '',
        hasOwnKey: !!(prefs as any)?.prospectionSendgridApiKey, // on ne renvoie jamais la clé
        verificationStatus, // verified | pending | none | unknown
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/prospection/sender', isAuthenticated, async (req: any, res) => {
    try {
      const { senderEmail, senderName, sendgridApiKey, address, city, country } = req.body || {};
      const data: any = {};
      if (typeof senderEmail === 'string') data.prospectionSenderEmail = senderEmail.trim() || null;
      if (typeof senderName === 'string') data.prospectionSenderName = senderName.trim() || null;
      if (typeof address === 'string') data.prospectionSenderAddress = address.trim() || null;
      if (typeof city === 'string') data.prospectionSenderCity = city.trim() || null;
      if (typeof country === 'string') data.prospectionSenderCountry = country.trim() || null;
      // Clé : chiffrée si fournie non vide ; effacée si chaîne vide ; inchangée si absente.
      if (typeof sendgridApiKey === 'string') {
        data.prospectionSendgridApiKey = sendgridApiKey.trim() ? encryptToken(sendgridApiKey.trim()) : null;
      }
      await storage.updateUserPreferences(req.userId, data);

      // Auto-vérification : si une adresse est définie et pas encore vérifiée, on déclenche
      // l'email de vérification SendGrid (Single Sender). Non bloquant.
      const prefs = await storage.getUserPreferences(req.userId);
      const email = prefs?.prospectionSenderEmail;
      let verificationStatus: string = 'none';
      let verificationTriggered = false;
      if (email) {
        const key = resolveUserSendgridKey(prefs);
        verificationStatus = await getSenderStatus(key, email);
        if (verificationStatus === 'none' && (prefs as any)?.prospectionSenderAddress && (prefs as any)?.prospectionSenderCity && (prefs as any)?.prospectionSenderCountry) {
          const r = await createSingleSender(key, {
            email,
            name: prefs?.prospectionSenderName || '',
            address: (prefs as any).prospectionSenderAddress,
            city: (prefs as any).prospectionSenderCity,
            country: (prefs as any).prospectionSenderCountry,
          });
          if (r.ok) { verificationStatus = 'pending'; verificationTriggered = true; }
        }
      }
      res.json({ ok: true, verificationStatus, verificationTriggered });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Renvoyer l'email de vérification de l'adresse expéditrice
  app.post('/api/prospection/sender/verify', isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await storage.getUserPreferences(req.userId);
      const email = prefs?.prospectionSenderEmail;
      if (!email) return res.status(400).json({ message: 'no_sender_email' });
      const key = resolveUserSendgridKey(prefs);
      const status = await getSenderStatus(key, email);
      if (status === 'verified') return res.json({ verificationStatus: 'verified' });
      if (!(prefs as any)?.prospectionSenderAddress || !(prefs as any)?.prospectionSenderCity || !(prefs as any)?.prospectionSenderCountry) {
        return res.status(400).json({ message: 'address_required' });
      }
      const r = await createSingleSender(key, {
        email, name: prefs?.prospectionSenderName || '',
        address: (prefs as any).prospectionSenderAddress,
        city: (prefs as any).prospectionSenderCity,
        country: (prefs as any).prospectionSenderCountry,
      });
      if (!r.ok) return res.status(400).json({ message: r.error });
      res.json({ verificationStatus: 'pending' });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Consignes de rédaction GLOBALES (toutes campagnes) — cumulées avec l'override par
  // campagne (prospectionCampaigns.messageInstructions) au moment de la génération.
  app.get('/api/prospection/writing-instructions', isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await storage.getUserPreferences(req.userId);
      res.json({ global: (prefs as any)?.messageInstructions || '' });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put('/api/prospection/writing-instructions', isAuthenticated, async (req: any, res) => {
    try {
      const { global: globalInstructions } = req.body || {};
      if (typeof globalInstructions !== 'string') return res.status(400).json({ message: 'global (string) requis' });
      const next = globalInstructions.trim() || null;
      const prevPrefs = await storage.getUserPreferences(req.userId);
      const prev = (prevPrefs as any)?.messageInstructions ?? null;
      await storage.updateUserPreferences(req.userId, { messageInstructions: next });
      // Les consignes globales ont changé → le cache lead_step_messages est périmé : on le purge
      // pour que le prochain aperçu/envoi régénère avec les nouvelles règles. No-op si inchangé.
      if (next !== prev) await storage.purgeLeadStepMessagesForUser(req.userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Connexion LinkedIn (Unipile) — chaque utilisateur connecte SON propre compte ──
  app.get('/api/prospection/linkedin/status', isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await storage.getUserPreferences(req.userId);
      res.json({
        configured: linkedinConfigured(),
        connected: !!(prefs as any)?.linkedinUnipileAccountId,
        // Garde de risque : compte en pause suite à un signal LinkedIn (auth/restriction/
        // challenge). Reprise UNIQUEMENT via /clear-restriction (action humaine explicite).
        restricted: !!(prefs as any)?.linkedinRestrictedAt,
        restrictedAt: (prefs as any)?.linkedinRestrictedAt ?? null,
        restrictedReason: (prefs as any)?.linkedinRestrictedReason ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Action humaine EXPLICITE pour lever une pause de restriction LinkedIn. Jamais
  // appelé automatiquement par le worker — cf. prospection-linkedin-guard.ts : une
  // retentative automatique après un refus de LinkedIn est précisément ce qui
  // transforme une restriction temporaire en permanente.
  app.post('/api/prospection/linkedin/clear-restriction', isAuthenticated, async (req: any, res) => {
    try {
      await storage.updateUserPreferences(req.userId, {
        linkedinRestrictedAt: null,
        linkedinRestrictedReason: null,
      } as any);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Génère le lien hébergé pour connecter son compte LinkedIn.
  app.post('/api/prospection/linkedin/connect-link', isAuthenticated, async (req: any, res) => {
    try {
      if (!linkedinConfigured()) return res.status(400).json({ message: 'linkedin_not_configured' });
      const url = await generateConnectLink(req.userId);
      if (!url) return res.status(502).json({ message: 'link_generation_failed' });
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Après connexion : retrouve le compte LinkedIn de l'utilisateur (tagué name=userId) et le stocke.
  app.post('/api/prospection/linkedin/sync', isAuthenticated, async (req: any, res) => {
    try {
      if (!linkedinConfigured()) return res.status(400).json({ message: 'linkedin_not_configured' });
      const accounts = await listUnipileAccounts();
      const mine = accounts.find(a => a.name === req.userId)
        || (accounts.length === 1 ? accounts[0] : undefined);
      if (!mine) return res.status(404).json({ message: 'no_linkedin_account_found' });
      const prevPrefs = await storage.getUserPreferences(req.userId);
      const prevAccountId = (prevPrefs as any)?.linkedinUnipileAccountId;
      // `linkedinAccountConnectedAt` est le point de départ de la montée en charge
      // (prospection-linkedin-guard.ts) : on ne le pose QUE pour un compte réellement
      // NOUVEAU (id différent ou jamais connecté). Reconnecter le MÊME compte (ex. après
      // un renouvellement de session Unipile) ne doit pas réinitialiser le ramp-up.
      const isNewAccount = prevAccountId !== mine.id;
      // RÉTRO-REMPLISSAGE (revue post-commit 261835e, Important 2) : un compte connecté
      // AVANT l'introduction de ce champ a `linkedinUnipileAccountId` posé et
      // `linkedinAccountConnectedAt` NULL pour toujours — la garde refuserait alors
      // indéfiniment (`account_connection_unknown`), en silence, sans jamais se corriger
      // d'elle-même. On pose `now()` dès qu'on revoit ce compte au sync, MÊME s'il n'est
      // pas nouveau, tant que la date manque encore. Choix conservateur assumé : on ne
      // connaît pas la VRAIE date de connexion d'un compte pré-migration, donc on le
      // traite comme flambant neuf (ramp-up reparti à zéro) plutôt que de risquer de le
      // supposer mature à tort — c'est plus lent, jamais plus risqué.
      const needsConnectedAtRetrofill = !isNewAccount && !(prevPrefs as any)?.linkedinAccountConnectedAt;
      await storage.updateUserPreferences(req.userId, {
        linkedinUnipileAccountId: mine.id,
        ...((isNewAccount || needsConnectedAtRetrofill) ? { linkedinAccountConnectedAt: new Date() } : {}),
      } as any);
      res.json({ connected: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Analytics d'une campagne de prospection (taux d'ouverture / réponse…)
  app.get('/api/prospection/campaigns/:id/analytics', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const leadsForCampaign = (await storage.getLeads(req.userId)).filter(l => (l as any).prospectionCampaignId === campaign.id);
      const ids = leadsForCampaign.map(l => l.id);
      const msgs = await storage.getOutreachForLeads(ids);
      const sent = msgs.filter(m => m.sentAt).length;
      const opened = msgs.filter(m => (m as any).openedAt).length;
      const clicked = msgs.filter(m => (m as any).clickedAt).length;
      const bounced = msgs.filter(m => (m as any).bouncedAt).length;
      const replied = leadsForCampaign.filter(l => ['connected', 'in_discussion', 'proposal_sent', 'signed'].includes((l as any).stage)).length;
      const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
      const detail = await storage.getCampaignStepAnalytics(campaign.id);
      res.json({
        leads: leadsForCampaign.length, sent, opened, clicked, bounced, replied,
        openRate: pct(opened, sent), clickRate: pct(clicked, sent), replyRate: pct(replied, sent), bounceRate: pct(bounced, sent),
        byStep: detail.byStep, byChannel: detail.byChannel,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // État d'enrôlement groupé de la campagne — alimente les badges de statut par prospect dans
  // l'onglet Prospects (sélection manuelle) sans faire un aller-retour par lead.
  app.get('/api/prospection/campaigns/:id/enrollments', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const rows = await storage.getEnrollmentsByCampaign(campaign.id);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Enrôlement manuel groupé : le owner choisit exactement quels prospects entrent dans la
  // séquence (contrairement à /launch, qui enrôle TOUS les prospects de la campagne). Même
  // logique de skip que /launch (états actifs/terminés/ayant répondu jamais ré-enrôlés).
  app.post('/api/prospection/campaigns/:id/enroll', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const steps = await storage.getSequenceSteps(campaign.id);
      if (steps.length === 0) return res.status(400).json({ message: 'no_sequence_defined' });

      const leadIds: number[] = Array.isArray(req.body?.leadIds)
        ? req.body.leadIds.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n))
        : [];
      const campaignLeadIds = new Set(
        (await storage.getLeads(req.userId))
          .filter(l => (l as any).prospectionCampaignId === campaign.id)
          .map(l => l.id),
      );

      let enrolled = 0, skipped = 0;
      for (const leadId of leadIds) {
        if (!campaignLeadIds.has(leadId)) { skipped++; continue; } // n'appartient pas à cette campagne
        const existing = await storage.getLeadSequenceState(leadId);
        if (existing && ['active', 'stopped_replied', 'completed'].includes(existing.status)) { skipped++; continue; }
        const st = await storage.enrollLead(leadId, campaign.id, req.userId);
        if (st) enrolled++; else skipped++;
      }
      res.json({ enrolled, skipped });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Lance la séquence : enrôle en masse les leads de la campagne (action "launch" lemlist)
  app.post('/api/prospection/campaigns/:id/launch', isAuthenticated, async (req: any, res) => {
    try {
      const campaign = await storage.getProspectionCampaign(Number(req.params.id));
      if (!campaign || campaign.userId !== req.userId) return res.status(404).json({ message: 'not_found' });
      const steps = await storage.getSequenceSteps(campaign.id);
      if (steps.length === 0) return res.status(400).json({ message: 'no_sequence_defined' });

      const campaignLeads = (await storage.getLeads(req.userId)).filter(l => (l as any).prospectionCampaignId === campaign.id);
      let enrolled = 0, skipped = 0;
      for (const lead of campaignLeads) {
        const existing = await storage.getLeadSequenceState(lead.id);
        if (existing && ['active', 'stopped_replied', 'completed'].includes(existing.status)) { skipped++; continue; }
        const st = await storage.enrollLead(lead.id, campaign.id, req.userId);
        if (st) enrolled++; else skipped++;
      }
      res.json({ enrolled, skipped, total: campaignLeads.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Webhook SendGrid (tracking : ouvertures / clics / bounces) ─────────────
  // Pas d'auth (appelé par SendGrid). Corrélation via custom_args.leadId.
  app.post('/api/sendgrid/webhook', async (req, res) => {
    try {
      const events = Array.isArray(req.body) ? req.body : [];
      for (const ev of events) {
        const leadId = Number(ev?.leadId);
        if (!leadId) continue;
        const msg = await storage.getLatestOutreachByLead(leadId);
        if (!msg) continue;
        const when = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();
        if (ev.event === 'open') {
          if (!(msg as any).openedAt) await storage.updateOutreachMessage(msg.id, { openedAt: when } as any);
        } else if (ev.event === 'click') {
          await storage.updateOutreachMessage(msg.id, { clickedAt: when } as any);
        } else if (['bounce', 'dropped', 'spamreport'].includes(ev.event)) {
          await storage.updateOutreachMessage(msg.id, { bouncedAt: when } as any);
          // Stop : ne plus envoyer à une adresse morte / plainte.
          await storage.updateLeadSequenceState(leadId, { status: 'bounced', nextRunAt: null }).catch(() => {});
        }
      }
      res.json({ received: true });
    } catch (e: any) {
      console.error('[SendGrid webhook]', e.message);
      res.status(500).json({ error: 'webhook_failed' });
    }
  });

  // Enrichit un lead avec audit 6 sections + 3 messages
  // Enrichissement d'UN prospect — unifié sur le pipeline complet (scraping Bright Data +
  // audit Sonnet adapté + message + tracking + gate 2-niveaux). Nécessite une campagne (contexte).
  app.post('/api/leads/:id/enrich', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (await isAiBlocked(userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
      const leadId = Number(req.params.id);
      const lead = await storage.getLead(leadId, userId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (!lead.prospectionCampaignId) {
        return res.status(400).json({ message: 'Associe d’abord ce prospect à une campagne pour l’enrichir.' });
      }
      const campaign = await storage.getProspectionCampaign(lead.prospectionCampaignId);
      if (!campaign || campaign.userId !== userId) return res.status(404).json({ message: 'campaign_not_found' });

      await enrichProspects(userId, campaign, [leadId]);
      const updated = await storage.getLead(leadId, userId);
      res.json(updated);
    } catch (e: any) {
      const gated = prospectionErrorResponse(e);
      if (gated) return res.status(gated.status).json(gated.body);
      console.error('[prospection/enrich]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Outreach routes
  app.get('/api/outreach', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { leadId } = req.query;
      const messages = await storage.getOutreachMessages(userId, leadId ? parseInt(leadId as string) : undefined);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching outreach messages:", error);
      res.status(500).json({ message: "Failed to fetch outreach messages" });
    }
  });

  app.post('/api/outreach', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const messageData = insertOutreachMessageSchema.parse({ ...req.body, userId });
      const message = await storage.createOutreachMessage(messageData);
      res.json(message);
    } catch (error) {
      console.error("Error creating outreach message:", error);
      res.status(500).json({ message: "Failed to create outreach message" });
    }
  });

  app.patch('/api/outreach/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const message = await storage.updateOutreachMessage(parseInt(id), updates);
      res.json(message);
    } catch (error) {
      console.error("Error updating outreach message:", error);
      res.status(500).json({ message: "Failed to update outreach message" });
    }
  });

  // AI-powered outreach message generation
  app.post('/api/outreach/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { leadInfo, messageType, goal } = req.body;
      
      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA not configured. Please complete onboarding first." });
      }

      const { projectContext: outreachProjCtx, personaContext: outreachPersonaCtx } = await fetchAIContext(userId,
        req.body.projectId ? parseInt(req.body.projectId) : undefined
      );

      let aiResponse;
      
      try {
        // Try OpenAI first for outreach generation
        aiResponse = await generateOutreachMessage({
          userId,
          leadInfo,
          messageType,
          goal,
          projectContext: outreachProjCtx,
          personaContext: outreachPersonaCtx,
          brandDna: {
            // New comprehensive fields
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
            currentChallenges: brandDna.currentChallenges || undefined,
            pastSuccess: brandDna.pastSuccess || undefined,
            inspiration: brandDna.inspiration || undefined,
            
            // Legacy fields for backward compatibility
            tone: brandDna.tone,
            contentPillars: brandDna.contentPillars || [],
            audience: brandDna.audience || "",
            painPoints: brandDna.painPoints || [],
            desires: brandDna.desires || [],
            offer: brandDna.offer || "",
            businessGoal: brandDna.businessGoal || "",
          },
        });
      } catch (aiError: any) {
        console.error("Claude AI error lors de la génération du message outreach:", aiError.message);
        // Fallback statique — Claude était indisponible
        aiResponse = {
          subject: `Collaboration avec ${leadInfo.company || leadInfo.name}`,
          body: `Bonjour ${leadInfo.name},\n\nJe souhaitais vous contacter au sujet d'une opportunité de collaboration.\n\nSeriez-vous disponible pour un échange cette semaine ?\n\nCordialement`,
          followUp: "Relancer dans 3-5 jours si pas de réponse",
          reasoning: "Message généré en mode fallback (IA indisponible)"
        };
      }

      res.json(aiResponse);
    } catch (error) {
      console.error("Error generating outreach message:", error);
      res.status(500).json({ message: "Failed to generate outreach message" });
    }
  });

  // Analytics routes
  app.get('/api/metrics', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { week } = req.query;
      const metrics = await storage.getMetrics(userId, week as string);

      // Aucune métrique réelle (l'ingestion n'est pas branchée) → état vide EXPLICITE.
      // On ne fabrique plus de chiffres fictifs (engagement_rate, reach…) qui s'afficheraient
      // comme s'ils étaient réels. Les consommateurs doivent gérer null = « pas de données ».
      if (!metrics) {
        return res.json(null);
      }

      res.json(metrics);
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  app.get('/api/metrics/history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { weeks = '4' } = req.query;
      const numWeeks = parseInt(weeks as string) || 4;
      
      // For demo purposes, generate sample data based on current metrics
      const currentMetrics = await storage.getMetrics(userId);
      const historicalMetrics = [];
      
      for (let i = 0; i < numWeeks; i++) {
        const weekDate = new Date();
        weekDate.setDate(weekDate.getDate() - (i * 7));
        const year = weekDate.getFullYear();
        const weekNum = Math.ceil(weekDate.getDate() / 7);
        const week = `${year}-W${weekNum.toString().padStart(2, '0')}`;
        
        // Create simulated data with some variation
        const variation = 0.8 + Math.random() * 0.4; // 80% to 120% of base values
        
        if (currentMetrics) {
          const cm = currentMetrics.contentMetrics as any;
          const om = currentMetrics.outreachMetrics as any;
          historicalMetrics.push({
            week,
            contentMetrics: {
              engagement_rate: Math.round((cm?.engagement_rate || 25) * variation),
              total_reach: Math.round((cm?.total_reach || 1000) * variation),
              instagram_reach: Math.round((cm?.instagram_reach || 500) * variation),
              linkedin_reach: Math.round((cm?.linkedin_reach || 300) * variation),
            },
            outreachMetrics: {
              leads_generated: Math.round((om?.leads_generated || 5) * variation),
              conversion_rate: Math.round((om?.conversion_rate || 15) * variation),
              response_rate: Math.round((om?.response_rate || 30) * variation),
              direct_outreach: Math.round((om?.direct_outreach || 10) * variation),
            },
            emailMetrics: {
              open_rate: Math.round(((currentMetrics.emailMetrics as any)?.open_rate || 45) * variation),
              total_sent: Math.round(((currentMetrics.emailMetrics as any)?.total_sent || 50) * variation),
            },
            goals: currentMetrics.goals || {
              monthly_leads: 20,
              engagement_rate: 50,
              conversion_rate: 15
            }
          });
        } else {
          // Default data if no current metrics exist
          historicalMetrics.push({
            week,
            contentMetrics: { 
              engagement_rate: Math.round(25 * variation), 
              total_reach: Math.round(1000 * variation),
              instagram_reach: Math.round(500 * variation),
              linkedin_reach: Math.round(300 * variation),
            },
            outreachMetrics: { 
              leads_generated: Math.round(5 * variation), 
              conversion_rate: Math.round(15 * variation), 
              response_rate: Math.round(30 * variation),
              direct_outreach: Math.round(10 * variation),
            },
            emailMetrics: { 
              open_rate: Math.round(45 * variation), 
              total_sent: Math.round(50 * variation) 
            },
            goals: {
              monthly_leads: 20,
              engagement_rate: 50,
              conversion_rate: 15
            }
          });
        }
      }
      
      res.json(historicalMetrics.reverse()); // Most recent first
    } catch (error) {
      console.error("Error fetching historical metrics:", error);
      res.status(500).json({ message: "Failed to fetch historical metrics" });
    }
  });

  app.get('/api/analytics/insights', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA not configured." });
      }

      // Use the performance monitor service to get insights
      const performanceMonitor = new (await import('./services/performance-monitor')).PerformanceMonitorService();
      const insights = await performanceMonitor.analyzeCurrentPerformance(userId);
      
      res.json(insights);
    } catch (error) {
      console.error("Error fetching performance insights:", error);
      res.status(500).json({ message: "Failed to fetch performance insights" });
    }
  });

  app.get('/api/strategy-report', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { week } = req.query;
      const report = await storage.getStrategyReport(userId, week as string);
      res.json(report);
    } catch (error) {
      console.error("Error fetching strategy report:", error);
      res.status(500).json({ message: "Failed to fetch strategy report" });
    }
  });

  function computeWeekStart(tzOffset?: string): string {
    let now: Date;
    if (tzOffset) {
      const offsetMin = parseInt(tzOffset, 10);
      if (!isNaN(offsetMin)) {
        now = new Date(Date.now() - offsetMin * 60 * 1000);
      } else {
        now = new Date();
      }
    } else {
      now = new Date();
    }
    const day = now.getUTCDay();
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - (day === 0 ? 6 : day - 1));
    return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
  }

  app.get('/api/strategy/weekly-briefing', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const weekStr = computeWeekStart(req.query.tzOffset as string);

      const briefing = await storage.getWeeklyBriefing(userId, weekStr);
      res.json(briefing || null);
    } catch (error) {
      console.error("Error fetching weekly briefing:", error);
      res.status(500).json({ message: "Failed to fetch weekly briefing" });
    }
  });

  app.post('/api/strategy/generate-weekly-briefing', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const weekStr = computeWeekStart(req.body?.tzOffset || req.query?.tzOffset);

      const existing = await storage.getWeeklyBriefing(userId, weekStr);
      if (existing) {
        return res.json(existing);
      }

      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.json({ needsOnboarding: true });
      }

      const now = new Date();
      const projects = await storage.getProjects(userId);
      const activeProjects = projects.filter(p => p.projectStatus === 'active');

      const projectSummaries = await Promise.all(
        activeProjects.slice(0, 5).map(async (p) => {
          const goals = await storage.getActiveGoalsForProject(p.id);
          const topGoal = goals[0];
          return {
            name: p.name,
            type: p.type,
            priorityLevel: p.priorityLevel || 'secondary',
            activeGoalTitle: topGoal?.title,
            activeGoalSuccessMode: topGoal?.successMode,
          };
        })
      );

      const twoWeeksAgo = new Date(now);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const twoWeeksAgoStr = `${twoWeeksAgo.getFullYear()}-${String(twoWeeksAgo.getMonth() + 1).padStart(2, '0')}-${String(twoWeeksAgo.getDate()).padStart(2, '0')}`;
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const recentTasks = await storage.getTasksInRange(userId, twoWeeksAgoStr, todayStr);
      const recentCompletedTasks = recentTasks
        .filter(t => t.completed)
        .map(t => ({
          title: t.title,
          type: t.type,
          category: t.category,
          completedAt: t.completedAt ? t.completedAt.toISOString() : undefined,
        }));

      const recentIncompleteTasks = recentTasks
        .filter(t => !t.completed && t.scheduledDate && t.scheduledDate < todayStr)
        .map(t => ({
          title: t.title,
          type: t.type,
          scheduledDate: t.scheduledDate || undefined,
        }));

      const campaigns = await storage.getCampaigns(userId);
      const activeCampaigns = campaigns
        .filter(c => c.status === 'active')
        .map(c => ({
          name: c.name,
          status: c.status || 'active',
          startDate: c.startDate || undefined,
          endDate: c.endDate || undefined,
        }));

      const operatingProfileSummary = await getOperatingProfileSummary(userId);

      const result = await generateWeeklyBriefing({
        userId,
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
          tone: brandDna.tone,
          contentPillars: brandDna.contentPillars || [],
          audience: brandDna.audience || '',
          businessGoal: brandDna.businessGoal || '',
        },
        projectSummaries,
        recentCompletedTasks,
        recentIncompleteTasks,
        activeCampaigns,
        operatingProfileSummary,
      });

      const raceCheck = await storage.getWeeklyBriefing(userId, weekStr);
      if (raceCheck) {
        return res.json(raceCheck);
      }

      let report;
      try {
        report = await storage.createStrategyReport({
          userId,
          projectId: null,
          week: weekStr,
          focus: result.strategicFocus,
          reasoning: result.energyNote,
          recommendations: result.doingWell,
          weeklyPlan: {
            type: 'weekly_briefing',
            doingWell: result.doingWell,
            risks: result.risks,
            recommendedMoves: result.recommendedMoves,
            energyNote: result.energyNote,
          },
          dismissed: false,
        });
      } catch (insertErr: any) {
        if (insertErr?.code === '23505') {
          const fallback = await storage.getWeeklyBriefing(userId, weekStr);
          return res.json(fallback);
        }
        throw insertErr;
      }

      res.json(report);
    } catch (error) {
      console.error("Error generating weekly briefing:", error);
      res.status(500).json({ message: "Failed to generate weekly briefing" });
    }
  });

  app.patch('/api/strategy/weekly-briefing/dismiss', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const weekStr = computeWeekStart(req.body?.tzOffset || req.query?.tzOffset);

      await storage.dismissWeeklyBriefing(userId, weekStr);
      res.json({ dismissed: true });
    } catch (error) {
      console.error("Error dismissing weekly briefing:", error);
      res.status(500).json({ message: "Failed to dismiss weekly briefing" });
    }
  });

  app.get('/api/analytics/metrics', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { week } = req.query;
      const metrics = await storage.getMetrics(userId, week as string);
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  app.get('/api/analytics/content-performance', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      const content = await storage.getContent(userId, 30);
      
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA not configured." });
      }

      const analysis = await analyzeContentPerformance(content, {
        // New comprehensive fields
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
        currentChallenges: brandDna.currentChallenges || undefined,
        pastSuccess: brandDna.pastSuccess || undefined,
        inspiration: brandDna.inspiration || undefined,
        
        // Legacy fields for backward compatibility
        tone: brandDna.tone,
        contentPillars: brandDna.contentPillars || [],
        audience: brandDna.audience || "",
        painPoints: brandDna.painPoints || [],
        desires: brandDna.desires || [],
        offer: brandDna.offer || "",
        businessGoal: brandDna.businessGoal || "",
      }, userId);

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing content performance:", error);
      res.status(500).json({ message: "Failed to analyze content performance" });
    }
  });

  app.get('/api/analytics/project-summary', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId } = req.query;
      let pid: number | undefined;
      if (projectId) {
        const parsed = Number(projectId);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ message: "Invalid projectId" });
        }
        pid = parsed;
      }

      const allTasks = await storage.getTasks(userId, undefined, pid);
      const totalTasks = allTasks.length;
      const completedTasks = allTasks.filter(t => t.completed).length;
      const pendingTasks = totalTasks - completedTasks;
      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const tasksByEnergy: Record<string, number> = {};
      const tasksByType: Record<string, number> = {};
      for (const t of allTasks) {
        const ek = t.taskEnergyType || 'other';
        tasksByEnergy[ek] = (tasksByEnergy[ek] || 0) + 1;
        tasksByType[t.type] = (tasksByType[t.type] || 0) + 1;
      }

      const allContent = await storage.getContent(userId, 500, pid);
      const contentByStatus: Record<string, number> = { idea: 0, draft: 0, ready: 0, published: 0 };
      for (const c of allContent) {
        const s = (c.contentStatus || 'idea') as string;
        if (s in contentByStatus) contentByStatus[s]++;
      }
      const contentByPlatform: Record<string, number> = {};
      for (const c of allContent) {
        contentByPlatform[c.platform] = (contentByPlatform[c.platform] || 0) + 1;
      }

      const allCampaigns = await storage.getCampaigns(userId, pid);
      const activeCampaigns = allCampaigns.filter(c => c.status === 'active').length;
      const completedCampaigns = allCampaigns.filter(c => c.status === 'completed').length;
      const draftCampaigns = allCampaigns.filter(c => c.status === 'draft').length;
      const totalCampaignTasks = allCampaigns.reduce((sum, c) => {
        return sum + ((c.generatedTasks as unknown[])?.length || 0);
      }, 0);

      const now = new Date();
      const currentWeek = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-W' + Math.ceil(now.getDate() / 7);
      const strategyReport = pid
        ? await storage.getStrategyReport(userId, currentWeek, pid)
        : await storage.getStrategyReport(userId, currentWeek);

      const weeklyCompletion: Array<{ week: string; completed: number; total: number }> = [];
      for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const weekLabel = i === 0 ? 'This week' : `W-${i}`;
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekStartStr = weekStart.toISOString().slice(0, 10);
        const weekEndStr = weekEnd.toISOString().slice(0, 10);
        const weekTasks = allTasks.filter(t => t.scheduledDate && t.scheduledDate >= weekStartStr && t.scheduledDate <= weekEndStr);
        weeklyCompletion.push({
          week: weekLabel,
          completed: weekTasks.filter(t => t.completed).length,
          total: weekTasks.length,
        });
      }

      res.json({
        tasks: { total: totalTasks, completed: completedTasks, pending: pendingTasks, completionRate, byEnergy: tasksByEnergy, byType: tasksByType },
        content: { total: allContent.length, byStatus: contentByStatus, byPlatform: contentByPlatform },
        campaigns: { active: activeCampaigns, completed: completedCampaigns, draft: draftCampaigns, totalTasksGenerated: totalCampaignTasks },
        strategy: strategyReport ? { focus: strategyReport.focus, recommendations: strategyReport.recommendations, weeklyPlan: strategyReport.weeklyPlan } : null,
        weeklyCompletion,
      });
    } catch (error) {
      console.error("Error computing project summary:", error);
      res.status(500).json({ message: "Failed to compute project summary" });
    }
  });

  // Strategy routes
  app.get('/api/strategy/report', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { week } = req.query;
      let projectId: number | null | undefined = undefined;
      if (req.query.projectId !== undefined) {
        projectId = parseInt(req.query.projectId as string);
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: "Invalid projectId" });
      }
      const report = await storage.getStrategyReport(userId, week as string, projectId);
      // ⚠️ Ne JAMAIS renvoyer undefined : res.json(undefined) envoie un corps VIDE, et côté client
      // res.json() fait JSON.parse('') → throw → ErrorBoundary. On renvoie null explicitement.
      res.json(report ?? null);
    } catch (error) {
      console.error("Error fetching strategy report:", error);
      res.status(500).json({ message: "Failed to fetch strategy report" });
    }
  });

  app.post('/api/strategy/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      let projectId: number | null = null;
      if (req.body.projectId !== undefined && req.body.projectId !== null) {
        projectId = parseInt(req.body.projectId);
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: "Invalid projectId" });
      }
      const weekContext = req.body.weekContext || '';

      if (projectId) {
        const project = await storage.getProject(projectId, userId);
        if (!project) {
          return res.status(403).json({ message: "Project not found or access denied" });
        }
      }

      // Fallback sur le DNA global si le projet n'a pas de DNA propre (cas du projet principal).
      const projectDna = projectId ? await storage.getBrandDnaForProject(userId, projectId) : null;
      const dna = projectDna ?? await storage.getBrandDna(userId);
      if (!dna) {
        return res.status(400).json({ message: "Brand DNA not configured for this project." });
      }

      const now = new Date();
      // Clé de semaine UNIQUE (shared/strategy-week) : la clé du client si valide (= celle
      // qu'il interroge à la lecture), sinon la clé serveur partagée. Utilisée pour les
      // MÉTRIQUES ET le RAPPORT → garantit qu'ils emploient la même clé (fin de l'incohérence
      // Math.ceil(jour/7) vs semaine ISO).
      const weekKey = resolveStrategyWeekKey(req.body.week, now);
      const [weeklyMetrics, content, outreach] = await Promise.all([
        storage.getMetrics(userId, weekKey),
        storage.getContent(userId, 20),
        storage.getOutreachMessages(userId),
      ]);

      const aiResponse = await generateStrategyInsights({
        userId,
        brandDna: {
          businessType: dna.businessType,
          businessModel: dna.businessModel,
          revenueUrgency: dna.revenueUrgency,
          targetAudience: dna.targetAudience,
          corePainPoint: dna.corePainPoint,
          audienceAspiration: dna.audienceAspiration,
          authorityLevel: dna.authorityLevel,
          communicationStyle: dna.communicationStyle,
          uniquePositioning: dna.uniquePositioning,
          platformPriority: dna.platformPriority,
          currentPresence: dna.currentPresence,
          primaryGoal: dna.primaryGoal,
          contentBandwidth: dna.contentBandwidth,
          successDefinition: dna.successDefinition,
          currentChallenges: dna.currentChallenges || undefined,
          pastSuccess: dna.pastSuccess || undefined,
          inspiration: dna.inspiration || undefined,
          tone: dna.tone,
          contentPillars: dna.contentPillars || [],
          audience: dna.audience || "",
          painPoints: dna.painPoints || [],
          desires: dna.desires || [],
          offer: dna.offer || "",
          businessGoal: dna.businessGoal || "",
        },
        weeklyMetrics: weeklyMetrics || {},
        contentPerformance: content,
        outreachPerformance: outreach,
        currentGoals: {},
        weekContext,
      });

      const report = await storage.createStrategyReport({
        userId,
        projectId: projectId || undefined,
        week: weekKey,
        focus: aiResponse.weeklyFocus,
        reasoning: aiResponse.insights.join(" "),
        recommendations: aiResponse.recommendations,
        weeklyPlan: aiResponse.nextWeekPlan,
      });

      res.json({ ...aiResponse, report });
    } catch (error) {
      console.error("Error generating strategy insights:", error);
      res.status(500).json({ message: "Failed to generate strategy insights" });
    }
  });

  // Company research routes
  app.post('/api/company/research', isAuthenticated, async (req: any, res) => {
    try {
      const { businessName, website, linkedinProfile, instagramHandle } = req.body;
      const analysis = await companyResearchService.analyzeCompanyOnlinePresence(
        businessName, website, linkedinProfile, instagramHandle
      );
      res.json(analysis);
    } catch (error) {
      console.error("Company research error:", error);
      res.status(500).json({ message: "Failed to analyze company presence" });
    }
  });

  // Social media integration routes
  app.post('/api/social/connect/:platform', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { platform } = req.params;
      const { accessToken, accessSecret } = req.body;
      
      let credentials;
      if (platform === 'instagram') {
        credentials = await socialMediaService.connectInstagramBusiness(accessToken);
      } else if (platform === 'linkedin') {
        credentials = await socialMediaService.connectLinkedIn(accessToken);
      } else if (platform === 'twitter') {
        credentials = await socialMediaService.connectTwitter(accessToken, accessSecret);
      } else if (platform === 'facebook') {
        credentials = await socialMediaService.connectFacebook(accessToken);
      } else {
        return res.status(400).json({ message: "Unsupported platform" });
      }
      
      // Save credentials securely in database
      const socialAccountData = insertSocialAccountSchema.parse({
        userId,
        platform: credentials.platform,
        accountId: credentials.accountId,
        accountName: credentials.accountName,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        permissions: [],
        isActive: true,
        lastSyncAt: new Date()
      });
      
      await storage.createSocialAccount(socialAccountData);
      
      res.json({ success: true, platform: credentials.platform, accountName: credentials.accountName });
    } catch (error) {
      console.error("Social connection error:", error);
      res.status(500).json({ message: `Failed to connect ${req.params.platform}` });
    }
  });

  app.post('/api/social/post', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { platform, content, imageUrl, scheduledFor, socialAccountId } = req.body;
      
      // Get user's stored credentials for platform
      let socialAccount;
      if (socialAccountId) {
        const accounts = await storage.getSocialAccounts(userId);
        socialAccount = accounts.find(acc => acc.id === socialAccountId);
      } else {
        // Find active account for this platform
        const accounts = await storage.getSocialAccounts(userId);
        socialAccount = accounts.find(acc => acc.platform === platform && acc.isActive);
      }
      
      if (!socialAccount) {
        return res.status(400).json({ message: `No connected ${platform} account found. Please connect your account first.` });
      }
      
      // Check if token is expired
      if (socialAccount.expiresAt && new Date() > socialAccount.expiresAt) {
        return res.status(400).json({ message: `${platform} account token has expired. Please reconnect your account.` });
      }
      
      const credentials = {
        platform: socialAccount.platform,
        accessToken: socialAccount.accessToken,
        refreshToken: socialAccount.refreshToken,
        accountId: socialAccount.accountId,
        accountName: socialAccount.accountName
      } as any;
      
      let postId;
      const postData = { platform, content, imageUrl };
      
      if (platform === 'instagram') {
        postId = await socialMediaService.postToInstagram(credentials, postData);
      } else if (platform === 'linkedin') {
        postId = await socialMediaService.postToLinkedIn(credentials, postData);
      } else if (platform === 'twitter') {
        postId = await socialMediaService.postToTwitter(credentials, postData);
      } else if (platform === 'facebook') {
        postId = await socialMediaService.postToFacebook(credentials, postData);
      } else {
        return res.status(400).json({ message: "Unsupported platform" });
      }
      
      res.json({ success: true, postId, platform });
    } catch (error) {
      console.error("Social posting error:", error);
      res.status(500).json({ message: `Failed to post to ${req.body.platform}: ${(error as any).message}` });
    }
  });

  // Publish scheduled content
  app.post('/api/content/:id/publish', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const contentId = parseInt(req.params.id);
      
      // Get the content to publish
      const content = await storage.getContentById(contentId, userId);
      if (!content) {
        return res.status(404).json({ error: "content_not_found", message: "Content not found" });
      }

      if (content.status === 'published') {
        return res.status(400).json({ error: "content_already_published", message: "Content is already published" });
      }

      // Get connected account for this platform
      const accounts = await storage.getSocialAccounts(userId);
      const socialAccount = accounts.find(acc => acc.platform === content.platform && acc.isActive);

      if (!socialAccount) {
        return res.status(400).json({
          error: "social_account_not_connected",
          params: { platform: content.platform },
          message: `No connected ${content.platform} account found. Please connect your account first.`,
        });
      }

      // Check if token is expired
      if (socialAccount.expiresAt && new Date() > socialAccount.expiresAt) {
        return res.status(400).json({
          error: "social_token_expired",
          params: { platform: content.platform },
          message: `${content.platform} account token has expired. Please reconnect your account.`,
        });
      }
      
      const credentials = {
        platform: socialAccount.platform,
        accessToken: socialAccount.accessToken,
        refreshToken: socialAccount.refreshToken,
        accountId: socialAccount.accountId,
        accountName: socialAccount.accountName
      } as any;
      
      // Get media URLs if any
      let imageUrl;
      if (content.mediaIds && Array.isArray(content.mediaIds) && content.mediaIds.length > 0) {
        const media = await storage.getMediaItemById(content.mediaIds[0], userId);
        if (media) {
          imageUrl = media.url;
        }
      }
      
      // Post to platform
      let platformPostId;
      const postData = { 
        platform: content.platform, 
        content: content.body,
        imageUrl 
      };
      
      if (content.platform === 'instagram') {
        platformPostId = await socialMediaService.postToInstagram(credentials, postData);
      } else if (content.platform === 'linkedin') {
        platformPostId = await socialMediaService.postToLinkedIn(credentials, postData);
      } else if (content.platform === 'twitter') {
        platformPostId = await socialMediaService.postToTwitter(credentials, postData);
      } else if (content.platform === 'facebook') {
        platformPostId = await socialMediaService.postToFacebook(credentials, postData);
      } else {
        return res.status(400).json({ message: "Unsupported platform" });
      }
      
      // Update content status
      const updatedContent = await storage.updateContent(contentId, {
        status: 'published',
        publishedAt: new Date(),
        platformPostId,
        postStatus: 'posted'
      });
      
      res.json({ 
        success: true, 
        platformPostId, 
        content: updatedContent,
        message: `Successfully published to ${content.platform}` 
      });
      
    } catch (error) {
      console.error("Content publishing error:", error);
      res.status(500).json({ message: `Failed to publish content: ${(error as any).message}` });
    }
  });

  // Lead scraping routes
  app.post('/api/leads/search', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { criteria } = req.body;
      const brandDna = await storage.getBrandDna(userId);
      
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA required for lead search" });
      }
      
      const leads = await leadScrapingService.findLeads(criteria, brandDna);
      res.json(leads);
    } catch (error) {
      console.error("Lead search error:", error);
      res.status(500).json({ message: "Failed to search for leads" });
    }
  });

  // Email marketing routes
  app.post('/api/email/newsletter/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      const recentContent = await storage.getContent(userId, 10);
      
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA required for newsletter generation" });
      }
      
      const newsletter = await emailMarketingService.generateNewsletterContent(brandDna, recentContent);
      res.json(newsletter);
    } catch (error) {
      console.error("Newsletter generation error:", error);
      res.status(500).json({ message: "Failed to generate newsletter" });
    }
  });

  app.post('/api/email/nurture/create', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const brandDna = await storage.getBrandDna(userId);
      
      if (!brandDna) {
        return res.status(400).json({ message: "Brand DNA required for nurture sequence" });
      }
      
      const sequence = await emailMarketingService.createNurtureSequence(brandDna);
      res.json(sequence);
    } catch (error) {
      console.error("Nurture sequence creation error:", error);
      res.status(500).json({ message: "Failed to create nurture sequence" });
    }
  });

  // Object storage routes for media library
  // Endpoint for serving private objects with ACL protection
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path,
      );
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Endpoint for getting upload URL for media files
  // Diagnostic crash mobile (sans auth) — l'app poste l'erreur JS fatale ici.
  const mobileCrashes: any[] = [];
  app.post("/api/mobile-crash", async (req: any, res) => {
    const entry = { ...(req.body || {}), at: new Date().toISOString() };
    mobileCrashes.unshift(entry);
    if (mobileCrashes.length > 20) mobileCrashes.pop();
    console.error("[MobileCrash]", JSON.stringify(entry).slice(0, 800));
    res.json({ ok: true });
  });
  app.get("/api/mobile-crash", (_req, res) => res.json(mobileCrashes));

  // Upload de médias (image/vidéo) sur Cloudflare R2 — URL présignée pour upload direct.
  app.post("/api/media/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      if (!r2Configured()) return res.status(503).json({ message: "storage_not_configured" });
      const { filename, contentType } = req.body || {};
      if (!filename || !contentType) return res.status(400).json({ message: "filename_and_contentType_required" });
      if (!/^(image|video)\//.test(contentType)) return res.status(400).json({ message: "unsupported_content_type" });
      const out = await createUploadUrl({ userId: req.userId, filename, contentType });
      res.json(out); // { uploadUrl, publicUrl, key }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req: any, res) => {
    try {
      // Validate object storage configuration first
      if (!process.env.PRIVATE_OBJECT_DIR) {
        return res.status(500).json({ 
          error: "Object storage not configured", 
          details: "PRIVATE_OBJECT_DIR environment variable is not set" 
        });
      }
      
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      if (error instanceof Error && error.message.includes('PRIVATE_OBJECT_DIR not set')) {
        return res.status(500).json({ 
          error: "Object storage not configured", 
          details: "Please set up object storage in the Object Storage tool" 
        });
      }
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Endpoint for updating media library after file upload
  app.put("/api/media-library", isAuthenticated, async (req: any, res) => {
    try {
      const { fileUrl, fileName, fileType, fileSize } = req.body;
      
      if (!fileUrl || !fileName) {
        return res.status(400).json({ error: "fileUrl and fileName are required" });
      }

      const userId = req.userId;
      const objectStorageService = new ObjectStorageService();
      
      // CRITICAL: Normalize the uploaded URL and set ACL policy for secure access
      const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
        fileUrl,
        {
          owner: userId,
          visibility: "private", // Media files are private to the user
        },
      );

      // Save media metadata to database with normalized secure path
      const mediaData = insertMediaLibrarySchema.parse({
        userId,
        fileName,
        fileType,
        fileSize: fileSize || 0,
        url: normalizedPath, // Use normalized path, not raw signed URL
      });
      
      const media = await storage.createMediaItem(mediaData);
      res.json(media);
    } catch (error) {
      console.error("Error saving media file:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid request data", errors: (error as any).errors });
      }
      res.status(500).json({ error: "Failed to save media file" });
    }
  });

  // ─── Campaign Routes ──────────────────────────────────────────────────────

  // Étape zéro de la génération : ce avec quoi cette campagne pourrait s'articuler.
  // Réponse vide = aucun lien déclaré → l'interface n'affiche rien et la génération
  // suit son cours inchangé.
  app.get('/api/campaigns/articulation', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.query?.projectId as string, 10);
      if (isNaN(projectId)) return res.status(400).json({ message: "projectId requis" });
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      const articulations: Articulation[] = await articulationsDisponibles(userId, projectId);
      res.json({ articulations });
    } catch (error) {
      console.error('[Liens] GET /api/campaigns/articulation:', error);
      res.status(500).json({ message: "Failed to fetch articulation options" });
    }
  });

  app.get('/api/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId } = req.query;
      let pid: number | undefined;
      if (projectId) {
        const parsed = Number(projectId);
        if (!Number.isFinite(parsed) || parsed <= 0) return res.status(400).json({ message: "Invalid projectId" });
        pid = parsed;
      }
      const result = await storage.getCampaigns(userId, pid);
      res.json(result);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  app.post('/api/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId } = req.body;
      if (projectId) {
        const pid = Number(projectId);
        if (!Number.isFinite(pid) || pid <= 0) return res.status(400).json({ message: "Invalid projectId" });
        const project = await storage.getProject(pid, userId);
        if (!project) return res.status(404).json({ message: "Project not found" });
      }
      const campaign = await storage.createCampaign({ ...req.body, userId });
      res.json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ message: "Failed to create campaign" });
    }
  });

  app.patch('/api/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const existing = await storage.getCampaign(id, userId);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      const updated = await storage.updateCampaign(id, userId, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating campaign:", error);
      res.status(500).json({ message: "Failed to update campaign" });
    }
  });

  app.patch('/api/campaigns/:id/review', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const { contentQuality, audienceResponse, taskExecution } = req.body;
      const validate = (v: any) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
      if (!validate(contentQuality) || !validate(audienceResponse) || !validate(taskExecution)) {
        return res.status(400).json({ message: "All three ratings (contentQuality, audienceResponse, taskExecution) must be integers from 1 to 5" });
      }
      const existing = await storage.getCampaign(id, userId);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      const updated = await storage.updateCampaign(id, userId, {
        reviewContentQuality: contentQuality,
        reviewAudienceResponse: audienceResponse,
        reviewTaskExecution: taskExecution,
        reviewedAt: new Date(),
        status: 'completed',
      });
      res.json(updated);
    } catch (error) {
      console.error("Error reviewing campaign:", error);
      res.status(500).json({ message: "Failed to save campaign review" });
    }
  });

  app.delete('/api/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const existing = await storage.getCampaign(id, userId);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      await storage.deleteCampaign(id, userId);
      res.json({ message: "Campaign deleted" });
    } catch (error) {
      console.error("Error deleting campaign:", error);
      res.status(500).json({ message: "Failed to delete campaign" });
    }
  });

  // GET /api/campaigns/:id/reject-preview — ce que la confirmation de rejet
  // annonce (tâche 5) avant que l'utilisatrice ne confirme. LECTURE SEULE : aucune
  // table n'est modifiée. Les comptages réutilisent les fonctions pures de
  // `campaign-reject/rejeter.ts` (`trierContenus`/`trierTaches`, verrouillées tâche
  // 1), appliquées à une lecture directe — jamais à `rejeterCampagne`, qui écrit.
  app.get('/api/campaigns/:id/reject-preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      // 404, jamais 403 : la propriété se valide par (id, userId) — motif du
      // dépôt, ne pas révéler l'existence d'une campagne d'autrui.
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      const contenus = await db
        .select({
          id: content.id,
          publishedAt: content.publishedAt,
          postStatus: content.postStatus,
          contentStatus: content.contentStatus,
        })
        .from(content)
        .where(and(eq(content.userId, userId), eq(content.campaignId, id)));

      const tachesBrutes = await db
        .select({ id: tasks.id, completed: tasks.completed })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.campaignId, id)));

      const triContenus = trierContenus(contenus);
      const triTaches = trierTaches(tachesBrutes);

      // Même requête que celle lue dans la transaction de `rejeterCampagne` — ici en
      // lecture simple, puisque rien ne va être supprimé.
      const articulations = await db
        .select({ campagneId: campaigns.id, campagneNom: campaigns.name, marque: projects.name })
        .from(campaigns)
        .leftJoin(projects, eq(campaigns.projectId, projects.id))
        .where(and(eq(campaigns.userId, userId), eq(campaigns.articuleAvecCampaignId, id)));

      // Campagne(s) de prospection liée(s), dans les deux sens (même requête que
      // `rejeterCampagne`) : l'écran de confirmation doit annoncer ce qui part avec le
      // rejet côté prospection — jamais une surprise après coup. LECTURE SEULE ici.
      const conditionsProspection = [eq(prospectionCampaigns.linkedCampaignId, id)];
      if ((campaign as any).linkedProspectionCampaignId) {
        conditionsProspection.push(eq(prospectionCampaigns.id, (campaign as any).linkedProspectionCampaignId));
      }
      const prospectionLiee = await db
        .select({ id: prospectionCampaigns.id, name: prospectionCampaigns.name })
        .from(prospectionCampaigns)
        .where(and(eq(prospectionCampaigns.userId, userId), or(...conditionsProspection)));

      // Les prospects ne sont jamais supprimés par cette cascade, seulement ARCHIVÉS
      // (réversible) — `storage.deleteProspectionCampaign`. Ceux déjà archivés ne
      // comptent pas : ils ne changent pas d'état avec ce rejet.
      let prospectsAArchiver = 0;
      if (prospectionLiee.length > 0) {
        const [ligneProspects] = await db
          .select({ total: count() })
          .from(leads)
          .where(and(
            eq(leads.userId, userId),
            inArray(leads.prospectionCampaignId, prospectionLiee.map((p) => p.id)),
            isNull(leads.archivedAt),
          ));
        prospectsAArchiver = ligneProspects?.total ?? 0;
      }

      res.json({
        contenusGardes: triContenus.gardes.length,
        contenusPartants: triContenus.partants.length,
        tachesGardees: triTaches.gardes.length,
        tachesPartantes: triTaches.partants.length,
        articulationsRompues: articulations.map((a) => ({
          campagneId: a.campagneId,
          campagneNom: a.campagneNom,
          marque: a.marque ?? "",
        })),
        prospectionLiee: prospectionLiee.map((p) => ({ id: p.id, name: p.name })),
        prospectsAArchiver,
      });
    } catch (error) {
      console.error("Error previewing campaign rejection:", error);
      res.status(500).json({ message: "Failed to preview campaign rejection" });
    }
  });

  // POST /api/campaigns/:id/reject — écarte une campagne générée (chantier « rejeter
  // une campagne »). `raison` est FACULTATIVE (Décision 4 du spec) : absente ou
  // blanche, le rejet se fait quand même et `preferenceEcrite` revient à faux —
  // c'est l'écran (tâche 5) qui en informe l'utilisatrice, pas cet endpoint.
  app.post('/api/campaigns/:id/reject', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      // 404, jamais 403 — même motif que ci-dessus. La propriété est vérifiée ICI,
      // avant d'appeler le service : une campagne d'autrui n'est jamais même passée
      // à `rejeterCampagne`.
      const existing = await storage.getCampaign(id, userId);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });

      const raison = typeof req.body?.raison === "string" ? req.body.raison : "";
      const resultat = await rejeterCampagne({ userId, campaignId: id, raison });
      res.json(resultat);
    } catch (error) {
      // `CampagneIntrouvable` reconnue par `instanceof`, JAMAIS par son message —
      // motif repris de `ReponseIllisible` (voir plus haut dans ce fichier). Cas
      // concret : l'utilisatrice ouvre la campagne dans deux onglets, la supprime
      // depuis le premier, puis clique « rejeter » depuis le second — entre la
      // vérification ci-dessus et l'exécution du service, la campagne a disparu.
      // Elle doit lire que la campagne n'existe déjà plus, pas une erreur qui
      // ressemble à une panne.
      if (error instanceof CampagneIntrouvable) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      console.error("Error rejecting campaign:", error);
      res.status(500).json({ message: "Failed to reject campaign" });
    }
  });

  // ─── « Repenser la campagne » (spec 2026-10-07) ─────────────────────────────
  // Même préparation que les trois étapes de création (/generate/strategy, /content,
  // /tasks) : marque, préférences, savoir, articulation existante, revues passées. Rien
  // n'est créé : ni nouvelle campagne, ni prospection.
  const depsRepenser: RepenserDeps = {
    getCampaign: (id, userId) => storage.getCampaign(id, userId) as any,
    lireContenus: lecturesRepenser.lireContenus,
    lireTaches: lecturesRepenser.lireTaches,
    async contexteGeneration(userId, campaign) {
      const ctx = await resolveCampaignCtx(userId, campaign.projectId ?? undefined);
      if ('error' in ctx) throw new Error(ctx.error);
      // L'articulation est relue et revérifiée comme à la création ; si elle n'est plus
      // proposable (lien de marques retiré), on repense sans elle plutôt que d'échouer.
      let articulation: Articulation | undefined;
      if (campaign.articuleAvecCampaignId && !campaign.articulationIndependante) {
        const art = await resolveArticulation(userId, ctx.pid, campaign.articuleAvecCampaignId);
        if ('error' in art) console.warn(`[repenser] articulation ignorée (campagne ${campaign.id}) : ${art.error}`);
        else articulation = art.articulation;
      }
      const [preferences, savoir, revuesPassees] = await Promise.all([
        resolvePreferences(userId, ctx.pid),
        savoirPourCampagne(userId, ctx.pid, { objective: campaign.objective, name: campaign.name }),
        revuesCampagnesPassees(userId, ctx.pid),
      ]);
      return {
        brandDna: ctx.brandDnaInput as any,
        preferences,
        ...(savoir ? { savoir } : {}),
        ...(articulation ? { articulation } : {}),
        ...(revuesPassees ? { revuesPassees } : {}),
      };
    },
    genererStrategie: (req) => generateCampaignStrategy(req),
    genererContenu: (req, strategy) => generateCampaignContent(req, strategy),
    genererTaches: (req, strategy) => generateCampaignTasks(req, strategy),
    transaction: transactionRepenser,
    placement: storage,
    fixOverlappingTasks: (userId, fromDate) => storage.fixOverlappingTasks(userId, fromDate),
    aujourdhuiParis: () => aujourdhuiParis(),
  };

  // GET /api/campaigns/:id/repenser-apercu → { postsRemplaces, postsConserves,
  // tachesRemplacees, tachesConservees }. 404 si la campagne n'est pas à l'utilisatrice.
  app.get('/api/campaigns/:id/repenser-apercu', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(404).json({ message: "Campaign not found" });
      res.json(await apercuRepenser(depsRepenser, req.userId, id));
    } catch (error) {
      if (error instanceof CampagneIntrouvable) return res.status(404).json({ message: "Campaign not found" });
      console.error("Error previewing campaign rethink:", error);
      res.status(500).json({ message: "Failed to preview campaign rethink" });
    }
  });

  // POST /api/campaigns/:id/repenser { consigne?: string } → 202 { etat: "en_cours" }.
  // Les contrôles (404, 409, 400) sont synchrones ; la génération (jusqu'à 3 × 240 s)
  // continue en arrière-plan — l'écran suit `GET …/repenser-etat`.
  app.post('/api/campaigns/:id/repenser', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(404).json({ message: "Campaign not found" });
      const brute = req.body?.consigne;
      if (brute !== undefined && brute !== null && typeof brute !== 'string') {
        return res.status(400).json({ message: "consigne_invalide" });
      }
      const consigne = typeof brute === 'string' ? brute.trim() : '';
      if (consigne.length > CONSIGNE_REPENSER_MAX) {
        return res.status(400).json({ message: "consigne_trop_longue", max: CONSIGNE_REPENSER_MAX });
      }
      await lancerRepenser(depsRepenser, req.userId, id, consigne ? { consigne } : {});
      res.status(202).json({ etat: "en_cours" });
    } catch (error) {
      if (error instanceof CampagneIntrouvable) return res.status(404).json({ message: "Campaign not found" });
      if (error instanceof DejaEnCours) return res.status(409).json({ message: "deja_en_cours" });
      if (error instanceof StatutIncompatible) {
        return res.status(409).json({ message: "statut_incompatible", statut: error.statut });
      }
      console.error("Error rethinking campaign:", error);
      res.status(500).json({ message: "Failed to rethink campaign" });
    }
  });

  // GET /api/campaigns/:id/repenser-etat → { etat: "aucun" } ou l'entrée du registre
  // ({ etat, debut, fin?, resultat?, erreur? }). 404 si la campagne n'est pas à elle.
  app.get('/api/campaigns/:id/repenser-etat', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(404).json({ message: "Campaign not found" });
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      res.json(registreRepenser.lire(`${userId}:${id}`) ?? { etat: "aucun" });
    } catch (error) {
      console.error("Error reading campaign rethink state:", error);
      res.status(500).json({ message: "Failed to read campaign rethink state" });
    }
  });

  // ─── Génération de campagne EN 3 ÉTAPES (anti-troncature + anti-timeout 3 min) ───
  // Le client appelle ces endpoints en séquence en affichant la progression. Chaque étape est
  // un appel Claude borné (2500/3000/2000 tokens) → jamais tronqué, chacune courte (~20-50s).

  function campaignBrandDnaInput(brandDna: any) {
    return {
      businessType: brandDna?.businessType || "",
      businessModel: brandDna?.businessModel || "",
      targetAudience: brandDna?.targetAudience || "",
      corePainPoint: brandDna?.corePainPoint || "",
      uniquePositioning: brandDna?.uniquePositioning || "",
      primaryGoal: brandDna?.primaryGoal || "",
      communicationStyle: brandDna?.communicationStyle || "Professional",
      audience: brandDna?.audience,
      businessGoal: brandDna?.businessGoal,
      contentPillars: brandDna?.contentPillars,
      platformPriority: brandDna?.platformPriority,
      audienceAspiration: brandDna?.audienceAspiration,
      businessName: brandDna?.businessName,
      offers: brandDna?.offers,
      priceRange: brandDna?.priceRange,
      editorialTerritory: brandDna?.editorialTerritory,
      brandVoiceKeywords: brandDna?.brandVoiceKeywords as string[] | undefined,
      brandVoiceAntiKeywords: brandDna?.brandVoiceAntiKeywords as string[] | undefined,
      activeBusinessPriority: brandDna?.activeBusinessPriority,
      revenueTarget: brandDna?.revenueTarget,
    };
  }

  // Résout projectId (validé) + brandDna d'une étape. Erreur typée si projet invalide.
  async function resolveCampaignCtx(
    userId: string, projectIdRaw: any,
  ): Promise<{ pid?: number; brandDnaInput: any } | { error: string; status: number }> {
    let pid: number | undefined;
    if (projectIdRaw) {
      pid = Number(projectIdRaw);
      if (!Number.isFinite(pid) || pid <= 0) return { error: "Invalid projectId", status: 400 };
      const project = await storage.getProject(pid, userId);
      if (!project) return { error: "Project not found", status: 404 };
    }
    const brandDna = pid
      ? (await storage.getBrandDnaForProject(userId, pid)) || (await storage.getBrandDna(userId))
      : await storage.getBrandDna(userId);
    return { pid, brandDnaInput: campaignBrandDnaInput(brandDna) };
  }

  /**
   * Résout l'articulation demandée par le client. Le client n'envoie qu'un
   * identifiant de campagne : on relit l'articulation nous-mêmes et on vérifie
   * qu'elle figure bien parmi celles proposables pour cette marque.
   *
   * Sans ce contrôle, un appelant authentifié pourrait faire injecter dans le
   * prompt la campagne d'une marque NON liée — ce qui contournerait la règle
   * centrale : l'absence de lien est une interdiction, pas un silence.
   */
  async function resolveArticulation(
    userId: string, projectId: number | undefined, campaignIdRaw: any,
  ): Promise<{ articulation?: Articulation } | { error: string; status: number }> {
    if (!campaignIdRaw || !projectId) return {};
    const cid = Number(campaignIdRaw);
    if (!Number.isFinite(cid)) return { error: "articulationCampaignId invalide", status: 400 };
    const proposables = await articulationsDisponibles(userId, projectId);
    const trouvee = proposables.find((a) => a.campagne.id === cid);
    if (!trouvee) return { error: "Cette campagne n'est pas articulable avec cette marque", status: 400 };
    return { articulation: trouvee };
  }

  /**
   * Les préférences actives de CETTE marque (chantier « rejeter une campagne »,
   * Décision 2), pour injection dans le prompt de génération — même motif que
   * `resolveArticulation` juste au-dessus : résolu CÔTÉ SERVEUR, jamais fourni
   * par le client.
   *
   * Rend un tableau VIDE sans marque sélectionnée : `preferencesDeLaMarque` exige
   * un `projectId`, et sans marque il n'y a rien à préférer ou éviter. Un tableau
   * vide se comporte comme un champ absent dans le prompt assemblé par
   * `openai.ts` (`request.preferences?.length ? ... : ''`), donc aucune
   * régression sur une génération sans marque.
   */
  async function resolvePreferences(userId: string, projectId: number | undefined): Promise<Preference[]> {
    if (!projectId) return [];
    return preferencesDeLaMarque(userId, projectId);
  }

  // Les revues des campagnes passées de la marque, ajoutées au contexte de la stratégie.
  async function revuesCampagnesPassees(userId: string, projectId: number | undefined): Promise<string> {
    const allCampaigns = await storage.getCampaigns(userId, projectId);
    const reviewed = allCampaigns.filter(c => c.reviewedAt && c.reviewContentQuality).slice(0, 5);
    return reviewed.length
      ? `\n\nPAST CAMPAIGN REVIEWS (adjust pacing/strategy):\n${reviewed.map(c => `- "${c.name}" (${c.campaignType || 'general'}): content ${c.reviewContentQuality}/5, audience ${c.reviewAudienceResponse}/5, execution ${c.reviewTaskExecution}/5`).join('\n')}`
      : '';
  }

  // ÉTAPE 1/3 — stratégie + phases + canaux + messaging + KPIs + prospection.
  app.post('/api/campaigns/generate/strategy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { objective, duration, projectId, weekContext } = req.body;
      if (!objective) return res.status(400).json({ message: "Objective is required" });
      const ctx = await resolveCampaignCtx(userId, projectId);
      if ('error' in ctx) return res.status(ctx.status).json({ message: ctx.error });

      const art = await resolveArticulation(userId, ctx.pid, req.body?.articulationCampaignId);
      if ('error' in art) return res.status(art.status).json({ message: art.error });

      const pastReviewContext = await revuesCampagnesPassees(userId, ctx.pid);

      // Les préférences de cette marque (chantier « rejeter une campagne ») : cette
      // fonction DÉCIDE de l'angle, elle doit donc éviter ce qui a été rejeté.
      const preferences = await resolvePreferences(userId, ctx.pid);

      const savoir = await savoirPourCampagne(userId, ctx.pid, { objective });

      const strategy = await generateCampaignStrategy({
        userId, projectId: ctx.pid, objective, duration: duration || '3_months',
        brandDna: ctx.brandDnaInput as any, weekContext: (weekContext || '') + pastReviewContext,
        preferences,
        ...(savoir ? { savoir } : {}),
        // N'ajoute PAS le champ `articulation` quand aucune campagne n'a été choisie :
        // la génération doit rester identique à avant ce chantier (voir brief tâche 5).
        ...(art.articulation ? { articulation: art.articulation } : {}),
      });
      res.json({ strategy });
    } catch (error: any) {
      console.error("[campaign/generate/strategy] Error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to generate campaign strategy" });
    }
  });

  // ÉTAPE 2/3 — plan de contenu par phase et canal (à partir de la stratégie).
  app.post('/api/campaigns/generate/content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { objective, duration, projectId, weekContext, strategy } = req.body;
      if (!strategy || typeof strategy !== 'object' || !Array.isArray(strategy.phases)) {
        return res.status(400).json({ message: "A valid strategy (with phases) is required" });
      }
      const ctx = await resolveCampaignCtx(userId, projectId);
      if ('error' in ctx) return res.status(ctx.status).json({ message: ctx.error });

      const art = await resolveArticulation(userId, ctx.pid, req.body?.articulationCampaignId);
      if ('error' in art) return res.status(art.status).json({ message: art.error });

      // Même raison qu'à l'étape 1 : le plan de contenu décide des angles, donc il
      // reçoit lui aussi les préférences de la marque.
      const preferences = await resolvePreferences(userId, ctx.pid);

      const savoir = await savoirPourCampagne(userId, ctx.pid, { objective, name: (strategy as any).name });

      const contentPlan = await generateCampaignContent(
        {
          userId, projectId: ctx.pid, objective, duration: duration || '3_months', brandDna: ctx.brandDnaInput as any, weekContext,
          preferences,
          ...(savoir ? { savoir } : {}),
          // N'ajoute PAS le champ `articulation` quand aucune campagne n'a été choisie :
          // la génération doit rester identique à avant ce chantier (voir brief tâche 5).
          ...(art.articulation ? { articulation: art.articulation } : {}),
        },
        strategy as CampaignStrategy,
      );
      res.json({ contentPlan });
    } catch (error: any) {
      console.error("[campaign/generate/content] Error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to generate campaign content" });
    }
  });

  // ÉTAPE 3/3 — tâches opérationnelles + création de la campagne (draft).
  app.post('/api/campaigns/generate/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { objective, duration, projectId, weekContext, startDate: bodyStartDate, strategy, contentPlan } = req.body;
      if (!objective) return res.status(400).json({ message: "Objective is required" });
      if (!strategy || typeof strategy !== 'object' || !Array.isArray(strategy.phases)) {
        return res.status(400).json({ message: "A valid strategy (with phases) is required" });
      }
      const ctx = await resolveCampaignCtx(userId, projectId);
      if ('error' in ctx) return res.status(ctx.status).json({ message: ctx.error });

      const art = await resolveArticulation(userId, ctx.pid, req.body?.articulationCampaignId);
      if ('error' in art) return res.status(art.status).json({ message: art.error });

      const preferences = await resolvePreferences(userId, ctx.pid);
      // savoirPourCampagne n'échoue jamais (undefined) : la génération continue sans savoir.
      const savoir = await savoirPourCampagne(userId, ctx.pid, { objective, name: (strategy as any).name });

      const tasks = await generateCampaignTasks(
        {
          userId, projectId: ctx.pid, objective, duration: duration || '3_months', brandDna: ctx.brandDnaInput as any, weekContext,
          preferences,
          ...(savoir ? { savoir } : {}),
        },
        strategy as CampaignStrategy,
      );

      const generated: any = {
        ...strategy,
        contentPlan: Array.isArray(contentPlan) ? contentPlan : [],
        tasks,
      };

      const durationDays: Record<string, number> = {
        '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
        '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
      };
      const startDate = bodyStartDate || sharedFormatDate(new Date());
      const startD = new Date(startDate + 'T00:00:00');
      const endD = new Date(startD);
      endD.setDate(endD.getDate() + (durationDays[duration || '3_months'] || 90));
      const endDate = sharedFormatDate(endD);

      const campaign = await storage.createCampaign({
        userId, projectId: ctx.pid, name: generated.name, objective,
        coreMessage: generated.coreMessage, targetAudience: generated.targetAudience,
        duration: duration || '3_months', status: 'draft', tasksGenerated: false,
        generatedTasks: generated.tasks, insights: generated.insights, campaignType: generated.campaignType,
        phases: generated.phases, messagingFramework: generated.messagingFramework, channels: generated.channels,
        contentPlan: generated.contentPlan, kpis: generated.kpis, audienceSegment: generated.audienceSegment,
        startDate, endDate,
        articuleAvecCampaignId: art.articulation ? art.articulation.campagne.id : null,
        // Le booléen n'est vrai que si l'utilisatrice a explicitement choisi l'isolement.
        // Il distingue « décidé que non » de « pas encore décidé » (les deux sont sinon
        // un articuleAvecCampaignId nul), pour que Naya ne repose pas la question.
        articulationIndependante: req.body?.articulationIndependante === true,
      });

      let prospectionCampaign = null;
      if (generated.prospection?.needed) {
        try {
          const p = generated.prospection;
          prospectionCampaign = await storage.createProspectionCampaign({
            userId, projectId: ctx.pid, name: `${generated.name} — Prospection`, status: 'active',
            targetSector: p.targetSector || generated.targetAudience, channel: p.channel || 'linkedin',
            digitalLevel: p.digitalLevel || 'tous', campaignBrief: p.campaignBrief || generated.coreMessage,
            messageAngle: p.messageAngle || generated.coreMessage, buyingSignals: p.buyingSignals || null,
            prospectsPerDay: p.prospectsPerDay || 3, offer: p.offer || null, linkedCampaignId: campaign.id,
          } as any);
          await storage.updateCampaign(campaign.id, userId, { linkedProspectionCampaignId: prospectionCampaign.id } as any);
          (campaign as any).linkedProspectionCampaignId = prospectionCampaign.id;
        } catch (prospectionError) {
          console.error("[campaign/generate/tasks] Prospection creation failed (campaign saved without link):", prospectionError);
        }
      }

      res.json({ campaign, generated, prospectionCampaign });
    } catch (error: any) {
      console.error("[campaign/generate/tasks] Error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to generate campaign tasks" });
    }
  });

  const campaignDateToStr = sharedFormatDate;
  const campaignAddDays = sharedAddDays;

  app.post('/api/campaigns/:id/launch', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (repenserEnCours(userId, id)) return res.status(409).json({ message: "deja_en_cours" });
      if (campaign.status === 'active') return res.status(400).json({ message: "Campaign already launched" });

      const rawStart = req.body.startDate || campaign.startDate;
      const startDate = rawStart ? new Date(rawStart + 'T00:00:00') : new Date();

      const durationDaysMap: Record<string, number> = {
        '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
        '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
      };
      const campaignDays = durationDaysMap[campaign.duration || '3_months'] || 90;
      const endDate = campaignAddDays(startDate, campaignDays);
      const endDateStr = campaignDateToStr(endDate);

      const { creees: tasksCreated } = await placerTachesCampagne(storage, {
        userId, campaign, debut: startDate, fin: endDate,
      });
      const { crees: contentCreated } = await placerPostsCampagne(storage, {
        userId, campaign, debut: startDate, fin: endDate,
      });


      const updated = await storage.updateCampaign(id, userId, {
        tasksGenerated: true,
        status: 'active',
        startDate: campaignDateToStr(startDate),
        endDate: endDateStr,
      });

      // Toujours éliminer les chevauchements générés par la campagne
      await storage.fixOverlappingTasks(userId, campaignDateToStr(startDate)).catch(() => {});

      res.json({ campaign: updated, tasksCreated, contentCreated });
    } catch (error) {
      console.error("Error launching campaign:", error);
      if (error instanceof Error && error.message.includes('Phase capacity exceeded')) {
        return res.status(422).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to launch campaign" });
    }
  });

  // Regenerate content calendar for an existing campaign (keeps tasks intact)
  app.post('/api/campaigns/:id/regenerate-content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (repenserEnCours(userId, id)) return res.status(409).json({ message: "deja_en_cours" });

      const contentPlan = (campaign.contentPlan || []) as Array<{
        phase: number; week: string; platform: string; format: string;
        angle: string; pillar: string; goal: string; copyDirections: string;
      }>;

      if (contentPlan.length === 0) {
        return res.status(400).json({ message: "Aucun plan de contenu trouvé — relance la campagne d'abord." });
      }

      // Supprime les posts de la campagne SAUF ceux déjà publiés ou en cours de publication :
      // les effacer falsifierait l'historique de l'utilisatrice.
      const existants = await storage.getContent(userId, 100000, undefined, id);
      const aSupprimer = existants.filter((c: any) => !estPublieOuEnCours(c) && !contenuEstPublie(c));
      const deleted = aSupprimer.length > 0
        ? await storage.deleteCampaignContentItems(id, aSupprimer.map((c: any) => c.id))
        : 0;

      const rawStart = campaign.startDate || new Date().toISOString().slice(0, 10);
      const startDate = new Date(rawStart + 'T00:00:00');
      const { crees: contentCreated } = await placerPostsCampagne(storage, {
        userId, campaign, debut: startDate,
        fin: campaign.endDate ? new Date(campaign.endDate + 'T00:00:00') : campaignAddDays(startDate, 365),
      });


      res.json({ deleted, contentCreated });
    } catch (error) {
      console.error("Error regenerating campaign content:", error);
      res.status(500).json({ message: "Failed to regenerate content" });
    }
  });

  app.post('/api/campaigns/:id/pause', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const { pauseNote } = req.body as { pauseNote?: string };
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (repenserEnCours(userId, id)) return res.status(409).json({ message: "deja_en_cours" });
      if (campaign.status !== 'active') return res.status(400).json({ message: "Campaign is not active" });
      const today = new Date().toISOString().slice(0, 10);
      const deleted = await storage.deleteCampaignFutureTasks(id, today);
      const contentDeleted = await storage.deleteCampaignFutureContent(id, today);
      const updated = await storage.updateCampaign(id, userId, {
        status: 'paused',
        pauseNote: pauseNote?.trim() || null,
      });
      res.json({ campaign: updated, tasksRemoved: deleted, contentRemoved: contentDeleted });
    } catch (error) {
      console.error("Error pausing campaign:", error);
      res.status(500).json({ message: "Failed to pause campaign" });
    }
  });

  app.post('/api/campaigns/:id/resume', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (repenserEnCours(userId, id)) return res.status(409).json({ message: "deja_en_cours" });
      if (campaign.status !== 'paused') return res.status(400).json({ message: "Campaign is not paused" });

      if (campaign.pauseNote) {
        const existingTasks = (campaign.generatedTasks || []) as Array<any>;
        const prompt = `L'utilisateur a mis en pause une campagne marketing avec la note suivante :\n\n"${campaign.pauseNote}"\n\nTâches actuelles (JSON array):\n${JSON.stringify(existingTasks, null, 2)}\n\nRetourne un JSON array modifié reflétant les changements demandés. Conserve la même structure (title, description, type, category, priority, estimatedDuration, taskEnergyType, phase). Retourne UNIQUEMENT du JSON valide — soit un array, soit un objet avec une clé "tasks".`;
        const raw = await callClaudeWithContext({
          userId,
          projectId: campaign.projectId ?? null,
          userMessage: prompt,
          model: CLAUDE_MODELS.fast,
          max_tokens: 4000,
        });
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }
        const updatedTasks: any[] = Array.isArray(parsed) ? parsed : (parsed.tasks ?? existingTasks);
        await storage.updateCampaign(id, userId, { generatedTasks: updatedTasks });
      }

      const resumeStartDate = new Date().toISOString().slice(0, 10);

      const rDurMap: Record<string, number> = {
        '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
        '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
      };
      const rDays = rDurMap[campaign.duration || '3_months'] || 90;
      const computedEndDate = campaignAddDays(new Date(resumeStartDate + 'T00:00:00'), rDays);

      await storage.updateCampaign(id, userId, {
        status: 'active',
        pauseNote: null,
        startDate: resumeStartDate,
        endDate: campaignDateToStr(computedEndDate),
      });
      const refreshedCampaign = await storage.getCampaign(id, userId);
      if (!refreshedCampaign) return res.status(500).json({ message: "Campaign lost after resume" });

      const rawStart = resumeStartDate;
      const rStartDate = new Date(rawStart + 'T00:00:00');

      const durationDaysMap: Record<string, number> = {
        '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
        '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
      };
      const rCampaignDays = durationDaysMap[refreshedCampaign.duration || '3_months'] || 90;
      const rEndDate = campaignAddDays(rStartDate, rCampaignDays);
      const rEndDateStr = campaignDateToStr(rEndDate);

      const rExistingTasks = await storage.getTasksInRange(userId, campaignDateToStr(rStartDate), rEndDateStr);

      const rPrefs = await storage.getUserPreferences(userId);
      const rWorkDaySet = parseWorkDays(rPrefs?.workDays);
      const rAvailability = await storage.getDayAvailabilityRange(userId, campaignDateToStr(rStartDate), rEndDateStr);
      const rOffDates = new Set<string>(
        rAvailability.filter((a: any) => a.dayType === 'off').map((a: any) => a.date as string)
      );

      // Use user's working hours preferences
      const rWorkDayStart = rPrefs?.workDayStart || '09:00';
      const rWorkDayEnd = rPrefs?.workDayEnd || '18:00';
      const rLunchStart = rPrefs?.lunchBreakStart || '12:00';
      const rLunchEnd = rPrefs?.lunchBreakEnd || '13:00';

      const R_DAY_START = hhmmToMin(rWorkDayStart);
      const R_DAY_END = hhmmToMin(rWorkDayEnd);
      const R_LUNCH_START = hhmmToMin(rLunchStart);
      const R_LUNCH_END = hhmmToMin(rLunchEnd);
      const R_BUFFER = 15;

      const rDayNextSlot = new Map<string, number>();
      for (const t of rExistingTasks) {
        if (!t.scheduledDate) continue;
        const existing = rDayNextSlot.get(t.scheduledDate) ?? R_DAY_START;
        if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
          const startMin = hhmmToMin(t.scheduledTime);
          const endMin = startMin + (t.estimatedDuration || 30) + R_BUFFER;
          if (endMin > existing) rDayNextSlot.set(t.scheduledDate, endMin);
        }
      }

      const rDayHasCapacity = (dateStr: string, durationMin: number): boolean => {
        const slot = rDayNextSlot.get(dateStr) ?? R_DAY_START;
        const adjusted = (slot < R_LUNCH_END && slot + durationMin > R_LUNCH_START) ? R_LUNCH_END : slot;
        return adjusted + durationMin <= R_DAY_END;
      }

      const rAssignSlot = (dateStr: string, durationMin: number): string => {
        let slot = rDayNextSlot.get(dateStr) ?? R_DAY_START;
        if (slot < R_LUNCH_END && slot + durationMin > R_LUNCH_START) {
          slot = R_LUNCH_END;
        }
        rDayNextSlot.set(dateStr, slot + durationMin + R_BUFFER);
        return minToHHMM(slot);
      }

      const rIsWorkDay = (dateStr: string): boolean => {
        if (rOffDates.has(dateStr)) return false;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        return rWorkDaySet.has(DAY_ABBRS[dow]);
      }

      const rPhases = (refreshedCampaign.phases || []) as Array<{ number: number; name: string; duration: string }>;
      const rPhaseRanges = computePhaseRanges(rPhases, rStartDate, rCampaignDays);

      const rGeneratedTasks = (refreshedCampaign.generatedTasks || []) as Array<{
        title: string; description: string; type: string; category: string;
        priority: number; estimatedDuration: number; taskEnergyType: string; phase?: number;
      }>;

      const rTasksByPhase: Record<number, typeof rGeneratedTasks> = {};
      for (const t of rGeneratedTasks) {
        const p = parseInt(String(t.phase), 10) || 1;
        if (!rTasksByPhase[p]) rTasksByPhase[p] = [];
        rTasksByPhase[p].push(t);
      }

      let rTasksCreated = 0;
      const R_CAMPAIGN_DAY_CAP = 3;
      const rCampaignDayCounts = new Map<string, number>();
      for (const t of rExistingTasks) {
        if (!t.scheduledDate) continue;
        rCampaignDayCounts.set(t.scheduledDate, (rCampaignDayCounts.get(t.scheduledDate) || 0) + 1);
      }

      const rCampaignDayAvailable = (dateStr: string, durationMin: number): boolean => {
        return (rCampaignDayCounts.get(dateStr) || 0) < R_CAMPAIGN_DAY_CAP
          && rDayHasCapacity(dateStr, durationMin);
      }

      const rSortedPhaseNums = Object.keys(rTasksByPhase).map(Number).sort((a, b) => a - b);

      for (const phaseNum of rSortedPhaseNums) {
        const phaseTasks = rTasksByPhase[phaseNum];
        const phaseRange = rPhaseRanges[phaseNum] || { start: rStartDate, end: campaignAddDays(rStartDate, 7) };

        const publicationDates = assignPublicationDates(phaseTasks, phaseRange.start, phaseRange.end, rIsWorkDay);

        for (let taskIdx = 0; taskIdx < phaseTasks.length; taskIdx++) {
          const originalTask = phaseTasks[taskIdx];
          const publicationDate = publicationDates[taskIdx];
          const subTasks = decomposeContentTask(originalTask);

          // Bug 3 fix: lock publication date first, then backward-schedule preparatory tasks
          const rPubTaskIndex = subTasks.findIndex(st => (st.daysBeforePublication || 0) === 0);
          let rLockedPublicationDate: Date | null = null;

          if (rPubTaskIndex !== -1) {
            let rPubDate = new Date(publicationDate);
            if (rPubDate < phaseRange.start) rPubDate = new Date(phaseRange.start);
            if (rPubDate < rStartDate) rPubDate = new Date(rStartDate);
            let rPubSafety = 0;
            while (rPubSafety < 30) {
              const ds = campaignDateToStr(rPubDate);
              if (rIsWorkDay(ds) && rCampaignDayAvailable(ds, subTasks[rPubTaskIndex].estimatedDuration)) {
                rLockedPublicationDate = rPubDate;
                break;
              }
              rPubDate = campaignAddDays(rPubDate, 1);
              rPubSafety++;
            }
            if (!rLockedPublicationDate) continue;
          }

          let rLastSubtaskDate: Date | null = null;
          for (let subIdx = 0; subIdx < subTasks.length; subIdx++) {
            const sub = subTasks[subIdx];
            const offset = typeof sub.daysBeforePublication === 'number' ? sub.daysBeforePublication : 0;

            let scheduledDate: Date;
            if (subIdx === rPubTaskIndex && rLockedPublicationDate) {
              scheduledDate = rLockedPublicationDate;
            } else if (rLockedPublicationDate) {
              scheduledDate = campaignAddDays(rLockedPublicationDate, offset);
            } else {
              scheduledDate = campaignAddDays(publicationDate, offset);
            }

            if (scheduledDate < phaseRange.start) scheduledDate = new Date(phaseRange.start);
            if (scheduledDate < rStartDate) scheduledDate = new Date(rStartDate);
            if (rLastSubtaskDate && scheduledDate <= rLastSubtaskDate) {
              scheduledDate = campaignAddDays(rLastSubtaskDate, 1);
            }

            let safety = 0;
            let foundSlot = false;
            while (safety < 30) {
              const ds = campaignDateToStr(scheduledDate);
              if (rIsWorkDay(ds) && rCampaignDayAvailable(ds, sub.estimatedDuration)) { foundSlot = true; break; }
              if (rLockedPublicationDate && subIdx !== rPubTaskIndex && scheduledDate >= rLockedPublicationDate) {
                console.warn(`Resume campaign ${refreshedCampaign.id}: subtask "${sub.title}" would fall after publication date. Skipping.`);
                break;
              }
              scheduledDate = campaignAddDays(scheduledDate, 1);
              safety++;
            }

            if (!foundSlot) {
              console.warn(`Resume campaign ${refreshedCampaign.id}: could not find valid slot for sub-task "${sub.title}"`);
              continue;
            }

            rLastSubtaskDate = scheduledDate;
            const scheduledDateStr = campaignDateToStr(scheduledDate);
            rCampaignDayCounts.set(scheduledDateStr, (rCampaignDayCounts.get(scheduledDateStr) || 0) + 1);
            const scheduledTime = rAssignSlot(scheduledDateStr, sub.estimatedDuration);
            const scheduledEndTime = minToHHMM(hhmmToMin(scheduledTime) + sub.estimatedDuration);

            await storage.createTask({
              userId,
              projectId: refreshedCampaign.projectId ?? undefined,
              campaignId: refreshedCampaign.id,
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
            rTasksCreated++;
          }
        }
      }

      const updated = await storage.getCampaign(id, userId);
      res.json({ campaign: updated, tasksCreated: rTasksCreated });
    } catch (error) {
      console.error("Error resuming campaign:", error);
      res.status(500).json({ message: "Failed to resume campaign" });
    }
  });

  app.post('/api/campaigns/:id/redeploy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      if (repenserEnCours(userId, id)) return res.status(409).json({ message: "deja_en_cours" });

      const tasksRemoved = await storage.deleteAllIncompleteCampaignTasks(id);

      const rdStartDateStr = new Date().toISOString().slice(0, 10);
      const rdStartDate = new Date(rdStartDateStr + 'T00:00:00');

      const rdDurMap: Record<string, number> = {
        '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
        '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
      };
      const rdDays = rdDurMap[campaign.duration || '3_months'] || 90;
      const rdEndDate = campaignAddDays(rdStartDate, rdDays);
      const rdEndDateStr = campaignDateToStr(rdEndDate);

      await storage.updateCampaign(id, userId, {
        status: 'active',
        tasksGenerated: false,
        startDate: rdStartDateStr,
        endDate: rdEndDateStr,
      });

      const { creees: rdTasksCreated } = await placerTachesCampagne(storage, {
        userId, campaign, debut: rdStartDate, fin: rdEndDate,
        // /redeploy n'a jamais contrôlé les créneaux en base : on garde ce comportement.
        controleCreneaux: false,
      });


      await storage.updateCampaign(id, userId, { tasksGenerated: true });
      const updatedCampaign = await storage.getCampaign(id, userId);
      res.json({ campaign: updatedCampaign, tasksCreated: rdTasksCreated, tasksRemoved });
    } catch (error) {
      console.error("Error redeploying campaign:", error);
      res.status(500).json({ message: "Failed to redeploy campaign" });
    }
  });

  // ─── Companion Pending Messages & Stuck Tasks ──────────────────────────────
  app.get('/api/companion/pending', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const messages = await storage.getPendingMessages(userId);
      res.json({ messages, unreadCount: messages.length });
    } catch (err: any) {
      console.error('GET /api/companion/pending error:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.post('/api/companion/pending/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'ID invalide' });
      await storage.markPendingMessageRead(id);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('POST /api/companion/pending/:id/read error:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.get('/api/tasks/stuck', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const stuck = await storage.getStuckTasks(userId);
      res.json(stuck);
    } catch (err: any) {
      console.error('GET /api/tasks/stuck error:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.post('/api/companion/pending-insight', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { tasks: stuckTasks } = req.body;
      if (!Array.isArray(stuckTasks) || stuckTasks.length === 0) {
        return res.status(400).json({ message: 'tasks requis' });
      }
      const taskList = stuckTasks
        .map((t: { title: string; count: number }) => `'${t.title}' (${t.count}x)`)
        .join(', ');
      const message = `Voici les tâches qui reviennent depuis plusieurs jours : ${taskList}. On en parle ? Je peux les découper, les reporter, ou les supprimer si elles ne sont plus pertinentes.`;
      await storage.createPendingMessage({
        userId,
        message,
        triggerType: 'weekly_insight',
        relatedTaskId: null,
      });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('POST /api/companion/pending-insight error:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  // ─── Business Memory CRUD ──────────────────────────────────────────────────
  app.get('/api/memory', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const archived = req.query.archived === 'true' ? true : req.query.archived === 'all' ? undefined : false;
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const limit = rawLimit && !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined;
      const memories = await storage.getBusinessMemories(userId, { archived, limit });
      res.json(memories);
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ message: "Failed to fetch memories" });
    }
  });

  app.post('/api/memory', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { type, content, sourceEntryId } = req.body;
      if (!type || !content) {
        return res.status(400).json({ message: "type and content are required" });
      }
      const validTypes = ['decision', 'lesson', 'pivot', 'milestone', 'observation'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `type must be one of: ${validTypes.join(', ')}` });
      }
      const memory = await storage.createBusinessMemory({
        userId,
        type,
        content,
        sourceEntryId: sourceEntryId || null,
        archived: false,
      });
      res.json(memory);
    } catch (error) {
      console.error("Error creating memory:", error);
      res.status(500).json({ message: "Failed to create memory" });
    }
  });

  app.patch('/api/memory/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid memory id" });
      const { type, content, archived } = req.body;
      const validTypes = ['decision', 'lesson', 'pivot', 'milestone', 'observation'];
      if (type !== undefined && !validTypes.includes(type)) {
        return res.status(400).json({ message: `type must be one of: ${validTypes.join(', ')}` });
      }
      const updates: any = {};
      if (type !== undefined) updates.type = type;
      if (content !== undefined) updates.content = content;
      if (archived !== undefined) updates.archived = archived;
      const memory = await storage.updateBusinessMemory(id, userId, updates);
      if (!memory) return res.status(404).json({ message: "Memory not found" });
      res.json(memory);
    } catch (error) {
      console.error("Error updating memory:", error);
      res.status(500).json({ message: "Failed to update memory" });
    }
  });

  app.delete('/api/memory/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid memory id" });
      const memory = await storage.archiveBusinessMemory(id, userId);
      if (!memory) return res.status(404).json({ message: "Memory not found" });
      res.json(memory);
    } catch (error) {
      console.error("Error archiving memory:", error);
      res.status(500).json({ message: "Failed to archive memory" });
    }
  });

  // ─── Task Prompts — capter le résultat ─────────────────────────────────────────
  // Notification locale posée à l'heure de fin de chaque tâche. Règle non négociable,
  // tenue ici au niveau des routes (cf. commentaire de tête de insight.ts) : une alarme
  // restée SANS réponse n'entre jamais dans buildImmediateInsight et n'est jamais
  // convertie en "not_done" — absence de réponse ≠ réponse négative.

  // Fenêtre de réponses récentes, chacune associée à l'id du `task_prompts` dont elle
  // vient — pour pouvoir, côté appelant, exclure UNE réponse précise et obtenir la
  // fenêtre "sans elle" (retour immédiat seulement quand l'observation change,
  // arbitrage de Jeanne 2026-09-08 — sans stockage, sans migration : les deux fenêtres
  // se recalculent à la volée, rien n'est persisté de plus).
  async function buildRecentAnsweredTaskAnswers(
    userId: string,
  ): Promise<Array<{ promptId: number; taskAnswer: TaskAnswer }>> {
    const recent = await storage.getRecentTaskPrompts(userId, INSIGHT_TASK_PROMPTS_LOOKBACK);
    // Seules les alarmes RÉPONDUES entrent dans l'insight — jamais une alarme ignorée.
    const answered = recent.filter(
      (p) => p.answeredAt !== null && (p.answer === "done" || p.answer === "not_done"),
    );
    if (answered.length === 0) return [];

    const taskIds = Array.from(new Set(answered.map((p) => p.taskId)));
    const relatedTasks = taskIds.length > 0
      ? await db.select({ id: tasks.id, category: tasks.category }).from(tasks).where(inArray(tasks.id, taskIds))
      : [];
    const categoryByTaskId = new Map(relatedTasks.map((t) => [t.id, t.category]));

    return answered.map((p) => ({
      promptId: p.id,
      taskAnswer: {
        category: categoryByTaskId.get(p.taskId) ?? null,
        // Jamais `.getHours()` : ça lit l'heure du fuseau du PROCESS (UTC en prod), pas
        // celle de Paris — alors que le seuil matin/après-midi de `buildImmediateInsight`
        // (MIDI = 13, insight.ts) est pensé en heure de Paris.
        scheduledHour: parisHourOf(p.scheduledFor),
        done: p.answer === "done",
      },
    }));
  }

  async function computeTaskPromptInsight(userId: string): Promise<string | null> {
    const entries = await buildRecentAnsweredTaskAnswers(userId);
    return buildImmediateInsight(entries.map((e) => e.taskAnswer));
  }

  // GET /api/task-prompts/today — les alarmes à poser aujourd'hui : une par tâche non
  // terminée du jour ayant un scheduledEndTime. Enregistre les lignes task_prompts
  // correspondantes (idempotent, via replaceTaskPromptsForDay) et indique si la
  // fréquence des notifications doit se réduire (soupape).
  //
  // Le SERVEUR tranche seul ce qui a été « posé » — le mobile ne fait plus que
  // programmer ce qu'on lui renvoie (revue finale, défaut Critique 1) :
  //   1. Les heures déjà passées sont exclues AVANT toute écriture. Sans ce filtre, ouvrir
  //      l'app en fin de journée avec des tâches non cochées créait des lignes
  //      `answeredAt IS NULL` pour des alarmes qui n'ont jamais sonné — indiscernables
  //      d'alarmes réellement ignorées, et pouvant déclencher la soupape sur du vide.
  //   2. La soupape (`unansweredStreak`) se calcule sur l'historique EXISTANT, avant
  //      l'insertion des lignes du jour — sinon les alarmes qu'on est en train de créer
  //      (jamais répondues puisqu'elles n'ont pas encore sonné) se mesureraient
  //      elles-mêmes et déclencheraient la soupape dès le premier jour.
  //   3. Quand `reduceFrequency` est vrai, seule la DERNIÈRE alarme du jour est retenue
  //      — et c'est CE jeu filtré, pas l'ensemble des candidates, qui est à la fois
  //      renvoyé au mobile ET persisté. Autrement, les alarmes non transmises au mobile
  //      ne sonneraient jamais mais existeraient quand même en base, devenant à tort des
  //      « ignorées » qui referment la soupape plus fort.
  app.get('/api/task-prompts/today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const now = new Date();
      // Jour calendaire de PARIS, pas celui du process (UTC en prod) : entre minuit et
      // 1h/2h du matin heure de Paris selon la saison, `sharedFormatDate(now)` (qui lit
      // le calendrier du process) renverrait encore la veille.
      const today = parisTodayString(now);

      const todaysTasks = await storage.getTasksInRange(userId, today, today);

      // Soupape calculée AVANT l'insertion des lignes du jour, sur l'historique déjà en
      // base — jamais sur un jeu qui inclurait les alarmes qu'on s'apprête à créer.
      const recentBeforeInsert = await storage.getRecentTaskPrompts(userId, SOUPAPE_TASK_PROMPTS_LOOKBACK);
      const streak = unansweredStreak(
        recentBeforeInsert.map((p) => ({ scheduledFor: p.scheduledFor, answeredAt: p.answeredAt })),
        now,
      );
      const reduceFrequency = shouldReduceFrequency(streak);

      // Toute la décision — heures passées exclues, tâches terminées exclues, soupape
      // appliquée — vit dans `selectAlarmsToPost`, fonction pure et testée
      // (server/services/result-capture/select-alarms.ts). Le jeu FINAL qu'elle renvoie
      // est à la fois celui envoyé au mobile ET celui persisté ci-dessous.
      const alarms = selectAlarmsToPost(todaysTasks, now, reduceFrequency);

      await storage.replaceTaskPromptsForDay(
        userId,
        today,
        alarms.map((a) => ({ taskId: a.taskId, scheduledFor: a.scheduledFor })),
        now,
      );

      res.json({
        prompts: alarms,
        reduceFrequency,
      });
    } catch (error) {
      console.error("Error building today's task prompts:", error);
      res.status(500).json({ message: "Failed to build today's task prompts" });
    }
  });

  // POST /api/task-prompts/:taskId/answer — enregistre la réponse à une alarme.
  // "done" marque la tâche terminée avec completedAt = maintenant — actualDuration n'est
  // JAMAIS écrite : répondre "fait" à l'heure de fin ne dit rien de l'heure de début.
  // "not_done" n'écrit rien de plus qu'une trace de la réponse (la tâche reste non
  // terminée). Validation stricte : jamais de 500 sur un corps malformé.
  app.post('/api/task-prompts/:taskId/answer', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const taskId = Number(req.params.taskId);
      if (!Number.isInteger(taskId)) {
        return res.status(400).json({ message: "taskId must be an integer" });
      }

      const { answer, scheduledFor } = req.body ?? {};
      if (answer !== "done" && answer !== "not_done") {
        return res.status(400).json({ message: "answer must be 'done' or 'not_done'" });
      }
      if (typeof scheduledFor !== "string" && typeof scheduledFor !== "number") {
        return res.status(400).json({ message: "scheduledFor is required" });
      }
      const scheduledForDate = new Date(scheduledFor);
      if (Number.isNaN(scheduledForDate.getTime())) {
        return res.status(400).json({ message: "scheduledFor must be a parsable date" });
      }

      // Appartenance de la tâche — jamais d'écriture pour une tâche d'un autre compte.
      const task = await storage.getTask(taskId);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ message: "Task not found" });
      }

      const [prompt] = await db.select().from(taskPrompts).where(and(
        eq(taskPrompts.taskId, taskId),
        eq(taskPrompts.userId, userId),
        eq(taskPrompts.scheduledFor, scheduledForDate),
      ));
      if (!prompt) {
        return res.status(404).json({ message: "Task prompt not found" });
      }

      const now = new Date();
      // Enregistre la réponse dans tous les cas — elle a bien eu lieu, même si la tâche
      // était déjà cochée ailleurs (web).
      await storage.answerTaskPrompt(prompt.id, userId, answer, now);

      if (answer === "done") {
        // Ne jamais écraser `completedAt` s'il est déjà renseigné : remplacer l'heure
        // réelle d'une complétion (posée ailleurs, par ex. côté web) par celle de la
        // réponse à cette notification remplacerait une mesure vraie par une
        // approximation. `completed` reste posé à `true`, idempotent si déjà vrai.
        await storage.updateTask(taskId, {
          completed: true,
          ...(task.completedAt ? {} : { completedAt: now }),
        } as any);
      }

      // Le retour immédiat ne parle que quand l'observation vient de changer (arbitrage
      // de Jeanne, 2026-09-08) : on la calcule avec la réponse qui vient d'arriver, et
      // sans elle (même fenêtre, moins cette seule réponse) — sans stockage ni nouvelle
      // migration, juste deux appels de `buildImmediateInsight` via `insightIfChanged`.
      const entries = await buildRecentAnsweredTaskAnswers(userId);
      const withLatest = entries.map((e) => e.taskAnswer);
      const withoutLatest = entries.filter((e) => e.promptId !== prompt.id).map((e) => e.taskAnswer);
      const insight = insightIfChanged(withLatest, withoutLatest);

      // La mémoire est un bénéfice, pas une condition : si elle échoue, la réponse de
      // l'utilisatrice reste enregistrée et la requête aboutit. On trace, on ne propage
      // pas. Ne JAMAIS `await` ici : l'écriture peut appeler un service d'embedding, et
      // la réponse HTTP ne doit pas dépendre de sa latence. On réutilise `withLatest`
      // (déjà calculé ci-dessus pour l'insight) plutôt que de relire les réponses
      // récentes une seconde fois.
      rememberObservations(userId, withLatest).catch((e) =>
        console.error("[Memoire] écriture des observations échouée", e?.message),
      );

      res.json({ insight });
    } catch (error) {
      console.error("Error answering task prompt:", error);
      res.status(500).json({ message: "Failed to answer task prompt" });
    }
  });

  // GET /api/task-prompts/insight — le dernier retour, pour que l'app le réaffiche.
  app.get('/api/task-prompts/insight', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const insight = await computeTaskPromptInsight(userId);
      res.json({ insight });
    } catch (error) {
      console.error("Error fetching task prompt insight:", error);
      res.status(500).json({ message: "Failed to fetch task prompt insight" });
    }
  });

  registerLivrablesRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
