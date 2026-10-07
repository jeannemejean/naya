// Accès base de « repenser la campagne » : lectures et transaction. Chaque requête porte
// sur userId ET campaignId — jamais seulement sur un identifiant de ligne.
import { and, eq, inArray } from "drizzle-orm";
import { campaigns, content, tasks } from "@shared/schema";
import { db, type DbExecutor } from "../../db";
import { storage } from "../../storage";
import type { ChampsRepenses, ContenuLu, OperationsTransaction, TacheLue } from "./repenser";

function operations(x: DbExecutor): OperationsTransaction {
  return {
    async lireContenus(userId, campaignId): Promise<ContenuLu[]> {
      return x
        .select({
          id: content.id,
          publishedAt: content.publishedAt,
          postStatus: content.postStatus,
          contentStatus: content.contentStatus,
        })
        .from(content)
        .where(and(eq(content.userId, userId), eq(content.campaignId, campaignId)));
    },
    async lireTaches(userId, campaignId): Promise<TacheLue[]> {
      const lignes = await x
        .select({ id: tasks.id, completed: tasks.completed })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.campaignId, campaignId)));
      return lignes.map((t) => ({ id: t.id, completed: t.completed === true }));
    },
    async mettreAJourCampagne(userId, campaignId, champs: ChampsRepenses) {
      const lignes = await x
        .update(campaigns)
        .set({ ...(champs as any), updatedAt: new Date() })
        .where(and(eq(campaigns.userId, userId), eq(campaigns.id, campaignId)))
        .returning({ id: campaigns.id });
      return lignes.length > 0;
    },
    async supprimerContenus(userId, campaignId, ids) {
      if (ids.length === 0) return 0;
      // `tasks.content_id` est en NO ACTION : une tâche gardée (faite) qui pointe vers un
      // post supprimé ferait échouer la suppression. On détache, la tâche survit.
      await x.update(tasks).set({ contentId: null })
        .where(and(eq(tasks.userId, userId), inArray(tasks.contentId, ids)));
      const lignes = await x
        .delete(content)
        .where(and(eq(content.userId, userId), eq(content.campaignId, campaignId), inArray(content.id, ids)))
        .returning({ id: content.id });
      return lignes.length;
    },
    async supprimerTaches(userId, campaignId, ids) {
      if (ids.length === 0) return 0;
      // Les FK enfants de `tasks` ne sont pas en CASCADE : même chemin que
      // `storage.deleteTasksByIds`, mais DANS cette transaction.
      await storage.clearTaskReferences(x, ids);
      const lignes = await x
        .delete(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.campaignId, campaignId), inArray(tasks.id, ids)))
        .returning({ id: tasks.id });
      return lignes.length;
    },
  };
}

/** Lectures hors transaction (aperçu). */
export const lecturesRepenser = {
  lireContenus: (userId: string, campaignId: number) => operations(db).lireContenus(userId, campaignId),
  lireTaches: (userId: string, campaignId: number) => operations(db).lireTaches(userId, campaignId),
};

/** Une seule `db.transaction` pour la mise à jour et les suppressions. */
export function transactionRepenser<T>(fn: (ops: OperationsTransaction) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(operations(tx)));
}
