// Import unique des appels d'offres exportés de Notion (« 🏛️ Veille Appels d'offres JMD »)
// vers la table appels_offres, pour UNE utilisatrice.
//
// Même garde que migrate-prod.ts : rien n'est lu dans .env.
//   IMPORT_DATABASE_URL  URL de la base, passée explicitement
//   IMPORT_USER_ID       id de l'utilisatrice propriétaire des lignes
//   IMPORT_PROJECT_ID    (facultatif) projet de l'agence auquel rattacher les lignes
//   IMPORT_FICHIER       (facultatif) JSON exporté ; défaut Naya-Build/donnees-import/appels-offres-notion.json
//
// Sans argument : essai à blanc (lecture seule) — comptes et 3 lignes mappées.
// Avec --appliquer : écrit. La production (ep-damp-water) exige en plus
// IMPORT_CONFIRMER_PRODUCTION=oui.
//
// Idempotent : clé unique (user_id, source='notion_import', source_id = id de la page Notion).
// L'écriture passe par upsertDepuisVeille (server/services/appels-offres-store.ts) : relancé,
// il met à jour les champs venus de la veille mais ne touche ni au statut ni aux notes.
import { readFileSync } from "node:fs";
import pg from "pg";
const { Pool } = pg;
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { appelsOffres, users, projects } from "../shared/schema";
import { mapperLigneNotion, type AppelOffresImporte } from "../shared/appels-offres";

const ENDPOINT_PRODUCTION = "ep-damp-water";

const url = process.env.IMPORT_DATABASE_URL;
const userId = process.env.IMPORT_USER_ID;
const projectId = process.env.IMPORT_PROJECT_ID ? Number(process.env.IMPORT_PROJECT_ID) : null;
const fichier = process.env.IMPORT_FICHIER ?? "/Users/jeannemejean/Desktop/Naya-Build/donnees-import/appels-offres-notion.json";
const appliquer = process.argv.includes("--appliquer");

if (!url) { console.error("REFUS : IMPORT_DATABASE_URL absente. L'URL doit être passée explicitement."); process.exit(1); }
if (!userId) { console.error("REFUS : IMPORT_USER_ID absent."); process.exit(1); }
if (projectId !== null && !Number.isInteger(projectId)) { console.error("REFUS : IMPORT_PROJECT_ID n'est pas un entier."); process.exit(1); }
const estProduction = url.includes(ENDPOINT_PRODUCTION);
if (appliquer && estProduction && process.env.IMPORT_CONFIRMER_PRODUCTION !== "oui") {
  console.error("REFUS : URL de production. Ajouter IMPORT_CONFIRMER_PRODUCTION=oui pour écrire en production.");
  process.exit(1);
}
// Le module d'accès base lit DATABASE_URL (et .env via dotenv, qui n'écrase pas une variable
// déjà posée) : on l'aligne sur l'URL explicite AVANT de l'importer. L'écriture passe de toute
// façon par le pool ci-dessous.
process.env.DATABASE_URL = url;
const { upsertDepuisVeille } = await import("../server/services/appels-offres-store");
const hote = url.match(/@([^/:?]+)/)?.[1] ?? "?";

const brut = JSON.parse(readFileSync(fichier, "utf8"));
const lignes: Record<string, unknown>[] = Array.isArray(brut) ? brut : brut.rows;
const mappees: AppelOffresImporte[] = [];
let ignorees = 0;
for (const l of lignes) {
  const m = mapperLigneNotion(l);
  if (m) mappees.push(m); else ignorees++;
}
const doublons = mappees.length - new Set(mappees.map((m) => m.sourceId)).size;

console.info(`Mode : ${appliquer ? "APPLICATION" : "essai à blanc (rien n'est écrit)"}`);
console.info(`Base : ${hote}${estProduction ? " (PRODUCTION)" : ""}`);
console.info(`Utilisatrice : ${userId}${projectId ? ` — projet ${projectId}` : ""}`);
console.info(`Fichier : ${fichier} — ${lignes.length} lignes, ${mappees.length} mappées, ${ignorees} ignorées, ${doublons} doublons d'id`);
const compte = (cle: keyof AppelOffresImporte) => mappees.reduce<Record<string, number>>((acc, m) => {
  const v = Array.isArray(m[cle]) ? (m[cle] as string[]).join("+") || "∅" : String(m[cle] ?? "∅");
  acc[v] = (acc[v] ?? 0) + 1; return acc;
}, {});
console.info("Statuts :", compte("statut"));
console.info("Scores :", compte("scoreAdequation"));
console.info("Procédures :", compte("procedure"));
console.info(`Sans date limite : ${mappees.filter((m) => !m.dateLimite).length} — avec montant : ${mappees.filter((m) => m.montantEstimeHt).length}`);
console.info("Exemples :");
for (const m of mappees.slice(0, 3)) console.info(JSON.stringify(m, null, 2));

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);
try {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) { console.error(`REFUS : aucune utilisatrice ${userId} dans cette base.`); process.exit(1); }
  if (projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!p) { console.error(`REFUS : le projet ${projectId} n'est pas à ${userId}.`); process.exit(1); }
  }
  const existants = await db.select({ sourceId: appelsOffres.sourceId }).from(appelsOffres)
    .where(and(eq(appelsOffres.userId, userId), eq(appelsOffres.source, "notion_import")));
  const deja = new Set(existants.map((e) => e.sourceId));
  const nouveaux = mappees.filter((m) => !deja.has(m.sourceId)).length;
  console.info(`Déjà importées : ${deja.size} — à créer : ${nouveaux} — à mettre à jour : ${mappees.length - nouveaux}`);

  if (!appliquer) {
    console.info("Essai à blanc terminé. Relancer avec --appliquer pour écrire.");
  } else {
    const { ecrites } = await upsertDepuisVeille(userId, mappees, { projectId }, db);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(appelsOffres)
      .where(and(eq(appelsOffres.userId, userId), eq(appelsOffres.source, "notion_import")));
    console.info(`Écrites : ${ecrites}. Lignes notion_import pour ${userId} : ${n}.`);
  }
} finally {
  await pool.end();
}
