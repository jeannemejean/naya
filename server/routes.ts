import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { setupAuth, isAuthenticated, hashPassword, verifyPassword, generateUserId, generateJWT } from "./auth";
import { 
  generateContent, 
  generateDailyTasks, 
  generateStrategyInsights, 
  generateOutreachMessage,
  analyzeContentPerformance,
  generateMonthlyPlan,
  generateWeeklyRefinement,
  generateCampaign,
  generateWeeklyBriefing,
  getMemoryContext,
} from "./services/openai";
import { callClaude, callClaudeWithContext, CLAUDE_MODELS } from "./services/claude";
import { checkAndUnlockMilestones, confirmMilestone, createMilestoneChain } from "./services/milestone-engine";
import { processCompanionMessage } from "./services/companion";
import { contextualRecommendationsEngine } from "./services/contextual-recommendations";
import { runRealismValidation } from "./services/realism";
import { taskPreGenerationService } from "./services/task-pre-generation";
import { NAYA_SYSTEM_VOICE } from "./naya-voice";
import { companyResearchService } from "./services/company-research";
import { socialMediaService } from "./services/social-integrations";
import { leadScrapingService } from "./services/lead-scraping";
import { emailMarketingService } from "./services/email-marketing";
import { parseMilestoneTrigger, checkMilestoneTriggers } from "./services/milestone-intelligence";
import { formatDate as sharedFormatDate, addDays as sharedAddDays } from "./utils/dateUtils";
import { generateGoalTasks } from "./services/goal-tasks";
import { enrichProspect, generateSearchBrief } from "./services/prospection";
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
import {
  getAuthUrl,
  exchangeCodeForTokens,
  getCalendarEvents,
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
const DAY_ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_WORK_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);

