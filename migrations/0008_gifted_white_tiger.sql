CREATE TABLE "task_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"answered_at" timestamp,
	"answer" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "task_prompts_unique" UNIQUE("task_id","scheduled_for")
);
--> statement-breakpoint
ALTER TABLE "task_prompts" ADD CONSTRAINT "task_prompts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_prompts" ADD CONSTRAINT "task_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
