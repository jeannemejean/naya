CREATE TABLE "prospection_salves" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"campaign_id" integer NOT NULL,
	"par_jour" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD COLUMN "salve_id" integer;--> statement-breakpoint
ALTER TABLE "prospection_salves" ADD CONSTRAINT "prospection_salves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_salves" ADD CONSTRAINT "prospection_salves_campaign_id_prospection_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."prospection_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospection_salves_campaign" ON "prospection_salves" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "lead_sequence_state" ADD CONSTRAINT "lead_sequence_state_salve_id_prospection_salves_id_fk" FOREIGN KEY ("salve_id") REFERENCES "public"."prospection_salves"("id") ON DELETE set null ON UPDATE no action;