function parseWorkDays(csv: string | null | undefined): Set<string> {
  if (csv === null || csv === undefined) return DEFAULT_WORK_DAYS;
  if (csv.trim() === '') return new Set<string>();
  const days = csv.split(',').map(d => d.trim().toLowerCase()).filter(d => DAY_ABBRS.includes(d));
  return new Set(days);
}

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

  // Auth middleware
  await setupAuth(app);

  // ─── Google Calendar OAuth ────────────────────────────────────────────────

  // GET /api/calendar/status — check if user has connected Google Calendar
  app.get('/api/calendar/status', isAuthenticated, async (req: any, res) => {
    try {
      const connected = await storage.hasGoogleCalendarToken(req.session.userId);
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
      (req.session as any).calendarOAuthUserId = req.session.userId;
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
      const userId = req.session.userId;
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
      await storage.deleteGoogleCalendarToken(req.session.userId);
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
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
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
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user || !user.hashedPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const isValid = await verifyPassword(password, user.hashedPassword);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Create session (web)
      req.session.userId = user.id;

      // JWT pour mobile
      const token = generateJWT(user.id);

      const { hashedPassword, ...userWithoutPassword } = user;
      res.json({ ...userWithoutPassword, token });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
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
      // Return user without password
      const { hashedPassword, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Brand DNA routes
  app.get('/api/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const brandDna = await storage.getBrandDna(userId);
      res.json(brandDna);
    } catch (error) {
      console.error("Error fetching brand DNA:", error);
      res.status(500).json({ message: "Failed to fetch brand DNA" });
    }
  });

  app.post('/api/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      let projectId: number | null = null;
      if (req.body.projectId !== undefined && req.body.projectId !== null) {
        projectId = parseInt(req.body.projectId);
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: "Invalid projectId" });
      }

      const dna = projectId
        ? await storage.getBrandDnaForProject(userId, projectId)
        : await storage.getBrandDna(userId);
      if (!dna) return res.status(404).json({ message: "Brand DNA not found" });

      const prompt = `Write a strategic intelligence brief (200–300 words) in first person (addressing the business owner as "you").

Cover these sections:
1. Core position — what makes this business distinctive and who it serves
2. Three communication angles — the most resonant narrative directions for content and outreach
3. Two to three content formats — the best-fit formats for their platform and bandwidth
4. Main growth lever — the single highest-impact action they should double down on right now
5. One blind spot — a strategic risk or gap worth watching

Write in clear, direct language. Be specific — reference actual offers, audience, and positioning from the business context above. Avoid generic business advice. This summary is used by Naya to generate better, more targeted content and task recommendations.`;

      // Use callClaudeWithContext for automatic Brand DNA + project injection
      const summary = await callClaudeWithContext({
        userId,
        projectId,
        userMessage: prompt,
        model: CLAUDE_MODELS.smart,
        max_tokens: 2000,
        additionalSystemContext: 'You are Naya\'s strategic intelligence engine. You write sharp, specific, actionable strategic summaries for independent builders.',
      });

      let updated;
      if (projectId) {
        updated = await storage.upsertBrandDnaForProject(userId, projectId, {
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
    } catch (error) {
      console.error("Error refreshing intelligence:", error);
      res.status(500).json({ message: "Failed to refresh intelligence" });
    }
  });

  // ─── New Three-Layer Onboarding Endpoint ────────────────────────────────────

  app.post('/api/onboarding', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

      // 6. Set active project in preferences
      await storage.upsertUserPreferences(userId, { activeProjectId: primaryProjectRecord.id });

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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      if (!client || client.userId !== req.session.userId) {
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
      if (!client || client.userId !== req.session.userId) {
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
      if (!client || client.userId !== req.session.userId) {
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

  app.get('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const project = await storage.updateProject(parseInt(req.params.id), userId, req.body);
      if (!project) return res.status(404).json({ message: "Project not found" });
      res.json(project);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

  // Génère un plan de tâches actionnables depuis un objectif
  app.post('/api/goals/:goalId/generate-tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const prefs = await storage.upsertUserPreferences(userId, req.body);
      res.json(prefs);
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // ── Energy Level endpoints ──────────────────────────────────────────
  app.get('/api/user/energy', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const brandDna = await storage.getBrandDna(userId);
      if (!brandDna) {
        return res.json({ needsOnboarding: true });
      }
      const prefs = await storage.getUserPreferences(userId);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (prefs?.dailyBriefDate === todayStr && prefs.dailyBriefContent) {
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

ENERGY RULES:
- high: ambitious, clear, direct. Reference the big picture.
- medium: practical, grounded. Focus on momentum over perfection.
- low: gentle, permission-giving. 1-2 tasks max. Admin/creative over deep work.
- depleted: compassionate. Rest is productive. Even showing up is enough.

YOUR VOICE:
- Never say "It looks like..." or "Here's a summary..."
- Speak in the second person. Address them directly.
- Be direct but human. Not corporate. Not cheerful-robot.
- If they have an avoidance trigger that's relevant today, name it gently.
- If they're a Builder: validate action-taking, warn against rabbit holes.
- If they're a Strategist: connect the day to the long-term vision.
- If they're Creative: give permission to follow energy, but anchor to one deliverable.
- If they're Analytical: give a clear rationale for the priority order.`;

      const briefPrompt = `WHAT YOU KNOW ABOUT THEM:
- Energy today: ${energyLevel}
${emotionalContext ? `- How they're feeling: ${emotionalContext}` : ''}
${personaContext}
${rhythmContext}
${avoidanceContext}
- Business type: ${brandDna.businessType || 'Independent builder'}
- Tasks today: ${incompleteTasks.length} pending, ${completedTasks.length} done
${topTasks.length > 0 ? `\nTODAY'S TOP TASKS:\n${topTasks.join('\n')}` : '\nNo tasks scheduled yet.'}
${carryoverLines.length > 0 ? `\nLEFT FROM YESTERDAY:\n${carryoverLines.join('\n')}` : ''}
${upcomingMilestone ? `\nINCOMING:\n- ${upcomingMilestone}` : ''}
${memoryBlock}

Return JSON:
{
  "greeting": "1-2 sentence opener. Personal, direct, human. Reference their energy and situation.",
  "topTasks": ["task title 1", "task title 2", "task title 3"],
  "carryovers": ["most important incomplete task from yesterday — or empty array"],
  "strategicReminder": "One sentence connecting today to the bigger picture. If a milestone is near, mention it.",
  "energyAdvice": "One practical sentence about how to move through today given their energy state."
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
      const userId = req.session.userId;
      await storage.upsertUserPreferences(userId, { dailyBriefDismissed: true });
      res.json({ dismissed: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to dismiss daily brief" });
    }
  });

  // ─── Day Availability Routes ─────────────────────────────────────────────────

  app.get('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const profile = await storage.getUserOperatingProfile(userId);
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching operating profile:", error);
      res.status(500).json({ message: "Failed to fetch operating profile" });
    }
  });

  app.patch('/api/me/operating-profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.upsertUserOperatingProfile(userId, req.body);
      res.json(profile);
    } catch (error) {
      console.error("Error updating operating profile:", error);
      res.status(500).json({ message: "Failed to update operating profile" });
    }
  });

  app.delete('/api/me/brand-dna', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      await storage.deleteBrandDna(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting brand DNA:", error);
      res.status(500).json({ message: "Failed to reset onboarding" });
    }
  });

  app.delete('/api/me/onboarding-reset', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

  app.get('/api/me/behavioral-signals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
        const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

  // PATCH /api/milestones/:id
  app.patch('/api/milestones/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const { message, context, conversationHistory } = req.body;

      if (!message?.trim()) {
        return res.status(400).json({ message: "message requis" });
      }

      // Enrichir le contexte avec les projets réels chargés depuis la DB
      const userProjects = await storage.getProjects(userId);

      // Injecter les tâches abandonnées (deferred 3x+) — concept 100% server-side
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const lookbackDate = new Date(now);
      lookbackDate.setDate(lookbackDate.getDate() - 14);
      const lookback = lookbackDate.toISOString().slice(0, 10);
      const recentTasks = await storage.getTasksInRange(userId, lookback, today).catch(() => []);
      const staleTasks = (recentTasks as any[])
        .filter(t => !t.completed && (t.learnedAdjustmentCount || 0) >= 3)
        .map(t => ({ id: t.id, title: t.title, learnedAdjustmentCount: t.learnedAdjustmentCount as number }))
        .slice(0, 8); // cap at 8 to avoid LLM context bloat

      const enrichedContext = {
        currentDate: today,
        currentTime: now.toTimeString().slice(0, 5),
        platform: "web",
        ...(context || {}),
        availableProjects: userProjects.slice(0, 15).map((p: any) => ({ id: p.id, name: p.name, type: p.type })),
        ...(staleTasks.length > 0 ? { staleTasks } : {}),
      };

      const response = await processCompanionMessage(userId, {
        message,
        context: enrichedContext,
        conversationHistory: conversationHistory || [],
      });

      res.json(response);
    } catch (error) {
      console.error("Companion chat error:", error);
      res.status(500).json({ message: "Erreur du Companion" });
    }
  });

  app.get('/api/companion/history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const history = await storage.getCompanionHistory(userId, 30);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Erreur de récupération" });
    }
  });

  // GET /api/companion/context — contexte enrichi pour le companion mobile
  app.get('/api/companion/context', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
        todayTasks: (todayTasks as any[]).slice(0, 10),
        upcomingTasks: (upcomingTasks as any[])
          .filter((t: any) => !t.completed && t.scheduledDate > today)
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

  // Task lists (créées par le Companion)
  app.post('/api/task-lists', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const captureData = insertQuickCaptureSchema.parse({ ...req.body, userId });
      const entry = await storage.createCaptureEntry(captureData);

      res.json(entry);

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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
  app.get('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const { date, projectId, campaignId } = req.query;
      const pid = projectId ? parseInt(projectId as string) : undefined;
      let cid: number | undefined;
      if (campaignId) {
        const parsed = Number(campaignId);
        if (Number.isFinite(parsed) && parsed > 0) cid = parsed;
      }
      const dueDate = cid ? undefined : (date ? new Date(date as string) : new Date());
      const tasks = await storage.getTasks(userId, dueDate, pid, cid);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get('/api/dashboard/tomorrow-preview', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const taskData = insertTaskSchema.parse({ ...req.body, userId });

      // Validate scheduling constraints
      const validation = await validateTaskScheduling(userId, taskData);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
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
      const userId = req.session.userId;
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
      res.json(entry);
    } catch (error) {
      console.error("Error creating workspace entry:", error);
      res.status(500).json({ message: "Failed to create workspace entry" });
    }
  });

  app.patch('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const { id } = req.params;
      const updates = req.body;
      const taskId = parseInt(id);

      // If updating schedule-related fields, validate constraints
      if (updates.scheduledDate || updates.scheduledTime || updates.estimatedDuration) {
        // Get current task to merge with updates
        const currentTask = await storage.getTask(taskId);
        if (!currentTask) {
          return res.status(404).json({ message: "Task not found" });
        }

        const mergedData = {
          ...currentTask,
          ...updates,
          userId
        };

        const validation = await validateTaskScheduling(userId, mergedData, taskId);
        if (!validation.valid) {
          return res.status(400).json({ message: validation.error });
        }
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
      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.post('/api/tasks/:id/complete', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const task = await storage.completeTask(parseInt(id));
      res.json(task);
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  app.post('/api/tasks/:id/toggle', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const { id } = req.params;
      const taskBefore = await storage.getTask(parseInt(id));
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
      const userId = req.session.userId;
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
      const finalTasks = rebalanceTasksForward(aiResult.tasks, floor, monthEnd, 5, undefined, 0, replanWorkDays)
        .filter((t: any) => !t._unschedulable);

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
      for (const taskData of finalTasks) {
        const task = await storage.createTask({
          userId,
          title: taskData.title,
          description: taskData.description,
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
          activationPrompt: taskData.activationPrompt || null,
          ...(projectIdFromBody ? { projectId: projectIdFromBody } : {}),
        } as any);
        savedTasks.push(task);
      }

      // Save dependency links
      for (const dep of aiResult.dependencies || []) {
        try {
          const fromTask = savedTasks[dep.taskIndex];
          const toTask = savedTasks[dep.dependsOnIndex];
          if (fromTask && toTask) {
            await storage.createTaskDependency({ taskId: fromTask.id, dependsOnTaskId: toTask.id, relationType: dep.relationType || 'blocked_by' });
          }
        } catch { /* non-fatal */ }
      }

      res.json({ tasks: savedTasks, realismReports, monthlyRationale: aiResult.monthlyRationale });
    } catch (error) {
      console.error("Error generating monthly plan:", error);
      res.status(500).json({ message: "Failed to generate monthly plan" });
    }
  });

  // ─── Weekly Refinement ────────────────────────────────────────────────────────
  app.post('/api/tasks/generate-weekly', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const negativeSignals = recentFeedback.filter((f: any) => ['deleted', 'dismissed', 'deferred'].includes(f.feedbackType));
      const rejectedTasksContext = negativeSignals.length > 0
        ? negativeSignals.slice(0, 15).map((f: any) => `- ${f.taskTitle} (${f.taskType || ''}/${f.taskCategory || ''}, source: ${f.taskSource || 'unknown'}) — ${f.feedbackType}, reason: ${f.reason}`).join('\n')
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

      let projectsToProcess: Array<{ id: number | null; name: string }> = [];
      if (resolvedProjectId) {
        projectsToProcess = [{ id: resolvedProjectId, name: '' }];
      } else {
        const allProjects = await storage.getProjects(userId);
        if (allProjects.length > 0) {
          projectsToProcess = allProjects.map(p => ({ id: p.id, name: p.name }));
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
      const perProjectCap = Math.min(TASKS_PER_PROJECT_MAX, Math.ceil(WEEKLY_TASK_CAP / Math.max(projectCount, 1)));

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

      for (const proj of projectsToProcess) {
        const projectBatchKey = proj.id?.toString() || 'general';

        const existingProjectTasks = (existingTasksByProject.get(projectBatchKey) || [])
          .filter((t: any) => !t.completed);
        if (existingProjectTasks.length >= WEEKLY_PROJECT_CAP) {
          skippedProjects.push({ projectId: proj.id, projectName: proj.name, reason: 'Already has tasks this week' });
          allCreatedTasks.push(...existingProjectTasks);
          continue;
        }

        // Get project-specific Brand DNA if available, otherwise use global
        let projectBrandDna = brandDna;
        if (proj.id !== null) {
          const projectSpecificDna = await storage.getBrandDnaForProject(userId, proj.id);
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
            workDayStartStr, workDayEndStr, todayBreaks, perProjectCap,
            energyLevel, isEnergyStale ? undefined : (prefs?.currentEmotionalContext || undefined),
          );
        } catch (projError: any) {
          console.error(`Task generation failed for project ${proj.id} (${proj.name}):`, projError.message);
          skippedProjects.push({ projectId: proj.id, projectName: proj.name, reason: `AI error — will retry next time` });
          continue;
        }

        if (!aiResponse?.tasks?.length) {
          skippedProjects.push({ projectId: proj.id, projectName: proj.name, reason: 'AI returned no tasks for this project' });
          continue;
        }

        const rawTasksToCreate = (aiResponse.tasks || []).slice(0, perProjectCap);

        const aiResponseAny = aiResponse as any;
        const workflowSugs = aiResponseAny.workflowSuggestions || [];
        const namespacedSugs = workflowSugs.map((s: any) => ({
          ...s,
          label: `${projectBatchKey}::${s.label}`,
        }));
        allWorkflowSugs.push(...namespacedSugs);
        for (const sug of namespacedSugs) {
          for (const idx of (sug.taskIndexes || [])) {
            if (rawTasksToCreate[idx]) {
              (rawTasksToCreate[idx] as any).workflowGroup = sug.label;
            }
          }
        }

        for (let i = 0; i < rawTasksToCreate.length; i++) {
          const taskData = normaliseTaskData(rawTasksToCreate[i]);
          allPendingTasks.push({
            taskData,
            scheduledDate: todayStr,
            projId: proj.id,
            aiResponseAny,
            taskIndex: i,
            projectBatchKey,
          });
        }

        if (aiResponse.focus) lastFocus = aiResponse.focus;
        if (aiResponse.reasoning) lastReasoning = aiResponse.reasoning;
        if ((aiResponse as any).bottleneck) lastBottleneck = (aiResponse as any).bottleneck;
        if ((aiResponse as any).suggestedNextMove) lastSuggestedNextMove = (aiResponse as any).suggestedNextMove;
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

          const scheduledEndTimeVal = scheduledTimeVal
            ? minutesToHHMM(hhmmToMinutes(scheduledTimeVal) + duration)
            : null;

          const task = await storage.createTask({
            userId,
            title: taskData.title,
            description: taskData.description,
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
            activationPrompt: taskData.activationPrompt || null,
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
        const blockedIndexes = new Set(deps.map((d: any) => d.taskIndex));
        const fractionBlocked = batchSaved.length > 0 ? blockedIndexes.size / batchSaved.length : 1;
        if (fractionBlocked < 0.6) {
          for (const dep of deps) {
            try {
              const fromEntry = batchSaved.find(e => e.taskIndex === dep.taskIndex);
              const toEntry = batchSaved.find(e => e.taskIndex === dep.dependsOnIndex);
              if (fromEntry?.task && toEntry?.task) {
                await storage.createTaskDependency({
                  taskId: fromEntry.task.id,
                  dependsOnTaskId: toEntry.task.id,
                  relationType: dep.relationType || 'blocked_by',
                });
              }
            } catch { /* non-fatal */ }
          }
        }
      }

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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const dep = await storage.createTaskDependency({ taskId, dependsOnTaskId, relationType });
      res.json(dep);
    } catch (error) {
      console.error("Error creating dependency:", error);
      res.status(500).json({ message: "Failed to create dependency" });
    }
  });

  // ─── Task Range query (for planning page) ────────────────────────────────────
  app.get('/api/tasks/range', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
        // Jalons déjà couverts par une vraie tâche dans la plage (évite les doublons)
        const coveredMilestoneIds = new Set(
          (tasks as any[]).filter(t => t.milestoneId && t.scheduledDate >= start && t.scheduledDate <= end)
            .map(t => t.milestoneId)
        );

        // Paralléliser les queries milestones pour tous les projets
        const allMilestones = await Promise.all(
          projects.filter(p => p?.id).map(p => storage.getMilestones(p.id, userId).catch(() => []))
        );

        const startDate = start as string;
        projects.filter(p => p?.id).forEach((project, i) => {
          const milestones = allMilestones[i] as any[];
          const visibleMilestones = milestones.filter(
            m => m.status !== 'completed' && m.status !== 'skipped'
          );
          const sortedMilestones = [...visibleMilestones].sort((a, b) => {
            const order = { active: 0, unlocked: 1, locked: 2 };
            return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
          });

          for (let idx = 0; idx < sortedMilestones.length; idx++) {
            const m = sortedMilestones[idx];
            if (coveredMilestoneIds.has(m.id)) continue;
            const dayOffset = Math.min(idx, 6);
            const d = new Date(startDate + 'T00:00:00');
            d.setDate(d.getDate() + dayOffset);
            const milestoneDate = m.targetDate && m.targetDate >= start && m.targetDate <= end
              ? m.targetDate
              : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const isActiveOrUnlocked = m.status === 'active' || m.status === 'unlocked';
            milestoneTasks.push({
              id: -(m.id),
              userId,
              projectId: project.id,
              milestoneId: m.id,
              milestoneStatus: m.status,
              title: m.title,
              description: m.description || '',
              type: 'milestone',
              category: 'planning',
              priority: 1,
              estimatedDuration: 45,
              scheduledDate: milestoneDate,
              scheduledTime: isActiveOrUnlocked ? '09:00' : null,
              source: 'milestone',
              completed: m.status === 'completed',
              _virtual: true,
            });
          }
        });

        console.log(`[tasks/range] Injecting ${milestoneTasks.length} virtual milestone tasks`);
        const finalTasks = [...tasks, ...milestoneTasks];

        // Inject Google Calendar events as virtual (read-only) tasks
        try {
          const calEvents = await getCalendarEvents(userId, start as string, end as string);
          console.log(`[tasks/range] GCal: userId=${userId} start=${start} end=${end} events=${calEvents.length}`);
          let gcalIdCounter = -1000;
          for (const ev of calEvents) {
            if (ev.allDay) continue;
            const durationMin = (() => {
              const [sh, sm] = ev.startTime.split(':').map(Number);
              const [eh, em] = ev.endTime.split(':').map(Number);
              return (eh * 60 + em) - (sh * 60 + sm);
            })();
            finalTasks.push({
              id: gcalIdCounter--,
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
        } catch (calErr: any) {
          // Non-fatal — calendar errors must never break the planning page
          console.error('[tasks/range] Calendar injection error:', calErr.message);
        }

        res.json(finalTasks);
      } catch (milestoneErr: any) {
        console.error('[tasks/range] Milestone injection error:', milestoneErr?.message || milestoneErr);
        res.json(tasks); // fallback silencieux
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
        slot += duration + 5;
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
      const userId = req.session.userId;
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
            claimSlot(finalDate, result.slot + duration);
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

      res.json({ moved, days });
    } catch (error) {
      console.error("Error rebalancing week:", error);
      res.status(500).json({ message: "Failed to rebalance week" });
    }
  });

  app.post('/api/tasks/clear-week', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
        const feedbackStr = recentFeedback.map(f => `${f.taskTitle} (${f.taskType}/${f.taskCategory}, source: ${f.taskSource || 'unknown'}) — ${f.feedbackType}, reason: ${f.reason}`).join('\n- ');
        signalParts.push(`REJECTED FEEDBACK:\n- ${feedbackStr}`);
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
      const userId = req.session.userId;
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
      res.json({ created, count: created.length });
    } catch (error) {
      console.error("Error applying replan:", error);
      res.status(500).json({ message: "Failed to apply replan" });
    }
  });

  // Content routes
  app.get('/api/content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

      let content;
      if (status) {
        content = await storage.getContentByStatus(userId, status as string, projectId);
      } else {
        content = await storage.getContent(userId, limit ? parseInt(limit as string) : 50, projectId, campaignId);
      }

      res.json(content);
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ message: "Failed to fetch content" });
    }
  });

  app.post('/api/content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const requestBody = { ...req.body, userId };
      
      // Convert string dates to Date objects for database
      if (requestBody.scheduledFor && typeof requestBody.scheduledFor === 'string') {
        requestBody.scheduledFor = new Date(requestBody.scheduledFor);
      }
      if (requestBody.publishedAt && typeof requestBody.publishedAt === 'string') {
        requestBody.publishedAt = new Date(requestBody.publishedAt);
      }
      
      const contentData = insertContentSchema.parse(requestBody);
      const content = await storage.createContent(contentData);
      res.json(content);
    } catch (error) {
      console.error("Error creating content:", error);
      res.status(500).json({ message: "Failed to create content" });
    }
  });

  app.patch('/api/content/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      res.json(content);
    } catch (error) {
      console.error("Error updating content:", error);
      res.status(500).json({ message: "Failed to update content" });
    }
  });

  app.delete('/api/content/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

  // Régénère un post de contenu en remplaçant son angle/corps en gardant platform/pillar/format
  app.post('/api/content/:id/regenerate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const { feedback } = req.body as { feedback?: string };

      const existing = await storage.getContentById(id, userId);
      if (!existing) return res.status(404).json({ message: "Contenu introuvable" });

      const brandDna = await storage.getBrandDna(userId);
      const bd: any = brandDna || {};

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

Génère un post de remplacement en JSON:
{"title": "Nouvel angle (accroche)", "body": "Contenu du post / directions créatives (2-3 phrases)"}

Le nouveau post doit avoir un angle COMPLÈTEMENT différent de l'original, tout en restant sur la même plateforme (${existing.platform}) et le même pilier (${existing.pillar}).`;

      const raw = await callClaude({
        model: CLAUDE_MODELS.smart,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 500,
      });

      let replacement: { title: string; body: string };
      try {
        replacement = JSON.parse(stripMarkdownJSON(raw));
      } catch {
        return res.status(500).json({ message: "Impossible de générer une alternative. Réessaie." });
      }

      const updated = await storage.updateContent(id, {
        title: replacement.title,
        body: replacement.body,
        contentStatus: 'idea',
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[content/regenerate] Error:", error?.message);
      res.status(500).json({ message: "Erreur lors de la régénération" });
    }
  });

  // AI-powered content generation
  app.post('/api/content/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

  // Saved articles routes (Reading Hub)
  app.get('/api/saved-articles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      const updates = updateSavedArticleSchema.parse(req.body);
      
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      const accounts = await storage.getSafeSocialAccounts(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching social accounts:", error);
      res.status(500).json({ message: "Failed to fetch social accounts" });
    }
  });

  app.post('/api/social-accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      const media = await storage.getMediaLibrary(userId);
      res.json(media);
    } catch (error) {
      console.error("Error fetching media library:", error);
      res.status(500).json({ message: "Failed to fetch media library" });
    }
  });

  app.post('/api/media-library', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
      
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const leadData = insertLeadSchema.parse({ ...req.body, userId });
      const lead = await storage.createLead(leadData);
      res.json(lead);
    } catch (error) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  app.patch('/api/leads/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId;
      const updates = updateLeadSchema.parse(req.body);
      const lead = await storage.updateLead(parseInt(id), userId, updates);
      
      if (!lead) {
        return res.status(404).json({ message: "Lead not found or access denied" });
      }
      
      res.json(lead);
    } catch (error) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  // ─── Prospection Campaign routes ─────────────────────────────────────────────
  app.get('/api/prospection/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const campaigns = await storage.getProspectionCampaigns(userId);
      res.json(campaigns);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/prospection/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const campaign = await storage.createProspectionCampaign({ ...req.body, userId });
      res.json(campaign);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch('/api/prospection/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const updated = await storage.updateProspectionCampaign(Number(req.params.id), userId, req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete('/api/prospection/campaigns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      await storage.deleteProspectionCampaign(Number(req.params.id), userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Génère un brief de recherche pour une campagne de prospection
  app.post('/api/prospection/campaigns/:id/search-brief', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const brief = await generateSearchBrief(userId, Number(req.params.id));
      res.json(brief);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Enrichit un lead avec audit 6 sections + 3 messages
  app.post('/api/leads/:id/enrich', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const leadId = Number(req.params.id);
      const leads = await storage.getLeads(userId);
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const enrichment = await enrichProspect(
        userId,
        {
          name: lead.name,
          company: lead.company || '',
          role: lead.role || undefined,
          sector: lead.sector || undefined,
          linkedinUrl: lead.linkedinUrl || undefined,
          instagramUrl: lead.instagramUrl || undefined,
          notes: lead.notes || undefined,
        },
        lead.prospectionCampaignId ?? null
      );

      const updated = await storage.updateLead(leadId, userId, {
        ...enrichment,
        stage: 'messages_ready',
        enrichedAt: new Date(),
      });
      res.json(updated);
    } catch (e: any) {
      console.error('[prospection/enrich]', e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Outreach routes
  app.get('/api/outreach', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const { week } = req.query;
      let metrics = await storage.getMetrics(userId, week as string);
      
      // If no metrics exist, return sample data structure
      if (!metrics) {
        metrics = {
          id: 0,
          userId,
          week: week as string || new Date().toISOString().slice(0, 7) + "-W" + Math.ceil(new Date().getDate() / 7),
          contentMetrics: {
            engagement_rate: 28,
            total_reach: 2100,
            instagram_reach: 1200,
            linkedin_reach: 900,
            shares: 15,
            saves: 8,
            comments_sentiment: 'positive'
          },
          outreachMetrics: {
            leads_generated: 7,
            conversion_rate: 12,
            response_rate: 35,
            direct_outreach: 15
          },
          emailMetrics: {
            open_rate: 48,
            total_sent: 120,
            click_rate: 12
          },
          goals: {
            monthly_leads: 20,
            engagement_rate: 50,
            conversion_rate: 15
          },
          createdAt: new Date()
        };
      }
      
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  app.get('/api/metrics/history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const { week } = req.query;
      let projectId: number | null | undefined = undefined;
      if (req.query.projectId !== undefined) {
        projectId = parseInt(req.query.projectId as string);
        if (!Number.isFinite(projectId)) return res.status(400).json({ message: "Invalid projectId" });
      }
      const report = await storage.getStrategyReport(userId, week as string, projectId);
      res.json(report);
    } catch (error) {
      console.error("Error fetching strategy report:", error);
      res.status(500).json({ message: "Failed to fetch strategy report" });
    }
  });

  app.post('/api/strategy/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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

      const dna = projectId
        ? await storage.getBrandDnaForProject(userId, projectId)
        : await storage.getBrandDna(userId);
      
      if (!dna) {
        return res.status(400).json({ message: "Brand DNA not configured for this project." });
      }

      const now = new Date();
      const currentWeek = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-W' + Math.ceil(now.getDate() / 7);
      const [weeklyMetrics, content, outreach] = await Promise.all([
        storage.getMetrics(userId, currentWeek),
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
        week: currentWeek,
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const contentId = parseInt(req.params.id);
      
      // Get the content to publish
      const content = await storage.getContentById(contentId, userId);
      if (!content) {
        return res.status(404).json({ message: "Content not found" });
      }
      
      if (content.status === 'published') {
        return res.status(400).json({ message: "Content is already published" });
      }
      
      // Get connected account for this platform
      const accounts = await storage.getSocialAccounts(userId);
      const socialAccount = accounts.find(acc => acc.platform === content.platform && acc.isActive);
      
      if (!socialAccount) {
        return res.status(400).json({ message: `No connected ${content.platform} account found. Please connect your account first.` });
      }
      
      // Check if token is expired
      if (socialAccount.expiresAt && new Date() > socialAccount.expiresAt) {
        return res.status(400).json({ message: `${content.platform} account token has expired. Please reconnect your account.` });
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

      const userId = req.session.userId;
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

  app.get('/api/campaigns', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

  app.post('/api/campaigns/generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const { objective, duration, projectId, weekContext, startDate: bodyStartDate } = req.body;
      if (!objective) return res.status(400).json({ message: "Objective is required" });

      let pid: number | undefined;
      if (projectId) {
        pid = Number(projectId);
        if (!Number.isFinite(pid) || pid <= 0) return res.status(400).json({ message: "Invalid projectId" });
        const project = await storage.getProject(pid, userId);
        if (!project) return res.status(404).json({ message: "Project not found" });
      }

      let brandDna;
      if (pid) {
        brandDna = await storage.getBrandDnaForProject(userId, pid);
        if (!brandDna) brandDna = await storage.getBrandDna(userId);
      } else {
        brandDna = await storage.getBrandDna(userId);
      }

      const brandDnaInput = {
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

      const allCampaigns = await storage.getCampaigns(userId, pid);
      const reviewedCampaigns = allCampaigns
        .filter(c => c.reviewedAt && c.reviewContentQuality)
        .slice(0, 5);
      let pastReviewContext = '';
      if (reviewedCampaigns.length > 0) {
        const summaries = reviewedCampaigns.map(c =>
          `- "${c.name}" (${c.campaignType || 'general'}): content quality ${c.reviewContentQuality}/5, audience response ${c.reviewAudienceResponse}/5, task execution ${c.reviewTaskExecution}/5`
        );
        pastReviewContext = `\n\nPAST CAMPAIGN REVIEWS (adjust this campaign's pacing and strategy based on these scores):\n${summaries.join('\n')}`;
      }

      const generated = await generateCampaign({
        userId,
        objective,
        duration: duration || '3_months',
        brandDna: brandDnaInput as any,
        weekContext: (weekContext || '') + pastReviewContext,
      });

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
        userId,
        projectId: pid,
        name: generated.name,
        objective,
        coreMessage: generated.coreMessage,
        targetAudience: generated.targetAudience,
        duration: duration || '3_months',
        status: 'draft',
        tasksGenerated: false,
        generatedTasks: generated.tasks,
        insights: generated.insights,
        campaignType: generated.campaignType,
        phases: generated.phases,
        messagingFramework: generated.messagingFramework,
        channels: generated.channels,
        contentPlan: generated.contentPlan,
        kpis: generated.kpis,
        audienceSegment: generated.audienceSegment,
        startDate,
        endDate,
      });

      // Si Claude estime qu'une prospection est nécessaire, créer la campagne liée
      let prospectionCampaign = null;
      if (generated.prospection?.needed) {
        try {
          const p = generated.prospection;
          prospectionCampaign = await storage.createProspectionCampaign({
            userId,
            projectId: pid,
            name: `${generated.name} — Prospection`,
            status: 'active',
            targetSector: p.targetSector || generated.targetAudience,
            channel: p.channel || 'linkedin',
            digitalLevel: p.digitalLevel || 'tous',
            campaignBrief: p.campaignBrief || generated.coreMessage,
            messageAngle: p.messageAngle || generated.coreMessage,
            buyingSignals: p.buyingSignals || null,
            prospectsPerDay: p.prospectsPerDay || 3,
            offer: p.offer || null,
            linkedCampaignId: campaign.id,
          } as any);
          // Mettre à jour la campagne avec le lien retour
          await storage.updateCampaign(campaign.id, userId, { linkedProspectionCampaignId: prospectionCampaign.id } as any);
          (campaign as any).linkedProspectionCampaignId = prospectionCampaign.id;
        } catch (prospectionError) {
          console.error("[campaign/generate] Prospection creation failed (campaign saved without link):", prospectionError);
        }
      }

      res.json({ campaign, generated, prospectionCampaign });
    } catch (error: any) {
      console.error("[campaign/generate] Error:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to generate campaign" });
    }
  });

  function hhmmToMin(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  }
  function minToHHMM(mins: number): string {
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  const campaignDateToStr = sharedFormatDate;
  const campaignAddDays = sharedAddDays;
  function campaignAddWeeks(d: Date, weeks: number): Date {
    return sharedAddDays(d, weeks * 7);
  }

  function computePhaseRanges(
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

  function assignPublicationDates(
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

  function mapFormatToContentType(format: string): string {
    const f = format.toLowerCase();
    if (f.includes('email') || f.includes('newsletter')) return 'email';
    if (f.includes('article') || f.includes('blog')) return 'article';
    if (f.includes('story') || f.includes('reel') || f.includes('video')) return 'story';
    if (f.includes('carousel')) return 'carousel';
    return 'post';
  }

  interface SubTask {
    title: string;
    description: string;
    type: string;
    taskEnergyType: string;
    estimatedDuration: number;
    daysBeforePublication: number;
  }

  function decomposeContentTask(task: {
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

  app.post('/api/campaigns/:id/launch', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
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

      const existingTasks = await storage.getTasksInRange(userId, campaignDateToStr(startDate), endDateStr);

      const prefs = await storage.getUserPreferences(userId);
      const campaignWorkDaySet = parseWorkDays(prefs?.workDays);
      const campaignAvailability = await storage.getDayAvailabilityRange(userId, campaignDateToStr(startDate), endDateStr);
      const campaignOffDates = new Set<string>(
        campaignAvailability.filter((a: any) => a.dayType === 'off').map((a: any) => a.date as string)
      );

      // Use user's working hours preferences
      const workDayStart = prefs?.workDayStart || '09:00';
      const workDayEnd = prefs?.workDayEnd || '18:00';
      const lunchStart = prefs?.lunchBreakStart || '12:00';
      const lunchEnd = prefs?.lunchBreakEnd || '13:00';

      const DAY_START = hhmmToMin(workDayStart);
      const DAY_END = hhmmToMin(workDayEnd);
      const LUNCH_START = hhmmToMin(lunchStart);
      const LUNCH_END = hhmmToMin(lunchEnd);
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
      }

      const assignSlot = (dateStr: string, durationMin: number): string => {
        let slot = dayNextSlot.get(dateStr) ?? DAY_START;
        if (slot < LUNCH_END && slot + durationMin > LUNCH_START) {
          slot = LUNCH_END;
        }
        dayNextSlot.set(dateStr, slot + durationMin + BUFFER);
        return minToHHMM(slot);
      }

      const isWorkDay = (dateStr: string): boolean => {
        if (campaignOffDates.has(dateStr)) return false;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        return campaignWorkDaySet.has(DAY_ABBRS[dow]);
      }

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
      }

      const sortedPhaseNums = Object.keys(tasksByPhase).map(Number).sort((a, b) => a - b);

      for (const phaseNum of sortedPhaseNums) {
        const phaseTasks = tasksByPhase[phaseNum];
        const phaseRange = phaseRanges[phaseNum] || { start: startDate, end: campaignAddDays(startDate, 7) };

        const publicationDates = assignPublicationDates(phaseTasks, phaseRange.start, phaseRange.end, isWorkDay);

        for (let taskIdx = 0; taskIdx < phaseTasks.length; taskIdx++) {
          const originalTask = phaseTasks[taskIdx];
          const publicationDate = publicationDates[taskIdx];
          const subTasks = decomposeContentTask(originalTask);

          // BACKWARD SCHEDULING FIX: Lock the publication date first (offset 0)
          // Find the publication task (the one with offset 0)
          const pubTaskIndex = subTasks.findIndex(st => (st.daysBeforePublication || 0) === 0);
          let lockedPublicationDate: Date | null = null;

          if (pubTaskIndex !== -1) {
            // Lock the publication date by finding a valid work day slot
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
              continue; // Skip this entire content task if we can't lock publication date
            }
          }

          // Now schedule all subtasks in order, using the locked publication date as anchor
          let lastSubtaskDate: Date | null = null;
          for (let subIdx = 0; subIdx < subTasks.length; subIdx++) {
            const sub = subTasks[subIdx];
            const offset = typeof sub.daysBeforePublication === 'number' ? sub.daysBeforePublication : 0;

            // If this is the publication task and we have a locked date, use it
            let scheduledDate: Date;
            if (subIdx === pubTaskIndex && lockedPublicationDate) {
              scheduledDate = lockedPublicationDate;
            } else if (lockedPublicationDate) {
              // Calculate from the LOCKED publication date, not the original one
              scheduledDate = campaignAddDays(lockedPublicationDate, offset);
            } else {
              // Fallback to original logic if no locked date
              scheduledDate = campaignAddDays(publicationDate, offset);
            }

            if (scheduledDate < phaseRange.start) scheduledDate = new Date(phaseRange.start);
            if (scheduledDate < startDate) scheduledDate = new Date(startDate);
            if (lastSubtaskDate && scheduledDate <= lastSubtaskDate) {
              scheduledDate = campaignAddDays(lastSubtaskDate, 1);
            }

            // For backward scheduling: only search forward if we're NOT past the publication date
            let safety = 0;
            let foundSlot = false;
            while (safety < 30) {
              const ds = campaignDateToStr(scheduledDate);
              if (isWorkDay(ds) && campaignDayAvailable(ds, sub.estimatedDuration)) { foundSlot = true; break; }

              // BACKWARD SCHEDULING FIX: If this task would be scheduled after the locked publication date, warn and skip
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
            const scheduledTime = assignSlot(scheduledDateStr, sub.estimatedDuration);
            const scheduledEndTime = minToHHMM(hhmmToMin(scheduledTime) + sub.estimatedDuration);

            await storage.createTask({
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

      const contentPlan = (campaign.contentPlan || []) as Array<{
        phase: number; week: string; platform: string; format: string;
        angle: string; pillar: string; goal: string; copyDirections: string;
      }>;

      // Group content plan items by week number
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

      let contentCreated = 0;
      // Spread posts across work days within each week
      for (const [weekNum, pieces] of contentByWeek) {
        const weekStart = campaignAddDays(startDate, (weekNum - 1) * 7);
        // Collect work days in this week
        const workDaysInWeek: string[] = [];
        for (let d = 0; d < 7; d++) {
          const day = campaignAddDays(weekStart, d);
          const dateStr = campaignDateToStr(day);
          if (isWorkDay(dateStr)) workDaysInWeek.push(dateStr);
        }
        if (workDaysInWeek.length === 0) {
          // Fallback: use Wed of the week
          const fallback = campaignAddDays(weekStart, 2);
          workDaysInWeek.push(campaignDateToStr(fallback));
        }

        // Assign pieces to different days, cycling through work days
        // Hours vary to avoid exact duplicates: 9h, 11h, 14h, 16h
        const HOURS = [9, 11, 14, 16];
        const dayUsageCounts = new Map<string, number>();

        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i];
          const dayStr = workDaysInWeek[i % workDaysInWeek.length];
          const usageCount = dayUsageCounts.get(dayStr) || 0;
          dayUsageCounts.set(dayStr, usageCount + 1);
          const hour = HOURS[usageCount % HOURS.length];

          const pieceDate = new Date(dayStr + 'T00:00:00');
          pieceDate.setHours(hour, 0, 0, 0);

          await storage.createContent({
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
          });
          contentCreated++;
        }
      }

      const updated = await storage.updateCampaign(id, userId, {
        tasksGenerated: true,
        status: 'active',
        startDate: campaignDateToStr(startDate),
        endDate: endDateStr,
      });

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
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      const contentPlan = (campaign.contentPlan || []) as Array<{
        phase: number; week: string; platform: string; format: string;
        angle: string; pillar: string; goal: string; copyDirections: string;
      }>;

      if (contentPlan.length === 0) {
        return res.status(400).json({ message: "Aucun plan de contenu trouvé — relance la campagne d'abord." });
      }

      // Delete all existing content items for this campaign
      const deleted = await storage.deleteAllCampaignContent(id);

      const rawStart = campaign.startDate || new Date().toISOString().slice(0, 10);
      const startDate = new Date(rawStart + 'T00:00:00');

      const prefs = await storage.getUserPreferences(userId);
      const campaignWorkDaySet = parseWorkDays(prefs?.workDays);
      const campaignAvailability = await storage.getDayAvailabilityRange(userId, rawStart,
        campaign.endDate || campaignDateToStr(campaignAddDays(startDate, 365)));
      const campaignOffDates = new Set<string>(
        campaignAvailability.filter((a: any) => a.dayType === 'off').map((a: any) => a.date as string)
      );

      const isWorkDayLocal = (dateStr: string): boolean => {
        if (campaignOffDates.has(dateStr)) return false;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        return campaignWorkDaySet.has(DAY_ABBRS[dow]);
      };

      // Group by week
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

      let contentCreated = 0;
      const HOURS = [9, 11, 14, 16];

      for (const [weekNum, pieces] of contentByWeek) {
        const weekStart = campaignAddDays(startDate, (weekNum - 1) * 7);
        const workDaysInWeek: string[] = [];
        for (let d = 0; d < 7; d++) {
          const day = campaignAddDays(weekStart, d);
          const dateStr = campaignDateToStr(day);
          if (isWorkDayLocal(dateStr)) workDaysInWeek.push(dateStr);
        }
        if (workDaysInWeek.length === 0) {
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

          await storage.createContent({
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
          });
          contentCreated++;
        }
      }

      res.json({ deleted, contentCreated });
    } catch (error) {
      console.error("Error regenerating campaign content:", error);
      res.status(500).json({ message: "Failed to regenerate content" });
    }
  });

  app.post('/api/campaigns/:id/pause', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const { pauseNote } = req.body as { pauseNote?: string };
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
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
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
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
      const userId = req.session.userId;
      const id = parseInt(req.params.id);
      const campaign = await storage.getCampaign(id, userId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

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

      const rdExistingTasks = await storage.getTasksInRange(userId, rdStartDateStr, rdEndDateStr);
      const rdPrefs = await storage.getUserPreferences(userId);
      const rdWorkDaySet = parseWorkDays(rdPrefs?.workDays);
      const rdAvailability = await storage.getDayAvailabilityRange(userId, rdStartDateStr, rdEndDateStr);
      const rdOffDates = new Set<string>(
        rdAvailability.filter((a: any) => a.dayType === 'off').map((a: any) => a.date as string)
      );

      // Use user's working hours preferences
      const rdWorkDayStart = rdPrefs?.workDayStart || '09:00';
      const rdWorkDayEnd = rdPrefs?.workDayEnd || '18:00';
      const rdLunchStart = rdPrefs?.lunchBreakStart || '12:00';
      const rdLunchEnd = rdPrefs?.lunchBreakEnd || '13:00';

      const RD_DAY_START = hhmmToMin(rdWorkDayStart);
      const RD_DAY_END = hhmmToMin(rdWorkDayEnd);
      const RD_LUNCH_START = hhmmToMin(rdLunchStart);
      const RD_LUNCH_END = hhmmToMin(rdLunchEnd);
      const RD_BUFFER = 15;

      const rdDayNextSlot = new Map<string, number>();
      for (const t of rdExistingTasks) {
        if (!t.scheduledDate) continue;
        const existing = rdDayNextSlot.get(t.scheduledDate) ?? RD_DAY_START;
        if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) {
          const startMin = hhmmToMin(t.scheduledTime);
          const endMin = startMin + (t.estimatedDuration || 30) + RD_BUFFER;
          if (endMin > existing) rdDayNextSlot.set(t.scheduledDate, endMin);
        }
      }

      const rdDayHasCapacity = (dateStr: string, durationMin: number): boolean => {
        const slot = rdDayNextSlot.get(dateStr) ?? RD_DAY_START;
        const adjusted = (slot < RD_LUNCH_END && slot + durationMin > RD_LUNCH_START) ? RD_LUNCH_END : slot;
        return adjusted + durationMin <= RD_DAY_END;
      }

      const rdAssignSlot = (dateStr: string, durationMin: number): string => {
        let slot = rdDayNextSlot.get(dateStr) ?? RD_DAY_START;
        if (slot < RD_LUNCH_END && slot + durationMin > RD_LUNCH_START) {
          slot = RD_LUNCH_END;
        }
        rdDayNextSlot.set(dateStr, slot + durationMin + RD_BUFFER);
        return minToHHMM(slot);
      }

      const rdIsWorkDay = (dateStr: string): boolean => {
        if (rdOffDates.has(dateStr)) return false;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        return rdWorkDaySet.has(DAY_ABBRS[dow]);
      }

      const rdPhases = (campaign.phases || []) as Array<{ number: number; name: string; duration: string }>;
      const rdPhaseRanges = computePhaseRanges(rdPhases, rdStartDate, rdDays);

      const rdGeneratedTasks = (campaign.generatedTasks || []) as Array<{
        title: string; description: string; type: string; category: string;
        priority: number; estimatedDuration: number; taskEnergyType: string; phase?: number;
      }>;

      const rdTasksByPhase: Record<number, typeof rdGeneratedTasks> = {};
      for (const t of rdGeneratedTasks) {
        const p = parseInt(String(t.phase), 10) || 1;
        if (!rdTasksByPhase[p]) rdTasksByPhase[p] = [];
        rdTasksByPhase[p].push(t);
      }

      let rdTasksCreated = 0;
      const RD_CAMPAIGN_DAY_CAP = 3;
      const rdCampaignDayCounts = new Map<string, number>();
      for (const t of rdExistingTasks) {
        if (!t.scheduledDate) continue;
        rdCampaignDayCounts.set(t.scheduledDate, (rdCampaignDayCounts.get(t.scheduledDate) || 0) + 1);
      }

      const rdCampaignDayAvailable = (dateStr: string, durationMin: number): boolean => {
        return (rdCampaignDayCounts.get(dateStr) || 0) < RD_CAMPAIGN_DAY_CAP
          && rdDayHasCapacity(dateStr, durationMin);
      }

      const rdSortedPhaseNums = Object.keys(rdTasksByPhase).map(Number).sort((a, b) => a - b);

      for (const phaseNum of rdSortedPhaseNums) {
        const phaseTasks = rdTasksByPhase[phaseNum];
        const phaseRange = rdPhaseRanges[phaseNum] || { start: rdStartDate, end: campaignAddDays(rdStartDate, 7) };
        const publicationDates = assignPublicationDates(phaseTasks, phaseRange.start, phaseRange.end, rdIsWorkDay);

        for (let taskIdx = 0; taskIdx < phaseTasks.length; taskIdx++) {
          const originalTask = phaseTasks[taskIdx];
          const publicationDate = publicationDates[taskIdx];
          const subTasks = decomposeContentTask(originalTask);

          // Bug 3 fix: lock publication date anchor, then backward-schedule preparatory subtasks
          const rdPubTaskIndex = subTasks.findIndex(st => (st.daysBeforePublication || 0) === 0);
          let rdLockedPublicationDate: Date | null = null;

          if (rdPubTaskIndex !== -1) {
            let rdPubDate = new Date(publicationDate);
            if (rdPubDate < phaseRange.start) rdPubDate = new Date(phaseRange.start);
            if (rdPubDate < rdStartDate) rdPubDate = new Date(rdStartDate);
            let rdPubSafety = 0;
            while (rdPubSafety < 30) {
              const ds = campaignDateToStr(rdPubDate);
              if (rdIsWorkDay(ds) && rdCampaignDayAvailable(ds, subTasks[rdPubTaskIndex].estimatedDuration)) {
                rdLockedPublicationDate = rdPubDate;
                break;
              }
              rdPubDate = campaignAddDays(rdPubDate, 1);
              rdPubSafety++;
            }
            if (!rdLockedPublicationDate) continue;
          }

          let lastSubtaskDate: Date | null = null;
          for (let subIdx = 0; subIdx < subTasks.length; subIdx++) {
            const sub = subTasks[subIdx];
            const offset = typeof sub.daysBeforePublication === 'number' ? sub.daysBeforePublication : 0;

            let scheduledDate: Date;
            if (subIdx === rdPubTaskIndex && rdLockedPublicationDate) {
              scheduledDate = rdLockedPublicationDate;
            } else if (rdLockedPublicationDate) {
              scheduledDate = campaignAddDays(rdLockedPublicationDate, offset);
            } else {
              scheduledDate = campaignAddDays(publicationDate, offset);
            }

            if (scheduledDate < phaseRange.start) scheduledDate = new Date(phaseRange.start);
            if (scheduledDate < rdStartDate) scheduledDate = new Date(rdStartDate);
            if (lastSubtaskDate && scheduledDate <= lastSubtaskDate) {
              scheduledDate = campaignAddDays(lastSubtaskDate, 1);
            }

            let safety = 0;
            let foundSlot = false;
            while (safety < 30) {
              const ds = campaignDateToStr(scheduledDate);
              if (rdIsWorkDay(ds) && rdCampaignDayAvailable(ds, sub.estimatedDuration)) { foundSlot = true; break; }
              if (rdLockedPublicationDate && subIdx !== rdPubTaskIndex && scheduledDate >= rdLockedPublicationDate) {
                console.warn(`Redeploy campaign ${campaign.id}: subtask "${sub.title}" would fall after publication date. Skipping.`);
                break;
              }
              scheduledDate = campaignAddDays(scheduledDate, 1);
              safety++;
            }

            if (!foundSlot) {
              console.warn(`Redeploy campaign ${campaign.id}: could not find valid slot for sub-task "${sub.title}"`);
              continue;
            }

            lastSubtaskDate = scheduledDate;
            const scheduledDateStr = campaignDateToStr(scheduledDate);
            rdCampaignDayCounts.set(scheduledDateStr, (rdCampaignDayCounts.get(scheduledDateStr) || 0) + 1);
            const scheduledTime = rdAssignSlot(scheduledDateStr, sub.estimatedDuration);
            const scheduledEndTime = minToHHMM(hhmmToMin(scheduledTime) + sub.estimatedDuration);

            await storage.createTask({
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
            rdTasksCreated++;
          }
        }
      }

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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
      const stuck = await storage.getStuckTasks(userId);
      res.json(stuck);
    } catch (err: any) {
      console.error('GET /api/tasks/stuck error:', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.post('/api/companion/pending-insight', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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
      const userId = req.session.userId;
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

  const httpServer = createServer(app);
  return httpServer;
}
