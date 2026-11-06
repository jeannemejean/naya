// Applique les migrations en attente sur une branche d'ESSAI, et affiche le suivi avant et après.
//
// Pourquoi pas `npm run db:migrate` : constaté le 6 novembre 2026, iCloud peut décharger
// `node_modules/drizzle-kit/bin.cjs`. Le fichier se lit alors comme vide, et la commande sort
// sans rien faire avec un code 0 : une répétition semble réussir sans avoir rien appliqué.
//
// Miroir de `migrate-prod.ts`, garde inversée : ce script REFUSE la production.
import pg from "pg";
const { Pool } = pg;
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const ENDPOINT_PRODUCTION = "ep-damp-water-anuyb0k6";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("REFUS : MIGRATION_DATABASE_URL absente. L'URL doit être passée explicitement.");
  process.exit(1);
}
if (url.includes(ENDPOINT_PRODUCTION)) {
  console.error("REFUS : cette URL désigne la production. Ce script ne sert qu'aux branches d'essai.");
  console.error("Aucune migration n'a été appliquée.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const suivi = async () => (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;

const avant = await suivi();
await migrate(drizzle(pool), { migrationsFolder: "migrations" });
console.info(`Suivi : ${avant} → ${await suivi()}`);
await pool.end();
