CREATE TABLE "project_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"from_project_id" integer NOT NULL,
	"to_project_id" integer NOT NULL,
	"role_amont" text,
	"role_aval" text,
	"nature" text,
	"audiences_recoupent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "articule_avec_campaign_id" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "articulation_independante" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_from_project_id_projects_id_fk" FOREIGN KEY ("from_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_to_project_id_projects_id_fk" FOREIGN KEY ("to_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_link_sens_idx" ON "project_links" USING btree ("user_id","from_project_id","to_project_id");--> statement-breakpoint
CREATE INDEX "project_link_vers_idx" ON "project_links" USING btree ("user_id","to_project_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_articule_avec_campaign_id_campaigns_id_fk" FOREIGN KEY ("articule_avec_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;