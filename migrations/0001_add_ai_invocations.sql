CREATE TABLE "ai_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"project_id" integer,
	"task_kind" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text,
	"user_message" text,
	"output" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"cost_eur" double precision,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;