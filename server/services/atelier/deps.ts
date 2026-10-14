// Les vraies dépendances de l'atelier de contenu (base, IA, comptes sociaux).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { content, tasks } from "@shared/schema";
import { storage } from "../../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import { compteDePublication } from "../connexions/comptes";
import type { GenreMedia } from "@shared/programmation";
import type { DepsRedaction } from "./redaction";
import type { DepsValidation } from "./validation";
import { notifierRoutine } from "../routines/notifier";
import { langueDuCompte } from "../garde-langue";
import { placerTachesProductionPosts, parseWorkDays, DAY_ABBRS } from "../campagne/placement";
import { redigerPost } from "./redaction";
import { basculerVersAteliers, preRediger, rappelVeille, type DepsQuotidien } from "./quotidien";
import { jourHeureParis } from "./validation";

/** Les visuels d'un post (dans l'ordre de publication), avec leur nature. */
export async function mediasDuPost(userId: string, post: any): Promise<Array<{ id: number; url: string; mimeType: string | null; genre: GenreMedia }>> {
  const ids = Array.isArray(post?.mediaIds) ? (post.mediaIds as unknown[]).map(Number).filter(Number.isInteger) : [];
  const out: Array<{ id: number; url: string; mimeType: string | null; genre: GenreMedia }> = [];
  for (const id of ids) {
    const m = await storage.getMediaItemById(id, userId);
    if (m?.url) out.push({ id, url: m.url, mimeType: m.mimeType ?? null, genre: (m.mimeType || "").startsWith("video/") ? "video" : "image" });
  }
  return out;
}

async function genresDuPost(userId: string, post: any): Promise<GenreMedia[]> {
  const g = (await mediasDuPost(userId, post)).map((m) => m.genre);
  if (g.length === 0 && post?.mediaUrl) g.push("image");
  return g;
}

export async function compteDuPost(userId: string, post: any) {
  const choix = await compteDePublication({ ...post, userId });
  return "compte" in choix ? (choix.compte as any) : null;
}

export const depsRedaction: DepsRedaction = {
  lirePost: (id, userId) => storage.getContentById(id, userId) as any,
  async reserverRedaction(id, userId, consigne) {
    const r = await db.update(content).set({ consigne, updatedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.userId, userId), isNull(content.consigne)))
      .returning({ id: content.id });
    return r.length > 0;
  },
  async ecrireBrouillon(id, userId, body) {
    // Jamais par-dessus un post validé, programmé ou publié entre-temps.
    await db.update(content).set({ body, contentStatus: "draft", updatedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.userId, userId), sql`coalesce(${content.contentStatus}, '') <> 'ready'`,
        sql`coalesce(${content.autoPost}, false) = false`, isNull(content.publishedAt)));
  },
  async liberer(id, userId) {
    await db.update(content).set({ consigne: null })
      .where(and(eq(content.id, id), eq(content.userId, userId), sql`coalesce(${content.contentStatus}, '') <> 'draft'`));
  },
  garde: gardeDepense,
  ia: (userId, projectId, prompt) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1500,
  }),
};

export const depsValidation: DepsValidation = {
  lirePost: (id, userId) => storage.getContentById(id, userId),
  async majPost(id, userId, patch) {
    const [p] = await db.update(content).set({ ...(patch as any), updatedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.userId, userId))).returning();
    return p;
  },
  mediasDuPost: genresDuPost,
  compteDuPost,
  tachesDuPost: (userId, contentId) => storage.getTasksForContents(userId, [contentId]),
  async archiverTaches(userId, ids) {
    if (!ids.length) return;
    await db.update(tasks).set({ archivedAt: new Date() }).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
  },
  creerTache: (t) => storage.createTask(t as any),
  async majTache(userId, id, patch) {
    await db.update(tasks).set(patch as any).where(and(eq(tasks.userId, userId), eq(tasks.id, id)));
  },
  postsEntre: (userId, debut, fin) => storage.getPostsEntre(userId, debut, fin),
  tachesAtelier: (userId, semaine) => storage.getTachesAtelier(userId, semaine),
  async cocherTaches(userId, ids) {
    if (!ids.length) return;
    await db.update(tasks).set({ completed: true, completedAt: new Date() })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids), eq(tasks.completed, false)));
  },
  maintenant: () => new Date(),
};

// ─── Le passage du matin ─────────────────────────────────────────────────────

export const depsQuotidien: DepsQuotidien = {
  postsEntre: (userId, debut, fin) => storage.getPostsEntre(userId, debut, fin),
  tachesDesPosts: (userId, ids) => storage.getTasksForContents(userId, ids),
  archiverTaches: (userId, ids) => depsValidation.archiverTaches(userId, ids),
  placer: (userId, posts) => placerTachesProductionPosts(storage, { userId, posts, aujourdhui: jourHeureParis(new Date()).jour }),
  tachesAtelier: (userId, semaine) => storage.getTachesAtelier(userId, semaine),
  rediger: (userId, id) => redigerPost(depsRedaction, userId, id),
  notifier: (userId, message, lien) => notifierRoutine(userId, message, lien),
};

/** Bascule des campagnes en cours, puis rappel des posts de demain non validés. */
export async function passageAtelierMatin(userId: string): Promise<void> {
  const maintenant = new Date();
  const aujourdhui = jourHeureParis(maintenant).jour;
  const b = await basculerVersAteliers(depsQuotidien, userId, { aujourdhui, appliquer: true });
  if (b.convertis.length) {
    console.log(`[atelier] bascule user=${userId} : ${b.convertis.length} post(s), ${b.archivees.length} étape(s) archivée(s), ${b.creees} tâche(s) d'atelier`);
  }
  const langue = (await langueDuCompte(userId)) === "en" ? "en" : "fr";
  await rappelVeille(depsQuotidien, userId, maintenant, langue);
}

/** Pré-rédaction des ateliers d'aujourd'hui et du prochain jour travaillé (appels IA). */
export async function preRedactionMatin(userId: string): Promise<number> {
  const prefs = await storage.getUserPreferences(userId);
  const jours = parseWorkDays((prefs as any)?.workDays);
  const estTravaille = (d: string) => jours.has(DAY_ABBRS[new Date(`${d}T12:00:00Z`).getUTCDay()]);
  return preRediger(depsQuotidien, userId, jourHeureParis(new Date()).jour, estTravaille);
}
