CREATE TABLE "clics_liens" (
	"lien_id" integer NOT NULL,
	"jour" date NOT NULL,
	"clics" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liens_courts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"code" varchar(7) NOT NULL,
	"url_cible" text NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origine" text DEFAULT 'composeur' NOT NULL,
	"clics" integer DEFAULT 0 NOT NULL,
	"dernier_clic_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smartlinks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"slug" varchar(40) NOT NULL,
	"titre" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"boutons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tuiles_actives" boolean DEFAULT false NOT NULL,
	"liens_tuiles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clics_liens" ADD CONSTRAINT "clics_liens_lien_id_liens_courts_id_fk" FOREIGN KEY ("lien_id") REFERENCES "public"."liens_courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_courts" ADD CONSTRAINT "liens_courts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liens_courts" ADD CONSTRAINT "liens_courts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smartlinks" ADD CONSTRAINT "smartlinks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smartlinks" ADD CONSTRAINT "smartlinks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clics_liens_lien_jour_idx" ON "clics_liens" USING btree ("lien_id","jour");--> statement-breakpoint
CREATE UNIQUE INDEX "liens_courts_code_idx" ON "liens_courts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "liens_courts_user_idx" ON "liens_courts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "smartlinks_slug_idx" ON "smartlinks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "smartlinks_user_idx" ON "smartlinks" USING btree ("user_id");