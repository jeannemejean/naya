ALTER TABLE "reprises_taches" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reprises_taches" ADD COLUMN "content_id" integer;--> statement-breakpoint
ALTER TABLE "reprises_taches" ADD CONSTRAINT "reprises_taches_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;