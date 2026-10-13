CREATE TABLE "rapports_client" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"mois" text NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"donnees" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"jeton" text,
	"partage_actif" boolean DEFAULT false NOT NULL,
	"publie_le" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "rapports_client" ADD CONSTRAINT "rapports_client_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rapports_client_user_project_mois_uq" ON "rapports_client" USING btree ("user_id","project_id","mois");--> statement-breakpoint
CREATE UNIQUE INDEX "rapports_client_jeton_uq" ON "rapports_client" USING btree ("jeton");