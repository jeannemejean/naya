import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Driver node-postgres (TCP) plutôt que @neondatabase/serverless (WebSocket) :
// l'app est un serveur Node long-running (Railway), pas une fonction edge/serverless.
// node-postgres retire de lui-même les connexions mortes et en recrée à la demande,
// donc une micro-coupure réseau Neon ne laisse plus le pool figé (plus besoin de restart
// manuel). SSL/connection string : même DATABASE_URL que connect-pg-simple, qui utilise
// déjà pg contre ce host Neon en prod → config prouvée compatible.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10000, // throw if no connection available within 10s
  idleTimeoutMillis: 30000,       // close idle connections after 30s
  keepAlive: true,                // TCP keep-alive : détecte plus vite une connexion morte
});

// Un client idle qui tombe (reset côté proxy Neon) émet 'error' au niveau du pool.
// Sans handler, node-postgres relaie l'erreur en 'uncaughtException' → crash du process.
// On la log ; le pool recréera les connexions à la prochaine requête.
pool.on('error', (err) => {
  console.error('[db] pool error (client idle):', err.message);
});

export const db = drizzle(pool, { schema });
