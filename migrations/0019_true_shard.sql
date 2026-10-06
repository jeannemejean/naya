CREATE TABLE "evenements_agenda_faits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"event_id" text NOT NULL,
	"date" text,
	"fait_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "evenements_agenda_faits" ADD CONSTRAINT "evenements_agenda_faits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenement_agenda_fait_unique_idx" ON "evenements_agenda_faits" USING btree ("user_id","event_id");