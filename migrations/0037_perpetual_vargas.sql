CREATE TABLE "prospects_bloques" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"email_normalise" text,
	"linkedin_id" text,
	"raison" text DEFAULT 'desinscription' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospects_bloques" ADD CONSTRAINT "prospects_bloques_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_bloques_user_email_uq" ON "prospects_bloques" USING btree ("user_id","email_normalise");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_bloques_user_linkedin_uq" ON "prospects_bloques" USING btree ("user_id","linkedin_id");