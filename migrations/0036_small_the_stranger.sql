CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"outil" text NOT NULL,
	"resume" text NOT NULL,
	"lignes" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"annulee_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_propositions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"outil" text NOT NULL,
	"arguments" jsonb,
	"changements" jsonb,
	"empreinte" jsonb,
	"statut" text DEFAULT 'en_attente',
	"resultat" jsonb,
	"created_at" timestamp DEFAULT now(),
	"expire_a" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recherche_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"source" text NOT NULL,
	"source_id" integer NOT NULL,
	"contenu_md5" text NOT NULL,
	"embedding" vector(1536),
	"indexe_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_propositions" ADD CONSTRAINT "agent_propositions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recherche_embeddings" ADD CONSTRAINT "recherche_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recherche_source_idx" ON "recherche_embeddings" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "recherche_emb_idx" ON "recherche_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "recherche_user_idx" ON "recherche_embeddings" USING btree ("user_id");