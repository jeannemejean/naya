import 'dotenv/config';
import dns from 'node:dns';
import net from 'node:net';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// ── Connexion a Neon depuis Railway : IPv4 d'abord, et un delai d'essai realiste ──────
//
// Symptome (24 septembre 2026) : /api/health renvoyait par intermittence
// { db: "disconnected" }, avec un message d'erreur VIDE. Une requete sur deux passait.
//
// La base n'y etait pour rien : interrogee directement au meme instant, elle repondait
// normalement, et son calcul Neon tourne sans interruption depuis le 18 septembre.
//
// Cause, lue dans les logs Railway. L'hote Neon resout SIX adresses — trois IPv6 et trois
// IPv4 :
//   connect ENETUNREACH 2600:1f18:700d:420f:... → le conteneur Railway n'a PAS de route IPv6
//   connect ETIMEDOUT   3.227.221.118:5432      → et l'IPv4 n'aboutit pas a temps
//
// Node 22 active « Happy Eyeballs » par defaut (autoSelectFamily) : il essaie les adresses
// en alternance, avec 250 ms par tentative. Les IPv6 echouent, les IPv4 n'ont pas le temps
// de terminer leur poignee de main TCP+TLS vers us-east-1, et toutes les adresses
// s'epuisent. Node leve alors une AggregateError dont le `.message` est VIDE — ce qui
// explique le `DB connection error:` sans rien apres.
//
// L'arithmetique confirme : les echecs duraient 754 a 769 ms, soit trois tentatives de
// 250 ms. Les requetes reussies, elles, prenaient 256 ms — une seule tentative qui aboutit.
//
// Deux reglages, au niveau du processus :
dns.setDefaultResultOrder('ipv4first');            // ne pas gaspiller d'essais sur l'IPv6 injoignable
net.setDefaultAutoSelectFamilyAttemptTimeout(2000); // 250 ms ne suffit pas pour un aller-retour inter-region

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

/** `db` ou une transaction — pour les helpers qui doivent fonctionner dans les deux. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
