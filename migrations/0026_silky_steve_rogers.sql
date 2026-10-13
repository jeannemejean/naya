CREATE TABLE "mesures_mensuelles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"mois" text NOT NULL,
	"ca" double precision,
	"ca_nouveaux" double precision,
	"nouveaux_clients" integer,
	"commandes" integer,
	"couts_variables" double precision,
	"depenses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'manuel' NOT NULL,
	"bilan" text,
	"bilan_le" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "mesures_mensuelles" ADD CONSTRAINT "mesures_mensuelles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mesures_mensuelles_user_project_mois_uq" ON "mesures_mensuelles" USING btree ("user_id","project_id","mois");