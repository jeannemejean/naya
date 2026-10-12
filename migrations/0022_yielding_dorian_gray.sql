CREATE TABLE "routine_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"routine_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"debut" timestamp DEFAULT now() NOT NULL,
	"fin" timestamp,
	"statut" text NOT NULL,
	"resume" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" integer,
	"kind" text NOT NULL,
	"cible" jsonb NOT NULL,
	"cible_cle" text NOT NULL,
	"cadence" text DEFAULT 'quotidienne' NOT NULL,
	"heure_utc" integer DEFAULT 5 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"prochain_passage" timestamp,
	"dernier_passage" timestamp,
	"derniere_erreur" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routine_runs_routine_idx" ON "routine_runs" USING btree ("routine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routines_user_kind_cible_uq" ON "routines" USING btree ("user_id","kind","cible_cle");--> statement-breakpoint
CREATE INDEX "routines_dues_idx" ON "routines" USING btree ("actif","prochain_passage");