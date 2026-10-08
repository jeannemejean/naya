/**
 * Rattrapage des campagnes lancées avant que la production ne dérive des posts (oct. 2026).
 *
 * Pour chaque campagne donnée :
 *   1. retire ses anciennes sous-tâches de contenu en anglais (« Write copy — … »,
 *      « Angle & structure — … », « Publish — … »…) : non faites, de type 'content',
 *      rattachées à la campagne et sans post (content_id nul) ;
 *   2. crée, pour chaque post à venir et non publié, les tâches de production qui manquent,
 *      reliées au post et planifiées à rebours de sa publication (idempotent).
 *
 * À BLANC PAR DÉFAUT : affiche ce qui serait supprimé et créé, n'écrit rien.
 *
 *   tsx server/scripts/migrer-production-posts.ts 7 8            # à blanc
 *   tsx server/scripts/migrer-production-posts.ts 7 8 --apply    # écrit
 *
 * Sans identifiant : campagnes 7 et 8. Ne PAS lancer pendant un « Repenser » en cours.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { campaigns, tasks } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { parisTodayString } from "../utils/timezone";
import { migrerProductionCampagne } from "../services/campagne/migration-production";

async function main() {
  const args = process.argv.slice(2);
  const appliquer = args.includes("--apply");
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const campagnes = ids.length > 0 ? ids : [7, 8];
  const aujourdhui = parisTodayString(new Date());

  console.log(appliquer ? "MODE ÉCRITURE (--apply)" : "MODE À BLANC — rien ne sera écrit (ajouter --apply pour écrire)");
  console.log(`Aujourd'hui (Paris) : ${aujourdhui}\n`);

  for (const campaignId of campagnes) {
    const [campagne] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campagne) {
      console.log(`✗ campagne #${campaignId} introuvable\n`);
      continue;
    }
    console.log(`── Campagne #${campaignId} « ${campagne.name} » (statut ${campagne.status})`);

    const r = await migrerProductionCampagne({
      placement: storage,
      lireTachesCampagne: (id) => db.select().from(tasks).where(eq(tasks.campaignId, id)),
      supprimerTaches: async (aSuppr) => {
        for (const id of aSuppr) await storage.deleteTask(id);
        return aSuppr.length;
      },
    }, { userId: campagne.userId, campaignId, aujourdhui, appliquer });

    console.log(`  ${r.aSupprimer.length} ancienne(s) sous-tâche(s) ${appliquer ? "supprimée(s)" : "à supprimer"} :`);
    for (const t of r.aSupprimer) console.log(`    - #${t.id} ${t.scheduledDate ?? "sans date"} ${t.title}`);
    console.log(`  ${r.aCreer.length} tâche(s) de production ${appliquer ? "créée(s)" : "à créer"} :`);
    for (const t of r.aCreer) console.log(`    + ${t.scheduledDate} ${t.scheduledTime} ${t.title} (post #${t.contentId})`);
    if (appliquer) {
      await storage.fixOverlappingTasks(campagne.userId, aujourdhui).catch((e: any) =>
        console.error("  fixOverlappingTasks :", e?.message ?? e));
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Échec du rattrapage :", err);
  process.exit(1);
});
