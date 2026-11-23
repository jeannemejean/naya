CREATE TABLE "portails_validation" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"expire_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_projet" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"actif" boolean DEFAULT false NOT NULL,
	"regle" text DEFAULT 'un' NOT NULL,
	"relecteurs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validations_post" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_id" integer NOT NULL,
	"relecteur_email" text NOT NULL,
	"decision" text NOT NULL,
	"commentaire" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "validation_statut" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "validation_demandee_at" timestamp;--> statement-breakpoint
ALTER TABLE "portails_validation" ADD CONSTRAINT "portails_validation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portails_validation" ADD CONSTRAINT "portails_validation_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_projet" ADD CONSTRAINT "validation_projet_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_projet" ADD CONSTRAINT "validation_projet_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validations_post" ADD CONSTRAINT "validations_post_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portails_validation_token_idx" ON "portails_validation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "portails_validation_project_idx" ON "portails_validation" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "validation_projet_project_idx" ON "validation_projet" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "validations_post_content_idx" ON "validations_post" USING btree ("content_id","created_at");