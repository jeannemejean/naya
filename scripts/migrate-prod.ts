// Applique les migrations en attente sur la PRODUCTION, avec un garde-fou.
//
// Pourquoi ce script et pas `npm run db:migrate` : `drizzle-kit` lit `DATABASE_URL`
// depuis l'environnement, donc depuis `.env`. Ce fichier a déjà pointé sur des bases
// différentes selon les époques — s'y fier pour une opération irréversible sur la
// production est exactement le genre de confiance qui coûte des données.
//
// Ici l'URL est passée explicitement dans MIGRATION_DATABASE_URL, et le script REFUSE
// de s'exécuter si elle ne désigne pas l'endpoint de production. La garde doit être
// vérifiée à blanc (refus constaté sur un autre endpoint) avant tout usage réel.
// `pg` est un module CommonJS : l'import nommé échoue sous ESM (constaté, pas supposé).
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
if (!url.includes(ENDPOINT_PRODUCTION)) {
  console.error(`REFUS : l'URL fournie ne désigne pas l'endpoint de production (${ENDPOINT_PRODUCTION}).`);
  console.error("Aucune migration n'a été appliquée.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

console.info(`Endpoint vérifié : ${ENDPOINT_PRODUCTION}. Application des migrations en attente…`);
await migrate(db, { migrationsFolder: "migrations" });
console.info("Migrations appliquées.");
await pool.end();
