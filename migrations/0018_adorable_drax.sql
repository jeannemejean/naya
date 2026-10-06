CREATE TABLE "livrables" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"task_id" integer,
	"task_title" text,
	"project_id" integer,
	"kind" text NOT NULL,
	"content" text,
	"url" text,
	"media_id" integer,
	"file_name" text,
	"mime_type" text,
	"size" integer,
	"memory_entry_ids" jsonb DEFAULT '[]'::jsonb,
	"memoire_pending" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "media_library" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "livrables" ADD CONSTRAINT "livrables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livrables" ADD CONSTRAINT "livrables_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livrables" ADD CONSTRAINT "livrables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livrables" ADD CONSTRAINT "livrables_media_id_media_library_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_library"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_library" ADD CONSTRAINT "media_library_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;