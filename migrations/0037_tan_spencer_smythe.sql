CREATE TABLE "envois_plafond" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"canal" text NOT NULL,
	"sent_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects_bloques" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"email_normalise" text,
	"linkedin_id" text,
	"raison" text DEFAULT 'desinscription' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects_supprimes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"lead_id_supprime" integer NOT NULL,
	"email_normalise" text,
	"linkedin_public_id" text,
	"linkedin_provider_id" text,
	"expire_a" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "envois_plafond" ADD CONSTRAINT "envois_plafond_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_bloques" ADD CONSTRAINT "prospects_bloques_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects_supprimes" ADD CONSTRAINT "prospects_supprimes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "envois_plafond_user_canal_sent_idx" ON "envois_plafond" USING btree ("user_id","canal","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_bloques_user_email_uq" ON "prospects_bloques" USING btree ("user_id","email_normalise");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_bloques_user_linkedin_uq" ON "prospects_bloques" USING btree ("user_id","linkedin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_supprimes_lead_uq" ON "prospects_supprimes" USING btree ("lead_id_supprime");--> statement-breakpoint
CREATE INDEX "prospects_supprimes_expire_idx" ON "prospects_supprimes" USING btree ("expire_a");