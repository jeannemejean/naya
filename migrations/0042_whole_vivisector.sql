CREATE TABLE "etat_taches_fond" (
	"nom" text PRIMARY KEY NOT NULL,
	"dernier_debut" timestamp,
	"dernier_succes" timestamp,
	"derniere_erreur" text,
	"derniere_erreur_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "indicateurs_releves" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"cle" text NOT NULL,
	"valeur" double precision,
	"texte" text,
	"indisponible" text,
	"releve_le" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mails_en_attente" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"thread_id" text NOT NULL,
	"task_id" integer,
	"expediteur" text,
	"sujet" text,
	"dernier_message_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "indicateurs_releves" ADD CONSTRAINT "indicateurs_releves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mails_en_attente" ADD CONSTRAINT "mails_en_attente_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indicateurs_releves_user_cle_jour_uq" ON "indicateurs_releves" USING btree ("user_id","cle","releve_le");--> statement-breakpoint
CREATE UNIQUE INDEX "mails_en_attente_user_thread_uq" ON "mails_en_attente" USING btree ("user_id","thread_id");