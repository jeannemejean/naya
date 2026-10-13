CREATE TABLE "fondations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"offre" jsonb,
	"motivations" jsonb,
	"kpis" jsonb,
	"plan" jsonb,
	"kpi_releves" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"statuts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "format_creatif" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "etiquetage" text;--> statement-breakpoint
ALTER TABLE "fondations" ADD CONSTRAINT "fondations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fondations_user_project_uq" ON "fondations" USING btree ("user_id","project_id");