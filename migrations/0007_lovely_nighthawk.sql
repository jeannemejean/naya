CREATE TABLE "brand_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"converted_at" timestamp NOT NULL,
	"conversion_type" text,
	"value" double precision,
	"attribution_window_days" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversion_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversion_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"credit_weight" double precision NOT NULL,
	CONSTRAINT "conversion_attributions_unique_credit" UNIQUE("conversion_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "brand_conversions" ADD CONSTRAINT "brand_conversions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_attributions" ADD CONSTRAINT "conversion_attributions_conversion_id_brand_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."brand_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_attributions" ADD CONSTRAINT "conversion_attributions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;