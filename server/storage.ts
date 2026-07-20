import {
  users,
  brandDna,
  tasks,
  content,
  leads,
  outreachMessages,
  metrics,
  strategyReports,
  savedArticles,
  socialAccounts,
  mediaLibrary,
  projects,
  projectGoals,
  projectStrategyProfiles,
  userPreferences,
  taskScheduleEvents,
  quickCaptureEntries,
  userPersonas,
  targetPersonas,
  personaStrategyMapping,
  personaAnalysisResults,
  userOperatingProfiles,
  behavioralSignals,
  taskWorkspaceEntries,
  taskFeedback,
  taskDependencies,
  clients,
  milestoneTriggers,
  projectMilestones,
  milestoneConditions,
  taskLists,
  taskListItems,
  companionConversations,
  companionPendingMessages,
  campaigns,
  prospectionCampaigns,
  type ProspectionCampaign,
  type InsertProspectionCampaign,
  dayAvailability,
  type DayAvailability,
  type InsertDayAvailability,
  type User,
  type UpsertUser,
  type BrandDna,
  type InsertBrandDna,
  type Task,
  type InsertTask,
  type Content,
  type InsertContent,
  type Lead,
  type InsertLead,
  type OutreachMessage,
  type InsertOutreachMessage,
  type Metrics,
  type InsertMetrics,
  type StrategyReport,
  type InsertStrategyReport,
  type SavedArticle,
  type InsertSavedArticle,
  type SocialAccount,
  type InsertSocialAccount,
  type SafeSocialAccount,
  type MediaLibrary,
  type InsertMediaLibrary,
  type Project,
  type InsertProject,
  type ProjectGoal,
  type InsertProjectGoal,
  type ProjectStrategyProfile,
  type InsertProjectStrategyProfile,
  type UserPreferences,
  type InsertUserPreferences,
  type TaskScheduleEvent,
  type InsertTaskScheduleEvent,
  type QuickCaptureEntry,
  type InsertQuickCaptureEntry,
  type UserPersona,
  type InsertUserPersona,
  type TargetPersona,
  type InsertTargetPersona,
  type PersonaAnalysisResult,
  type InsertPersonaAnalysisResult,
  type UserOperatingProfile,
  type InsertUserOperatingProfile,
  type BehavioralSignal,
  type InsertBehavioralSignal,
  type TaskWorkspaceEntry,
  type InsertTaskWorkspaceEntry,
  type TaskFeedback,
  type InsertTaskFeedback,
  type TaskDependency,
  type InsertTaskDependency,
  type Client,
  type InsertClient,
  type MilestoneTrigger,
  type InsertMilestoneTrigger,
  type ProjectMilestone,
  type InsertProjectMilestone,
  type MilestoneCondition,
  type InsertMilestoneCondition,
  type TaskList,
  type TaskListItem,
  type CompanionConversation,
  type Campaign,
  type InsertCampaign,
  businessMemory,
  type BusinessMemory,
  type InsertBusinessMemory,
  memoryEntries,
  googleCalendarTokens,
  type GoogleCalendarToken,
  type InsertGoogleCalendarToken,
  subscriptions,
  type Subscription,
  type InsertSubscription,
  accessCodes,
  type AccessCode,
  accessCodeRedemptions,
  processedStripeEvents,
  prospectionUsage,
  type InsertProspectionUsage,
  campaignSequenceSteps,
  type CampaignSequenceStep,
  type InsertCampaignSequenceStep,
  leadSequenceState,
  type LeadSequenceState,
  type InsertLeadSequenceState,
  leadStepMessages,
  type LeadStepMessage,
  type InsertLeadStepMessage,
  aiInvocations,
  type AiInvocation,
  type InsertAiInvocation,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, isNotNull, inArray, ne, sql } from "drizzle-orm";
