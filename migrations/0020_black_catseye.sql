CREATE TABLE "project_proofs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"client_label" text NOT NULL,
	"citable" boolean DEFAULT false NOT NULL,
	"what_was_done" text NOT NULL,
	"result" text,
	"url" text,
	"media_id" integer,
	"tags" text[],
	"status" text DEFAULT 'proposed' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospection_learned_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"texte" text NOT NULL,
	"statut" text DEFAULT 'proposee' NOT NULL,
	"source_ids" integer[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospection_message_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"campaign_id" integer,
	"lead_id" integer,
	"step_id" integer,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"original" text,
	"final" text,
	"raison" text,
	"defauts" jsonb,
	"a_repondu" boolean,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "lead_step_messages" ADD COLUMN "qualite" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_step_messages" ADD COLUMN "defauts" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "prospect_brief" jsonb;--> statement-breakpoint
ALTER TABLE "project_proofs" ADD CONSTRAINT "project_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_proofs" ADD CONSTRAINT "project_proofs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_learned_rules" ADD CONSTRAINT "prospection_learned_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_message_feedback" ADD CONSTRAINT "prospection_message_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_proofs_project_idx" ON "project_proofs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prospection_feedback_project_idx" ON "prospection_message_feedback" USING btree ("user_id","project_id");