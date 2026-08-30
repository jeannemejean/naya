CREATE TABLE "competitor_reception" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"post_ref" text,
	"engagement_rate" double precision,
	"sentiment_score" double precision,
	"observed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"platform" text,
	"is_active" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "content_reception" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"platform" text NOT NULL,
	"saves" integer,
	"shares" integer,
	"comments" integer,
	"reach" integer,
	"sentiment_score" double precision,
	"received_vs_intent_score" double precision,
	"confidence" double precision,
	"rationale" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"measured_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "content_reception_unique_measure" UNIQUE("content_id","platform","measured_at")
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "attribution_window_days" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "competitor_reception" ADD CONSTRAINT "competitor_reception_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reception" ADD CONSTRAINT "content_reception_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reception" ADD CONSTRAINT "content_reception_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;