CREATE TABLE "access_code_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"redeemed_at" timestamp DEFAULT now(),
	CONSTRAINT "access_code_redemptions_code_id_user_id_unique" UNIQUE("code_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "access_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "access_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "behavioral_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"content" text NOT NULL,
	"ai_interpretation" text,
	"linked_context" text,
	"capture_entry_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brand_dna" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"business_name" varchar,
	"website" varchar,
	"linkedin_profile" varchar,
	"instagram_handle" varchar,
	"business_type" text NOT NULL,
	"business_model" text NOT NULL,
	"revenue_urgency" text NOT NULL,
	"target_audience" text NOT NULL,
	"core_pain_point" text NOT NULL,
	"audience_aspiration" text NOT NULL,
	"authority_level" text NOT NULL,
	"communication_style" text NOT NULL,
	"unique_positioning" text NOT NULL,
	"platform_priority" text NOT NULL,
	"current_presence" text NOT NULL,
	"primary_goal" text NOT NULL,
	"content_bandwidth" text NOT NULL,
	"success_definition" text NOT NULL,
	"current_challenges" text,
	"past_success" text,
	"inspiration" text,
	"offers" text,
	"price_range" text,
	"client_journey" text,
	"competitor_landscape" text,
	"brand_voice_keywords" text[],
	"brand_voice_anti_keywords" text[],
	"editorial_territory" text,
	"visual_identity_notes" text,
	"reference_brands" text[],
	"content_pillars_detailed" jsonb,
	"active_business_priority" text,
	"current_business_stage" text,
	"revenue_target" text,
	"key_milestones" jsonb,
	"team_structure" text,
	"operational_constraints" text,
	"geographic_focus" text,
	"language_strategy" text,
	"naya_intelligence_summary" text,
	"last_strategy_refresh_at" timestamp,
	"tone" jsonb,
	"content_pillars" text[],
	"audience" text,
	"pain_points" text[],
	"desires" text[],
	"offer" text,
	"cta" text,
	"cta_destination" text,
	"business_goal" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "business_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"source_entry_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_sequence_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"step_order" integer NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"core_message" text,
	"target_audience" text,
	"duration" text DEFAULT '3_months',
	"status" text DEFAULT 'draft',
	"tasks_generated" boolean DEFAULT false,
	"generated_tasks" jsonb,
	"insights" jsonb,
	"campaign_type" text,
	"phases" jsonb,
	"messaging_framework" jsonb,
	"channels" jsonb,
	"content_plan" jsonb,
	"kpis" jsonb,
	"start_date" text,
	"end_date" text,
	"audience_segment" text,
	"linked_prospection_campaign_id" integer,
	"pause_note" text,
	"review_content_quality" integer,
	"review_audience_response" integer,
	"review_task_execution" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"parent_project_id" integer NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"website" text,
	"lifecycle_stage" text DEFAULT 'active',
	"urgency_level" text DEFAULT 'medium',
	"monthly_retainer" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companion_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"actions" jsonb,
	"platform" text DEFAULT 'web',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companion_pending_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"message" text NOT NULL,
	"trigger_type" text NOT NULL,
	"related_task_id" integer,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"platform" text NOT NULL,
	"content_type" text NOT NULL,
	"pillar" text NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content_status" text DEFAULT 'idea',
	"scheduled_for" timestamp,
	"published_at" timestamp,
	"metrics" jsonb,
	"media_ids" jsonb DEFAULT '[]'::jsonb,
	"media_url" text,
	"media_file_name" text,
	"campaign_id" integer,
	"social_account_id" integer,
	"auto_post" boolean DEFAULT true,
	"post_status" text DEFAULT 'pending',
	"platform_post_id" text,
	"post_format" text DEFAULT 'feed_image',
	"cross_post_group_id" text,
	"video_meta" jsonb,
	"provider_container_id" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "day_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"date" text NOT NULL,
	"day_type" text DEFAULT 'full' NOT NULL,
	"work_start" text,
	"work_end" text,
	"breaks" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "google_calendar_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"calendar_id" text DEFAULT 'primary',
	"sync_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "google_calendar_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "lead_sequence_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp,
	"enrolled_at" timestamp DEFAULT now(),
	"last_step_sent_at" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_sequence_state_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"prospection_campaign_id" integer,
	"name" text NOT NULL,
	"email" text,
	"company" text,
	"role" text,
	"sector" text,
	"platform" text,
	"profile_url" text,
	"linkedin_url" text,
	"instagram_url" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"stage" text DEFAULT 'identified',
	"score" text DEFAULT 'cold' NOT NULL,
	"tags" text[],
	"notes" text,
	"strategic_notes" text,
	"message1" text,
	"message2" text,
	"message3" text,
	"first_contact_date" timestamp,
	"last_contact_date" timestamp,
	"next_follow_up" timestamp,
	"enriched_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "media_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"width" integer,
	"height" integer,
	"duration" integer,
	"alt" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"folder" text DEFAULT 'general',
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"week" text NOT NULL,
	"content_metrics" jsonb NOT NULL,
	"outreach_metrics" jsonb NOT NULL,
	"email_metrics" jsonb NOT NULL,
	"goals" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "milestone_conditions" (
	"id" serial PRIMARY KEY NOT NULL,
	"milestone_id" integer NOT NULL,
	"condition_type" text NOT NULL,
	"label" text NOT NULL,
	"blocked_by_milestone_id" integer,
	"blocked_by_task_id" integer,
	"required_days" integer,
	"external_description" text,
	"is_fulfilled" boolean DEFAULT false,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "milestone_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"raw_condition" text NOT NULL,
	"condition_type" text DEFAULT 'keyword' NOT NULL,
	"condition_summary" text DEFAULT '',
	"condition_keywords" jsonb DEFAULT '[]'::jsonb,
	"tasks_to_unlock" jsonb DEFAULT '[]'::jsonb,
	"scheduling_mode" text DEFAULT 'flexible' NOT NULL,
	"status" text DEFAULT 'watching' NOT NULL,
	"triggered_at" timestamp,
	"triggered_by_task_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"lead_id" integer NOT NULL,
	"platform" text NOT NULL,
	"message_type" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"sent_at" timestamp,
	"response_received" boolean DEFAULT false NOT NULL,
	"response_date" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"bounced_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "persona_analysis_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"persona_type" text NOT NULL,
	"input_context" jsonb,
	"analysis_result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "persona_strategy_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_persona_id" integer NOT NULL,
	"target_persona_id" integer,
	"project_type" text,
	"success_mode" text,
	"recommended_strategy_types" text[],
	"message_patterns" text[],
	"channel_preferences" text[]
);
--> statement-breakpoint
CREATE TABLE "processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"goal_type" text DEFAULT 'monthly' NOT NULL,
	"success_mode" text DEFAULT 'visibility' NOT NULL,
	"target_value" text,
	"current_value" text,
	"timeframe" text,
	"due_date" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"order" integer DEFAULT 0,
	"status" text DEFAULT 'locked' NOT NULL,
	"milestone_type" text DEFAULT 'action',
	"activated_at" timestamp,
	"completed_at" timestamp,
	"target_date" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_strategy_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_intent" text,
	"success_definition" text,
	"operating_mode" text,
	"main_constraint" text,
	"current_stage" text,
	"target_audience" text,
	"core_pain_point" text,
	"audience_aspiration" text,
	"communication_style" text,
	"unique_positioning" text,
	"content_pillars" text[],
	"platform_priority" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "project_strategy_profiles_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"icon" text DEFAULT '📁',
	"color" text DEFAULT '#6366f1',
	"type" text DEFAULT 'Business' NOT NULL,
	"description" text,
	"monetization_intent" text DEFAULT 'exploratory',
	"priority_level" text DEFAULT 'secondary',
	"project_status" text DEFAULT 'active',
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospection_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_sector" text,
	"digital_level" text DEFAULT 'tous',
	"channel" text DEFAULT 'linkedin',
	"offer" text,
	"prospects_per_day" integer DEFAULT 3,
	"buying_signals" text,
	"campaign_brief" text,
	"message_angle" text,
	"linked_campaign_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "quick_capture_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"content" text NOT NULL,
	"capture_type" text DEFAULT 'note' NOT NULL,
	"classified_type" text,
	"is_processed" boolean DEFAULT false,
	"converted_to_task_id" integer,
	"routing_status" text DEFAULT 'inbox',
	"routed_to" text,
	"ai_summary" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"author" text,
	"published_at" timestamp,
	"source" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"category" text,
	"ai_analysis" jsonb,
	"notes" text,
	"is_read" boolean DEFAULT false,
	"is_favorite" boolean DEFAULT false,
	"reading_time" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"platform_user_id" text,
	"account_name" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategy_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"week" text NOT NULL,
	"focus" text NOT NULL,
	"reasoning" text NOT NULL,
	"recommendations" text[] NOT NULL,
	"weekly_plan" jsonb NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text,
	"price_id" text,
	"current_period_end" timestamp,
	"trial_ends_at" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "target_personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"industry" text,
	"job_title" text,
	"company_size" text,
	"motivations" text[],
	"frustrations" text[],
	"decision_triggers" text[],
	"persuasion_drivers" text[],
	"preferred_channels" text[],
	"is_ai_generated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	"relation_type" text DEFAULT 'blocked_by' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"task_title" text NOT NULL,
	"task_type" text,
	"task_category" text,
	"task_source" text,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"feedback_type" text DEFAULT 'deleted' NOT NULL,
	"reason" text NOT NULL,
	"free_text" text,
	"completion_delay_days" integer,
	"times_rescheduled" integer,
	"actual_duration_variance" integer,
	"impact_score" integer,
	"milestone_unlocked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"title" text NOT NULL,
	"completed" boolean DEFAULT false,
	"order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "task_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"linked_task_id" integer,
	"linked_date" text,
	"list_type" text DEFAULT 'checklist',
	"created_by_companion" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_schedule_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"previous_start_time" timestamp,
	"new_start_time" timestamp,
	"previous_end_time" timestamp,
	"new_end_time" timestamp,
	"change_type" text DEFAULT 'moved' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_workspace_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"type" text DEFAULT 'notes' NOT NULL,
	"intent" text,
	"title" text,
	"source" text DEFAULT 'task' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"due_date" timestamp,
	"content_id" integer,
	"lead_id" integer,
	"suggested_start_time" timestamp,
	"suggested_end_time" timestamp,
	"estimated_duration" integer,
	"actual_duration" integer,
	"source" text DEFAULT 'manual',
	"scheduling_mode" text DEFAULT 'flexible',
	"learned_adjustment_count" integer DEFAULT 0,
	"activation_prompt" text,
	"scheduled_date" text,
	"task_energy_type" text,
	"setup_cost" text,
	"can_be_fragmented" boolean DEFAULT true,
	"recommended_time_of_day" text,
	"workflow_group" text,
	"scheduled_time" text,
	"scheduled_end_time" text,
	"milestone_trigger_id" integer,
	"milestone_id" integer,
	"is_blocked_by_milestone" boolean DEFAULT false,
	"campaign_id" integer,
	"goal_id" integer,
	"task_type" text DEFAULT 'generic',
	"action_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"client_id" integer
);
--> statement-breakpoint
CREATE TABLE "user_operating_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"planning_style" text,
	"motivation_style" text,
	"energy_rhythm" text,
	"work_block_preference" text,
	"avoidance_triggers" text[],
	"friction_patterns" text[],
	"encouragement_style" text,
	"activation_style" text,
	"self_described_friction" text,
	"setup_complete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_operating_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"behavior_traits" text[] NOT NULL,
	"decision_style" text NOT NULL,
	"preferred_output_style" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"active_project_id" integer,
	"default_view" text DEFAULT 'list',
	"timezone" text DEFAULT 'UTC',
	"work_day_start" text DEFAULT '09:00',
	"work_day_end" text DEFAULT '18:00',
	"work_days" text DEFAULT 'mon,tue,wed,thu,fri',
	"lunch_break_enabled" boolean DEFAULT true,
	"lunch_break_start" text DEFAULT '12:00',
	"lunch_break_end" text DEFAULT '13:00',
	"current_energy_level" text DEFAULT 'high',
	"current_emotional_context" text,
	"energy_updated_date" text,
	"daily_brief_date" text,
	"daily_brief_content" jsonb,
	"daily_brief_dismissed" boolean DEFAULT false,
	"planning_start_date" text,
	"planning_status" text DEFAULT 'active',
	"planning_paused_at" timestamp,
	"language" text DEFAULT 'fr',
	"duration_calibration" jsonb,
	"behavior_patterns" jsonb,
	"prospection_sender_email" text,
	"prospection_sender_name" text,
	"prospection_sendgrid_api_key" text,
	"prospection_sender_address" text,
	"prospection_sender_city" text,
	"prospection_sender_country" text,
	"ai_spend_eur" double precision DEFAULT 0 NOT NULL,
	"ai_spend_period" text,
	"linkedin_unipile_account_id" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"email" varchar NOT NULL,
	"hashed_password" varchar,
	"email_verified" boolean DEFAULT false,
	"role" text DEFAULT 'user' NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"expo_push_token" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"language" text DEFAULT 'fr',
	"source" text DEFAULT 'landing',
	"description" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "access_code_redemptions" ADD CONSTRAINT "access_code_redemptions_code_id_access_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."access_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_code_redemptions" ADD CONSTRAINT "access_code_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_signals" ADD CONSTRAINT "behavioral_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_signals" ADD CONSTRAINT "behavioral_signals_capture_entry_id_quick_capture_entries_id_fk" FOREIGN KEY ("capture_entry_id") REFERENCES "public"."quick_capture_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_dna" ADD CONSTRAINT "brand_dna_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_dna" ADD CONSTRAINT "brand_dna_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memory" ADD CONSTRAINT "business_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memory" ADD CONSTRAINT "business_memory_source_entry_id_quick_capture_entries_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."quick_capture_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ADD CONSTRAINT "campaign_sequence_steps_campaign_id_prospection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."prospection_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ADD CONSTRAINT "campaign_sequence_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_conversations" ADD CONSTRAINT "companion_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_pending_messages" ADD CONSTRAINT "companion_pending_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_pending_messages" ADD CONSTRAINT "companion_pending_messages_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_availability" ADD CONSTRAINT "day_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_tokens" ADD CONSTRAINT "google_calendar_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD CONSTRAINT "lead_sequence_state_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD CONSTRAINT "lead_sequence_state_campaign_id_prospection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."prospection_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD CONSTRAINT "lead_sequence_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_prospection_campaign_id_prospection_campaigns_id_fk" FOREIGN KEY ("prospection_campaign_id") REFERENCES "public"."prospection_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_library" ADD CONSTRAINT "media_library_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_conditions" ADD CONSTRAINT "milestone_conditions_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_conditions" ADD CONSTRAINT "milestone_conditions_blocked_by_milestone_id_project_milestones_id_fk" FOREIGN KEY ("blocked_by_milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_triggers" ADD CONSTRAINT "milestone_triggers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_triggers" ADD CONSTRAINT "milestone_triggers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_analysis_results" ADD CONSTRAINT "persona_analysis_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_analysis_results" ADD CONSTRAINT "persona_analysis_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_strategy_mapping" ADD CONSTRAINT "persona_strategy_mapping_user_persona_id_user_personas_id_fk" FOREIGN KEY ("user_persona_id") REFERENCES "public"."user_personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_strategy_mapping" ADD CONSTRAINT "persona_strategy_mapping_target_persona_id_target_personas_id_fk" FOREIGN KEY ("target_persona_id") REFERENCES "public"."target_personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_strategy_profiles" ADD CONSTRAINT "project_strategy_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_campaigns" ADD CONSTRAINT "prospection_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_campaigns" ADD CONSTRAINT "prospection_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_capture_entries" ADD CONSTRAINT "quick_capture_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_capture_entries" ADD CONSTRAINT "quick_capture_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_capture_entries" ADD CONSTRAINT "quick_capture_entries_converted_to_task_id_tasks_id_fk" FOREIGN KEY ("converted_to_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_articles" ADD CONSTRAINT "saved_articles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_reports" ADD CONSTRAINT "strategy_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_reports" ADD CONSTRAINT "strategy_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_personas" ADD CONSTRAINT "target_personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_personas" ADD CONSTRAINT "target_personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_list_items" ADD CONSTRAINT "task_list_items_list_id_task_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."task_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedule_events" ADD CONSTRAINT "task_schedule_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedule_events" ADD CONSTRAINT "task_schedule_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_schedule_events" ADD CONSTRAINT "task_schedule_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workspace_entries" ADD CONSTRAINT "task_workspace_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workspace_entries" ADD CONSTRAINT "task_workspace_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workspace_entries" ADD CONSTRAINT "task_workspace_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_project_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."project_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_operating_profiles" ADD CONSTRAINT "user_operating_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_project_id_projects_id_fk" FOREIGN KEY ("active_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_day_availability_user_date" ON "day_availability" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");