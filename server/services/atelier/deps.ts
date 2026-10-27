// Les vraies dépendances de l'atelier de contenu (base, IA, comptes sociaux).
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { content, tasks } from "@shared/schema";
import { storage } from "../../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { tendancesPourLeContenu } from "../profils-veille/tri";
import { stockageProfils } from "../profils-veille/stockage";
import { gardeDepense } from "../routines/garde";
import { compteDePublication, type DepsComptes } from "../connexions/comptes";
import type { GenreMedia } from "@shared/programmation";
import { effetSurPost } from "@shared/livrables";
import { genreDuMedia } from "@shared/atelier";
import type { DepsRedaction } from "./redaction";
import type { DepsValidation } from "./validation";
import { notifierRoutine } from "../routines/notifier";
import { langueDuCompte } from "../garde-langue";
import { placerTachesProductionPosts, parseWorkDays, DAY_ABBRS } from "../campagne/placement";
import { redigerPost, refairePost } from "./redaction";
import { devaliderPost } from "./validation";
import { SCHEMA_NOTE, SYSTEME_NOTE, promptNote, type DepsNote } from "./note";
import { refuserPost } from "../refus-post/service";
import { refusPostDeps } from "../refus-post/deps";
import { basculerVersAteliers, preRediger, rappelVeille, type DepsQuotidien } from "./quotidien";
import { jourHeureParis } from "./validation";

/** Les visuels d'un post (dans l'ordre de publication), avec leur nature. */
export async function mediasDuPost(userId: string, post: any): Promise<Array<{ id: number; url: string; mimeType: string | null; genre: GenreMedia }>> {
  const ids = Array.isArray(post?.mediaIds) ? (post.mediaIds as unknown[]).map(Number).filter(Number.isInteger) : [];
  // En parallèle : chaque lecture est un aller-retour réseau vers la base (l'atelier en faisait
  // des dizaines à la suite). Promise.all garde l'ordre des visuels.
  const lus = await Promise.all(ids.map((id) => storage.getMediaItemById(id, userId)));
  return lus.flatMap((m, i) => (m?.url ? [{ id: ids[i], url: m.url, mimeType: m.mimeType ?? null, genre: genreDuMedia(m) }] : []));
}

async function genresDuPost(userId: string, post: any): Promise<GenreMedia[]> {
  const g = (await mediasDuPost(userId, post)).map((m) => m.genre);
  if (g.length === 0 && post?.mediaUrl) g.push("image");
  return g;
}

export async function compteDuPost(userId: string, post: any, deps?: DepsComptes) {
  const choix = await compteDePublication({ ...post, userId }, deps);
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
  async ecrireBrouillon(id, userId, body, { siCorps, annexe }) {
    // Jamais par-dessus un post validé, programmé ou publié entre-temps ; et, pour une rédaction
    // automatique, jamais par-dessus ce que l'utilisatrice a écrit pendant ce temps (`siCorps`).
    const r = await db.update(content).set({
      body, contentStatus: "draft", updatedAt: new Date(),
      ...(annexe ? { consigne: sql`coalesce(${content.consigne}, '') || ${"\n\n" + annexe}` } : {}),
    }).where(and(eq(content.id, id), eq(content.userId, userId), sql`coalesce(${content.contentStatus}, '') <> 'ready'`,
      sql`coalesce(${content.autoPost}, false) = false`, isNull(content.publishedAt),
      ...(siCorps !== undefined ? [eq(content.body, siCorps)] : []))).returning({ id: content.id });
    return r.length > 0;
  },
  async etapeEcritureFaite(userId, id) {
    const liees = await storage.getTasksForContents(userId, [id]);
    return liees.some((t) => t.completed && effetSurPost(t.title).texte);
  },
  async marquerBrouillon(id, userId) {
    await db.update(content).set({ contentStatus: "draft", updatedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.userId, userId), sql`coalesce(${content.contentStatus}, '') <> 'ready'`));
  },
  async liberer(id, userId) {
    await db.update(content).set({ consigne: null })
      .where(and(eq(content.id, id), eq(content.userId, userId), sql`coalesce(${content.contentStatus}, '') <> 'draft'`));
  },
  garde: gardeDepense,
  ia: async (userId, projectId, prompt, opts) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1500,
    destinataire: "audience", // le texte d'un post de la marque, pas Naya qui parle à l'utilisatrice
    additionalSystemContext: await tendancesPourLeContenu(userId, projectId, opts?.plateformes ?? []),
  }),
  async lierTendance(id, userId, tendanceProjetId) {
    const t = await stockageProfils.tendanceProjet(userId, tendanceProjetId);
    if (t) await db.update(content).set({ tendanceId: t.tendanceId }).where(and(eq(content.id, id), eq(content.userId, userId)));
  },
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
  async desarchiverTaches(userId, ids) {
    if (!ids.length) return;
    await db.update(tasks).set({ archivedAt: null }).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
  },
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

// ─── La note à Naya sur un post ──────────────────────────────────────────────

export const depsNote: DepsNote = {
  lirePost: (id, userId) => storage.getContentById(id, userId) as any,
  garde: gardeDepense,
  async decider(userId, post, note) {
    const [{ isAiBlocked }, { buildNayaContext }, { genererStructure }] = await Promise.all([
      import("../usage"), import("../naya-context"), import("../ai/structure"),
    ]);
    if (await isAiBlocked(userId)) return null;
    const contexte = await buildNayaContext(userId, (post as any).projectId ?? null, "Une note sur un post prévu");
    const { valeur } = await genererStructure({
      schema: SCHEMA_NOTE, system: `${SYSTEME_NOTE}\n\n${contexte}`, model: CLAUDE_MODELS.fast, maxTokens: 600,
      taskKind: "classification", etape: "note sur un post de l'atelier", userId, projectId: (post as any).projectId ?? null,
      prompt: promptNote(post, note),
    });
    return valeur;
  },
  async autresSujets(userId, post) {
    if (!post.scheduledFor) return [];
    const t = new Date(post.scheduledFor).getTime();
    const voisins = await storage.getPostsEntre(userId, new Date(t - 7 * 86400000), new Date(t + 8 * 86400000));
    return voisins.filter((p) => p.id !== post.id).map((p) => (p.title ?? "").trim()).filter(Boolean);
  },
  devalider: (userId, id) => devaliderPost(depsValidation, userId, id),
  refaire: (userId, id, consigne) => refairePost(depsRedaction, userId, id, consigne),
  refuser: (userId, id, o) => refuserPost(refusPostDeps, { userId, contentId: id, raison: "other", ...o }),
};
