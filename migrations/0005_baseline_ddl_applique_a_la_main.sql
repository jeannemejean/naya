-- Ce fichier enregistre du DDL déjà appliqué à la main sur dev-local et sur la
-- production (rituels récurrents, idempotence des envois, consignes de rédaction,
-- respiration entre les tâches). Il sert de référence pour que `drizzle-kit generate`
-- cesse de le réémettre — le dossier migrations/ était en retard sur `shared/schema.ts`,
-- pas les bases elles-mêmes.
-- Il est valide pour amorcer une base neuve.
-- Il NE DOIT JAMAIS être rejoué sur dev-local ni sur la production : ces objets y
-- existent déjà, le rejouer échouerait (« relation/colonne already exists ») ou pire.

CREATE TABLE "daily_rhythm_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"feedback_date" text NOT NULL,
	"signal" text NOT NULL,
	"task_count" integer,
	"planned_minutes" integer,
	"buffer_min" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_rhythm_feedback_user_date_unique" UNIQUE("user_id","feedback_date")
);
--> statement-breakpoint
CREATE TABLE "outreach_step_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"claimed_at" timestamp DEFAULT now(),
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "recurring_rituals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"days" text DEFAULT 'mon,tue,wed,thu,fri' NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "prospection_campaigns" ADD COLUMN "message_instructions" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ritual_id" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "buffer_min" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "buffer_adjusted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "message_instructions" text;--> statement-breakpoint
ALTER TABLE "daily_rhythm_feedback" ADD CONSTRAINT "daily_rhythm_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_step_sends" ADD CONSTRAINT "outreach_step_sends_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_step_sends" ADD CONSTRAINT "outreach_step_sends_campaign_id_prospection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."prospection_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_step_sends" ADD CONSTRAINT "outreach_step_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rituals" ADD CONSTRAINT "recurring_rituals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rituals" ADD CONSTRAINT "recurring_rituals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_step_sends_lead_campaign_step_uq" ON "outreach_step_sends" USING btree ("lead_id","campaign_id","step_order");--> statement-breakpoint
CREATE INDEX "idx_recurring_rituals_user" ON "recurring_rituals" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ritual_id_recurring_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."recurring_rituals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_ritual_date_uq" ON "tasks" USING btree ("ritual_id","scheduled_date");