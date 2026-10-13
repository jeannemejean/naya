CREATE TABLE "connexions_projet" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"sender_email" text,
	"sender_name" text,
	"sendgrid_api_key" text,
	"sender_address" text,
	"sender_city" text,
	"sender_country" text,
	"linkedin_unipile_account_id" text,
	"linkedin_account_connected_at" timestamp,
	"linkedin_restricted_at" timestamp,
	"linkedin_restricted_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "linkedin_send_attempts" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "connexions_projet" ADD CONSTRAINT "connexions_projet_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connexions_projet_user_project_uq" ON "connexions_projet" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_social_accounts_user_project_platform" ON "social_accounts" USING btree ("user_id","project_id","platform");