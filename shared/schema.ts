import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique().notNull(),
  hashedPassword: varchar("hashed_password"),
  emailVerified: boolean("email_verified").default(false),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  expoPushToken: varchar("expo_push_token"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Multi-Project System ───────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  slug: text("slug"),
  icon: text("icon").default("📁"),
  color: text("color").default("#6366f1"),
  type: text("type").notNull().default("Business"), // Business | Personal Brand | Passion Project | Client Project | Agency | Internal | Lifestyle
  description: text("description"),
  monetizationIntent: text("monetization_intent").default("exploratory"), // revenue-now | authority-building | exploratory | none
  priorityLevel: text("priority_level").default("secondary"), // primary | secondary | background
  projectStatus: text("project_status").default("active"), // active | paused | incubating
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectGoals = pgTable("project_goals", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description"),
  goalType: text("goal_type").notNull().default("monthly"), // monthly | quarterly | milestone | revenue | visibility | consistency
  successMode: text("success_mode").notNull().default("visibility"), // revenue | visibility | consistency | exploration | learning | wellbeing
  targetValue: text("target_value"),
  currentValue: text("current_value"),
  timeframe: text("timeframe"),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("active"), // active | completed | paused
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectStrategyProfiles = pgTable("project_strategy_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projects.id),
  // Broader strategic fields
  projectIntent: text("project_intent"),
  successDefinition: text("success_definition"),
  operatingMode: text("operating_mode"), // create | build | grow | explore | maintain
  mainConstraint: text("main_constraint"), // time | money | audience | clarity
  currentStage: text("current_stage"), // ideation | early | growth | mature
  // Communication fields (nullable — not all projects have audience/positioning)
  targetAudience: text("target_audience"),
  corePainPoint: text("core_pain_point"),
  audienceAspiration: text("audience_aspiration"),
  communicationStyle: text("communication_style"),
  uniquePositioning: text("unique_positioning"),
  contentPillars: text("content_pillars").array(),
  platformPriority: text("platform_priority"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User preferences — server-side source of truth for active project
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  activeProjectId: integer("active_project_id").references(() => projects.id), // null = All Projects mode
  defaultView: text("default_view").default("list"),
  timezone: text("timezone").default("UTC"),
  workDayStart: text("work_day_start").default("09:00"), // HH:MM default working hours start
  workDayEnd: text("work_day_end").default("18:00"),     // HH:MM default working hours end
  workDays: text("work_days").default("mon,tue,wed,thu,fri"), // comma-separated day abbreviations
  lunchBreakEnabled: boolean("lunch_break_enabled").default(true),
  lunchBreakStart: text("lunch_break_start").default("12:00"), // HH:MM
  lunchBreakEnd: text("lunch_break_end").default("13:00"),     // HH:MM
  currentEnergyLevel: text("current_energy_level").default("high"), // high | medium | low | depleted
  currentEmotionalContext: text("current_emotional_context"),       // optional free text
  energyUpdatedDate: text("energy_updated_date"),                   // YYYY-MM-DD local date
  dailyBriefDate: text("daily_brief_date"),                         // YYYY-MM-DD — date of last generated brief
  dailyBriefContent: jsonb("daily_brief_content"),                  // stored brief JSON
  dailyBriefDismissed: boolean("daily_brief_dismissed").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Day availability — user declares daily working mode per date
export const dayAvailability = pgTable("day_availability", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // YYYY-MM-DD
  dayType: text("day_type").notNull().default("full"), // full | half-am | half-pm | off | travel | deep-work
  workStart: text("work_start"), // HH:MM — overrides user default for this day
  workEnd: text("work_end"),     // HH:MM — overrides user default for this day
  breaks: jsonb("breaks"),       // [{ start: "HH:MM", end: "HH:MM", label: string }]
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_day_availability_user_date").on(table.userId, table.date),
]);

export const insertDayAvailabilitySchema = createInsertSchema(dayAvailability).omit({ id: true, createdAt: true });
export type DayAvailability = typeof dayAvailability.$inferSelect;
export type InsertDayAvailability = z.infer<typeof insertDayAvailabilitySchema>;

// Task schedule events — scheduling history for adaptive learning
export const taskScheduleEvents = pgTable("task_schedule_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  previousStartTime: timestamp("previous_start_time"),
  newStartTime: timestamp("new_start_time"),
  previousEndTime: timestamp("previous_end_time"),
  newEndTime: timestamp("new_end_time"),
  changeType: text("change_type").notNull().default("moved"), // moved | resized | completed-early | skipped
  createdAt: timestamp("created_at").defaultNow(),
});

// Quick capture entries — intelligent inbox for unstructured thoughts
export const quickCaptureEntries = pgTable("quick_capture_entries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  content: text("content").notNull(),
  captureType: text("capture_type").notNull().default("note"), // task | note | idea | reminder
  classifiedType: text("classified_type"), // AI-classified: task | note | idea | reminder | emotional_signal | behavioral_insight | unknown
  isProcessed: boolean("is_processed").default(false),
  convertedToTaskId: integer("converted_to_task_id").references(() => tasks.id),
  routingStatus: text("routing_status").default("inbox"), // inbox | routed | dismissed
  routedTo: text("routed_to"), // e.g. "task:42", "idea_board", "note"
  aiSummary: text("ai_summary"), // optional AI one-liner interpretation
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Persona Intelligence System ────────────────────────────────────────────

export const userPersonas = pgTable("user_personas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  behaviorTraits: text("behavior_traits").array().notNull(),
  decisionStyle: text("decision_style").notNull(),
  preferredOutputStyle: text("preferred_output_style").notNull(),
});

export const targetPersonas = pgTable("target_personas", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  name: text("name").notNull(),
  industry: text("industry"),
  jobTitle: text("job_title"),
  companySize: text("company_size"),
  motivations: text("motivations").array(),
  frustrations: text("frustrations").array(),
  decisionTriggers: text("decision_triggers").array(),
  persuasionDrivers: text("persuasion_drivers").array(),
  preferredChannels: text("preferred_channels").array(),
  isAiGenerated: boolean("is_ai_generated").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const personaAnalysisResults = pgTable("persona_analysis_results", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  personaType: text("persona_type").notNull(), // user | target
  inputContext: jsonb("input_context"),
  analysisResult: jsonb("analysis_result").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const personaStrategyMapping = pgTable("persona_strategy_mapping", {
  id: serial("id").primaryKey(),
  userPersonaId: integer("user_persona_id").notNull().references(() => userPersonas.id),
  targetPersonaId: integer("target_persona_id").references(() => targetPersonas.id),
  projectType: text("project_type"),
  successMode: text("success_mode"),
  recommendedStrategyTypes: text("recommended_strategy_types").array(),
  messagePatterns: text("message_patterns").array(),
  channelPreferences: text("channel_preferences").array(),
});

// ─── User Operating Profile — Behavioral Intelligence Layer ──────────────────

export const userOperatingProfiles = pgTable("user_operating_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  planningStyle: text("planning_style"), // visual | list | time-blocked | flexible | spontaneous
  motivationStyle: text("motivation_style"), // achievement | progress | autonomy | connection | impact
  energyRhythm: text("energy_rhythm"), // morning-person | afternoon-peak | evening-owl | variable
  workBlockPreference: text("work_block_preference"), // deep-focused-blocks | short-sprints | flowing-with-mood | structured-schedule
  avoidanceTriggers: text("avoidance_triggers").array(), // visibility | perfectionism | starting | admin-tasks | selling | etc.
  frictionPatterns: text("friction_patterns").array(), // overthinking | comparing-to-others | fear-of-judgment | etc.
  encouragementStyle: text("encouragement_style"), // direct-and-brief | warm-and-supportive | structured-framework | reframe-and-question
  activationStyle: text("activation_style"), // smallest-next-step | big-picture-first | deadline-pressure | external-accountability
  selfDescribedFriction: text("self_described_friction"), // free-text
  setupComplete: boolean("setup_complete").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserOperatingProfileSchema = createInsertSchema(userOperatingProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type UserOperatingProfile = typeof userOperatingProfiles.$inferSelect;
export type InsertUserOperatingProfile = z.infer<typeof insertUserOperatingProfileSchema>;

// ─── Behavioral Signals — Memory Layer ───────────────────────────────────────

export const behavioralSignals = pgTable("behavioral_signals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  signalType: text("signal_type").notNull(), // emotional_signal | behavioral_insight | avoidance_pattern | energy_state
  content: text("content").notNull(),
  aiInterpretation: text("ai_interpretation"),
  linkedContext: text("linked_context"), // e.g. "instagram_posting", "client_outreach"
  captureEntryId: integer("capture_entry_id").references(() => quickCaptureEntries.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBehavioralSignalSchema = createInsertSchema(behavioralSignals).omit({
  id: true,
  createdAt: true,
});
export type BehavioralSignal = typeof behavioralSignals.$inferSelect;
export type InsertBehavioralSignal = z.infer<typeof insertBehavioralSignalSchema>;

// ─── Existing Tables ─────────────────────────────────────────────────────────

// Brand DNA configuration - comprehensive strategic framework
export const brandDna = pgTable("brand_dna", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  
  // Business identification fields
  businessName: varchar("business_name"),
  website: varchar("website"),
  linkedinProfile: varchar("linkedin_profile"),
  instagramHandle: varchar("instagram_handle"),
  
  // Section 1: Business Intelligence
  businessType: text("business_type").notNull(),
  businessModel: text("business_model").notNull(),
  revenueUrgency: text("revenue_urgency").notNull(),
  
  // Section 2: Audience Psychology
  targetAudience: text("target_audience").notNull(),
  corePainPoint: text("core_pain_point").notNull(),
  audienceAspiration: text("audience_aspiration").notNull(),
  
  // Section 3: Brand Positioning
  authorityLevel: text("authority_level").notNull(),
  communicationStyle: text("communication_style").notNull(),
  uniquePositioning: text("unique_positioning").notNull(),
  
  // Section 4: Platform Strategy
  platformPriority: text("platform_priority").notNull(),
  currentPresence: text("current_presence").notNull(),
  
  // Section 5: Goals & Timeline
  primaryGoal: text("primary_goal").notNull(),
  contentBandwidth: text("content_bandwidth").notNull(),
  successDefinition: text("success_definition").notNull(),
  
  // Bonus Questions (Optional)
  currentChallenges: text("current_challenges"),
  pastSuccess: text("past_success"),
  inspiration: text("inspiration"),

  // ─── Enriched Brand DNA fields (Task #15) ──────────────────────────────────

  // Offers & Market
  offers: text("offers"),
  priceRange: text("price_range"),
  clientJourney: text("client_journey"),
  competitorLandscape: text("competitor_landscape"),

  // Voice & Differentiation
  brandVoiceKeywords: text("brand_voice_keywords").array(),
  brandVoiceAntiKeywords: text("brand_voice_anti_keywords").array(),
  editorialTerritory: text("editorial_territory"),
  visualIdentityNotes: text("visual_identity_notes"),
  referenceBrands: text("reference_brands").array(),

  // Content & Platform depth
  contentPillarsDetailed: jsonb("content_pillars_detailed"),

  // Active Priorities
  activeBusinessPriority: text("active_business_priority"),
  currentBusinessStage: text("current_business_stage"),
  revenueTarget: text("revenue_target"),
  keyMilestones: jsonb("key_milestones"),
  teamStructure: text("team_structure"),
  operationalConstraints: text("operational_constraints"),
  geographicFocus: text("geographic_focus"),
  languageStrategy: text("language_strategy"),

  // Naya Intelligence
  nayaIntelligenceSummary: text("naya_intelligence_summary"),
  lastStrategyRefreshAt: timestamp("last_strategy_refresh_at"),

  // Legacy fields for backward compatibility
  tone: jsonb("tone"),
  contentPillars: text("content_pillars").array(),
  audience: text("audience"),
  painPoints: text("pain_points").array(),
  desires: text("desires").array(),
  offer: text("offer"),
  cta: text("cta"),
  ctaDestination: text("cta_destination"),
  businessGoal: text("business_goal"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tasks for daily pilot board — now project-aware with scheduling fields
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull(), // content, outreach, admin, planning
  category: text("category").notNull(), // trust, conversion, engagement, planning
  priority: integer("priority").notNull().default(1),
  completed: boolean("completed").notNull().default(false),
  dueDate: timestamp("due_date"),
  contentId: integer("content_id").references(() => content.id),
  leadId: integer("lead_id").references(() => leads.id),
  // Scheduling fields
  suggestedStartTime: timestamp("suggested_start_time"),
  suggestedEndTime: timestamp("suggested_end_time"),
  estimatedDuration: integer("estimated_duration"), // minutes
  actualDuration: integer("actual_duration"), // minutes
  source: text("source").default("manual"), // generated | manual | capture | replan
  schedulingMode: text("scheduling_mode").default("flexible"), // flexible | fixed | suggested
  learnedAdjustmentCount: integer("learned_adjustment_count").default(0),
  activationPrompt: text("activation_prompt"), // Behavioral: gentle nudge to help user start
  scheduledDate: text("scheduled_date"), // YYYY-MM-DD — planning date (distinct from dueDate deadline)
  // Duration intelligence fields
  taskEnergyType: text("task_energy_type"), // deep_work | creative | admin | social | logistics | execution
  setupCost: text("setup_cost"),            // low | medium | high — cognitive cost to enter this task
  canBeFragmented: boolean("can_be_fragmented").default(true), // false = must be done in one sitting
  recommendedTimeOfDay: text("recommended_time_of_day"), // morning | afternoon | evening | flexible
  workflowGroup: text("workflow_group"),    // bundle label string — tasks sharing this label form a workflow
  // DESIGN NOTE: workflowGroup is a string label (pragmatic for now).
  // If bundle identity needs to be stable over time, this can be hashed or promoted to an FK without data loss.
  scheduledTime: text("scheduled_time"),    // HH:MM — time-of-day position within scheduledDate
  scheduledEndTime: text("scheduled_end_time"), // HH:MM — computed from scheduledTime + estimatedDuration
  milestoneTriggerId: integer("milestone_trigger_id"),
  milestoneId: integer("milestone_id").references(() => projectMilestones.id),
  isBlockedByMilestone: boolean("is_blocked_by_milestone").default(false),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  // Goal-driven tasks
  goalId: integer("goal_id").references(() => projectGoals.id),
  // Actionable task type + data (pour exécution depuis web/mobile)
  taskType: text("task_type").default("generic"), // generic | linkedin_message | post_publish | canva_task | call | email | outreach_action
  actionData: jsonb("action_data"), // { message?, postContent?, canvaBrief?, externalUrl?, leadName?, platform?, leadId? }
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  clientId: integer("client_id").references(() => clients.id),
});

// Clients table - for Agency/Client management
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  parentProjectId: integer("parent_project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  website: text("website"),
  lifecycleStage: text("lifecycle_stage").default("active"), // onboarding | active | retention | campaign | offboarding
  urgencyLevel: text("urgency_level").default("medium"),     // low | medium | high | critical
  monthlyRetainer: text("monthly_retainer"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
});
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

// ─── Content calendar and generation — now project-aware
export const content = pgTable("content", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  platform: text("platform").notNull(),
  contentType: text("content_type").notNull(),
  pillar: text("pillar").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("draft"),
  contentStatus: text("content_status").default("idea"),
  scheduledFor: timestamp("scheduled_for"),
  publishedAt: timestamp("published_at"),
  metrics: jsonb("metrics"),
  mediaIds: jsonb("media_ids").default([]),
  mediaUrl: text("media_url"),
  mediaFileName: text("media_file_name"),
  socialAccountId: integer("social_account_id").references(() => socialAccounts.id),
  autoPost: boolean("auto_post").default(true),
  postStatus: text("post_status").default("pending"),
  platformPostId: text("platform_post_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Prospection Campaigns ────────────────────────────────────────────────────
// Campagnes de prospection (distinctes des campagnes marketing)
export const prospectionCampaigns = pgTable("prospection_campaigns", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | paused | completed
  targetSector: text("target_sector"),               // ex: "Viticulture, Oenotourisme"
  digitalLevel: text("digital_level").default("tous"), // fort | faible | tous
  channel: text("channel").default("linkedin"),       // linkedin | email | both
  offer: text("offer"),                               // l'offre proposée à ce segment
  prospectsPerDay: integer("prospects_per_day").default(3),
  buyingSignals: text("buying_signals"),              // critères de qualification
  campaignBrief: text("campaign_brief"),              // proposition en une phrase
  messageAngle: text("message_angle"),                // angle d'approche unique
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertProspectionCampaignSchema = createInsertSchema(prospectionCampaigns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProspectionCampaign = z.infer<typeof insertProspectionCampaignSchema>;
export type ProspectionCampaign = typeof prospectionCampaigns.$inferSelect;

// Lead management and outreach — now project-aware
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  prospectionCampaignId: integer("prospection_campaign_id").references(() => prospectionCampaigns.id),
  name: text("name").notNull(),
  email: text("email"),
  company: text("company"),
  role: text("role"),                   // titre exact du prospect
  sector: text("sector"),              // secteur détecté
  platform: text("platform"),
  profileUrl: text("profile_url"),     // URL générique
  linkedinUrl: text("linkedin_url"),   // URL profil LinkedIn
  instagramUrl: text("instagram_url"), // URL compte Instagram
  status: text("status").notNull().default("discovered"),
  // Pipeline prospection complet
  stage: text("stage").default("identified"),
  // identified | messages_ready | connection_sent | connected |
  // followup1_sent | followup2_sent | in_discussion | proposal_sent | signed | no_follow
  score: text("score").notNull().default("cold"),
  tags: text("tags").array(),
  notes: text("notes"),
  strategicNotes: text("strategic_notes"), // audit 6 sections (JSON stringifié)
  message1: text("message1"),              // message de connexion LinkedIn (≤200 cars)
  message2: text("message2"),              // message de suivi après connexion
  message3: text("message3"),              // message de clôture
  firstContactDate: timestamp("first_contact_date"),
  lastContactDate: timestamp("last_contact_date"),
  nextFollowUp: timestamp("next_follow_up"),
  enrichedAt: timestamp("enriched_at"),   // date de dernière génération IA
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Outreach messages — now project-aware
export const outreachMessages = pgTable("outreach_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  platform: text("platform").notNull(),
  messageType: text("message_type").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at"),
  responseReceived: boolean("response_received").notNull().default(false),
  responseDate: timestamp("response_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Business metrics and analytics
export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  week: text("week").notNull(),
  contentMetrics: jsonb("content_metrics").notNull(),
  outreachMetrics: jsonb("outreach_metrics").notNull(),
  emailMetrics: jsonb("email_metrics").notNull(),
  goals: jsonb("goals").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Weekly strategy reports
export const strategyReports = pgTable("strategy_reports", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  week: text("week").notNull(),
  focus: text("focus").notNull(),
  reasoning: text("reasoning").notNull(),
  recommendations: text("recommendations").array().notNull(),
  weeklyPlan: jsonb("weekly_plan").notNull(),
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Saved articles for Reading Hub
export const savedArticles = pgTable("saved_articles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  author: text("author"),
  publishedAt: timestamp("published_at"),
  source: text("source"),
  tags: jsonb("tags").default([]),
  category: text("category"),
  aiAnalysis: jsonb("ai_analysis"),
  notes: text("notes"),
  isRead: boolean("is_read").default(false),
  isFavorite: boolean("is_favorite").default(false),
  readingTime: integer("reading_time"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Social media accounts for posting
export const socialAccounts = pgTable("social_accounts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  platform: text("platform").notNull(),
  accountId: text("account_id").notNull(),
  accountName: text("account_name").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  permissions: jsonb("permissions").default([]),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Media library for content assets
export const mediaLibrary = pgTable("media_library", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  width: integer("width"),
  height: integer("height"),
  duration: integer("duration"),
  alt: text("alt"),
  tags: jsonb("tags").default([]),
  folder: text("folder").default("general"),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Milestone Triggers ──────────────────────────────────────────────────────
export const milestoneTriggers = pgTable("milestone_triggers", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  rawCondition: text("raw_condition").notNull(),
  conditionType: text("condition_type").notNull().default("keyword"),
  conditionSummary: text("condition_summary").default(""),
  conditionKeywords: jsonb("condition_keywords").default([]),
  tasksToUnlock: jsonb("tasks_to_unlock").default([]),
  schedulingMode: text("scheduling_mode").notNull().default("flexible"),
  status: text("status").notNull().default("watching"),
  triggeredAt: timestamp("triggered_at"),
  triggeredByTaskId: integer("triggered_by_task_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMilestoneTriggerSchema = createInsertSchema(milestoneTriggers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type MilestoneTrigger = typeof milestoneTriggers.$inferSelect;
export type InsertMilestoneTrigger = z.infer<typeof insertMilestoneTriggerSchema>;

// ─── Project Milestones (Jalons Conditionnels) ───────────────────────────────

export const projectMilestones = pgTable("project_milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  order: integer("order").default(0),
  status: text("status").notNull().default("locked"),
  // locked | unlocked | active | completed | skipped
  milestoneType: text("milestone_type").default("action"),
  // action | decision | payment | launch | phase_start | phase_end
  activatedAt: timestamp("activated_at"),
  completedAt: timestamp("completed_at"),
  targetDate: text("target_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const milestoneConditions = pgTable("milestone_conditions", {
  id: serial("id").primaryKey(),
  milestoneId: integer("milestone_id").notNull().references(() => projectMilestones.id),
  conditionType: text("condition_type").notNull(),
  // manual_confirm | task_completed | milestone_completed | duration_elapsed | external_event
  label: text("label").notNull(),
  blockedByMilestoneId: integer("blocked_by_milestone_id").references(() => projectMilestones.id),
  blockedByTaskId: integer("blocked_by_task_id"),
  requiredDays: integer("required_days"),
  externalDescription: text("external_description"),
  isFulfilled: boolean("is_fulfilled").default(false),
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProjectMilestoneSchema = createInsertSchema(projectMilestones).omit({
  id: true,
  createdAt: true,
});
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type InsertProjectMilestone = z.infer<typeof insertProjectMilestoneSchema>;

export const insertMilestoneConditionSchema = createInsertSchema(milestoneConditions).omit({
  id: true,
  createdAt: true,
});
export type MilestoneCondition = typeof milestoneConditions.$inferSelect;
export type InsertMilestoneCondition = z.infer<typeof insertMilestoneConditionSchema>;

// ─── Companion ───────────────────────────────────────────────────────────────

export const taskLists = pgTable("task_lists", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  title: text("title").notNull(),
  linkedTaskId: integer("linked_task_id"),
  linkedDate: text("linked_date"),
  listType: text("list_type").default("checklist"),
  createdByCompanion: boolean("created_by_companion").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const taskListItems = pgTable("task_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull().references(() => taskLists.id),
  title: text("title").notNull(),
  completed: boolean("completed").default(false),
  order: integer("order").default(0),
});

export const companionConversations = pgTable("companion_conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  actions: jsonb("actions"),
  platform: text("platform").default("web"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const companionPendingMessages = pgTable("companion_pending_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  triggerType: text("trigger_type").notNull(),
  // "task_deferred_2x" | "task_deferred_3x" | "weekly_insight"
  relatedTaskId: integer("related_task_id").references(() => tasks.id),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type TaskList = typeof taskLists.$inferSelect;
export type TaskListItem = typeof taskListItems.$inferSelect;
export type CompanionConversation = typeof companionConversations.$inferSelect;
export type CompanionPendingMessage = typeof companionPendingMessages.$inferSelect;

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  coreMessage: text("core_message"),
  targetAudience: text("target_audience"),
  duration: text("duration").default("3_months"),
  status: text("status").default("draft"),
  tasksGenerated: boolean("tasks_generated").default(false),
  generatedTasks: jsonb("generated_tasks"),
  insights: jsonb("insights"),
  campaignType: text("campaign_type"),
  phases: jsonb("phases"),
  messagingFramework: jsonb("messaging_framework"),
  channels: jsonb("channels"),
  contentPlan: jsonb("content_plan"),
  kpis: jsonb("kpis"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  audienceSegment: text("audience_segment"),
  pauseNote: text("pause_note"),
  reviewContentQuality: integer("review_content_quality"),
  reviewAudienceResponse: integer("review_audience_response"),
  reviewTaskExecution: integer("review_task_execution"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true, createdAt: true, updatedAt: true });
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

// ─── Relations ───────────────────────────────────────────────────────────────

export const userRelations = relations(users, ({ one, many }) => ({
  brandDna: one(brandDna),
  projects: many(projects),
  preferences: one(userPreferences),
  tasks: many(tasks),
  content: many(content),
  leads: many(leads),
  outreachMessages: many(outreachMessages),
  metrics: many(metrics),
  strategyReports: many(strategyReports),
  savedArticles: many(savedArticles),
  socialAccounts: many(socialAccounts),
  mediaLibrary: many(mediaLibrary),
  captureEntries: many(quickCaptureEntries),
  personaAnalysisResults: many(personaAnalysisResults),
  targetPersonas: many(targetPersonas),
  milestoneTriggers: many(milestoneTriggers),
  campaigns: many(campaigns),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  goals: many(projectGoals),
  strategyProfile: one(projectStrategyProfiles),
  tasks: many(tasks),
  content: many(content),
  leads: many(leads),
  captureEntries: many(quickCaptureEntries),
  targetPersonas: many(targetPersonas),
  clients: many(clients),
  strategyReports: many(strategyReports),
  campaigns: many(campaigns),
}));

export const projectGoalRelations = relations(projectGoals, ({ one }) => ({
  project: one(projects, { fields: [projectGoals.projectId], references: [projects.id] }),
}));

export const projectStrategyProfileRelations = relations(projectStrategyProfiles, ({ one }) => ({
  project: one(projects, { fields: [projectStrategyProfiles.projectId], references: [projects.id] }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, { fields: [userPreferences.userId], references: [users.id] }),
  activeProject: one(projects, { fields: [userPreferences.activeProjectId], references: [projects.id] }),
}));

export const quickCaptureRelations = relations(quickCaptureEntries, ({ one }) => ({
  user: one(users, { fields: [quickCaptureEntries.userId], references: [users.id] }),
  project: one(projects, { fields: [quickCaptureEntries.projectId], references: [projects.id] }),
  convertedTask: one(tasks, { fields: [quickCaptureEntries.convertedToTaskId], references: [tasks.id] }),
}));

export const taskScheduleEventRelations = relations(taskScheduleEvents, ({ one }) => ({
  task: one(tasks, { fields: [taskScheduleEvents.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskScheduleEvents.userId], references: [users.id] }),
  project: one(projects, { fields: [taskScheduleEvents.projectId], references: [projects.id] }),
}));

export const userPersonaRelations = relations(userPersonas, ({ many }) => ({
  strategyMappings: many(personaStrategyMapping),
}));

export const targetPersonaRelations = relations(targetPersonas, ({ one }) => ({
  user: one(users, { fields: [targetPersonas.userId], references: [users.id] }),
  project: one(projects, { fields: [targetPersonas.projectId], references: [projects.id] }),
}));

export const personaAnalysisRelations = relations(personaAnalysisResults, ({ one }) => ({
  user: one(users, { fields: [personaAnalysisResults.userId], references: [users.id] }),
  project: one(projects, { fields: [personaAnalysisResults.projectId], references: [projects.id] }),
}));

export const brandDnaRelations = relations(brandDna, ({ one }) => ({
  user: one(users, { fields: [brandDna.userId], references: [users.id] }),
}));

export const taskRelations = relations(tasks, ({ one, many }) => ({
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  content: one(content, { fields: [tasks.contentId], references: [content.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  campaign: one(campaigns, { fields: [tasks.campaignId], references: [campaigns.id] }),
  scheduleEvents: many(taskScheduleEvents),
}));

export const campaignRelations = relations(campaigns, ({ one, many }) => ({
  user: one(users, { fields: [campaigns.userId], references: [users.id] }),
  project: one(projects, { fields: [campaigns.projectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const clientRelations = relations(clients, ({ one, many }) => ({
  project: one(projects, { fields: [clients.parentProjectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const contentRelations = relations(content, ({ one, many }) => ({
  user: one(users, { fields: [content.userId], references: [users.id] }),
  project: one(projects, { fields: [content.projectId], references: [projects.id] }),
  socialAccount: one(socialAccounts, { fields: [content.socialAccountId], references: [socialAccounts.id] }),
  tasks: many(tasks),
}));

export const leadRelations = relations(leads, ({ one, many }) => ({
  user: one(users, { fields: [leads.userId], references: [users.id] }),
  project: one(projects, { fields: [leads.projectId], references: [projects.id] }),
  tasks: many(tasks),
  outreachMessages: many(outreachMessages),
}));

export const outreachMessageRelations = relations(outreachMessages, ({ one }) => ({
  user: one(users, { fields: [outreachMessages.userId], references: [users.id] }),
  project: one(projects, { fields: [outreachMessages.projectId], references: [projects.id] }),
  lead: one(leads, { fields: [outreachMessages.leadId], references: [leads.id] }),
}));

export const metricsRelations = relations(metrics, ({ one }) => ({
  user: one(users, { fields: [metrics.userId], references: [users.id] }),
}));

export const strategyReportRelations = relations(strategyReports, ({ one }) => ({
  user: one(users, { fields: [strategyReports.userId], references: [users.id] }),
  project: one(projects, { fields: [strategyReports.projectId], references: [projects.id] }),
}));

export const savedArticleRelations = relations(savedArticles, ({ one }) => ({
  user: one(users, { fields: [savedArticles.userId], references: [users.id] }),
}));

export const socialAccountRelations = relations(socialAccounts, ({ one, many }) => ({
  user: one(users, { fields: [socialAccounts.userId], references: [users.id] }),
  content: many(content),
}));

export const mediaLibraryRelations = relations(mediaLibrary, ({ one }) => ({
  user: one(users, { fields: [mediaLibrary.userId], references: [users.id] }),
}));

export const milestoneTriggerRelations = relations(milestoneTriggers, ({ one }) => ({
  user: one(users, { fields: [milestoneTriggers.userId], references: [users.id] }),
  project: one(projects, { fields: [milestoneTriggers.projectId], references: [projects.id] }),
}));

// ─── Insert Schemas ───────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectGoalSchema = createInsertSchema(projectGoals).omit({
  id: true,
  createdAt: true,
});

export const insertProjectStrategyProfileSchema = createInsertSchema(projectStrategyProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  updatedAt: true,
});

export const insertTaskScheduleEventSchema = createInsertSchema(taskScheduleEvents).omit({
  id: true,
  createdAt: true,
});

export const insertQuickCaptureSchema = createInsertSchema(quickCaptureEntries).omit({
  id: true,
  createdAt: true,
});

export const insertUserPersonaSchema = createInsertSchema(userPersonas).omit({
  id: true,
});

export const insertTargetPersonaSchema = createInsertSchema(targetPersonas).omit({
  id: true,
  createdAt: true,
});

export const insertPersonaAnalysisSchema = createInsertSchema(personaAnalysisResults).omit({
  id: true,
  createdAt: true,
});

export const insertBrandDnaSchema = createInsertSchema(brandDna).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tone: z.object({
    formal_casual: z.number().min(1).max(5),
    educational_conversational: z.number().min(1).max(5),
    humble_assertive: z.number().min(1).max(5),
    polished_raw: z.number().min(1).max(5),
  }).optional(),
  contentPillars: z.array(z.string()).optional(),
  audience: z.string().optional(),
  painPoints: z.array(z.string()).optional(),
  desires: z.array(z.string()).optional(),
  offer: z.string().optional(),
  cta: z.string().optional(),
  ctaDestination: z.string().optional(),
  businessGoal: z.string().optional(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertContentSchema = createInsertSchema(content).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOutreachMessageSchema = createInsertSchema(outreachMessages).omit({
  id: true,
  createdAt: true,
});

export const insertMetricsSchema = createInsertSchema(metrics).omit({
  id: true,
  createdAt: true,
});

export const insertStrategyReportSchema = createInsertSchema(strategyReports).omit({
  id: true,
  createdAt: true,
});

export const insertSavedArticleSchema = createInsertSchema(savedArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSavedArticleSchema = insertSavedArticleSchema.partial().omit({
  userId: true,
});

export const toggleReadSchema = z.object({
  isRead: z.boolean(),
});

export const toggleFavoriteSchema = z.object({
  isFavorite: z.boolean(),
});

export const updateLeadSchema = insertLeadSchema.partial().omit({
  userId: true,
});

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMediaLibrarySchema = createInsertSchema(mediaLibrary).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSocialAccountSchema = insertSocialAccountSchema.partial().omit({
  userId: true,
});

export const updateMediaLibrarySchema = insertMediaLibrarySchema.partial().omit({
  userId: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type ProjectGoal = typeof projectGoals.$inferSelect;
export type InsertProjectGoal = z.infer<typeof insertProjectGoalSchema>;

export type ProjectStrategyProfile = typeof projectStrategyProfiles.$inferSelect;
export type InsertProjectStrategyProfile = z.infer<typeof insertProjectStrategyProfileSchema>;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;

export type TaskScheduleEvent = typeof taskScheduleEvents.$inferSelect;
export type InsertTaskScheduleEvent = z.infer<typeof insertTaskScheduleEventSchema>;

export type QuickCaptureEntry = typeof quickCaptureEntries.$inferSelect;
export type InsertQuickCaptureEntry = z.infer<typeof insertQuickCaptureSchema>;

export type UserPersona = typeof userPersonas.$inferSelect;
export type InsertUserPersona = z.infer<typeof insertUserPersonaSchema>;

export type TargetPersona = typeof targetPersonas.$inferSelect;
export type InsertTargetPersona = z.infer<typeof insertTargetPersonaSchema>;

export type PersonaAnalysisResult = typeof personaAnalysisResults.$inferSelect;
export type InsertPersonaAnalysisResult = z.infer<typeof insertPersonaAnalysisSchema>;

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertBrandDna = z.infer<typeof insertBrandDnaSchema>;
export type BrandDna = typeof brandDna.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertContent = z.infer<typeof insertContentSchema>;
export type Content = typeof content.$inferSelect;
export type InsertOutreachMessage = z.infer<typeof insertOutreachMessageSchema>;
export type OutreachMessage = typeof outreachMessages.$inferSelect;
export type InsertMetrics = z.infer<typeof insertMetricsSchema>;
export type Metrics = typeof metrics.$inferSelect;
export type InsertStrategyReport = z.infer<typeof insertStrategyReportSchema>;
export type StrategyReport = typeof strategyReports.$inferSelect;
export type InsertSavedArticle = z.infer<typeof insertSavedArticleSchema>;
export type SavedArticle = typeof savedArticles.$inferSelect;
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type InsertMediaLibrary = z.infer<typeof insertMediaLibrarySchema>;
export type MediaLibrary = typeof mediaLibrary.$inferSelect;

export type SafeSocialAccount = Omit<SocialAccount, 'accessToken' | 'refreshToken'>;
export type SafeMediaLibrary = MediaLibrary;

// ─── Task Workspace Entries ───────────────────────────────────────────────────
export const taskWorkspaceEntries = pgTable("task_workspace_entries", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  type: text("type").notNull().default("notes"),    // strategy | content | writing | planning | reflection | research
  intent: text("intent"),                            // content_idea | strategy | writing | planning | reflection | research
  title: text("title"),
  source: text("source").notNull().default("task"), // task | capture | brainstorm | ai
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaskWorkspaceEntrySchema = createInsertSchema(taskWorkspaceEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaskWorkspaceEntry = z.infer<typeof insertTaskWorkspaceEntrySchema>;
export type TaskWorkspaceEntry = typeof taskWorkspaceEntries.$inferSelect;

// ─── Task Feedback ────────────────────────────────────────────────────────────
export const taskFeedback = pgTable("task_feedback", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),         // soft ref — task may be deleted
  taskTitle: text("task_title").notNull(),       // captured at feedback time
  taskType: text("task_type"),
  taskCategory: text("task_category"),
  taskSource: text("task_source"),              // generated|manual|capture|replan
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  feedbackType: text("feedback_type").notNull().default("deleted"), // deleted|dismissed|deferred|reframed|completed
  reason: text("reason").notNull(),             // not_useful|wrong_timing|already_done|not_aligned|too_vague|wrong_approach|other|task_done
  freeText: text("free_text"),
  // Effectiveness signal fields — captured at the moment of the signal
  completionDelayDays: integer("completion_delay_days"),    // days between scheduledDate and completedAt (0 = on time)
  timesRescheduled: integer("times_rescheduled"),           // learnedAdjustmentCount at signal-capture time
  actualDurationVariance: integer("actual_duration_variance"), // actualDuration - estimatedDuration (negative = faster)
  // Future impact scoring — reserved for user-marked importance and milestone tracking
  impactScore: integer("impact_score"),                     // nullable 1–5; future user-marked impact
  milestoneUnlocked: boolean("milestone_unlocked").default(false), // future: did this task unlock a milestone?
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertTaskFeedbackSchema = createInsertSchema(taskFeedback).omit({ id: true, createdAt: true });
export type InsertTaskFeedback = z.infer<typeof insertTaskFeedbackSchema>;
export type TaskFeedback = typeof taskFeedback.$inferSelect;

// ─── Task Dependencies ────────────────────────────────────────────────────────
export const taskDependencies = pgTable("task_dependencies", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  dependsOnTaskId: integer("depends_on_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull().default("blocked_by"), // blocked_by|follows|subtask_of
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertTaskDependencySchema = createInsertSchema(taskDependencies).omit({ id: true, createdAt: true });
export type InsertTaskDependency = z.infer<typeof insertTaskDependencySchema>;
export type TaskDependency = typeof taskDependencies.$inferSelect;

// ─── Business Memory ─────────────────────────────────────────────────────────
export const businessMemory = pgTable("business_memory", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  content: text("content").notNull(),
  sourceEntryId: integer("source_entry_id").references(() => quickCaptureEntries.id),
  archived: boolean("archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertBusinessMemorySchema = createInsertSchema(businessMemory).omit({ id: true, createdAt: true });
export type InsertBusinessMemory = z.infer<typeof insertBusinessMemorySchema>;
export type BusinessMemory = typeof businessMemory.$inferSelect;

// ─── Google Calendar Integration ─────────────────────────────────────────────
export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  calendarId: text("calendar_id").default("primary"),
  syncEnabled: boolean("sync_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type GoogleCalendarToken = typeof googleCalendarTokens.$inferSelect;
export type InsertGoogleCalendarToken = typeof googleCalendarTokens.$inferInsert;
