// Remise en ordre ponctuelle du planning d'UN utilisateur selon les précédences
// (prérequis avant dépendant), avec un garde-fou comme scripts/migrate-prod.ts.
//
// Usage :
//   REORDONNER_DATABASE_URL=<url prod> npx tsx scripts/reordonner-planning.ts --user <id>              (à blanc)
//   REORDONNER_DATABASE_URL=<url prod> npx tsx scripts/reordonner-planning.ts --user <id> --appliquer
//
// À BLANC par défaut : rien n'est écrit. On valide la liste avant d'appliquer.
// Le script REFUSE de s'exécuter (sans se connecter) si l'URL ne désigne pas l'endpoint de
// production, ou si --user manque.
// `pg` est un module CommonJS : l'import nommé échoue sous ESM (cf. migrate-prod.ts).
import pg from "pg";
const { Pool } = pg;
import { respecterPrecedences } from "../server/services/precedence";
import { calendrierDepuisPreferences, deplacementsAdmissibles } from "../server/services/stabiliser-planning";

const ENDPOINT_PRODUCTION = "ep-damp-water-anuyb0k6";
// Même plafond du tampon que storage (BUFFER_MIN_CEILING dans services/rhythm-buffer.ts).
// Répliqué ici car rhythm-buffer importe tout `storage` (donc exige DATABASE_URL à l'import) ;
// la vérification à blanc doit rester légère.
const PLAFOND_TAMPON = 30;

function refuser(msg: string): never {
  console.error(`REFUS : ${msg}`);
  console.error("Aucune modification n'a été faite.");
  process.exit(1);
}

const url = process.env.REORDONNER_DATABASE_URL;
if (!url) refuser("REORDONNER_DATABASE_URL absente. L'URL doit être passée explicitement.");
if (!url.includes(ENDPOINT_PRODUCTION)) {
  refuser(`l'URL fournie ne désigne pas l'endpoint de production (${ENDPOINT_PRODUCTION}).`);
}

const args = process.argv.slice(2);
const iUser = args.indexOf("--user");
const userId = iUser >= 0 ? args[iUser + 1] : undefined;
if (!userId || userId.startsWith("--")) refuser("argument --user <id> obligatoire.");
const appliquer = args.includes("--appliquer");

// Aujourd'hui à Paris (même calcul que storage.maintenantParis).
const fmt = (o: Intl.DateTimeFormatOptions, loc: string) => new Intl.DateTimeFormat(loc, { timeZone: "Europe/Paris", ...o }).format(new Date());
const aujourdhui = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");
const [hh, mm] = fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, "en-GB").split(":").map(Number);
const maintenantMin = hh * 60 + (mm || 0);

const pool = new Pool({ connectionString: url, max: 1 });
try {
  console.info(`Endpoint vérifié : ${ENDPOINT_PRODUCTION}. Utilisateur : ${userId}. Mode : ${appliquer ? "APPLICATION" : "à blanc (rien n'est écrit)"}.`);
  console.info(`Aujourd'hui (Paris) : ${aujourdhui}`);

  // (a) Auto-dépendances de l'utilisateur.
  const auto = await pool.query(
    `SELECT d.id, d.task_id FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
     WHERE d.task_id = d.depends_on_task_id AND t.user_id = $1 ORDER BY d.id`, [userId]);
  console.info(`\n(a) Auto-dépendances à supprimer : ${auto.rows.length}`);
  for (const r of auto.rows) console.info(`  dépendance #${r.id} sur la tâche ${r.task_id}`);

  // (b) Déplacements de la règle de précédence (tâches visibles à partir d'aujourd'hui).
  const taches = (await pool.query(
    `SELECT id, title, scheduled_date, scheduled_time, estimated_duration, completed, scheduling_mode
     FROM tasks WHERE user_id = $1 AND archived_at IS NULL AND scheduled_date >= $2 ORDER BY id`,
    [userId, aujourdhui])).rows;
  const ids = taches.map((t) => t.id as number);
  const deps = ids.length === 0 ? [] : (await pool.query(
    `SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id = ANY($1::int[])`, [ids])).rows
    .map((r) => ({ taskId: r.task_id as number, dependsOnTaskId: r.depends_on_task_id as number }))
    .filter((d) => ids.includes(d.dependsOnTaskId));
  const prefs = (await pool.query(
    `SELECT work_days, work_day_start, work_day_end, buffer_min FROM user_preferences WHERE user_id = $1`, [userId])).rows[0];

  const proposes = respecterPrecedences({
    taches: taches.map((t) => ({
      id: t.id, scheduledDate: t.scheduled_date, scheduledTime: t.scheduled_time,
      estimatedDuration: t.estimated_duration, completed: t.completed,
    })),
    dependances: deps,
    calendrier: calendrierDepuisPreferences(
      prefs && { workDays: prefs.work_days, workDayStart: prefs.work_day_start, workDayEnd: prefs.work_day_end, bufferMin: prefs.buffer_min },
      PLAFOND_TAMPON),
  });
  const mouvements = deplacementsAdmissibles(
    proposes.map((p) => ({ id: p.id, scheduledDate: p.scheduledDate, scheduledTime: p.scheduledTime })),
    { aujourdhui, maintenantMin, idsFixes: new Set(taches.filter((t) => t.scheduling_mode === "fixed").map((t) => t.id as number)) });

  console.info(`\n(b) Déplacements de précédence prévus : ${mouvements.length} (sur ${taches.length} tâche(s) visibles, ${deps.length} dépendance(s))`);
  for (const mv of mouvements) {
    const t = taches.find((x) => x.id === mv.id)!;
    const titre = String(t.title ?? "").slice(0, 60);
    console.info(`  ${mv.id} | ${titre} | avant ${t.scheduled_date} ${t.scheduled_time} → après ${mv.scheduledDate} ${mv.scheduledTime}`);
  }
  console.info("\nNote : l'application réelle relance en plus le re-tassage (chevauchements) ; les heures finales peuvent donc différer légèrement.");

  if (!appliquer) {
    console.info("\nÀ blanc : rien n'a été écrit. Relancer avec --appliquer après validation.");
  } else {
    // Supprimer (a), puis lancer le VRAI storage.fixOverlappingTasks. db.ts lit DATABASE_URL
    // à l'import : on la pose avant l'import dynamique.
    const supprimees = auto.rows.length === 0 ? 0 : (await pool.query(
      `DELETE FROM task_dependencies WHERE id = ANY($1::int[])`, [auto.rows.map((r) => r.id)])).rowCount;
    console.info(`\nAuto-dépendances supprimées : ${supprimees}`);
    process.env.DATABASE_URL = url;
    const { storage } = await import("../server/storage");
    const touchees = await storage.fixOverlappingTasks(userId!, aujourdhui);
    console.info(`fixOverlappingTasks : ${touchees} tâche(s) touchée(s) (re-tassées + déplacées).`);
    console.info(`Résumé : ${supprimees} auto-dépendance(s) supprimée(s), ${touchees} tâche(s) touchée(s).`);
  }
} finally {
  await pool.end();
}
process.exit(0);
