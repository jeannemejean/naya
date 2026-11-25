CREATE TABLE "connexions_metricool" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"jeton_chiffre" text NOT NULL,
	"mc_user_id" text NOT NULL,
	"blog_id" text NOT NULL,
	"etat" text DEFAULT 'ok' NOT NULL,
	"verifie_le" timestamp
);
--> statement-breakpoint
CREATE TABLE "envois" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"marque" text NOT NULL,
	"contact" text,
	"objet" text NOT NULL,
	"canal" text,
	"envoye_le" date NOT NULL,
	"statut" text DEFAULT 'envoye' NOT NULL,
	"prochaine_relance" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seances_redemarrage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"absence_depuis" timestamp,
	"bilan" jsonb NOT NULL,
	"projets" jsonb NOT NULL,
	"projet_courant" integer,
	"evaluation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"terminee_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "recurring_rituals" ADD COLUMN "interval_weeks" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_rituals" ADD COLUMN "anchor_date" date;--> statement-breakpoint
ALTER TABLE "connexions_metricool" ADD CONSTRAINT "connexions_metricool_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois" ADD CONSTRAINT "envois_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois" ADD CONSTRAINT "envois_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seances_redemarrage" ADD CONSTRAINT "seances_redemarrage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_envois_user_relance" ON "envois" USING btree ("user_id","prochaine_relance");--> statement-breakpoint
CREATE UNIQUE INDEX "seance_redemarrage_en_cours_uq" ON "seances_redemarrage" USING btree ("user_id") WHERE statut = 'en_cours';