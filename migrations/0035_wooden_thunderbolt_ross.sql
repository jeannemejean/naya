CREATE TABLE "inbox_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"lead_id" integer NOT NULL,
	"channel" text NOT NULL,
	"unipile_account_id" text NOT NULL,
	"provider_chat_id" text,
	"statut" text DEFAULT 'a_traiter' NOT NULL,
	"non_lu" boolean DEFAULT true NOT NULL,
	"task_id" integer,
	"etat_avant_reponse" jsonb,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"provider_message_id" text NOT NULL,
	"sens" text NOT NULL,
	"nature" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"sent_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "inbox_messages_provider_message_id_unique" UNIQUE("provider_message_id")
);
--> statement-breakpoint
ALTER TABLE "connexions_projet" ADD COLUMN "email_unipile_account_id" text;--> statement-breakpoint
ALTER TABLE "connexions_projet" ADD COLUMN "email_account_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "connexions_projet" ADD COLUMN "comptes_deconnectes" jsonb;--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD COLUMN "delay_anchor_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "linkedin_provider_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "relation_verifiee_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "exclusion_raison" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "provider_thread_id" text;--> statement-breakpoint
ALTER TABLE "prospection_campaigns" ADD COLUMN "audience" text DEFAULT 'froid' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "email_unipile_account_id" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "email_account_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "comptes_deconnectes" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversations_lead_channel_uq" ON "inbox_conversations" USING btree ("lead_id","channel");