import { encryptToken, encryptNullable, decryptToken } from "./services/token-crypto";
import { repackDay } from "./services/schedule-repack";
import { deriveSignals, type LeadSignals } from "./services/sequence-signals";
import { aggregateStepAnalytics } from "./services/campaign-step-analytics";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getActiveUserIds(): Promise<string[]>;
  
  // Brand DNA operations
  getBrandDna(userId: string): Promise<BrandDna | undefined>;
  getBrandDnaForProject(userId: string, projectId: number): Promise<BrandDna | undefined>;
  upsertBrandDna(brandDnaData: InsertBrandDna): Promise<BrandDna>;
  upsertBrandDnaForProject(userId: string, projectId: number, brandDnaData: Partial<InsertBrandDna>): Promise<BrandDna>;
  upsertProjectBrandDnaClean(userId: string, projectId: number, brandDnaData: Partial<InsertBrandDna>): Promise<BrandDna>;
  
  // Project operations
  getProjects(userId: string, limit?: number, offset?: number): Promise<Project[]>;
  getProject(id: number, userId: string): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, userId: string, data: Partial<Project>): Promise<Project | null>;
  deleteProject(id: number, userId: string): Promise<boolean>;
  getPrimaryProject(userId: string): Promise<Project | undefined>;
  setPrimaryProject(id: number, userId: string): Promise<Project | null>;

  // Project goal operations
  getProjectGoal(id: number): Promise<ProjectGoal | null>;
  getProjectGoals(projectId: number): Promise<ProjectGoal[]>;
  getActiveGoalsForProject(projectId: number): Promise<ProjectGoal[]>;
  createProjectGoal(data: InsertProjectGoal): Promise<ProjectGoal>;
  updateProjectGoal(id: number, data: Partial<ProjectGoal>): Promise<ProjectGoal | null>;
  deleteProjectGoal(id: number): Promise<boolean>;
  getGoalProgress(goalId: number): Promise<{ completed: number; total: number }>;

  // Project strategy profile operations
  getProjectStrategyProfile(projectId: number): Promise<ProjectStrategyProfile | undefined>;
  upsertProjectStrategyProfile(data: InsertProjectStrategyProfile): Promise<ProjectStrategyProfile>;

  // User preferences operations
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(userId: string, data: Partial<InsertUserPreferences>): Promise<UserPreferences>;

  // Day availability operations
  getDayAvailability(userId: string, date: string): Promise<DayAvailability | undefined>;
  getDayAvailabilityRange(userId: string, startDate: string, endDate: string): Promise<DayAvailability[]>;
  upsertDayAvailability(userId: string, date: string, data: Partial<InsertDayAvailability>): Promise<DayAvailability>;

  // Task schedule event operations
  createScheduleEvent(data: InsertTaskScheduleEvent): Promise<TaskScheduleEvent>;
  getScheduleEvents(taskId: number): Promise<TaskScheduleEvent[]>;

  // Quick capture operations
  createCaptureEntry(data: InsertQuickCaptureEntry): Promise<QuickCaptureEntry>;
  getCaptureEntries(userId: string, processed?: boolean): Promise<QuickCaptureEntry[]>;
  updateCaptureEntry(id: number, userId: string, data: Partial<QuickCaptureEntry>): Promise<QuickCaptureEntry | null>;
  deleteCaptureEntry(id: number, userId: string): Promise<boolean>;

  // User Operating Profile operations
  getUserOperatingProfile(userId: string): Promise<UserOperatingProfile | undefined>;
  upsertUserOperatingProfile(userId: string, data: Partial<InsertUserOperatingProfile>): Promise<UserOperatingProfile>;
  deleteBrandDna(userId: string): Promise<boolean>;
  resetUserOnboardingState(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<boolean>;

  // Behavioral Signal operations
  createBehavioralSignal(data: InsertBehavioralSignal): Promise<BehavioralSignal>;
  getBehavioralSignals(userId: string, limit?: number): Promise<BehavioralSignal[]>;

  // Task Workspace Entry operations
  getWorkspaceEntries(taskId: number): Promise<TaskWorkspaceEntry[]>;
  createWorkspaceEntry(data: InsertTaskWorkspaceEntry): Promise<TaskWorkspaceEntry>;
  updateWorkspaceEntry(id: number, updates: { content?: string; title?: string }): Promise<TaskWorkspaceEntry>;
  getRecentWorkspaceEntries(userId: string, projectId?: number, limit?: number): Promise<TaskWorkspaceEntry[]>;

  // Task Feedback operations
  createTaskFeedback(data: InsertTaskFeedback): Promise<TaskFeedback>;
  getRecentTaskFeedback(userId: string, projectId?: number, limit?: number): Promise<TaskFeedback[]>;
  updateTaskFeedback(id: number, data: Partial<InsertTaskFeedback>): Promise<TaskFeedback>;
  deleteTask(taskId: number): Promise<void>;
  deleteIncompleteFutureTasks(userId: string, fromDate: string): Promise<number>;
  archiveIncompleteFutureTasks(userId: string, fromDate: string): Promise<number>;

  // Task Dependency operations
  getTaskDependencies(taskId: number): Promise<TaskDependency[]>;
  createTaskDependency(data: InsertTaskDependency): Promise<TaskDependency>;
  deleteTaskDependency(id: number): Promise<void>;
  getTaskDependenciesForUser(userId: string, projectId?: number): Promise<TaskDependency[]>;

  // Task range query (for planning views)
  getTasksInRange(userId: string, startDate: string, endDate: string, projectId?: number): Promise<Task[]>;
  getArchivedTasks(userId: string, projectId?: number): Promise<Task[]>;

  // Scheduling signals (for replan)
  getRecentScheduleEvents(userId: string, limit?: number): Promise<TaskScheduleEvent[]>;

  // Persona operations
  getUserPersonaArchetypes(): Promise<UserPersona[]>;
  upsertUserPersona(data: InsertUserPersona): Promise<UserPersona>;
  getTargetPersonas(userId: string, projectId?: number): Promise<TargetPersona[]>;
  createTargetPersona(data: InsertTargetPersona): Promise<TargetPersona>;
  deleteTargetPersona(id: number, userId: string): Promise<boolean>;
  savePersonaAnalysisResult(data: InsertPersonaAnalysisResult): Promise<PersonaAnalysisResult>;
  getLatestPersonaAnalysis(userId: string, personaType: string): Promise<PersonaAnalysisResult | undefined>;

  // Task operations
  getTask(taskId: number): Promise<Task | undefined>;
  getTasks(userId: string, dueDate?: Date, projectId?: number, campaignId?: number): Promise<Task[]>;
  checkSlotAvailability(userId: string, date: string, startTime: string, durationMinutes: number, excludeTaskId?: number): Promise<{ available: boolean; nextAvailableTime?: string }>;
  findFirstFreeSlot(userId: string, fromDate: string, durationMinutes: number): Promise<{ date: string; time: string }>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: Partial<Task>): Promise<Task>;
  completeTask(id: number): Promise<Task>;
  toggleTaskCompletion(id: number): Promise<Task>;
  getTomorrowPreviewData(userId: string, projectId?: number): Promise<{ carryover: Task[]; scheduledTomorrow: Task[]; approachingDeadlines: any[] }>;
  
  // Content operations
  getContent(userId: string, limit?: number, projectId?: number): Promise<Content[]>;
  getContentById(id: number, userId: string): Promise<Content | undefined>;
  createContent(content: InsertContent): Promise<Content>;
  updateContent(id: number, updates: Partial<Content>): Promise<Content>;
  deleteContent(id: number): Promise<void>;
  deleteCampaignFutureContent(campaignId: number, fromDate: string): Promise<number>;
  deleteAllCampaignContent(campaignId: number): Promise<number>;
  getContentByStatus(userId: string, status: string, projectId?: number): Promise<Content[]>;
  getDueScheduledContent(now: Date): Promise<Content[]>;
  claimContentForPosting(id: number): Promise<boolean>;

  // Prospection Campaign operations
  getProspectionCampaigns(userId: string): Promise<ProspectionCampaign[]>;
  getProspectionCampaign(id: number): Promise<ProspectionCampaign | null>;
  createProspectionCampaign(campaign: InsertProspectionCampaign): Promise<ProspectionCampaign>;
  updateProspectionCampaign(id: number, userId: string, updates: Partial<ProspectionCampaign>): Promise<ProspectionCampaign | null>;
  deleteProspectionCampaign(id: number, userId: string): Promise<void>;

  // Séquences de prospection
  getSequenceSteps(campaignId: number): Promise<CampaignSequenceStep[]>;
  replaceSequenceSteps(campaignId: number, userId: string, steps: Array<{ stepOrder: number; channel: string; delayDays: number; subjectTemplate?: string | null; bodyTemplate: string }>): Promise<CampaignSequenceStep[]>;
  saveSequencePlan(campaignId: number, userId: string, plan: { steps: { channel: string; delayDays: number; intention: string; condition: string }[] }): Promise<void>;
  getLeadSequenceState(leadId: number): Promise<LeadSequenceState | undefined>;
  enrollLead(leadId: number, campaignId: number, userId: string): Promise<LeadSequenceState | null>;
  updateLeadSequenceState(leadId: number, updates: Partial<LeadSequenceState>): Promise<LeadSequenceState | null>;
  getDueEnrollments(now: Date, limit?: number): Promise<LeadSequenceState[]>;
  getLeadStepMessage(leadId: number, stepId: number): Promise<LeadStepMessage | undefined>;
  upsertLeadStepMessage(row: InsertLeadStepMessage): Promise<void>;

  // Lead operations
  getLeads(userId: string): Promise<Lead[]>;
  getLead(id: number, userId: string): Promise<Lead | undefined>;
  getLeadsByCampaign(campaignId: number, userId: string): Promise<Lead[]>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: number, userId: string, updates: Partial<Lead>): Promise<Lead | null>;
  bulkArchiveLeads(ids: number[], userId: string): Promise<number>;
  bulkMoveLeads(ids: number[], userId: string, campaignId: number): Promise<number>;
  getLeadsByStatus(userId: string, status: string): Promise<Lead[]>;
  setLeadLinkedinConnected(leadId: number, at: Date): Promise<void>;
  getLeadsAwaitingInvite(): Promise<{ id: number; userId: string; linkedinUrl: string | null }[]>;

  // Outreach operations
  getOutreachMessages(userId: string, leadId?: number): Promise<OutreachMessage[]>;
  getLeadSignals(leadId: number): Promise<LeadSignals>;
  createOutreachMessage(message: InsertOutreachMessage): Promise<OutreachMessage>;
  updateOutreachMessage(id: number, updates: Partial<OutreachMessage>): Promise<OutreachMessage>;
  getLatestOutreachByLead(leadId: number): Promise<OutreachMessage | undefined>;
  getOutreachForLeads(leadIds: number[]): Promise<OutreachMessage[]>;
  countOutreachSentSince(userId: string, since: Date, platform?: string): Promise<number>;
  getCampaignStepAnalytics(campaignId: number): Promise<{
    byStep: { stepOrder: number; channel: string; sent: number; opened: number; clicked: number; bounced: number }[];
    byChannel: { channel: string; sent: number; replied: number }[];
  }>;

  // Metrics operations
  getMetrics(userId: string, week?: string): Promise<Metrics | undefined>;
  upsertMetrics(metricsData: InsertMetrics): Promise<Metrics>;
  
  // Strategy operations
  getStrategyReport(userId: string, week?: string, projectId?: number | null): Promise<StrategyReport | undefined>;
  createStrategyReport(report: InsertStrategyReport): Promise<StrategyReport>;
  getWeeklyBriefing(userId: string, week: string): Promise<StrategyReport | undefined>;
  dismissWeeklyBriefing(userId: string, week: string): Promise<void>;
  
  // Saved articles operations (Reading Hub)
  getSavedArticles(userId: string, category?: string): Promise<SavedArticle[]>;
  createSavedArticle(article: InsertSavedArticle): Promise<SavedArticle>;
  updateSavedArticle(id: number, userId: string, updates: Partial<SavedArticle>): Promise<SavedArticle | null>;
  deleteSavedArticle(id: number, userId: string): Promise<boolean>;
  getSavedArticleById(id: number, userId: string): Promise<SavedArticle | undefined>;
  markArticleAsRead(id: number, userId: string, isRead: boolean): Promise<SavedArticle | null>;
  toggleArticleFavorite(id: number, userId: string, isFavorite: boolean): Promise<SavedArticle | null>;
  
  // Social account operations
  getSocialAccounts(userId: string): Promise<SocialAccount[]>;
  getSafeSocialAccounts(userId: string): Promise<SafeSocialAccount[]>;
  createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount>;
  createSafeSocialAccount(account: InsertSocialAccount): Promise<SafeSocialAccount>;
  updateSocialAccount(id: number, userId: string, updates: Partial<SocialAccount>): Promise<SocialAccount | null>;
  updateSafeSocialAccount(id: number, userId: string, updates: Partial<SocialAccount>): Promise<SafeSocialAccount | null>;
  deleteSocialAccount(id: number, userId: string): Promise<boolean>;
  deleteSocialAccountsByPlatformUserId(platformUserId: string): Promise<number>;

  // Abonnement & accès (Stripe)
  getSubscription(userId: string): Promise<Subscription | undefined>;
  upsertSubscription(sub: InsertSubscription): Promise<Subscription>;
  setProspectionPlan(userId: string, plan: "base" | "enrichissement"): Promise<void>;
  // Tracking interne des coûts de prospection
  recordProspectionUsage(entry: InsertProspectionUsage): Promise<void>;
  countProspectionOperationsSince(userId: string, operationTypes: string[], since: Date): Promise<number>;
  setUserRole(userId: string, role: string): Promise<void>;
  setUserRoleByEmail(email: string, role: string): Promise<boolean>;
  getAccessCodeByCode(code: string): Promise<AccessCode | undefined>;
  createAccessCode(input: { code: string; label?: string; maxRedemptions?: number | null; expiresAt?: Date | null }): Promise<AccessCode>;
  hasRedeemed(codeId: number, userId: string): Promise<boolean>;
  recordRedemption(codeId: number, userId: string): Promise<void>;
  isStripeEventProcessed(eventId: string): Promise<boolean>;
  markStripeEventProcessed(eventId: string): Promise<void>;
  getSocialAccountById(id: number, userId: string): Promise<SocialAccount | undefined>;
  getSafeSocialAccountById(id: number, userId: string): Promise<SafeSocialAccount | undefined>;
  getSocialAccountByPlatform(userId: string, platform: string): Promise<SocialAccount | undefined>;
  
  // Media library operations
  getMediaLibrary(userId: string): Promise<MediaLibrary[]>;
  createMediaItem(media: InsertMediaLibrary): Promise<MediaLibrary>;
  updateMediaItem(id: number, userId: string, updates: Partial<MediaLibrary>): Promise<MediaLibrary | null>;
  deleteMediaItem(id: number, userId: string): Promise<boolean>;
  getMediaItemById(id: number, userId: string): Promise<MediaLibrary | undefined>;

  // Client operations
  createClient(data: InsertClient): Promise<Client>;
  getClients(userId: string, projectId: number): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  updateClient(id: number, data: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  getClientTasks(clientId: number): Promise<Task[]>;

  // Milestone Trigger operations
  createMilestoneTrigger(data: InsertMilestoneTrigger): Promise<MilestoneTrigger>;
  getMilestoneTriggers(userId: string, status?: string): Promise<MilestoneTrigger[]>;
  getMilestoneTrigger(id: number): Promise<MilestoneTrigger | undefined>;
  updateMilestoneTrigger(id: number, data: Partial<MilestoneTrigger>): Promise<MilestoneTrigger | null>;
  deleteMilestoneTrigger(id: number, userId: string): Promise<boolean>;

  // Campaign operations
  getCampaigns(userId: string, projectId?: number): Promise<Campaign[]>;
  getCampaign(id: number, userId: string): Promise<Campaign | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: number, userId: string, data: Partial<Campaign>): Promise<Campaign>;
  deleteCampaign(id: number, userId: string): Promise<void>;
  deleteCampaignFutureTasks(campaignId: number, fromDate: string): Promise<number>;
  deleteAllIncompleteCampaignTasks(campaignId: number): Promise<number>;

  // Business Memory operations
  getBusinessMemories(userId: string, opts?: { archived?: boolean; limit?: number }): Promise<BusinessMemory[]>;
  createBusinessMemory(data: InsertBusinessMemory): Promise<BusinessMemory>;
  updateBusinessMemory(id: number, userId: string, data: Partial<BusinessMemory>): Promise<BusinessMemory | null>;
  archiveBusinessMemory(id: number, userId: string): Promise<BusinessMemory | null>;

  // Google Calendar Token operations
  getGoogleCalendarToken(userId: string): Promise<GoogleCalendarToken | undefined>;
  upsertGoogleCalendarToken(data: InsertGoogleCalendarToken): Promise<GoogleCalendarToken>;
  deleteGoogleCalendarToken(userId: string): Promise<void>;
  hasGoogleCalendarToken(userId: string): Promise<boolean>;

  // Companion pending messages
  createPendingMessage(data: {
    userId: string;
    message: string;
    triggerType: string;
    relatedTaskId?: number | null;
  }): Promise<{ id: number; userId: string; message: string; triggerType: string; relatedTaskId: number | null; isRead: boolean | null; createdAt: Date | null }>;

  getPendingMessages(userId: string): Promise<Array<{
    id: number;
    message: string;
    triggerType: string;
    relatedTaskId: number | null;
    isRead: boolean | null;
    createdAt: Date | null;
  }>>;

  markPendingMessageRead(id: number): Promise<void>;

  getPendingMessageByTaskAndType(taskId: number, triggerType: string): Promise<{ id: number } | undefined>;

  getStuckTasks(userId: string): Promise<Array<{
    id: number;
    title: string;
    learnedAdjustmentCount: number | null;
    scheduledDate: string | null;
  }>>;

  // Journal des invocations IA (Phase 1 — corpus propriétaire)
  createAiInvocation(entry: InsertAiInvocation): Promise<AiInvocation>;
  getAiInvocations(opts?: { userId?: string; limit?: number }): Promise<AiInvocation[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getActiveUserIds(): Promise<string[]> {
    // Returns all userId values that have brand DNA configured (= onboarded users)
    const rows = await db.selectDistinct({ userId: brandDna.userId }).from(brandDna);
    return rows.map(r => r.userId);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: { ...userData, updatedAt: new Date() },
      })
      .returning();
    return user;
  }

  // Brand DNA operations
  async getBrandDna(userId: string): Promise<BrandDna | undefined> {
    // Return global (non-project-specific) record
    const [dna] = await db.select().from(brandDna)
      .where(and(eq(brandDna.userId, userId), isNull(brandDna.projectId)));
    return dna;
  }

  async getBrandDnaForProject(userId: string, projectId: number): Promise<BrandDna | undefined> {
    const [projectDna] = await db.select().from(brandDna)
      .where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId)));
    return projectDna;
  }

  async upsertBrandDna(brandDnaData: InsertBrandDna): Promise<BrandDna> {
    const [existing] = await db.select({ id: brandDna.id }).from(brandDna)
      .where(and(eq(brandDna.userId, brandDnaData.userId), isNull(brandDna.projectId)));
    if (existing) {
      const [updated] = await db.update(brandDna)
        .set({ ...brandDnaData, updatedAt: new Date() })
        .where(eq(brandDna.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(brandDna).values(brandDnaData).returning();
    return inserted;
  }

  async upsertBrandDnaForProject(userId: string, projectId: number, brandDnaData: Partial<InsertBrandDna>): Promise<BrandDna> {
    const [existing] = await db.select({ id: brandDna.id }).from(brandDna)
      .where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId)));
    if (existing) {
      const [updated] = await db.update(brandDna)
        .set({ ...brandDnaData, updatedAt: new Date() })
        .where(eq(brandDna.id, existing.id))
        .returning();
      return updated;
    }
    // Get global DNA as base template (if any), then overlay project-specific fields
    const [globalDna] = await db.select().from(brandDna)
      .where(and(eq(brandDna.userId, userId), isNull(brandDna.projectId)));
    const baseData = globalDna
      ? (({ id: _id, createdAt: _c, updatedAt: _u, projectId: _p, ...rest }) => rest)(globalDna as any)
      : {};
    const [inserted] = await db.insert(brandDna)
      .values({ ...baseData, ...brandDnaData, userId, projectId })
      .returning();
    return inserted;
  }

  // DNA propre à un projet, SANS hériter du DNA global. À utiliser quand le projet est un
  // AUTRE business (ex. blog de cuisine ≠ agence mode) : aucun champ (y compris
  // nayaIntelligenceSummary) ne doit être recopié depuis le projet principal.
  async upsertProjectBrandDnaClean(userId: string, projectId: number, brandDnaData: Partial<InsertBrandDna>): Promise<BrandDna> {
    const [existing] = await db.select({ id: brandDna.id }).from(brandDna)
      .where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId)));
    if (existing) {
      const [updated] = await db.update(brandDna)
        .set({ ...brandDnaData, nayaIntelligenceSummary: null, lastStrategyRefreshAt: null, updatedAt: new Date() } as any)
        .where(eq(brandDna.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(brandDna)
      .values({ ...brandDnaData, userId, projectId } as any)
      .returning();
    return inserted;
  }

  // Project operations
  async getProjects(userId: string, limit = 50, offset = 0): Promise<Project[]> {
    return await db.select().from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.isPrimary), projects.createdAt)
      .limit(limit)
      .offset(offset);
  }

  async getProject(id: number, userId: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)));
    return project;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(data).returning();
    return project;
  }

  async updateProject(id: number, userId: string, data: Partial<Project>): Promise<Project | null> {
    const [project] = await db.update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    return project || null;
  }

  async deleteProject(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getPrimaryProject(userId: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.isPrimary, true)));
    return project;
  }

  async setPrimaryProject(id: number, userId: string): Promise<Project | null> {
    // Unset all primary flags first
    await db.update(projects)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(projects.userId, userId));
    // Set the new primary
    const [project] = await db.update(projects)
      .set({ isPrimary: true, priorityLevel: 'primary', updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    return project || null;
  }

  // Project goal operations
  async getProjectGoal(id: number): Promise<ProjectGoal | null> {
    const [goal] = await db.select().from(projectGoals).where(eq(projectGoals.id, id));
    return goal || null;
  }

  async getProjectGoals(projectId: number): Promise<ProjectGoal[]> {
    return await db.select().from(projectGoals)
      .where(eq(projectGoals.projectId, projectId))
      .orderBy(projectGoals.createdAt);
  }

  async getActiveGoalsForProject(projectId: number): Promise<ProjectGoal[]> {
    return await db.select().from(projectGoals)
      .where(and(eq(projectGoals.projectId, projectId), eq(projectGoals.status, 'active')))
      .orderBy(projectGoals.createdAt);
  }

  async createProjectGoal(data: InsertProjectGoal): Promise<ProjectGoal> {
    const [goal] = await db.insert(projectGoals).values(data).returning();
    return goal;
  }

  async updateProjectGoal(id: number, data: Partial<ProjectGoal>): Promise<ProjectGoal | null> {
    const [goal] = await db.update(projectGoals)
      .set(data)
      .where(eq(projectGoals.id, id))
      .returning();
    return goal || null;
  }

  async deleteProjectGoal(id: number): Promise<boolean> {
    const result = await db.delete(projectGoals).where(eq(projectGoals.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getGoalProgress(goalId: number): Promise<{ completed: number; total: number }> {
    const rows = await db
      .select({ completed: tasks.completed })
      .from(tasks)
      .where(eq(tasks.goalId, goalId));
    return {
      total: rows.length,
      completed: rows.filter(r => r.completed).length,
    };
  }

  // Project strategy profile operations
  async getProjectStrategyProfile(projectId: number): Promise<ProjectStrategyProfile | undefined> {
    const [profile] = await db.select().from(projectStrategyProfiles)
      .where(eq(projectStrategyProfiles.projectId, projectId));
    return profile;
  }

  async upsertProjectStrategyProfile(data: InsertProjectStrategyProfile): Promise<ProjectStrategyProfile> {
    const [profile] = await db.insert(projectStrategyProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: projectStrategyProfiles.projectId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return profile;
  }

  // User preferences
  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return prefs;
  }

  async upsertUserPreferences(userId: string, data: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    const [prefs] = await db.insert(userPreferences)
      .values({ userId, ...data })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return prefs;
  }

  // Day availability
  async getDayAvailability(userId: string, date: string): Promise<DayAvailability | undefined> {
    const [row] = await db.select().from(dayAvailability)
      .where(and(eq(dayAvailability.userId, userId), eq(dayAvailability.date, date)));
    return row;
  }

  async getDayAvailabilityRange(userId: string, startDate: string, endDate: string): Promise<DayAvailability[]> {
    return await db.select().from(dayAvailability)
      .where(and(
        eq(dayAvailability.userId, userId),
        gte(dayAvailability.date, startDate),
        lte(dayAvailability.date, endDate),
      ));
  }

  async upsertDayAvailability(userId: string, date: string, data: Partial<InsertDayAvailability>): Promise<DayAvailability> {
    const existing = await this.getDayAvailability(userId, date);
    if (existing) {
      const [row] = await db.update(dayAvailability)
        .set({ ...data })
        .where(and(eq(dayAvailability.userId, userId), eq(dayAvailability.date, date)))
        .returning();
      return row;
    }
    const [row] = await db.insert(dayAvailability)
      .values({ userId, date, ...data })
      .returning();
    return row;
  }

  // Task schedule events
  async createScheduleEvent(data: InsertTaskScheduleEvent): Promise<TaskScheduleEvent> {
    const [event] = await db.insert(taskScheduleEvents).values(data).returning();
    return event;
  }

  async getScheduleEvents(taskId: number): Promise<TaskScheduleEvent[]> {
    return await db.select().from(taskScheduleEvents)
      .where(eq(taskScheduleEvents.taskId, taskId))
      .orderBy(desc(taskScheduleEvents.createdAt));
  }

  // Quick capture
  async createCaptureEntry(data: InsertQuickCaptureEntry): Promise<QuickCaptureEntry> {
    const [entry] = await db.insert(quickCaptureEntries).values(data).returning();
    return entry;
  }

  async getCaptureEntries(userId: string, processed?: boolean): Promise<QuickCaptureEntry[]> {
    const conditions = [eq(quickCaptureEntries.userId, userId)];
    if (processed === false) conditions.push(eq(quickCaptureEntries.isProcessed, false));
    if (processed === true) conditions.push(eq(quickCaptureEntries.isProcessed, true));
    return await db.select().from(quickCaptureEntries)
      .where(and(...conditions))
      .orderBy(desc(quickCaptureEntries.createdAt));
  }

  async updateCaptureEntry(id: number, userId: string, data: Partial<QuickCaptureEntry>): Promise<QuickCaptureEntry | null> {
    const [entry] = await db.update(quickCaptureEntries)
      .set(data)
      .where(and(eq(quickCaptureEntries.id, id), eq(quickCaptureEntries.userId, userId)))
      .returning();
    return entry || null;
  }

  async deleteCaptureEntry(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(quickCaptureEntries)
      .where(and(eq(quickCaptureEntries.id, id), eq(quickCaptureEntries.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Persona operations
  async getUserPersonaArchetypes(): Promise<UserPersona[]> {
    return await db.select().from(userPersonas).orderBy(userPersonas.id);
  }

  async upsertUserPersona(data: InsertUserPersona): Promise<UserPersona> {
    const existing = await db.select().from(userPersonas).where(eq(userPersonas.name, data.name));
    if (existing.length > 0) return existing[0];
    const [persona] = await db.insert(userPersonas).values(data).returning();
    return persona;
  }

  async getTargetPersonas(userId: string, projectId?: number): Promise<TargetPersona[]> {
    const conditions = [eq(targetPersonas.userId, userId)];
    if (projectId !== undefined) conditions.push(eq(targetPersonas.projectId, projectId));
    return await db.select().from(targetPersonas)
      .where(and(...conditions))
      .orderBy(desc(targetPersonas.createdAt));
  }

  async createTargetPersona(data: InsertTargetPersona): Promise<TargetPersona> {
    const [persona] = await db.insert(targetPersonas).values(data).returning();
    return persona;
  }

  async deleteTargetPersona(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(targetPersonas)
      .where(and(eq(targetPersonas.id, id), eq(targetPersonas.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async savePersonaAnalysisResult(data: InsertPersonaAnalysisResult): Promise<PersonaAnalysisResult> {
    const [result] = await db.insert(personaAnalysisResults).values(data).returning();
    return result;
  }

  async getLatestPersonaAnalysis(userId: string, personaType: string): Promise<PersonaAnalysisResult | undefined> {
    const [result] = await db.select().from(personaAnalysisResults)
      .where(and(eq(personaAnalysisResults.userId, userId), eq(personaAnalysisResults.personaType, personaType)))
      .orderBy(desc(personaAnalysisResults.createdAt))
      .limit(1);
    return result;
  }

  // Task operations
  async getTask(taskId: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    return task;
  }

  async getTasks(userId: string, dueDate?: Date, projectId?: number, campaignId?: number): Promise<Task[]> {
    // Les tâches archivées (« Ignorer » → archivedAt non nul) sont exclues GLOBALEMENT de toutes
    // les surfaces actives (Planning, Today, analytics). Pour les retrouver : getArchivedTasks().
    const conditions = [eq(tasks.userId, userId), isNull(tasks.archivedAt)];
    if (dueDate) {
      const startOfDay = new Date(dueDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dueDate);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(gte(tasks.dueDate, startOfDay), lte(tasks.dueDate, endOfDay));
    }
    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId));
    }
    if (campaignId !== undefined) {
      conditions.push(eq(tasks.campaignId, campaignId));
    }
    return await db.select().from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.priority), tasks.createdAt);
  }

  async getTomorrowPreviewData(userId: string, projectId?: number): Promise<{ carryover: Task[]; scheduledTomorrow: Task[]; approachingDeadlines: any[] }> {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(now); tomorrowStart.setDate(now.getDate() + 1); tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(now); tomorrowEnd.setDate(now.getDate() + 1); tomorrowEnd.setHours(23, 59, 59, 999);
    const in7Days = new Date(now); in7Days.setDate(now.getDate() + 7);

    const baseConditions = [eq(tasks.userId, userId), isNull(tasks.archivedAt)];
    if (projectId) baseConditions.push(eq(tasks.projectId, projectId));

    const todayConditions = [...baseConditions, eq(tasks.completed, false), gte(tasks.dueDate, todayStart), lte(tasks.dueDate, todayEnd)];
    const tomorrowConditions = [...baseConditions, eq(tasks.completed, false), gte(tasks.dueDate, tomorrowStart), lte(tasks.dueDate, tomorrowEnd)];

    const [carryover, scheduledTomorrow] = await Promise.all([
      db.select().from(tasks).where(and(...todayConditions)).orderBy(desc(tasks.priority)).limit(3),
      db.select().from(tasks).where(and(...tomorrowConditions)).orderBy(desc(tasks.priority)).limit(5),
    ]);

    const goalConditions = [eq(projectGoals.status, 'active'), lte(projectGoals.dueDate, in7Days), gte(projectGoals.dueDate, now)];
    let goalsQuery = db.select({ id: projectGoals.id, title: projectGoals.title, dueDate: projectGoals.dueDate, successMode: projectGoals.successMode, projectId: projectGoals.projectId })
      .from(projectGoals)
      .innerJoin(projects, eq(projectGoals.projectId, projects.id))
      .where(and(eq(projects.userId, userId), ...goalConditions))
      .limit(3);

    const approachingDeadlines = await goalsQuery;

    return { carryover, scheduledTomorrow, approachingDeadlines };
  }

  async createTask(task: InsertTask): Promise<Task> {
    // ── Auto-assignation d'horaire ─────────────────────────────────────────
    // Cœur produit : une tâche DATÉE doit avoir une HEURE de réalisation (Naya
    // place les tâches dans la semaine). Les générateurs (goal-tasks, pré-génération
    // stratégique) ne fournissent qu'une date suggérée → on place ici la tâche au
    // premier créneau libre (respecte heures/jours de travail + tâches existantes).
    // Couvre TOUS les chemins de création, pas seulement la route POST /api/tasks.
    // Exclusions : jalons (all-day) et tâches `fixed` (ancrées par l'utilisateur).
    if (
      task.userId &&
      task.scheduledDate &&
      (typeof task.scheduledTime !== 'string' || !/^\d{2}:\d{2}$/.test(task.scheduledTime as string)) &&
      (task as any).type !== 'milestone' &&
      (task as any).schedulingMode !== 'fixed'
    ) {
      const duration = (task.estimatedDuration as number) || 30;
      const slot = await this.findFirstFreeSlot(task.userId as string, task.scheduledDate as string, duration);
      const [h, m] = slot.time.split(':').map(Number);
      const endMin = h * 60 + m + duration;
      const endStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      task = { ...task, scheduledDate: slot.date, scheduledTime: slot.time, scheduledEndTime: endStr };
    }

    // ── Slot-collision guard ───────────────────────────────────────────────
    // Règle non négociable : deux tâches ne sont jamais planifiées en même temps.
    // Toute tâche avec une date + une heure concrètes est décalée au prochain
    // créneau libre si le slot est déjà occupé. S'applique à TOUS les chemins de
    // création (auto-planner, companion, jalons, manuel…), pas seulement certains.
    // Exception : les tâches `fixed` (ancrées par l'utilisateur, ex. un rendez-vous)
    // gardent leur heure — ce sont les autres tâches qui les évitent.
    if (
      task.userId &&
      task.scheduledDate &&
      typeof task.scheduledTime === 'string' &&
      /^\d{2}:\d{2}$/.test(task.scheduledTime) &&
      task.schedulingMode !== 'fixed'
    ) {
      const duration = (task.estimatedDuration as number) || 30;
      const check = await this.checkSlotAvailability(
        task.userId as string,
        task.scheduledDate as string,
        task.scheduledTime,
        duration,
      );
      if (!check.available && check.nextAvailableTime) {
        const start = check.nextAvailableTime;
        const [h, m] = start.split(':').map(Number);
        const endMin = h * 60 + m + duration;
        const endStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
        task = { ...task, scheduledTime: start, scheduledEndTime: endStr };
      }
    }

    const [newTask] = await db.insert(tasks).values(task).returning();
    return newTask;
  }

  async updateTask(id: number, updates: Partial<Task>): Promise<Task> {
    const [updatedTask] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return updatedTask;
  }

  async completeTask(id: number): Promise<Task> {
    const [completedTask] = await db
      .update(tasks)
      .set({ completed: true, completedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return completedTask;
  }

  async toggleTaskCompletion(id: number): Promise<Task> {
    const [current] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!current) throw new Error("Task not found");
    const [updated] = await db
      .update(tasks)
      .set({
        completed: !current.completed,
        completedAt: !current.completed ? new Date() : null,
      })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  // Content operations
  async getContent(userId: string, limit = 50, projectId?: number, campaignId?: number): Promise<Content[]> {
    const conditions = [eq(content.userId, userId)];
    if (projectId !== undefined) conditions.push(eq(content.projectId, projectId));
    if (campaignId !== undefined) conditions.push(eq((content as any).campaignId, campaignId));
    return await db.select().from(content)
      .where(and(...conditions))
      .orderBy(desc(content.createdAt))
      .limit(limit);
  }

  async getContentById(id: number, userId: string): Promise<Content | undefined> {
    const [item] = await db.select().from(content)
      .where(and(eq(content.id, id), eq(content.userId, userId)));
    return item;
  }

  async createContent(contentData: InsertContent): Promise<Content> {
    const [newContent] = await db.insert(content).values(contentData).returning();
    return newContent;
  }

  async updateContent(id: number, updates: Partial<Content>): Promise<Content> {
    const [updatedContent] = await db.update(content)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(content.id, id))
      .returning();
    return updatedContent;
  }

  async getContentByStatus(userId: string, status: string, projectId?: number): Promise<Content[]> {
    const conditions = [eq(content.userId, userId), eq(content.status, status)];
    if (projectId !== undefined) conditions.push(eq(content.projectId, projectId));
    return await db.select().from(content)
      .where(and(...conditions))
      .orderBy(desc(content.createdAt));
  }

  async deleteContent(id: number): Promise<void> {
    await db.delete(content).where(eq(content.id, id));
  }

  // ── Auto-publication des posts programmés ────────────────────────────────
  // Renvoie les contenus dont l'heure de publication vient d'être atteinte et
  // qui attendent encore d'être postés (autoPost activé, pas déjà publiés).
  //
  // FENÊTRE DE GRÂCE (sécurité critique) : on ne publie QUE les posts dont
  // l'heure prévue est dans [now - grâce, now]. Un post en retard de plus que
  // la fenêtre (ex. programmé il y a plusieurs jours) n'est JAMAIS auto-publié
  // — sinon le worker « viderait » tout l'arriéré d'un coup. Ces posts restent
  // en attente et devront être republiés/replanifiés manuellement.
  // Réglable via SOCIAL_PUBLISH_GRACE_MINUTES (défaut 120 min).
  async getDueScheduledContent(now: Date): Promise<Content[]> {
    const graceMin = parseInt(process.env.SOCIAL_PUBLISH_GRACE_MINUTES || '120', 10);
    const earliest = new Date(now.getTime() - graceMin * 60 * 1000);
    return await db.select().from(content)
      .where(and(
        eq(content.autoPost, true),
        eq(content.postStatus, 'pending'),
        isNull(content.publishedAt),
        isNotNull(content.scheduledFor),
        lte(content.scheduledFor, now),
        gte(content.scheduledFor, earliest),
      ))
      .orderBy(content.scheduledFor)
      .limit(25);
  }

  /** Contenus dont la vidéo est en cours de traitement (conteneur async à finaliser). */
  async getProcessingContent(): Promise<Content[]> {
    return await db.select().from(content)
      .where(and(
        eq(content.postStatus, 'processing'),
        isNotNull(content.providerContainerId),
      ))
      .limit(25);
  }

  // Claim atomique : passe pending → posting une seule fois. Renvoie false si
  // un autre passage du worker a déjà pris ce contenu (anti double-publication).
  async claimContentForPosting(id: number): Promise<boolean> {
    const claimed = await db.update(content)
      .set({ postStatus: 'posting', updatedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.postStatus, 'pending')))
      .returning({ id: content.id });
    return claimed.length > 0;
  }

  async deleteCampaignFutureContent(campaignId: number, fromDate: string): Promise<number> {
    const deleted = await db.delete(content).where(
      and(
        eq((content as any).campaignId, campaignId),
        gte(content.scheduledFor, new Date(fromDate + 'T00:00:00'))
      )
    ).returning({ id: content.id });
    return deleted.length;
  }

  async deleteAllCampaignContent(campaignId: number): Promise<number> {
    const deleted = await db.delete(content).where(
      eq((content as any).campaignId, campaignId)
    ).returning({ id: content.id });
    return deleted.length;
  }

  // ─── Prospection Campaign operations ─────────────────────────────────────────
  async getProspectionCampaigns(userId: string): Promise<ProspectionCampaign[]> {
    return await db.select().from(prospectionCampaigns)
      .where(eq(prospectionCampaigns.userId, userId))
      .orderBy(desc(prospectionCampaigns.createdAt));
  }

  async getProspectionCampaign(id: number): Promise<ProspectionCampaign | null> {
    const [c] = await db.select().from(prospectionCampaigns).where(eq(prospectionCampaigns.id, id));
    return c || null;
  }

  async createProspectionCampaign(campaign: InsertProspectionCampaign): Promise<ProspectionCampaign> {
    const [c] = await db.insert(prospectionCampaigns).values(campaign).returning();
    return c;
  }

  async updateProspectionCampaign(id: number, userId: string, updates: Partial<ProspectionCampaign>): Promise<ProspectionCampaign | null> {
    const [c] = await db.update(prospectionCampaigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(prospectionCampaigns.id, id), eq(prospectionCampaigns.userId, userId)))
      .returning();
    return c || null;
  }

  // Suppression d'une campagne de prospection AVEC cascade (les FK n'ont pas ON DELETE CASCADE) :
  // - prospects : ARCHIVÉS (soft-delete réversible) + détachés de la campagne
  // - séquences (steps + états d'enrôlement) : supprimées
  // - tracking de coûts : campaign_id remis à NULL (historique préservé)
  // - campagne marketing liée : lien remis à NULL
  // Le tout dans une transaction pour rester cohérent.
  async deleteProspectionCampaign(id: number, userId: string): Promise<void> {
    const [owned] = await db.select({ id: prospectionCampaigns.id }).from(prospectionCampaigns)
      .where(and(eq(prospectionCampaigns.id, id), eq(prospectionCampaigns.userId, userId)));
    if (!owned) return; // inexistante ou pas au user → no-op

    await db.transaction(async (tx) => {
      // Prospects : archiver (réversible) + détacher pour lever la FK
      await tx.update(leads)
        .set({ archivedAt: new Date(), prospectionCampaignId: null, updatedAt: new Date() })
        .where(and(eq(leads.prospectionCampaignId, id), eq(leads.userId, userId)));
      // Séquences liées à la campagne
      await tx.delete(leadSequenceState).where(eq(leadSequenceState.campaignId, id));
      await tx.delete(campaignSequenceSteps).where(eq(campaignSequenceSteps.campaignId, id));
      // Tracking de coûts : conserver la ligne, retirer la référence
      await tx.update(prospectionUsage).set({ campaignId: null }).where(eq(prospectionUsage.campaignId, id));
      // Campagne marketing qui pointait vers cette prospection : délier
      await tx.update(campaigns).set({ linkedProspectionCampaignId: null } as any)
        .where(eq((campaigns as any).linkedProspectionCampaignId, id));
      // Enfin, la campagne elle-même
      await tx.delete(prospectionCampaigns)
        .where(and(eq(prospectionCampaigns.id, id), eq(prospectionCampaigns.userId, userId)));
    });
  }

  // ─── Séquences de prospection ──────────────────────────────────────────────

  async getSequenceSteps(campaignId: number): Promise<CampaignSequenceStep[]> {
    return await db.select().from(campaignSequenceSteps)
      .where(eq(campaignSequenceSteps.campaignId, campaignId))
      .orderBy(campaignSequenceSteps.stepOrder);
  }

  async replaceSequenceSteps(
    campaignId: number,
    userId: string,
    steps: Array<{ stepOrder: number; channel: string; delayDays: number; subjectTemplate?: string | null; bodyTemplate: string }>,
  ): Promise<CampaignSequenceStep[]> {
    // Fetch old step IDs and purge dependent leadStepMessages before deletion
    const oldStepIds = (
      await db.select({ id: campaignSequenceSteps.id })
        .from(campaignSequenceSteps)
        .where(eq(campaignSequenceSteps.campaignId, campaignId))
    ).map((r) => r.id);
    if (oldStepIds.length > 0) {
      await db.delete(leadStepMessages).where(inArray(leadStepMessages.stepId, oldStepIds));
    }

    await db.delete(campaignSequenceSteps).where(eq(campaignSequenceSteps.campaignId, campaignId));
    if (steps.length === 0) return [];
    const rows = await db.insert(campaignSequenceSteps).values(
      steps.map(s => ({
        campaignId,
        userId,
        stepOrder: s.stepOrder,
        channel: s.channel,
        delayDays: s.delayDays,
        subjectTemplate: s.subjectTemplate ?? null,
        bodyTemplate: s.bodyTemplate,
      })),
    ).returning();
    return rows;
  }

  // Plan de séquence multicanal généré par l'IA (canal intelligent + branches conditionnelles).
  // Remplace toute la séquence existante — pas de bodyTemplate/subjectTemplate : le texte réel
  // est généré sur-mesure par prospect (voir leadStepMessages).
  async saveSequencePlan(campaignId: number, userId: string, plan: { steps: { channel: string; delayDays: number; intention: string; condition: string }[] }): Promise<void> {
    // Fetch old step IDs and purge dependent leadStepMessages before deletion
    const oldStepIds = (
      await db.select({ id: campaignSequenceSteps.id })
        .from(campaignSequenceSteps)
        .where(eq(campaignSequenceSteps.campaignId, campaignId))
    ).map((r) => r.id);
    if (oldStepIds.length > 0) {
      await db.delete(leadStepMessages).where(inArray(leadStepMessages.stepId, oldStepIds));
    }

    await db.delete(campaignSequenceSteps).where(eq(campaignSequenceSteps.campaignId, campaignId));
    if (plan.steps.length === 0) return;
    await db.insert(campaignSequenceSteps).values(plan.steps.map((s, i) => ({
      campaignId, userId, stepOrder: i + 1,
      channel: s.channel, delayDays: s.delayDays, intention: s.intention, condition: s.condition,
      bodyTemplate: null, subjectTemplate: null, isActive: true,
    })));
  }

  async getLeadSequenceState(leadId: number): Promise<LeadSequenceState | undefined> {
    const [s] = await db.select().from(leadSequenceState).where(eq(leadSequenceState.leadId, leadId));
    return s;
  }

  async enrollLead(leadId: number, campaignId: number, userId: string): Promise<LeadSequenceState | null> {
    const steps = await this.getSequenceSteps(campaignId);
    if (steps.length === 0) return null; // pas de séquence définie → rien à enrôler
    const firstDelayDays = steps[0].delayDays || 0;
    const nextRunAt = new Date(Date.now() + firstDelayDays * 86400000);

    const existing = await this.getLeadSequenceState(leadId);
    const values = {
      leadId, campaignId, userId,
      status: "active", currentStep: 0, nextRunAt,
      lastStepSentAt: null, repliedAt: null,
    };
    if (existing) {
      const [updated] = await db.update(leadSequenceState)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(leadSequenceState.leadId, leadId)).returning();
      return updated || null;
    }
    const [created] = await db.insert(leadSequenceState).values(values).returning();
    return created || null;
  }

  async updateLeadSequenceState(leadId: number, updates: Partial<LeadSequenceState>): Promise<LeadSequenceState | null> {
    const [updated] = await db.update(leadSequenceState)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leadSequenceState.leadId, leadId)).returning();
    return updated || null;
  }

  async getDueEnrollments(now: Date, limit: number = 50): Promise<LeadSequenceState[]> {
    return await db.select().from(leadSequenceState)
      .where(and(
        eq(leadSequenceState.status, "active"),
        isNotNull(leadSequenceState.nextRunAt),
        lte(leadSequenceState.nextRunAt, now),
      ))
      .orderBy(leadSequenceState.nextRunAt)
      .limit(limit);
  }

  async getLeadStepMessage(leadId: number, stepId: number): Promise<LeadStepMessage | undefined> {
    const [row] = await db.select().from(leadStepMessages)
      .where(and(eq(leadStepMessages.leadId, leadId), eq(leadStepMessages.stepId, stepId)));
    return row;
  }

  async upsertLeadStepMessage(row: InsertLeadStepMessage): Promise<void> {
    await db.insert(leadStepMessages).values(row)
      .onConflictDoUpdate({
        target: [leadStepMessages.leadId, leadStepMessages.stepId],
        set: { subject: row.subject ?? null, body: row.body!, edited: row.edited ?? false, generatedAt: new Date() },
      });
  }

  // Lead operations
  async getLeads(userId: string): Promise<Lead[]> {
    // Exclut les prospects archivés (soft-delete) des vues actives, comme les tâches.
    return await db.select().from(leads)
      .where(and(eq(leads.userId, userId), isNull(leads.archivedAt)))
      .orderBy(desc(leads.updatedAt));
  }

  async getLead(id: number, userId: string): Promise<Lead | undefined> {
    const [row] = await db.select().from(leads)
      .where(and(eq(leads.id, id), eq(leads.userId, userId)));
    return row;
  }

  async getLeadsByCampaign(campaignId: number, userId: string): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(
        eq(leads.userId, userId),
        eq(leads.prospectionCampaignId, campaignId),
        isNull(leads.archivedAt),
      ))
      .orderBy(desc(leads.updatedAt));
  }

  // Archivage groupé (soft-delete) : renvoie le nombre de prospects archivés (scopé userId).
  async bulkArchiveLeads(ids: number[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await db.update(leads)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(leads.id, ids), eq(leads.userId, userId), isNull(leads.archivedAt)))
      .returning({ id: leads.id });
    return rows.length;
  }

  // Déplacement groupé vers une campagne : met à jour prospection_campaign_id (scopé userId).
  async bulkMoveLeads(ids: number[], userId: string, campaignId: number): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await db.update(leads)
      .set({ prospectionCampaignId: campaignId, updatedAt: new Date() })
      .where(and(inArray(leads.id, ids), eq(leads.userId, userId), isNull(leads.archivedAt)))
      .returning({ id: leads.id });
    return rows.length;
  }

  async createLead(leadData: InsertLead): Promise<Lead> {
    const [newLead] = await db.insert(leads).values(leadData).returning();
    return newLead;
  }

  // ─── Journal des invocations IA (Phase 1) ───────────────────────────────────
  async createAiInvocation(entry: InsertAiInvocation): Promise<AiInvocation> {
    const [row] = await db.insert(aiInvocations).values(entry).returning();
    return row;
  }

  async getAiInvocations(opts?: { userId?: string; limit?: number }): Promise<AiInvocation[]> {
    const limit = opts?.limit ?? 100;
    if (opts?.userId) {
      return db.select().from(aiInvocations)
        .where(eq(aiInvocations.userId, opts.userId))
        .orderBy(desc(aiInvocations.createdAt))
        .limit(limit);
    }
    return db.select().from(aiInvocations)
      .orderBy(desc(aiInvocations.createdAt))
      .limit(limit);
  }

  async updateLead(id: number, userId: string, updates: Partial<Lead>): Promise<Lead | null> {
    const [updatedLead] = await db.update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.userId, userId)))
      .returning();
    return updatedLead || null;
  }

  async getLeadsByStatus(userId: string, status: string): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(and(eq(leads.userId, userId), eq(leads.status, status), isNull(leads.archivedAt)))
      .orderBy(desc(leads.updatedAt));
  }

  // Stampe l'acceptation de l'invitation LinkedIn — signal lu par le moteur de décision
  // (branches if_invite_accepted / if_invite_not_accepted). Poller Unipile (Task 7).
  async setLeadLinkedinConnected(leadId: number, at: Date): Promise<void> {
    await db.update(leads).set({ linkedinConnectedAt: at, updatedAt: new Date() }).where(eq(leads.id, leadId));
  }

  // Leads enrôlés (séquence active) dont l'invitation LinkedIn n'a pas encore été confirmée
  // acceptée — candidats au poller Unipile.
  async getLeadsAwaitingInvite(): Promise<{ id: number; userId: string; linkedinUrl: string | null }[]> {
    return await db.select({ id: leads.id, userId: leads.userId, linkedinUrl: leads.linkedinUrl })
      .from(leads)
      .innerJoin(leadSequenceState, eq(leadSequenceState.leadId, leads.id))
      .where(and(
        eq(leadSequenceState.status, "active"),
        isNull(leads.linkedinConnectedAt),
        isNull(leads.archivedAt),
      ));
  }

  // Outreach operations
  async getOutreachMessages(userId: string, leadId?: number): Promise<OutreachMessage[]> {
    if (leadId) {
      return await db.select().from(outreachMessages).where(
        and(eq(outreachMessages.userId, userId), eq(outreachMessages.leadId, leadId))
      ).orderBy(desc(outreachMessages.createdAt));
    }
    return await db.select().from(outreachMessages)
      .where(eq(outreachMessages.userId, userId))
      .orderBy(desc(outreachMessages.createdAt));
  }

  // Signaux de réception agrégés pour un prospect (ouverture/clic/bounce/réponse/invite acceptée).
  async getLeadSignals(leadId: number): Promise<LeadSignals> {
    const [msgs, leadRow, state] = await Promise.all([
      db.select().from(outreachMessages).where(eq(outreachMessages.leadId, leadId)),
      db.select().from(leads).where(eq(leads.id, leadId)).then((r) => r[0]),
      this.getLeadSequenceState(leadId),
    ]);
    return deriveSignals(
      msgs.map((m) => ({ platform: m.platform, openedAt: m.openedAt, clickedAt: m.clickedAt, bouncedAt: m.bouncedAt })),
      { linkedinConnectedAt: leadRow?.linkedinConnectedAt ?? null },
      { repliedAt: state?.repliedAt ?? null, status: state?.status ?? "active" },
    );
  }

  async createOutreachMessage(message: InsertOutreachMessage): Promise<OutreachMessage> {
    const [newMessage] = await db.insert(outreachMessages).values(message).returning();
    return newMessage;
  }

  async updateOutreachMessage(id: number, updates: Partial<OutreachMessage>): Promise<OutreachMessage> {
    const [updatedMessage] = await db.update(outreachMessages).set(updates)
      .where(eq(outreachMessages.id, id)).returning();
    return updatedMessage;
  }

  // Dernier message envoyé pour un lead (pour le webhook de tracking).
  async getLatestOutreachByLead(leadId: number): Promise<OutreachMessage | undefined> {
    const [m] = await db.select().from(outreachMessages)
      .where(and(eq(outreachMessages.leadId, leadId), isNotNull(outreachMessages.sentAt)))
      .orderBy(desc(outreachMessages.sentAt))
      .limit(1);
    return m;
  }

  // Tous les messages d'une liste de leads (pour l'analytics de campagne).
  async getOutreachForLeads(leadIds: number[]): Promise<OutreachMessage[]> {
    if (leadIds.length === 0) return [];
    return await db.select().from(outreachMessages).where(inArray(outreachMessages.leadId, leadIds));
  }

  // Nombre d'emails envoyés par un user depuis `since` (plafond anti-spam du worker).
  async countOutreachSentSince(userId: string, since: Date, platform?: string): Promise<number> {
    const rows = await db.select({ id: outreachMessages.id }).from(outreachMessages)
      .where(and(
        eq(outreachMessages.userId, userId),
        isNotNull(outreachMessages.sentAt),
        gte(outreachMessages.sentAt, since),
        ...(platform ? [eq(outreachMessages.platform, platform)] : []),
      ));
    return rows.length;
  }

  // Analytics de séquence par étape et par canal (Task 9). Agrégation faite côté TS
  // (helper pur testé) plutôt qu'en SQL — volumes faibles par campagne, code plus lisible.
  async getCampaignStepAnalytics(campaignId: number): Promise<{
    byStep: { stepOrder: number; channel: string; sent: number; opened: number; clicked: number; bounced: number }[];
    byChannel: { channel: string; sent: number; replied: number }[];
  }> {
    const campaignLeads = await db.select().from(leads)
      .where(and(eq(leads.prospectionCampaignId, campaignId), isNull(leads.archivedAt)));
    const leadIds = campaignLeads.map((l) => l.id);
    if (leadIds.length === 0) return { byStep: [], byChannel: [] };

    const messages = await this.getOutreachForLeads(leadIds);
    const states = await db.select().from(leadSequenceState).where(inArray(leadSequenceState.leadId, leadIds));
    const repliedLeadIds = new Set(
      states.filter((s) => s.status === "stopped_replied").map((s) => s.leadId),
    );

    return aggregateStepAnalytics(messages, repliedLeadIds);
  }

  // Metrics operations
  async getMetrics(userId: string, week?: string): Promise<Metrics | undefined> {
    if (week) {
      const [m] = await db.select().from(metrics).where(
        and(eq(metrics.userId, userId), eq(metrics.week, week))
      ).orderBy(desc(metrics.createdAt));
      return m;
    }
    const [m] = await db.select().from(metrics)
      .where(eq(metrics.userId, userId))
      .orderBy(desc(metrics.createdAt));
    return m;
  }

  async upsertMetrics(metricsData: InsertMetrics): Promise<Metrics> {
    const [metric] = await db.insert(metrics)
      .values(metricsData)
      .onConflictDoUpdate({
        target: [metrics.userId, metrics.week],
        set: { ...metricsData, createdAt: new Date() },
      })
      .returning();
    return metric;
  }

  // Strategy operations
  async getStrategyReport(userId: string, week?: string, projectId?: number | null): Promise<StrategyReport | undefined> {
    const conditions = [eq(strategyReports.userId, userId)];
    if (week) conditions.push(eq(strategyReports.week, week));
    if (projectId !== undefined) {
      if (projectId) conditions.push(eq(strategyReports.projectId, projectId));
      else conditions.push(isNull(strategyReports.projectId));
    }
    const [report] = await db.select().from(strategyReports)
      .where(and(...conditions))
      .orderBy(desc(strategyReports.createdAt))
      .limit(1);
    return report;
  }

  async createStrategyReport(report: InsertStrategyReport): Promise<StrategyReport> {
    const [newReport] = await db.insert(strategyReports).values(report).returning();
    return newReport;
  }

  async getWeeklyBriefing(userId: string, week: string): Promise<StrategyReport | undefined> {
    const [report] = await db.select().from(strategyReports)
      .where(and(
        eq(strategyReports.userId, userId),
        eq(strategyReports.week, week),
        isNull(strategyReports.projectId),
      ))
      .orderBy(desc(strategyReports.createdAt))
      .limit(1);
    return report;
  }

  async dismissWeeklyBriefing(userId: string, week: string): Promise<void> {
    await db.update(strategyReports)
      .set({ dismissed: true })
      .where(and(
        eq(strategyReports.userId, userId),
        eq(strategyReports.week, week),
        isNull(strategyReports.projectId),
      ));
  }

  // Saved articles
  async getSavedArticles(userId: string, category?: string): Promise<SavedArticle[]> {
    const conditions = [eq(savedArticles.userId, userId)];
    if (category && category !== 'all') conditions.push(eq(savedArticles.category, category));
    return await db.select().from(savedArticles)
      .where(and(...conditions))
      .orderBy(desc(savedArticles.createdAt));
  }

  async createSavedArticle(article: InsertSavedArticle): Promise<SavedArticle> {
    const [newArticle] = await db.insert(savedArticles).values(article).returning();
    return newArticle;
  }

  async updateSavedArticle(id: number, userId: string, updates: Partial<SavedArticle>): Promise<SavedArticle | null> {
    const [updated] = await db.update(savedArticles)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(savedArticles.id, id), eq(savedArticles.userId, userId)))
      .returning();
    return updated || null;
  }

  async deleteSavedArticle(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(savedArticles)
      .where(and(eq(savedArticles.id, id), eq(savedArticles.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSavedArticleById(id: number, userId: string): Promise<SavedArticle | undefined> {
    const [article] = await db.select().from(savedArticles)
      .where(and(eq(savedArticles.id, id), eq(savedArticles.userId, userId)));
    return article;
  }

  async markArticleAsRead(id: number, userId: string, isRead: boolean): Promise<SavedArticle | null> {
    const [updated] = await db.update(savedArticles)
      .set({ isRead, updatedAt: new Date() })
      .where(and(eq(savedArticles.id, id), eq(savedArticles.userId, userId)))
      .returning();
    return updated || null;
  }

  async toggleArticleFavorite(id: number, userId: string, isFavorite: boolean): Promise<SavedArticle | null> {
    const [updated] = await db.update(savedArticles)
      .set({ isFavorite, updatedAt: new Date() })
      .where(and(eq(savedArticles.id, id), eq(savedArticles.userId, userId)))
      .returning();
    return updated || null;
  }

  // Social account operations
  // Déchiffre les jetons d'un compte renvoyé par la DB (cf. token-crypto.ts).
  private decryptSocialAccount(account: SocialAccount): SocialAccount {
    return {
      ...account,
      accessToken: decryptToken(account.accessToken) as string,
      refreshToken: decryptToken(account.refreshToken),
    };
  }

  async getSocialAccounts(userId: string): Promise<SocialAccount[]> {
    const rows = await db.select().from(socialAccounts)
      .where(eq(socialAccounts.userId, userId))
      .orderBy(desc(socialAccounts.createdAt));
    return rows.map(r => this.decryptSocialAccount(r));
  }

  async createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount> {
    const values = {
      ...account,
      accessToken: encryptToken(account.accessToken),
      refreshToken: encryptNullable(account.refreshToken),
    };
    const [newAccount] = await db.insert(socialAccounts).values(values).returning();
    return this.decryptSocialAccount(newAccount);
  }

  async updateSocialAccount(id: number, userId: string, updates: Partial<SocialAccount>): Promise<SocialAccount | null> {
    const enc: Partial<SocialAccount> = { ...updates };
    if (typeof updates.accessToken === "string") enc.accessToken = encryptToken(updates.accessToken);
    if (updates.refreshToken !== undefined) enc.refreshToken = encryptNullable(updates.refreshToken);
    const [updated] = await db.update(socialAccounts)
      .set({ ...enc, updatedAt: new Date() })
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)))
      .returning();
    return updated ? this.decryptSocialAccount(updated) : null;
  }

  async deleteSocialAccount(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Suppression de tous les comptes liés à un identifiant utilisateur de plateforme
  // (utilisé par le callback Meta data deletion : signed_request.user_id).
  async deleteSocialAccountsByPlatformUserId(platformUserId: string): Promise<number> {
    const result = await db.delete(socialAccounts)
      .where(eq(socialAccounts.platformUserId, platformUserId));
    return result.rowCount ?? 0;
  }

  // ─── Abonnement & accès (Stripe) ───────────────────────────────────────────

  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return s;
  }

  async upsertSubscription(sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(sub.userId);
    if (existing) {
      const [updated] = await db.update(subscriptions)
        .set({ ...sub, updatedAt: new Date() })
        .where(eq(subscriptions.userId, sub.userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(subscriptions).values(sub).returning();
    return created;
  }

  // Fixe le plan prospection. Upsert : crée une ligne minimale si l'abonnement n'existe pas
  // encore (ex: utilisateur en essai sans objet Stripe complet).
  async setProspectionPlan(userId: string, plan: "base" | "enrichissement"): Promise<void> {
    await db.insert(subscriptions)
      .values({ userId, prospectionPlan: plan })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { prospectionPlan: plan, updatedAt: new Date() },
      });
  }

  async recordProspectionUsage(entry: InsertProspectionUsage): Promise<void> {
    await db.insert(prospectionUsage).values(entry);
  }

  async countProspectionOperationsSince(
    userId: string,
    operationTypes: string[],
    since: Date,
  ): Promise<number> {
    if (operationTypes.length === 0) return 0;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(prospectionUsage)
      .where(and(
        eq(prospectionUsage.userId, userId),
        inArray(prospectionUsage.operationType, operationTypes),
        gte(prospectionUsage.createdAt, since),
      ));
    return row?.n ?? 0;
  }

  async setUserRole(userId: string, role: string): Promise<void> {
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async setUserRoleByEmail(email: string, role: string): Promise<boolean> {
    const res = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.email, email));
    return (res.rowCount ?? 0) > 0;
  }

  async getAccessCodeByCode(code: string): Promise<AccessCode | undefined> {
    const [c] = await db.select().from(accessCodes).where(eq(accessCodes.code, code));
    return c;
  }

  async createAccessCode(input: { code: string; label?: string; maxRedemptions?: number | null; expiresAt?: Date | null }): Promise<AccessCode> {
    const [c] = await db.insert(accessCodes).values({
      code: input.code,
      label: input.label ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
    }).returning();
    return c;
  }

  async hasRedeemed(codeId: number, userId: string): Promise<boolean> {
    const [r] = await db.select().from(accessCodeRedemptions)
      .where(and(eq(accessCodeRedemptions.codeId, codeId), eq(accessCodeRedemptions.userId, userId)));
    return !!r;
  }

  async recordRedemption(codeId: number, userId: string): Promise<void> {
    await db.insert(accessCodeRedemptions).values({ codeId, userId });
    await db.update(accessCodes)
      .set({ redemptionCount: sql`${accessCodes.redemptionCount} + 1` })
      .where(eq(accessCodes.id, codeId));
  }

  async isStripeEventProcessed(eventId: string): Promise<boolean> {
    const [e] = await db.select().from(processedStripeEvents).where(eq(processedStripeEvents.eventId, eventId));
    return !!e;
  }

  async markStripeEventProcessed(eventId: string): Promise<void> {
    await db.insert(processedStripeEvents).values({ eventId }).onConflictDoNothing();
  }

  async getSocialAccountById(id: number, userId: string): Promise<SocialAccount | undefined> {
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
    return account ? this.decryptSocialAccount(account) : undefined;
  }

  async getSocialAccountByPlatform(userId: string, platform: string): Promise<SocialAccount | undefined> {
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.platform, platform)));
    return account ? this.decryptSocialAccount(account) : undefined;
  }

  private toSafeSocialAccount(account: SocialAccount): SafeSocialAccount {
    const { accessToken, refreshToken, ...safeAccount } = account;
    return safeAccount;
  }

  async getSafeSocialAccounts(userId: string): Promise<SafeSocialAccount[]> {
    const accounts = await this.getSocialAccounts(userId);
    return accounts.map(a => this.toSafeSocialAccount(a));
  }

  async createSafeSocialAccount(account: InsertSocialAccount): Promise<SafeSocialAccount> {
    const newAccount = await this.createSocialAccount(account);
    return this.toSafeSocialAccount(newAccount);
  }

  async updateSafeSocialAccount(id: number, userId: string, updates: Partial<SocialAccount>): Promise<SafeSocialAccount | null> {
    const updated = await this.updateSocialAccount(id, userId, updates);
    return updated ? this.toSafeSocialAccount(updated) : null;
  }

  async getSafeSocialAccountById(id: number, userId: string): Promise<SafeSocialAccount | undefined> {
    const account = await this.getSocialAccountById(id, userId);
    return account ? this.toSafeSocialAccount(account) : undefined;
  }

  // Media library operations
  async getMediaLibrary(userId: string): Promise<MediaLibrary[]> {
    return await db.select().from(mediaLibrary)
      .where(eq(mediaLibrary.userId, userId))
      .orderBy(desc(mediaLibrary.createdAt));
  }

  async createMediaItem(media: InsertMediaLibrary): Promise<MediaLibrary> {
    const [newMedia] = await db.insert(mediaLibrary).values(media).returning();
    return newMedia;
  }

  async updateMediaItem(id: number, userId: string, updates: Partial<MediaLibrary>): Promise<MediaLibrary | null> {
    const [updated] = await db.update(mediaLibrary)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(mediaLibrary.id, id), eq(mediaLibrary.userId, userId)))
      .returning();
    return updated || null;
  }

  async deleteMediaItem(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(mediaLibrary)
      .where(and(eq(mediaLibrary.id, id), eq(mediaLibrary.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getMediaItemById(id: number, userId: string): Promise<MediaLibrary | undefined> {
    const [media] = await db.select().from(mediaLibrary)
      .where(and(eq(mediaLibrary.id, id), eq(mediaLibrary.userId, userId)));
    return media;
  }

  // User Operating Profile operations
  async getUserOperatingProfile(userId: string): Promise<UserOperatingProfile | undefined> {
    const [profile] = await db.select().from(userOperatingProfiles)
      .where(eq(userOperatingProfiles.userId, userId));
    return profile;
  }

  async upsertUserOperatingProfile(userId: string, data: Partial<InsertUserOperatingProfile>): Promise<UserOperatingProfile> {
    const existing = await this.getUserOperatingProfile(userId);
    if (existing) {
      const [updated] = await db.update(userOperatingProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userOperatingProfiles.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(userOperatingProfiles)
        .values({ userId, ...data })
        .returning();
      return created;
    }
  }

  async deleteBrandDna(userId: string): Promise<boolean> {
    const result = await db.delete(brandDna).where(eq(brandDna.userId, userId));
    return (result.rowCount ?? 0) > 0;
  }

  async resetUserOnboardingState(userId: string): Promise<void> {
    console.log(`[reset] Starting full onboarding reset for user ${userId}`);

    await db.transaction(async (tx) => {
      // Ordre FK-safe : on supprime TOUJOURS les enfants avant les parents.
      // (Beaucoup de FK sont en ON DELETE NO ACTION → une seule table enfant oubliée
      //  faisait échouer tout le reset. Liste dérivée du graphe de FK réel.)

      // IDs nécessaires pour les tables sans user_id.
      const projRows = await tx.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId));
      const projectIds = projRows.map((p) => p.id);
      const mileRows = await tx.select({ id: projectMilestones.id }).from(projectMilestones).where(eq(projectMilestones.userId, userId));
      const milestoneIds = mileRows.map((m) => m.id);
      const listRows = await tx.select({ id: taskLists.id }).from(taskLists).where(eq(taskLists.userId, userId));
      const listIds = listRows.map((l) => l.id);
      const personaRows = await tx.select({ id: targetPersonas.id }).from(targetPersonas).where(eq(targetPersonas.userId, userId));
      const personaIds = personaRows.map((p) => p.id);

      // ── Phase 1 : libérer les FK des enregistrements qu'on GARDE ──────────────
      console.log(`[reset] phase 1: clearing kept references (captures, preferences)`);
      await tx.update(quickCaptureEntries)
        .set({ convertedToTaskId: null, projectId: null })
        .where(eq(quickCaptureEntries.userId, userId));
      await tx.update(userPreferences)
        .set({ activeProjectId: null })
        .where(eq(userPreferences.userId, userId));

      // ── Phase 2 : enfants de TASKS, puis tasks ────────────────────────────────
      console.log(`[reset] phase 2: task children + tasks`);
      await tx.delete(companionPendingMessages).where(eq(companionPendingMessages.userId, userId)); // related_task_id → tasks
      await tx.delete(taskWorkspaceEntries).where(eq(taskWorkspaceEntries.userId, userId));         // task_id/project_id
      await tx.delete(taskFeedback).where(eq(taskFeedback.userId, userId));                         // project_id
      await tx.delete(taskScheduleEvents).where(eq(taskScheduleEvents.userId, userId));             // task_id (NOT NULL)
      // task_dependencies → tasks en CASCADE (auto)
      await tx.delete(tasks).where(eq(tasks.userId, userId));

      // ── Phase 3 : enfants de LEADS, puis leads ────────────────────────────────
      console.log(`[reset] phase 3: lead children + leads`);
      await tx.delete(leadSequenceState).where(eq(leadSequenceState.userId, userId)); // lead_id (NOT NULL)
      await tx.delete(outreachMessages).where(eq(outreachMessages.userId, userId));   // lead_id (NOT NULL)
      await tx.delete(leads).where(eq(leads.userId, userId));

      // ── Phase 4 : content, puis campagnes (content/tasks les référencent) ─────
      console.log(`[reset] phase 4: content + campaigns`);
      await tx.delete(content).where(eq(content.userId, userId));                 // campaign_id, project_id
      await tx.delete(campaigns).where(eq(campaigns.userId, userId));             // project_id
      await tx.delete(prospectionCampaigns).where(eq(prospectionCampaigns.userId, userId)); // project_id

      // ── Phase 5 : jalons (conditions avant milestones) + triggers ─────────────
      console.log(`[reset] phase 5: milestones`);
      if (milestoneIds.length > 0) {
        await tx.delete(milestoneConditions).where(inArray(milestoneConditions.milestoneId, milestoneIds));
      }
      await tx.delete(projectMilestones).where(eq(projectMilestones.userId, userId)); // project_id
      await tx.delete(milestoneTriggers).where(eq(milestoneTriggers.userId, userId)); // project_id

      // ── Phase 6 : task lists (items avant lists) ──────────────────────────────
      console.log(`[reset] phase 6: task lists`);
      if (listIds.length > 0) {
        await tx.delete(taskListItems).where(inArray(taskListItems.listId, listIds));
      }
      await tx.delete(taskLists).where(eq(taskLists.userId, userId)); // project_id

      // ── Phase 7 : personas ────────────────────────────────────────────────────
      console.log(`[reset] phase 7: personas`);
      if (personaIds.length > 0) {
        await tx.delete(personaStrategyMapping).where(inArray(personaStrategyMapping.targetPersonaId, personaIds));
      }
      await tx.delete(personaAnalysisResults).where(eq(personaAnalysisResults.userId, userId));
      await tx.delete(targetPersonas).where(eq(targetPersonas.userId, userId)); // project_id

      // ── Phase 8 : autres enfants de PROJECTS ──────────────────────────────────
      console.log(`[reset] phase 8: remaining project children`);
      if (projectIds.length > 0) {
        await tx.delete(projectGoals).where(inArray(projectGoals.projectId, projectIds));
        await tx.delete(projectStrategyProfiles).where(inArray(projectStrategyProfiles.projectId, projectIds));
      }
      await tx.delete(clients).where(eq(clients.userId, userId));                 // parent_project_id
      await tx.delete(strategyReports).where(eq(strategyReports.userId, userId)); // project_id
      await tx.delete(brandDna).where(eq(brandDna.userId, userId));               // project_id (AVANT projects!)
      await tx.delete(memoryEntries).where(eq(memoryEntries.userId, userId));     // mémoire Naya (reset all data)

      // ── Phase 9 : projects ────────────────────────────────────────────────────
      console.log(`[reset] phase 9: projects`);
      await tx.delete(projects).where(eq(projects.userId, userId));

      // ── Phase 10 : profil opératoire ──────────────────────────────────────────
      console.log(`[reset] phase 10: operating profile`);
      await tx.delete(userOperatingProfiles).where(eq(userOperatingProfiles.userId, userId));
    });

    console.log(`[reset] Onboarding reset complete for user ${userId}`);
  }

  async deleteUser(userId: string): Promise<boolean> {
    // Cascade: delete all user data first, then the user record
    await db.delete(behavioralSignals).where(eq(behavioralSignals.userId, userId));
    await db.delete(userOperatingProfiles).where(eq(userOperatingProfiles.userId, userId));
    await db.delete(quickCaptureEntries).where(eq(quickCaptureEntries.userId, userId));
    await db.delete(taskScheduleEvents).where(eq(taskScheduleEvents.userId, userId));
    await db.delete(tasks).where(eq(tasks.userId, userId));
    await db.delete(brandDna).where(eq(brandDna.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
    // Delete project goals via projects
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    for (const p of userProjects) {
      await db.delete(projectGoals).where(eq(projectGoals.projectId, p.id));
      await db.delete(projectStrategyProfiles).where(eq(projectStrategyProfiles.projectId, p.id));
    }
    await db.delete(projects).where(eq(projects.userId, userId));
    await db.delete(personaAnalysisResults).where(eq(personaAnalysisResults.userId, userId));
    await db.delete(targetPersonas).where(eq(targetPersonas.userId, userId));
    const result = await db.delete(users).where(eq(users.id, userId));
    return (result.rowCount ?? 0) > 0;
  }

  // Behavioral Signal operations
  async createBehavioralSignal(data: InsertBehavioralSignal): Promise<BehavioralSignal> {
    const [signal] = await db.insert(behavioralSignals).values(data).returning();
    return signal;
  }

  async getBehavioralSignals(userId: string, limit = 20): Promise<BehavioralSignal[]> {
    return await db.select().from(behavioralSignals)
      .where(eq(behavioralSignals.userId, userId))
      .orderBy(desc(behavioralSignals.createdAt))
      .limit(limit);
  }

  async getWorkspaceEntries(taskId: number): Promise<TaskWorkspaceEntry[]> {
    return await db.select().from(taskWorkspaceEntries)
      .where(eq(taskWorkspaceEntries.taskId, taskId))
      .orderBy(desc(taskWorkspaceEntries.createdAt));
  }

  async createWorkspaceEntry(data: InsertTaskWorkspaceEntry): Promise<TaskWorkspaceEntry> {
    const [entry] = await db.insert(taskWorkspaceEntries).values(data).returning();
    return entry;
  }

  async updateWorkspaceEntry(id: number, updates: { content?: string; title?: string }): Promise<TaskWorkspaceEntry> {
    const [entry] = await db.update(taskWorkspaceEntries)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(taskWorkspaceEntries.id, id))
      .returning();
    return entry;
  }

  async getRecentWorkspaceEntries(userId: string, projectId?: number, limit = 20): Promise<TaskWorkspaceEntry[]> {
    const conditions = projectId
      ? and(eq(taskWorkspaceEntries.userId, userId), eq(taskWorkspaceEntries.projectId, projectId))
      : eq(taskWorkspaceEntries.userId, userId);
    return await db.select().from(taskWorkspaceEntries)
      .where(conditions)
      .orderBy(desc(taskWorkspaceEntries.createdAt))
      .limit(limit);
  }

  async createTaskFeedback(data: InsertTaskFeedback): Promise<TaskFeedback> {
    const [row] = await db.insert(taskFeedback).values(data).returning();
    return row;
  }

  async getRecentTaskFeedback(userId: string, projectId?: number, limit = 30): Promise<TaskFeedback[]> {
    const conditions = projectId
      ? and(eq(taskFeedback.userId, userId), eq(taskFeedback.projectId, projectId))
      : eq(taskFeedback.userId, userId);
    return await db.select().from(taskFeedback)
      .where(conditions)
      .orderBy(desc(taskFeedback.createdAt))
      .limit(limit);
  }

  async updateTaskFeedback(id: number, data: Partial<InsertTaskFeedback>): Promise<TaskFeedback> {
    const [row] = await db.update(taskFeedback).set(data).where(eq(taskFeedback.id, id)).returning();
    return row;
  }

  async deleteTask(taskId: number): Promise<void> {
    // Nullify FK references before deleting (no cascade on these)
    await db.update(quickCaptureEntries)
      .set({ convertedToTaskId: null })
      .where(eq(quickCaptureEntries.convertedToTaskId, taskId));
    await db.update(companionPendingMessages)
      .set({ relatedTaskId: null })
      .where(eq(companionPendingMessages.relatedTaskId, taskId));
    // Delete child records
    await db.delete(taskScheduleEvents).where(eq(taskScheduleEvents.taskId, taskId));
    await db.delete(taskWorkspaceEntries).where(eq(taskWorkspaceEntries.taskId, taskId));
    // Delete the task (taskDependencies cascade automatically)
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }

  async checkSlotAvailability(
    userId: string,
    date: string,
    startTime: string,
    durationMinutes: number,
    excludeTaskId?: number
  ): Promise<{ available: boolean; nextAvailableTime?: string }> {
    const conditions = [
      eq(tasks.userId, userId),
      eq(tasks.scheduledDate, date),
      eq(tasks.completed, false),
    ];
    if (excludeTaskId) conditions.push(ne(tasks.id, excludeTaskId) as any);

    const dayTasks = await db.select().from(tasks).where(and(...conditions as any[]));

    const parseMin = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const formatMin = (min: number): string =>
      `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

    const newStart = parseMin(startTime);
    const newEnd = newStart + durationMinutes;

    // Build occupied intervals from tasks that have a scheduled time…
    const occupied = dayTasks
      .filter(t => t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime))
      .map(t => ({
        start: parseMin(t.scheduledTime!),
        end: parseMin(t.scheduledTime!) + (t.estimatedDuration || 30),
      }));

    // …ET des événements Google Calendar (rendez-vous). Une tâche ne doit jamais
    // se poser par-dessus un rendez-vous. Import dynamique pour éviter une
    // dépendance circulaire ; si GCal est indisponible, on continue sans bloquer.
    try {
      const { getCalendarBlockedRanges } = await import('./services/google-calendar');
      const calRanges = await getCalendarBlockedRanges(userId, date);
      for (const r of calRanges) occupied.push({ start: r.start, end: r.end });
    } catch { /* GCal optionnel — ne bloque pas la création de tâche */ }

    occupied.sort((a, b) => a.start - b.start);

    // Check if proposed slot is free
    const hasOverlap = occupied.some(r => newStart < r.end && newEnd > r.start);
    if (!hasOverlap) return { available: true };

    // Scan forward to find next free slot
    let candidate = newStart;
    for (let tries = 0; tries < 96; tries++) { // max 48h forward scan
      const candidateEnd = candidate + durationMinutes;
      const blocking = occupied.find(r => candidate < r.end && candidateEnd > r.start);
      if (!blocking) return { available: false, nextAvailableTime: formatMin(candidate) };
      candidate = blocking.end; // jump past blocking task
    }

    return { available: false, nextAvailableTime: formatMin(candidate) };
  }

  async findFirstFreeSlot(userId: string, fromDate: string, durationMinutes: number): Promise<{ date: string; time: string }> {
    const prefs = await this.getUserPreferences(userId);
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
    // Use UTC to avoid timezone-shift bugs with toISOString()
    const parseDateUTC = (ds: string) => { const [y,m,d] = ds.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
    const isWorkDay = (ds: string) => workDaySet.has(DAY_ABBRS_LOCAL[parseDateUTC(ds).getUTCDay()]);
    const nextDay = (ds: string): string => {
      const d = parseDateUTC(ds);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    let currentDate = fromDate;
    for (let guard = 0; guard < 14; guard++) {
      if (!isWorkDay(currentDate)) { currentDate = nextDay(currentDate); continue; }

      const dayTasks = await db.select({ scheduledTime: tasks.scheduledTime, estimatedDuration: tasks.estimatedDuration })
        .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.scheduledDate, currentDate), eq(tasks.completed, false)));

      const occupied = dayTasks
        .filter(t => t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime))
        .map(t => ({ start: parseMin(t.scheduledTime!), end: parseMin(t.scheduledTime!) + (t.estimatedDuration || 30) }));

      // Inclure les rendez-vous Google Calendar comme créneaux occupés.
      try {
        const { getCalendarBlockedRanges } = await import('./services/google-calendar');
        const calRanges = await getCalendarBlockedRanges(userId, currentDate);
        for (const r of calRanges) occupied.push({ start: r.start, end: r.end });
      } catch { /* GCal optionnel */ }

      occupied.sort((a, b) => a.start - b.start);

      let candidate = DAY_START;
      while (candidate + durationMinutes <= DAY_END) {
        const candidateEnd = candidate + durationMinutes;
        if (lunchEnabled && candidate < LUNCH_END && candidateEnd > LUNCH_START) { candidate = LUNCH_END; continue; }
        const blocking = occupied.find(r => candidate < r.end && candidateEnd > r.start);
        if (!blocking) return { date: currentDate, time: formatMin(candidate) };
        candidate = blocking.end;
      }
      currentDate = nextDay(currentDate);
    }

    return { date: fromDate, time: formatMin(DAY_START) };
  }

  async fixOverlappingTasks(userId: string, fromDate: string): Promise<number> {
    const [toFix, prefs] = await Promise.all([
      db.select().from(tasks).where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, false),
        gte(tasks.scheduledDate, fromDate),
      )),
      this.getUserPreferences(userId),
    ]);

    const parseTime = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const formatTime = (min: number): string => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const dayStartMin   = parseTime(prefs?.workDayStart || '09:00');
    const dayEndMin     = parseTime(prefs?.workDayEnd   || '18:00');
    const lunchStartMin = parseTime(prefs?.lunchBreakStart || '12:00');
    const lunchEndMin   = parseTime(prefs?.lunchBreakEnd   || '13:00');
    const lunchEnabled  = prefs?.lunchBreakEnabled !== false;

    // « Maintenant » et « aujourd'hui » en heure de Paris — pour ne JAMAIS
    // replanifier une tâche du jour courant dans le passé.
    const parisToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const parisNowMin = parseTime(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()));

    // Grouper par date, ignorer les tâches sans heure valide.
    const byDate = new Map<string, typeof toFix>();
    for (const t of toFix) {
      if (!t.scheduledDate || !t.scheduledTime || !/^\d{2}:\d{2}$/.test(t.scheduledTime)) continue;
      if (!byDate.has(t.scheduledDate)) byDate.set(t.scheduledDate, []);
      byDate.get(t.scheduledDate)!.push(t);
    }

    let fixed = 0;
    for (const [date, dayTasks] of Array.from(byDate.entries())) {
      const repackTasks = dayTasks.map(t => ({
        id: t.id,
        startMin: parseTime(t.scheduledTime!),
        durationMin: t.estimatedDuration || 30,
      }));

      const { moves, overflow } = repackDay(repackTasks, {
        dayStartMin, dayEndMin, lunchStartMin, lunchEndMin, lunchEnabled,
        floorMin: date === parisToday ? parisNowMin : undefined,
      });

      for (const mv of moves) {
        await db.update(tasks)
          .set({ scheduledTime: formatTime(mv.newStartMin), scheduledEndTime: formatTime(mv.newEndMin) })
          .where(eq(tasks.id, mv.id));
        fixed++;
      }
      // Tâches qui débordent des heures de travail → déplanifiées (repassent en « non planifiées »,
      // glissables sur la grille). On NE les place jamais hors des heures de travail.
      for (const id of overflow) {
        await db.update(tasks)
          .set({ scheduledTime: null, scheduledEndTime: null })
          .where(eq(tasks.id, id));
        fixed++;
      }
    }
    return fixed;
  }

  async deleteIncompleteFutureTasks(userId: string, fromDate: string): Promise<number> {
    const toDelete = await db.select({ id: tasks.id })
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, false),
        gte(tasks.scheduledDate, fromDate),
      ));
    for (const { id } of toDelete) {
      await db.delete(taskScheduleEvents).where(eq(taskScheduleEvents.taskId, id));
      await db.delete(taskWorkspaceEntries).where(eq(taskWorkspaceEntries.taskId, id));
      await db.delete(tasks).where(eq(tasks.id, id));
    }
    return toDelete.length;
  }

  async archiveIncompleteFutureTasks(userId: string, fromDate: string): Promise<number> {
    const toArchive = await db.select({ id: tasks.id })
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, false),
        gte(tasks.scheduledDate, fromDate),
      ));
    for (const { id } of toArchive) {
      await db.update(tasks).set({
        source: 'archived',
        scheduledDate: null,
        scheduledTime: null,
        scheduledEndTime: null,
      }).where(eq(tasks.id, id));
    }
    return toArchive.length;
  }

  async getTaskDependencies(taskId: number): Promise<TaskDependency[]> {
    return await db.select().from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId))
      .orderBy(desc(taskDependencies.createdAt));
  }

  async createTaskDependency(data: InsertTaskDependency): Promise<TaskDependency> {
    const [row] = await db.insert(taskDependencies).values(data).returning();
    return row;
  }

  async deleteTaskDependency(id: number): Promise<void> {
    await db.delete(taskDependencies).where(eq(taskDependencies.id, id));
  }

  async getTaskDependenciesForUser(userId: string, projectId?: number): Promise<TaskDependency[]> {
    const userTasks = await db.select({ id: tasks.id }).from(tasks)
      .where(projectId
        ? and(eq(tasks.userId, userId), eq(tasks.projectId, projectId))
        : eq(tasks.userId, userId)
      );
    if (userTasks.length === 0) return [];
    const taskIds = userTasks.map(t => t.id);
    return await db.select().from(taskDependencies)
      .where(inArray(taskDependencies.taskId, taskIds))
      .orderBy(desc(taskDependencies.createdAt));
  }

  async getTasksInRange(userId: string, startDate: string, endDate: string, projectId?: number): Promise<Task[]> {
    // Archivées exclues globalement (cf. getTasks). Aucune surface active (Planning/Today) ne
    // doit afficher une tâche archivée. Récupération explicite via getArchivedTasks().
    const conditions = projectId
      ? and(eq(tasks.userId, userId), isNull(tasks.archivedAt), eq(tasks.projectId, projectId), gte(tasks.scheduledDate, startDate), lte(tasks.scheduledDate, endDate))
      : and(eq(tasks.userId, userId), isNull(tasks.archivedAt), gte(tasks.scheduledDate, startDate), lte(tasks.scheduledDate, endDate));
    return await db.select().from(tasks)
      .where(conditions)
      .orderBy(tasks.scheduledDate);
  }

  // Tâches ARCHIVÉES uniquement (archivedAt non nul) — surface explicite pour les retrouver.
  // N'est jamais utilisée par les widgets actifs.
  async getArchivedTasks(userId: string, projectId?: number): Promise<Task[]> {
    const conditions = [eq(tasks.userId, userId), isNotNull(tasks.archivedAt)];
    if (projectId) conditions.push(eq(tasks.projectId, projectId));
    return await db.select().from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.archivedAt));
  }

  async getRecentScheduleEvents(userId: string, limit = 40): Promise<TaskScheduleEvent[]> {
    return await db.select().from(taskScheduleEvents)
      .where(eq(taskScheduleEvents.userId, userId))
      .orderBy(desc(taskScheduleEvents.createdAt))
      .limit(limit);
  }

  // Client operations
  async createClient(data: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(data).returning();
    return client;
  }

  async getClients(userId: string, projectId: number): Promise<Client[]> {
    return await db.select().from(clients)
      .where(and(eq(clients.userId, userId), eq(clients.parentProjectId, projectId), eq(clients.isActive, true)))
      .orderBy(desc(clients.createdAt));
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async updateClient(id: number, data: Partial<InsertClient>): Promise<Client> {
    const [updated] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
    return updated;
  }

  async deleteClient(id: number): Promise<void> {
    await db.update(clients).set({ isActive: false }).where(eq(clients.id, id));
  }

  async getClientTasks(clientId: number): Promise<Task[]> {
    return await db.select().from(tasks).where(eq(tasks.clientId, clientId)).orderBy(desc(tasks.priority), tasks.createdAt);
  }

  // Milestone Trigger operations
  async createMilestoneTrigger(data: InsertMilestoneTrigger): Promise<MilestoneTrigger> {
    const [trigger] = await db.insert(milestoneTriggers).values(data).returning();
    return trigger;
  }

  async getMilestoneTriggers(userId: string, status?: string): Promise<MilestoneTrigger[]> {
    const conditions = [eq(milestoneTriggers.userId, userId)];
    if (status) conditions.push(eq(milestoneTriggers.status, status));
    return await db.select().from(milestoneTriggers)
      .where(and(...conditions))
      .orderBy(desc(milestoneTriggers.createdAt));
  }

  async getMilestoneTrigger(id: number): Promise<MilestoneTrigger | undefined> {
    const [trigger] = await db.select().from(milestoneTriggers).where(eq(milestoneTriggers.id, id));
    return trigger;
  }

  async updateMilestoneTrigger(id: number, data: Partial<MilestoneTrigger>): Promise<MilestoneTrigger | null> {
    const [updated] = await db.update(milestoneTriggers)
      .set(data)
      .where(eq(milestoneTriggers.id, id))
      .returning();
    return updated || null;
  }

  async deleteMilestoneTrigger(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(milestoneTriggers)
      .where(and(eq(milestoneTriggers.id, id), eq(milestoneTriggers.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getCampaigns(userId: string, projectId?: number): Promise<Campaign[]> {
    const conditions = [eq(campaigns.userId, userId)];
    if (projectId !== undefined) {
      conditions.push(eq(campaigns.projectId, projectId));
    }
    return await db.select().from(campaigns)
      .where(and(...conditions))
      .orderBy(desc(campaigns.createdAt));
  }

  async getCampaign(id: number, userId: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
    return campaign;
  }

  async createCampaign(data: InsertCampaign): Promise<Campaign> {
    const [campaign] = await db.insert(campaigns).values(data).returning();
    return campaign;
  }

  async updateCampaign(id: number, userId: string, data: Partial<Campaign>): Promise<Campaign> {
    const [campaign] = await db.update(campaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .returning();
    return campaign;
  }

  async deleteCampaign(id: number, userId: string): Promise<void> {
    // Cascade : supprimer d'abord la/les campagne(s) de prospection liée(s) à cette campagne
    // marketing (lien dans les deux sens : campaigns.linkedProspectionCampaignId ET
    // prospectionCampaigns.linkedCampaignId), avec leur propre cascade (prospects, séquences…).
    const linkedIds = new Set<number>();
    const [camp] = await db.select({ linked: (campaigns as any).linkedProspectionCampaignId })
      .from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
    if (camp?.linked) linkedIds.add(camp.linked as number);
    const backrefs = await db.select({ id: prospectionCampaigns.id }).from(prospectionCampaigns)
      .where(and(eq((prospectionCampaigns as any).linkedCampaignId, id), eq(prospectionCampaigns.userId, userId)));
    for (const b of backrefs) linkedIds.add(b.id);
    for (const pcId of Array.from(linkedIds)) {
      await this.deleteProspectionCampaign(pcId, userId);
    }
    await db.delete(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
  }

  async deleteCampaignFutureTasks(campaignId: number, fromDate: string): Promise<number> {
    const deleted = await db.delete(tasks).where(
      and(
        eq(tasks.campaignId, campaignId),
        eq(tasks.completed, false),
        gte(tasks.scheduledDate, fromDate)
      )
    ).returning({ id: tasks.id });
    return deleted.length;
  }

  async deleteAllIncompleteCampaignTasks(campaignId: number): Promise<number> {
    const deleted = await db.delete(tasks).where(
      and(
        eq(tasks.campaignId, campaignId),
        eq(tasks.completed, false)
      )
    ).returning({ id: tasks.id });
    return deleted.length;
  }

  async getBusinessMemories(userId: string, opts?: { archived?: boolean; limit?: number }): Promise<BusinessMemory[]> {
    const conditions = [eq(businessMemory.userId, userId)];
    if (opts?.archived !== undefined) {
      conditions.push(eq(businessMemory.archived, opts.archived));
    }
    const rows = await db.select().from(businessMemory)
      .where(and(...conditions))
      .orderBy(desc(businessMemory.createdAt))
      .limit(opts?.limit || 100);
    return rows;
  }

  async createBusinessMemory(data: InsertBusinessMemory): Promise<BusinessMemory> {
    const [row] = await db.insert(businessMemory).values(data).returning();
    return row;
  }

  async updateBusinessMemory(id: number, userId: string, data: Partial<BusinessMemory>): Promise<BusinessMemory | null> {
    const [row] = await db.update(businessMemory)
      .set(data)
      .where(and(eq(businessMemory.id, id), eq(businessMemory.userId, userId)))
      .returning();
    return row || null;
  }

  async archiveBusinessMemory(id: number, userId: string): Promise<BusinessMemory | null> {
    return this.updateBusinessMemory(id, userId, { archived: true });
  }

  // ─── Task Lists ──────────────────────────────────────────────────────────────

  async createTaskList(data: { userId: string; projectId?: number | null; title: string; linkedTaskId?: number | null; linkedDate?: string | null; listType?: string; createdByCompanion?: boolean }): Promise<TaskList> {
    const [row] = await db.insert(taskLists).values(data).returning();
    return row;
  }

  async createTaskListItem(data: { listId: number; title: string; order?: number }): Promise<TaskListItem> {
    const [row] = await db.insert(taskListItems).values(data).returning();
    return row;
  }

  async getTaskList(id: number, userId: string): Promise<(TaskList & { items: TaskListItem[] }) | null> {
    const [list] = await db.select().from(taskLists).where(and(eq(taskLists.id, id), eq(taskLists.userId, userId)));
    if (!list) return null;
    const items = await db.select().from(taskListItems).where(eq(taskListItems.listId, id)).orderBy(taskListItems.order);
    return { ...list, items };
  }

  async updateTaskListItem(id: number, data: { completed?: boolean }): Promise<TaskListItem | null> {
    const [row] = await db.update(taskListItems).set(data).where(eq(taskListItems.id, id)).returning();
    return row || null;
  }

  // ─── Companion Conversations ─────────────────────────────────────────────────

  async saveCompanionMessage(data: { userId: string; role: string; content: string; actions?: any; platform?: string }): Promise<CompanionConversation> {
    const [row] = await db.insert(companionConversations).values(data).returning();
    return row;
  }

  async getCompanionHistory(userId: string, limit = 20): Promise<CompanionConversation[]> {
    return db.select().from(companionConversations)
      .where(eq(companionConversations.userId, userId))
      .orderBy(desc(companionConversations.createdAt))
      .limit(limit)
      .then(rows => rows.reverse()); // Retourner dans l'ordre chronologique
  }

  // ─── Companion Pending Messages ───────────────────────────────────────────

  async createPendingMessage(data: {
    userId: string;
    message: string;
    triggerType: string;
    relatedTaskId?: number | null;
  }) {
    const [row] = await db
      .insert(companionPendingMessages)
      .values(data)
      .returning();
    return row;
  }

  async getPendingMessages(userId: string) {
    return db
      .select()
      .from(companionPendingMessages)
      .where(
        and(
          eq(companionPendingMessages.userId, userId),
          eq(companionPendingMessages.isRead, false)
        )
      )
      .orderBy(desc(companionPendingMessages.createdAt));
  }

  async markPendingMessageRead(id: number) {
    await db
      .update(companionPendingMessages)
      .set({ isRead: true })
      .where(eq(companionPendingMessages.id, id));
  }

  async getPendingMessageByTaskAndType(taskId: number, triggerType: string) {
    const [row] = await db
      .select({ id: companionPendingMessages.id })
      .from(companionPendingMessages)
      .where(
        and(
          eq(companionPendingMessages.relatedTaskId, taskId),
          eq(companionPendingMessages.triggerType, triggerType),
          eq(companionPendingMessages.isRead, false)
        )
      )
      .limit(1);
    return row;
  }

  async getStuckTasks(userId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    return db
      .select({
        id: tasks.id,
        title: tasks.title,
        learnedAdjustmentCount: tasks.learnedAdjustmentCount,
        scheduledDate: tasks.scheduledDate,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.completed, false),
          gte(tasks.scheduledDate, sevenDaysAgoStr),
          gte(tasks.learnedAdjustmentCount, 2)
        )
      )
      .orderBy(desc(tasks.learnedAdjustmentCount))
      .limit(10);
  }

  // ─── Project Milestones ───────────────────────────────────────────────────

  async getMilestones(projectId: number, userId: string): Promise<ProjectMilestone[]> {
    return db.select().from(projectMilestones)
      .where(and(eq(projectMilestones.projectId, projectId), eq(projectMilestones.userId, userId)))
      .orderBy(projectMilestones.order);
  }

  async getMilestone(id: number): Promise<ProjectMilestone | undefined> {
    const [m] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, id));
    return m;
  }

  async createMilestone(data: InsertProjectMilestone): Promise<ProjectMilestone> {
    const [m] = await db.insert(projectMilestones).values(data).returning();
    return m;
  }

  async updateMilestone(id: number, data: Partial<ProjectMilestone>): Promise<ProjectMilestone | null> {
    const [m] = await db.update(projectMilestones).set(data).where(eq(projectMilestones.id, id)).returning();
    return m || null;
  }

  async deleteMilestone(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(projectMilestones)
      .where(and(eq(projectMilestones.id, id), eq(projectMilestones.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Milestone Conditions ────────────────────────────────────────────────

  async getMilestoneConditions(milestoneId: number): Promise<MilestoneCondition[]> {
    return db.select().from(milestoneConditions)
      .where(eq(milestoneConditions.milestoneId, milestoneId));
  }

  async createMilestoneCondition(data: InsertMilestoneCondition): Promise<MilestoneCondition> {
    const [c] = await db.insert(milestoneConditions).values(data).returning();
    return c;
  }

  async fulfillCondition(id: number): Promise<MilestoneCondition | null> {
    const [c] = await db.update(milestoneConditions)
      .set({ isFulfilled: true, fulfilledAt: new Date() })
      .where(eq(milestoneConditions.id, id))
      .returning();
    return c || null;
  }

  async getPendingDurationConditions(): Promise<MilestoneCondition[]> {
    return db.select().from(milestoneConditions)
      .where(and(
        eq(milestoneConditions.conditionType, 'duration_elapsed'),
        eq(milestoneConditions.isFulfilled, false),
      ));
  }

  // ─── Tâches bloquées par jalon ───────────────────────────────────────────

  async unblockTasksForMilestone(milestoneId: number): Promise<void> {
    await db.update(tasks)
      .set({ isBlockedByMilestone: false })
      .where(and(eq(tasks.milestoneId, milestoneId), eq(tasks.isBlockedByMilestone, true)));
  }

  /**
   * Stats des tâches RÉELLES liées à des jalons (pour la date logique + la progression).
   * Renvoie, par milestoneId : les dates planifiées des tâches + le nb total/terminées.
   * Exclut les anciennes tâches-jalons (type='milestone').
   */
  async getMilestoneTaskStats(
    userId: string,
    milestoneIds: number[],
  ): Promise<Record<number, { dates: string[]; done: number; total: number }>> {
    if (milestoneIds.length === 0) return {};
    const rows = await db
      .select({ milestoneId: tasks.milestoneId, scheduledDate: tasks.scheduledDate, completed: tasks.completed })
      .from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        inArray(tasks.milestoneId, milestoneIds),
        ne(tasks.type, "milestone"),
      ));
    const out: Record<number, { dates: string[]; done: number; total: number }> = {};
    for (const r of rows) {
      const id = r.milestoneId;
      if (id == null) continue;
      (out[id] ||= { dates: [], done: 0, total: 0 });
      out[id].total++;
      if (r.completed) out[id].done++;
      if (r.scheduledDate) out[id].dates.push(r.scheduledDate);
    }
    return out;
  }

  /** Complète la tâche-jalon (🏁) associée à un jalon confirmé/complété. */
  async completeMilestoneTask(milestoneId: number): Promise<void> {
    await db.update(tasks)
      .set({ completed: true, completedAt: new Date() })
      .where(and(eq(tasks.milestoneId, milestoneId), eq(tasks.completed, false)));
  }

  // ─── Google Calendar Token operations ────────────────────────────────────────

  async getGoogleCalendarToken(userId: string): Promise<GoogleCalendarToken | undefined> {
    const [token] = await db.select().from(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId));
    return token;
  }

  async upsertGoogleCalendarToken(data: InsertGoogleCalendarToken): Promise<GoogleCalendarToken> {
    const [row] = await db
      .insert(googleCalendarTokens)
      .values(data)
      .onConflictDoUpdate({
        target: googleCalendarTokens.userId,
        set: {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async deleteGoogleCalendarToken(userId: string): Promise<void> {
    await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId));
  }

  async hasGoogleCalendarToken(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: googleCalendarTokens.id })
      .from(googleCalendarTokens)
      .where(eq(googleCalendarTokens.userId, userId));
    return !!row;
  }

  // ─── Intelligence analytics ───────────────────────────────────────────────────

  /** Alias pour upsertUserPreferences — utilisé par les services d'intelligence */
  async updateUserPreferences(userId: string, data: Record<string, any>): Promise<void> {
    await this.upsertUserPreferences(userId, data as any);
  }

  /** Tâches complétées avec actualDuration renseigné (pour calibrage durées) */
  async getCompletedTasksWithDuration(userId: string, limit = 60): Promise<Task[]> {
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.completed, true),
        isNotNull(tasks.actualDuration),
        isNotNull(tasks.estimatedDuration),
      ))
      .orderBy(desc(tasks.completedAt))
      .limit(limit);
  }

  /** Historique des tâches sur N jours (complètes et incomplètes, pour analyse comportementale) */
  async getTaskHistory(userId: string, days = 90): Promise<Task[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        gte(tasks.scheduledDate, sinceStr),
      ))
      .orderBy(desc(tasks.scheduledDate));
  }

  /** Dépendances pour un ensemble de tâches (version multi-IDs pour dependency-sort) */
  async getTaskDependenciesForIds(taskIds: number[]): Promise<TaskDependency[]> {
    if (taskIds.length === 0) return [];
    return await db.select().from(taskDependencies)
      .where(inArray(taskDependencies.taskId, taskIds));
  }
}

export const storage = new DatabaseStorage();
