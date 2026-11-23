CREATE TABLE "autoliste_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"autoliste_id" integer NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL,
	"contenu" jsonb NOT NULL,
	"publie_fois" integer DEFAULT 0 NOT NULL,
	"dernier_passage_at" timestamp,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autolistes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"nom" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"en_boucle" boolean DEFAULT false NOT NULL,
	"creneaux" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comptes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fuseau" text DEFAULT 'Europe/Paris' NOT NULL,
	"problemes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derniere_materialisation_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "autoliste_id" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "autoliste_post_id" integer;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "autoliste_creneau" timestamp;--> statement-breakpoint
ALTER TABLE "autoliste_posts" ADD CONSTRAINT "autoliste_posts_autoliste_id_autolistes_id_fk" FOREIGN KEY ("autoliste_id") REFERENCES "public"."autolistes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autolistes" ADD CONSTRAINT "autolistes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autolistes" ADD CONSTRAINT "autolistes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autoliste_posts_liste_idx" ON "autoliste_posts" USING btree ("autoliste_id","ordre");--> statement-breakpoint
CREATE INDEX "autolistes_user_idx" ON "autolistes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_autoliste_id_autolistes_id_fk" FOREIGN KEY ("autoliste_id") REFERENCES "public"."autolistes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_autoliste_post_id_autoliste_posts_id_fk" FOREIGN KEY ("autoliste_post_id") REFERENCES "public"."autoliste_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_autoliste_creneau_idx" ON "content" USING btree ("autoliste_id","autoliste_creneau","social_account_id");