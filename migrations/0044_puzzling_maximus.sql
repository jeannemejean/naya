ALTER TABLE "content" ADD COLUMN "premier_commentaire" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "premier_commentaire_at" timestamp;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "couverture_url" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "couverture_offset_ms" integer;