CREATE TABLE "lead_step_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"step_id" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ALTER COLUMN "body_template" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ADD COLUMN "intention" text;--> statement-breakpoint
ALTER TABLE "campaign_sequence_steps" ADD COLUMN "condition" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "linkedin_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_step_messages" ADD CONSTRAINT "lead_step_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_step_messages" ADD CONSTRAINT "lead_step_messages_step_id_campaign_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_sequence_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_step_messages_lead_step_uq" ON "lead_step_messages" USING btree ("lead_id","step_id");
