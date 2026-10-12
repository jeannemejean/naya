CREATE TABLE "veille_constats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"titre" text NOT NULL,
	"texte" text NOT NULL,
	"preuve" jsonb,
	"statut" text DEFAULT 'nouveau' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "veille_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"libelle" text NOT NULL,
	"valeur" jsonb,
	"statut" text DEFAULT 'propose' NOT NULL,
	"source" text DEFAULT 'naya' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "veille_releves" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"cle" text NOT NULL,
	"donnees" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "veille_constats" ADD CONSTRAINT "veille_constats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veille_items" ADD CONSTRAINT "veille_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veille_releves" ADD CONSTRAINT "veille_releves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "veille_constats_project_idx" ON "veille_constats" USING btree ("user_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "veille_items_project_idx" ON "veille_items" USING btree ("user_id","project_id","type");--> statement-breakpoint
CREATE INDEX "veille_releves_cle_idx" ON "veille_releves" USING btree ("user_id","project_id","kind","cle");