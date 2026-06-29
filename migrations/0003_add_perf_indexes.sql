-- Index de performance (hot paths). Idempotents : CREATE INDEX IF NOT EXISTS.
-- Cible : éliminer les scans séquentiels sur les requêtes fréquentes (amplifiés par
-- la latence réseau Neon). Tables les plus chaudes en tête (tasks, companion, capture).

-- tasks (table la plus sollicitée — planning, brief, génération)
CREATE INDEX IF NOT EXISTS "idx_tasks_user_scheduled" ON "tasks" ("user_id","scheduled_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_user_completed" ON "tasks" ("user_id","completed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_project" ON "tasks" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_campaign" ON "tasks" ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_milestone" ON "tasks" ("milestone_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_goal" ON "tasks" ("goal_id");--> statement-breakpoint

-- companion_conversations (chargé à chaque tour de chat)
CREATE INDEX IF NOT EXISTS "idx_companion_conv_user_created" ON "companion_conversations" ("user_id","created_at");--> statement-breakpoint

-- quick_capture_entries (inbox + polling)
CREATE INDEX IF NOT EXISTS "idx_qce_user_created" ON "quick_capture_entries" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qce_user_processed" ON "quick_capture_entries" ("user_id","is_processed");--> statement-breakpoint

-- content (pipeline + worker de publication)
CREATE INDEX IF NOT EXISTS "idx_content_user" ON "content" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_project" ON "content" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_due" ON "content" ("auto_post","post_status","scheduled_for");--> statement-breakpoint

-- project_goals (buildNayaContext + dashboard)
CREATE INDEX IF NOT EXISTS "idx_pgoals_project_status" ON "project_goals" ("project_id","status");--> statement-breakpoint

-- leads & outreach
CREATE INDEX IF NOT EXISTS "idx_leads_user_status" ON "leads" ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outreach_user" ON "outreach_messages" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outreach_lead_sent" ON "outreach_messages" ("lead_id","sent_at");--> statement-breakpoint

-- behavioral_signals (profil fondateur)
CREATE INDEX IF NOT EXISTS "idx_behav_user_created" ON "behavioral_signals" ("user_id","created_at");--> statement-breakpoint

-- jalons
CREATE INDEX IF NOT EXISTS "idx_pmilestones_project_user" ON "project_milestones" ("project_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mconditions_milestone" ON "milestone_conditions" ("milestone_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mtriggers_user_status" ON "milestone_triggers" ("user_id","status");--> statement-breakpoint

-- personas / campagnes / mémoire / contexte
CREATE INDEX IF NOT EXISTS "idx_tpersonas_user_project" ON "target_personas" ("user_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaigns_user" ON "campaigns" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bmemory_user" ON "business_memory" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brand_dna_user_project" ON "brand_dna" ("user_id","project_id");--> statement-breakpoint

-- feedback / workspace (profil fondateur, génération)
CREATE INDEX IF NOT EXISTS "idx_tfeedback_user" ON "task_feedback" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tworkspace_task" ON "task_workspace_entries" ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tworkspace_user" ON "task_workspace_entries" ("user_id");--> statement-breakpoint

-- projets & corpus
CREATE INDEX IF NOT EXISTS "idx_projects_user" ON "projects" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_invocations_user_created" ON "ai_invocations" ("user_id","created_at");
