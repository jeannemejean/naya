// Dépendances des routes de la bibliothèque (textes enregistrés, posts modèles) et de l'aperçu
// de la grille Instagram. Injectées : les tests de routes les simulent sans base.
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  content, mediaLibrary, modelesPost, textesEnregistres,
  type Content, type ModelePost, type TexteEnregistre,
} from "@shared/schema";
import { FORMATS_FIL } from "@shared/apercu-instagram";
import { journaliser } from "../gestion-posts/historique";

export interface DepsBibliotheque {
  projet(id: number, userId: string): Promise<{ id: number; projectKind?: string | null } | undefined>;
  /** Post vivant de l'utilisatrice (hors corbeille). */
  post(id: number, userId: string): Promise<Content | undefined>;
  /** Posts vivants du même envoi multi-réseaux. */
  freres(userId: string, groupe: string): Promise<Content[]>;
  creerPost(row: Record<string, any>): Promise<Content>;
  journaliser: typeof journaliser;

  textes(userId: string): Promise<TexteEnregistre[]>;
  creerTexte(userId: string, v: { titre: string; texte: string; projectId: number | null }): Promise<TexteEnregistre>;
  modifierTexte(userId: string, id: number, v: Partial<{ titre: string; texte: string; projectId: number | null }>): Promise<TexteEnregistre | undefined>;
  supprimerTexte(userId: string, id: number): Promise<boolean>;

  modeles(userId: string): Promise<ModelePost[]>;
  modele(userId: string, id: number): Promise<ModelePost | undefined>;
  creerModele(userId: string, v: { nom: string; projectId: number | null; contenu: unknown }): Promise<ModelePost>;
  supprimerModele(userId: string, id: number): Promise<boolean>;

  /** Aperçu Instagram : les posts candidats de la marque (null = sans marque), hors corbeille. */
  postsInstagram(userId: string, projectId: number | null, depuis: Date): Promise<Content[]>;
  medias(userId: string, ids: number[]): Promise<Array<{ id: number; url: string; thumbnailUrl: string | null; mimeType: string }>>;
  comptes(userId: string): Promise<any[]>;
}

export const depsBibliotheque: DepsBibliotheque = {
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  post: (id, userId) => storage.getContentById(id, userId),
  freres: (userId, groupe) => db.select().from(content)
    .where(and(eq(content.userId, userId), eq(content.crossPostGroupId, groupe), isNull(content.supprimeLe))),
  creerPost: (row) => storage.createContent(row as any),
  journaliser,

  textes: (userId) => db.select().from(textesEnregistres)
    .where(eq(textesEnregistres.userId, userId))
    .orderBy(desc(textesEnregistres.updatedAt), desc(textesEnregistres.id))
    .limit(500),
  async creerTexte(userId, v) {
    const [t] = await db.insert(textesEnregistres).values({ userId, ...v }).returning();
    return t;
  },
  async modifierTexte(userId, id, v) {
    const [t] = await db.update(textesEnregistres).set({ ...v, updatedAt: new Date() })
      .where(and(eq(textesEnregistres.id, id), eq(textesEnregistres.userId, userId)))
      .returning();
    return t;
  },
  async supprimerTexte(userId, id) {
    const r = await db.delete(textesEnregistres)
      .where(and(eq(textesEnregistres.id, id), eq(textesEnregistres.userId, userId)))
      .returning({ id: textesEnregistres.id });
    return r.length > 0;
  },

  modeles: (userId) => db.select().from(modelesPost)
    .where(eq(modelesPost.userId, userId))
    .orderBy(desc(modelesPost.createdAt), desc(modelesPost.id))
    .limit(500),
  async modele(userId, id) {
    const [m] = await db.select().from(modelesPost).where(and(eq(modelesPost.id, id), eq(modelesPost.userId, userId)));
    return m;
  },
  async creerModele(userId, v) {
    const [m] = await db.insert(modelesPost).values({ userId, nom: v.nom, projectId: v.projectId, contenu: v.contenu as any }).returning();
    return m;
  },
  async supprimerModele(userId, id) {
    const r = await db.delete(modelesPost)
      .where(and(eq(modelesPost.id, id), eq(modelesPost.userId, userId)))
      .returning({ id: modelesPost.id });
    return r.length > 0;
  },

  postsInstagram: (userId, projectId, depuis) => db.select().from(content)
    .where(and(
      eq(content.userId, userId),
      projectId == null ? isNull(content.projectId) : eq(content.projectId, projectId),
      isNull(content.supprimeLe),
      sql`lower(trim(${content.platform})) = 'instagram'`,
      or(isNull(content.postFormat), inArray(content.postFormat, [...FORMATS_FIL])),
      or(isNotNull(content.publishedAt), eq(content.postStatus, "posted"), gte(content.scheduledFor, depuis)),
    ))
    .orderBy(desc(sql`coalesce(${content.publishedAt}, ${content.scheduledFor})`))
    .limit(200),
  medias: async (userId, ids) => (ids.length === 0 ? [] : db
    .select({ id: mediaLibrary.id, url: mediaLibrary.url, thumbnailUrl: mediaLibrary.thumbnailUrl, mimeType: mediaLibrary.mimeType })
    .from(mediaLibrary)
    .where(and(eq(mediaLibrary.userId, userId), inArray(mediaLibrary.id, ids)))),
  comptes: (userId) => storage.getSocialAccounts(userId),
};
