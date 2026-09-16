CREATE TABLE "linkedin_send_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"lead_id" integer,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD COLUMN "linkedin_consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "linkedin_send_attempts" ADD CONSTRAINT "linkedin_send_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkedin_send_attempts" ADD CONSTRAINT "linkedin_send_attempts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_linkedin_send_attempts_user_time" ON "linkedin_send_attempts" USING btree ("user_id","attempted_at");