CREATE TABLE "appels_offres" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"objet" text NOT NULL,
	"acheteur" text,
	"reference" text,
	"procedure" text,
	"date_limite" timestamp,
	"date_reperage" date,
	"departement" text,
	"montant_estime_ht" numeric(14, 2),
	"score_adequation" text,
	"offres_jmd" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"statut" text DEFAULT 'repere' NOT NULL,
	"criteres_ponderation" text,
	"pieces_exigees" text,
	"bloquants" text,
	"notes" text,
	"lien_avis" text,
	"lien_dce" text,
	"premier_jet" text,
	"source" text DEFAULT 'manuel' NOT NULL,
	"source_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appels_offres" ADD CONSTRAINT "appels_offres_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appels_offres" ADD CONSTRAINT "appels_offres_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appels_offres_user_source_uniq" ON "appels_offres" USING btree ("user_id","source","source_id");--> statement-breakpoint
CREATE INDEX "appels_offres_user_date_limite_idx" ON "appels_offres" USING btree ("user_id","date_limite");