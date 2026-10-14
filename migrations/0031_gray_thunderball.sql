CREATE TABLE "profil_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"profil_id" integer NOT NULL,
	"semaine" text NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"batch_id" text,
	"retenus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cout_eur" double precision DEFAULT 0 NOT NULL,
	"erreur" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_comptes" (
	"id" serial PRIMARY KEY NOT NULL,
	"profil_id" integer NOT NULL,
	"plateforme" text NOT NULL,
	"compte" text NOT NULL,
	"url" text NOT NULL,
	"libelle" text,
	"statut" text DEFAULT 'propose' NOT NULL,
	"origine" text DEFAULT 'naya' NOT NULL,
	"suggere_par" varchar,
	"echecs_consecutifs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_etiquettes" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"structure" text NOT NULL,
	"accroche" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"profil_id" integer NOT NULL,
	"plateforme" text NOT NULL,
	"jour" text NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"comptes" integer DEFAULT 0 NOT NULL,
	"posts_nouveaux" integer DEFAULT 0 NOT NULL,
	"posts_mis_a_jour" integer DEFAULT 0 NOT NULL,
	"echecs" integer DEFAULT 0 NOT NULL,
	"erreur" text,
	"cout_eur" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profil_id" integer NOT NULL,
	"compte_id" integer NOT NULL,
	"plateforme" text NOT NULL,
	"url" text NOT NULL,
	"cle" text NOT NULL,
	"publie_le" timestamp,
	"type_media" text NOT NULL,
	"legende" text,
	"metriques" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"abonnes" integer,
	"engagement" double precision,
	"fort" boolean,
	"format" jsonb,
	"releve_le" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_rattachements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"profil_id" integer NOT NULL,
	"confiance" double precision DEFAULT 0 NOT NULL,
	"raison" text DEFAULT '' NOT NULL,
	"statut" text DEFAULT 'propose' NOT NULL,
	"exclus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dernier_tri" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profil_tendances" (
	"id" serial PRIMARY KEY NOT NULL,
	"profil_id" integer NOT NULL,
	"semaine" text NOT NULL,
	"plateforme" text NOT NULL,
	"type_media" text NOT NULL,
	"structure" text NOT NULL,
	"cle" text NOT NULL,
	"accroche_dominante" text,
	"lift" double precision NOT NULL,
	"nb_forts" integer NOT NULL,
	"nb_comptes" integer NOT NULL,
	"exemples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pourquoi" text DEFAULT '' NOT NULL,
	"comment_adapter" text DEFAULT '' NOT NULL,
	"statut" text DEFAULT 'nouveau' NOT NULL,
	"ecarte_par_jeanne" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profils_veille" (
	"id" serial PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"criteres" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origine" text DEFAULT 'jeanne' NOT NULL,
	"statut" text DEFAULT 'propose' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tendances_projet" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"tendance_id" integer NOT NULL,
	"adaptation" text NOT NULL,
	"statut" text DEFAULT 'nouveau' NOT NULL,
	"content_id" integer,
	"ecarte_le" timestamp,
	"expire_le" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "tendance_id" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "tendance_projet_id" integer;--> statement-breakpoint
ALTER TABLE "profil_analyses" ADD CONSTRAINT "profil_analyses_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_comptes" ADD CONSTRAINT "profil_comptes_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_comptes" ADD CONSTRAINT "profil_comptes_suggere_par_users_id_fk" FOREIGN KEY ("suggere_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_etiquettes" ADD CONSTRAINT "profil_etiquettes_post_id_profil_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."profil_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_passages" ADD CONSTRAINT "profil_passages_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_posts" ADD CONSTRAINT "profil_posts_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_posts" ADD CONSTRAINT "profil_posts_compte_id_profil_comptes_id_fk" FOREIGN KEY ("compte_id") REFERENCES "public"."profil_comptes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_rattachements" ADD CONSTRAINT "profil_rattachements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_rattachements" ADD CONSTRAINT "profil_rattachements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_rattachements" ADD CONSTRAINT "profil_rattachements_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profil_tendances" ADD CONSTRAINT "profil_tendances_profil_id_profils_veille_id_fk" FOREIGN KEY ("profil_id") REFERENCES "public"."profils_veille"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tendances_projet" ADD CONSTRAINT "tendances_projet_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tendances_projet" ADD CONSTRAINT "tendances_projet_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tendances_projet" ADD CONSTRAINT "tendances_projet_tendance_id_profil_tendances_id_fk" FOREIGN KEY ("tendance_id") REFERENCES "public"."profil_tendances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profil_analyses_semaine" ON "profil_analyses" USING btree ("profil_id","semaine");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_comptes_unique" ON "profil_comptes" USING btree ("profil_id","plateforme","compte");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_etiquettes_post" ON "profil_etiquettes" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_passages_jour" ON "profil_passages" USING btree ("profil_id","plateforme","jour");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_posts_cle" ON "profil_posts" USING btree ("profil_id","cle");--> statement-breakpoint
CREATE INDEX "profil_posts_compte_idx" ON "profil_posts" USING btree ("compte_id","publie_le");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_rattachements_projet" ON "profil_rattachements" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profil_tendances_format" ON "profil_tendances" USING btree ("profil_id","semaine","cle");--> statement-breakpoint
CREATE UNIQUE INDEX "tendances_projet_unique" ON "tendances_projet" USING btree ("project_id","tendance_id");--> statement-breakpoint
CREATE INDEX "tendances_projet_idx" ON "tendances_projet" USING btree ("user_id","project_id");