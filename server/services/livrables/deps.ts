// server/services/livrables/deps.ts — implémentation réelle (Drizzle, R2, mémoire).
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { content, livrables, mediaLibrary } from "@shared/schema";
import { deposerDossier, perimerSouvenirs } from "../memory/deposer-dossier";
import { deleteObject, deletePrivateObject, keyFromPublicUrl } from "../r2-storage";
import type { LivrablesDeps } from "./service";
import { estCleFichierDe, estUrlMediaDe } from "./urls";

export const livrablesDeps: LivrablesDeps = {
  async inserer(row) {
    const [l] = await db.insert(livrables).values(row as any).returning();
    return l;
  },
  async maj(id, userId, patch) {
    const [l] = await db.update(livrables)
      .set({ ...(patch as any), updatedAt: new Date() })
      .where(and(eq(livrables.id, id), eq(livrables.userId, userId)))
      .returning();
    return l ?? null;
  },
  async lire(id, userId) {
    const [l] = await db.select().from(livrables)
      .where(and(eq(livrables.id, id), eq(livrables.userId, userId)));
    return l;
  },
  async supprimer(id, userId) {
    const r = await db.delete(livrables).where(and(eq(livrables.id, id), eq(livrables.userId, userId)));
    return (r.rowCount ?? 0) > 0;
  },
  async creerMedia(row) {
    const [m] = await db.insert(mediaLibrary).values(row as any).returning({ id: mediaLibrary.id });
    return m;
  },
  async majMediaAlt(mediaId, userId, alt) {
    await db.update(mediaLibrary).set({ alt, updatedAt: new Date() } as any)
      .where(and(eq(mediaLibrary.id, mediaId), eq(mediaLibrary.userId, userId)));
  },
  async supprimerMedia(mediaId, userId) {
    await db.delete(mediaLibrary).where(and(eq(mediaLibrary.id, mediaId), eq(mediaLibrary.userId, userId)));
  },
  async mediaReferenceParUnContenu(userId, mediaId, url) {
    const conditions = [sql`${content.mediaIds} @> ${JSON.stringify([mediaId])}::jsonb`];
    if (url) conditions.push(eq(content.mediaUrl, url));
    const [r] = await db.select({ id: content.id }).from(content)
      .where(and(eq(content.userId, userId), or(...conditions)))
      .limit(1);
    return !!r;
  },
  async deposerMemoire(input) {
    const r = await deposerDossier(input);
    return { morceaux: r.morceaux, ids: r.ids };
  },
  perimerMemoire: perimerSouvenirs,
  async supprimerObjetPublic(userId, url) {
    // Défense en profondeur : jamais l'objet d'un autre compte.
    if (!estUrlMediaDe(userId, url)) return;
    const key = keyFromPublicUrl(url);
    if (key) await deleteObject(key);
  },
  async supprimerObjetPrive(userId, key) {
    if (!estCleFichierDe(userId, key)) return;
    await deletePrivateObject(key);
  },
};

/** Livrables d'une tâche ou d'un projet, récents d'abord, filtrés par propriétaire. */
export async function listerLivrables(userId: string, filtre: { taskId?: number; projectId?: number }) {
  const cond = filtre.taskId != null
    ? eq(livrables.taskId, filtre.taskId)
    : eq(livrables.projectId, filtre.projectId!);
  return db.select().from(livrables)
    .where(and(eq(livrables.userId, userId), cond))
    .orderBy(desc(livrables.createdAt));
}
