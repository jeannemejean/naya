CREATE TABLE "groupe_marques_projets" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupe_id" integer NOT NULL,
	"project_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groupes_marques" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"nom" varchar(80) NOT NULL,
	"couleur" varchar(7) DEFAULT '#6366f1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groupe_marques_projets" ADD CONSTRAINT "groupe_marques_projets_groupe_id_groupes_marques_id_fk" FOREIGN KEY ("groupe_id") REFERENCES "public"."groupes_marques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groupe_marques_projets" ADD CONSTRAINT "groupe_marques_projets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groupes_marques" ADD CONSTRAINT "groupes_marques_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groupe_marques_projets_paire_idx" ON "groupe_marques_projets" USING btree ("groupe_id","project_id");--> statement-breakpoint
CREATE INDEX "groupe_marques_projets_project_idx" ON "groupe_marques_projets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "groupes_marques_user_idx" ON "groupes_marques" USING btree ("user_id");