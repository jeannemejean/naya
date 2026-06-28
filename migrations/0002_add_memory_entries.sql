CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"fil" text NOT NULL,
	"entry_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"salience" double precision DEFAULT 0.5,
	"source_capture_id" integer,
	"superseded_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_source_capture_id_quick_capture_entries_id_fk" FOREIGN KEY ("source_capture_id") REFERENCES "public"."quick_capture_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_emb_idx" ON "memory_entries" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "memory_fil_idx" ON "memory_entries" USING btree ("user_id","project_id","fil");