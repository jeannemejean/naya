CREATE TABLE "reading_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"published_at" timestamp,
	"relevance_score" double precision,
	"relevance_rationale" text,
	"fact_summary" text,
	"why_this_brand" text,
	"angle" text,
	"question" text,
	"user_answer" text,
	"answered_at" timestamp,
	"status" text DEFAULT 'proposed' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reading_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"query" text NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "saved_articles" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_queries" ADD CONSTRAINT "reading_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_queries" ADD CONSTRAINT "reading_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_card_seen_idx" ON "reading_cards" USING btree ("user_id","url_hash");--> statement-breakpoint
CREATE INDEX "reading_card_day_idx" ON "reading_cards" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reading_query_proj_idx" ON "reading_queries" USING btree ("user_id","project_id","is_active");--> statement-breakpoint
ALTER TABLE "saved_articles" ADD CONSTRAINT "saved_articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;