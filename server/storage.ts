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
  googleCalendarTokens,
  type GoogleCalendarToken,
  type InsertGoogleCalendarToken,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, isNotNull, inArray } from "drizzle-orm";

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

  // Task Dependency operations
  getTaskDependencies(taskId: number): Promise<TaskDependency[]>;
  createTaskDependency(data: InsertTaskDependency): Promise<TaskDependency>;
  deleteTaskDependency(id: number): Promise<void>;
  getTaskDependenciesForUser(userId: string, projectId?: number): Promise<TaskDependency[]>;

  // Task range query (for planning views)
  getTasksInRange(userId: string, startDate: string, endDate: string, projectId?: number): Promise<Task[]>;

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
  
  // Prospection Campaign operations
  getProspectionCampaigns(userId: string): Promise<ProspectionCampaign[]>;
  getProspectionCampaign(id: number): Promise<ProspectionCampaign | null>;
  createProspectionCampaign(campaign: InsertProspectionCampaign): Promise<ProspectionCampaign>;
  updateProspectionCampaign(id: number, userId: string, updates: Partial<ProspectionCampaign>): Promise<ProspectionCampaign | null>;
  deleteProspectionCampaign(id: number, userId: string): Promise<void>;

  // Lead operations
  getLeads(userId: string): Promise<Lead[]>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: number, userId: string, updates: Partial<Lead>): Promise<Lead | null>;
  getLeadsByStatus(userId: string, status: string): Promise<Lead[]>;
  
  // Outreach operations
  getOutreachMessages(userId: string, leadId?: number): Promise<OutreachMessage[]>;
  createOutreachMessage(message: InsertOutreachMessage): Promise<OutreachMessage>;
  updateOutreachMessage(id: number, updates: Partial<OutreachMessage>): Promise<OutreachMessage>;
  
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
    const conditions = [eq(tasks.userId, userId)];
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

    const baseConditions = [eq(tasks.userId, userId)];
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

  async deleteProspectionCampaign(id: number, userId: string): Promise<void> {
    await db.delete(prospectionCampaigns)
      .where(and(eq(prospectionCampaigns.id, id), eq(prospectionCampaigns.userId, userId)));
  }

  // Lead operations
  async getLeads(userId: string): Promise<Lead[]> {
    return await db.select().from(leads)
      .where(eq(leads.userId, userId))
      .orderBy(desc(leads.updatedAt));
  }

  async createLead(leadData: InsertLead): Promise<Lead> {
    const [newLead] = await db.insert(leads).values(leadData).returning();
    return newLead;
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
      .where(and(eq(leads.userId, userId), eq(leads.status, status)))
      .orderBy(desc(leads.updatedAt));
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

  async createOutreachMessage(message: InsertOutreachMessage): Promise<OutreachMessage> {
    const [newMessage] = await db.insert(outreachMessages).values(message).returning();
    return newMessage;
  }

  async updateOutreachMessage(id: number, updates: Partial<OutreachMessage>): Promise<OutreachMessage> {
    const [updatedMessage] = await db.update(outreachMessages).set(updates)
      .where(eq(outreachMessages.id, id)).returning();
    return updatedMessage;
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
  async getSocialAccounts(userId: string): Promise<SocialAccount[]> {
    return await db.select().from(socialAccounts)
      .where(eq(socialAccounts.userId, userId))
      .orderBy(desc(socialAccounts.createdAt));
  }

  async createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount> {
    const [newAccount] = await db.insert(socialAccounts).values(account).returning();
    return newAccount;
  }

  async updateSocialAccount(id: number, userId: string, updates: Partial<SocialAccount>): Promise<SocialAccount | null> {
    const [updated] = await db.update(socialAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)))
      .returning();
    return updated || null;
  }

  async deleteSocialAccount(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSocialAccountById(id: number, userId: string): Promise<SocialAccount | undefined> {
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
    return account;
  }

  async getSocialAccountByPlatform(userId: string, platform: string): Promise<SocialAccount | undefined> {
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.platform, platform)));
    return account;
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
      // ── Step 1: Null FK references in records we are KEEPING ─────────────────
      // quickCaptureEntries.convertedToTaskId → tasks.id  (must be null before deleting tasks)
      // quickCaptureEntries.projectId → projects.id       (must be null before deleting projects)
      console.log(`[reset] Step 1: clearing quick capture references`);
      await tx.update(quickCaptureEntries)
        .set({ convertedToTaskId: null, projectId: null })
        .where(eq(quickCaptureEntries.userId, userId));

      // ── Step 2: Null activeProjectId BEFORE deleting projects ─────────────────
      // user_preferences.activeProjectId → projects.id (FK must be released first)
      console.log(`[reset] Step 2: clearing active project reference in preferences`);
      await tx.update(userPreferences)
        .set({ activeProjectId: null })
        .where(eq(userPreferences.userId, userId));

      // ── Step 3: Delete task schedule events before tasks ──────────────────────
      // taskScheduleEvents.taskId → tasks.id (NOT NULL FK)
      console.log(`[reset] Step 3: deleting task schedule events`);
      await tx.delete(taskScheduleEvents).where(eq(taskScheduleEvents.userId, userId));

      console.log(`[reset] Step 4: deleting tasks`);
      await tx.delete(tasks).where(eq(tasks.userId, userId));

      // ── Step 4: Delete persona_strategy_mapping before target_personas ────────
      // personaStrategyMapping.targetPersonaId → targetPersonas.id (FK)
      // personaStrategyMapping has no userId column, so join via targetPersonas
      console.log(`[reset] Step 5: deleting persona strategy mappings`);
      const userPersonaIds = await tx
        .select({ id: targetPersonas.id })
        .from(targetPersonas)
        .where(eq(targetPersonas.userId, userId));
      if (userPersonaIds.length > 0) {
        const ids = userPersonaIds.map((p) => p.id);
        await tx.delete(personaStrategyMapping)
          .where(inArray(personaStrategyMapping.targetPersonaId, ids));
      }

      // ── Step 5: Delete persona analysis results before target personas ────────
      // personaAnalysisResults.userPersonaId → userPersonas.id (we keep userPersonas)
      console.log(`[reset] Step 6: deleting persona analysis results`);
      await tx.delete(personaAnalysisResults).where(eq(personaAnalysisResults.userId, userId));

      console.log(`[reset] Step 7: deleting target personas`);
      await tx.delete(targetPersonas).where(eq(targetPersonas.userId, userId));

      // ── Step 6: Delete outreach data ──────────────────────────────────────────
      // outreachMessages.leadId → leads.id (NOT NULL FK — must delete messages before leads)
      console.log(`[reset] Step 8: deleting outreach messages`);
      await tx.delete(outreachMessages).where(eq(outreachMessages.userId, userId));

      console.log(`[reset] Step 9: deleting leads`);
      await tx.delete(leads).where(eq(leads.userId, userId));

      console.log(`[reset] Step 10: deleting content`);
      await tx.delete(content).where(eq(content.userId, userId));

      // ── Step 7: Delete project-scoped child records, then projects ─────────────
      // projectGoals.projectId → projects.id (NOT NULL FK)
      // projectStrategyProfiles.projectId → projects.id (NOT NULL FK)
      console.log(`[reset] Step 11: deleting project goals and strategy profiles`);
      const userProjects = await tx.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId));
      if (userProjects.length > 0) {
        const projectIds = userProjects.map((p) => p.id);
        await tx.delete(projectGoals).where(inArray(projectGoals.projectId, projectIds));
        await tx.delete(projectStrategyProfiles).where(inArray(projectStrategyProfiles.projectId, projectIds));
      }

      console.log(`[reset] Step 12: deleting projects`);
      await tx.delete(projects).where(eq(projects.userId, userId));

      // ── Step 8: Delete brand DNA and operating profile ────────────────────────
      console.log(`[reset] Step 13: deleting brand DNA`);
      await tx.delete(brandDna).where(eq(brandDna.userId, userId));

      console.log(`[reset] Step 14: deleting user operating profile`);
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
    const conditions = projectId
      ? and(eq(tasks.userId, userId), eq(tasks.projectId, projectId), gte(tasks.scheduledDate, startDate), lte(tasks.scheduledDate, endDate))
      : and(eq(tasks.userId, userId), gte(tasks.scheduledDate, startDate), lte(tasks.scheduledDate, endDate));
    return await db.select().from(tasks)
      .where(conditions)
      .orderBy(tasks.scheduledDate);
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
