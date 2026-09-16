ALTER TABLE "user_preferences" ADD COLUMN "linkedin_account_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "linkedin_restricted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "linkedin_restricted_reason" text;