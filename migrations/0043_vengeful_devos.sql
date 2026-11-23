CREATE TABLE "vie_perso_activites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"titre" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"avec_qui" text DEFAULT '' NOT NULL,
	"quand" text DEFAULT 'indifferent' NOT NULL,
	"date_cible" date,
	"statut" text DEFAULT 'a_planifier' NOT NULL,
	"contenu" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vie_perso_membres" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"prenom" text NOT NULL,
	"est_moi" boolean DEFAULT false NOT NULL,
	"regime" text DEFAULT '' NOT NULL,
	"exclusions" text DEFAULT '' NOT NULL,
	"aime" text DEFAULT '' NOT NULL,
	"aime_pas" text DEFAULT '' NOT NULL,
	"repas_maison" text DEFAULT 'les_deux' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vie_perso_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"semaine" date NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"contenu" jsonb NOT NULL,
	"coches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cout_eur" numeric(10, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vie_perso_profil" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"reglages" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vie_perso_recettes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"titre" text NOT NULL,
	"lien" text,
	"notes" text,
	"avis" text DEFAULT 'aime' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vie_perso_activites" ADD CONSTRAINT "vie_perso_activites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vie_perso_membres" ADD CONSTRAINT "vie_perso_membres_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vie_perso_plans" ADD CONSTRAINT "vie_perso_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vie_perso_profil" ADD CONSTRAINT "vie_perso_profil_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vie_perso_recettes" ADD CONSTRAINT "vie_perso_recettes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vie_perso_plans_user_semaine_uq" ON "vie_perso_plans" USING btree ("user_id","semaine");