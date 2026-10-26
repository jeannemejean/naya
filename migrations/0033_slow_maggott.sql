CREATE TABLE "reprises_taches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"lot" text NOT NULL,
	"task_id" integer NOT NULL,
	"action" text NOT NULL,
	"raison" text DEFAULT '' NOT NULL,
	"avant" jsonb NOT NULL,
	"apres" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"vue_at" timestamp,
	"annulee_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "reprises_taches" ADD CONSTRAINT "reprises_taches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprises_taches" ADD CONSTRAINT "reprises_taches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reprises_taches_user_lot_idx" ON "reprises_taches" USING btree ("user_id","lot");