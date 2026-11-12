ALTER TABLE "project_milestones" ADD COLUMN "goal_id" integer;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "pourquoi" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pourquoi" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "fil_conducteur_depuis" timestamp;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_goal_id_project_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."project_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestones_goal_idx" ON "project_milestones" USING btree ("goal_id");