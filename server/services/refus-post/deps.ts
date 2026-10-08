// Implémentation réelle des dépendances du refus de post (base, mémoire, génération).
import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import { content, memoryEntries, type InsertContent } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { embedText } from "../memory/embed";
import { genererPostRemplacement } from "./remplacement";
import { placerTachesProductionPosts } from "../campagne/placement";
import type { RefusPostDeps } from "./service";

const SALIENCE_REFUS_POST = 0.8;

export const refusPostDeps: RefusPostDeps = {
  // Lecture par id seul : la propriété (userId) est contrôlée par le service.
  lirePost: async (id) => {
    const [row] = await db.select().from(content).where(eq(content.id, id));
    return row;
  },

  ecrireSouvenir: async ({ userId, projectId, texte }) => {
    // Embedding best-effort : sans vecteur, le souvenir est écrit quand même.
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(texte);
    } catch {
      embedding = null;
    }
    if (!embedding) console.warn(`[refus-post] préférence sans embedding (userId=${userId}, projectId=${projectId})`);
    await db.insert(memoryEntries).values({
      userId,
      projectId,
      fil: "cap",
      entryType: "préférence",
      content: texte,
      salience: SALIENCE_REFUS_POST,
      ...(embedding ? { embedding } : {}),
    });
  },

  generer: (input) => genererPostRemplacement(input),

  // Un remplaçant de post de campagne arrive avec ses tâches de production (le refusé
  // emporte les siennes à sa suppression). Leur placement ne fait jamais échouer le refus.
  creerPost: async (row) => {
    const cree = await storage.createContent(row satisfies InsertContent);
    if (cree.campaignId) {
      await placerTachesProductionPosts(storage, { userId: row.userId, posts: [cree] })
        .catch((e: any) => console.error("[refus-post] tâches de production du remplaçant :", e?.message ?? e));
    }
    return cree;
  },

  neutraliserPost: async (userId, id) => {
    const rows = await db.update(content).set({ autoPost: false }).where(and(
      eq(content.id, id),
      eq(content.userId, userId),
      isNull(content.publishedAt),
      or(isNull(content.postStatus), notInArray(content.postStatus, ["uploading", "processing", "posting", "posted"])),
    )).returning({ id: content.id });
    return rows.length > 0;
  },

  supprimerPost: (id) => storage.deleteContent(id),
};
