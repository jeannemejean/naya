// Dépendances des routes de gestion des posts (notes, historique, duplication, corbeille,
// actions groupées). Injectées : les tests de routes les simulent sans base.
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { content, historiquePost, notesPost, type Content, type HistoriquePost, type NotePost } from "@shared/schema";
import { journaliser } from "./historique";
import { relancerValidationSiEdite } from "../validation/relance";

export interface DepsGestionPosts {
  /** Post vivant de l'utilisatrice (hors corbeille). */
  post(id: number, userId: string): Promise<Content | undefined>;
  /** Post de l'utilisatrice, corbeille comprise. */
  postMemeSupprime(id: number, userId: string): Promise<Content | undefined>;
  /** Posts vivants de l'utilisatrice parmi ces ids. */
  posts(userId: string, ids: number[]): Promise<Content[]>;
  projet(id: number, userId: string): Promise<{ id: number } | undefined>;
  creer(row: Record<string, any>): Promise<Content>;
  /** Déplace un post (jamais s'il est parti entre-temps). Rend false s'il n'a pas bougé. */
  deplacer(id: number, userId: string, quand: Date): Promise<boolean>;
  mettreALaCorbeille(id: number, userId: string): Promise<boolean>;
  restaurer(id: number, userId: string): Promise<boolean>;
  corbeille(userId: string, depuis: Date): Promise<Content[]>;
  supprimerDefinitivement(id: number): Promise<void>;
  notes(userId: string, contentId: number): Promise<NotePost[]>;
  ajouterNote(userId: string, contentId: number, texte: string): Promise<NotePost>;
  supprimerNote(userId: string, contentId: number, noteId: number): Promise<boolean>;
  historique(userId: string, contentId: number): Promise<HistoriquePost[]>;
  journaliser: typeof journaliser;
  /** Validation client (lot 8) : une date déplacée remet le post « à valider ». */
  relancerValidation?: typeof relancerValidationSiEdite;
}

export const depsGestionPosts: DepsGestionPosts = {
  post: (id, userId) => storage.getContentById(id, userId),
  postMemeSupprime: (id, userId) => storage.getContentByIdMemeSupprime(id, userId),
  posts: (userId, ids) => storage.getContentsByIds(userId, ids),
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  creer: (row) => storage.createContent(row as any),
  async deplacer(id, userId, quand) {
    const [fait] = await db.update(content)
      .set({
        scheduledFor: quand, updatedAt: new Date(),
        // Reprogrammé : un réessai en attente repart de zéro (même règle que PATCH /api/content/:id).
        lastError: sql`case when ${content.lastError} like 'reessai:%' then null else ${content.lastError} end`,
      } as any)
      .where(and(
        eq(content.id, id), eq(content.userId, userId), isNull(content.supprimeLe), isNull(content.publishedAt),
        sql`lower(trim(coalesce(${content.postStatus}, ''))) not in ('posted', 'posting', 'processing', 'uploading')`,
      ))
      .returning({ id: content.id });
    return !!fait;
  },
  mettreALaCorbeille: (id, userId) => storage.mettreALaCorbeille(id, userId),
  restaurer: (id, userId) => storage.restaurerContenu(id, userId),
  corbeille: (userId, depuis) => storage.getCorbeille(userId, depuis),
  supprimerDefinitivement: (id) => storage.deleteContent(id),
  notes: (userId, contentId) => db.select().from(notesPost)
    .where(and(eq(notesPost.userId, userId), eq(notesPost.contentId, contentId)))
    .orderBy(asc(notesPost.createdAt), asc(notesPost.id)),
  async ajouterNote(userId, contentId, texte) {
    const [n] = await db.insert(notesPost).values({ userId, contentId, texte }).returning();
    return n;
  },
  async supprimerNote(userId, contentId, noteId) {
    const r = await db.delete(notesPost)
      .where(and(eq(notesPost.id, noteId), eq(notesPost.userId, userId), eq(notesPost.contentId, contentId)))
      .returning({ id: notesPost.id });
    return r.length > 0;
  },
  historique: (userId, contentId) => db.select().from(historiquePost)
    .where(and(eq(historiquePost.userId, userId), eq(historiquePost.contentId, contentId)))
    .orderBy(desc(historiquePost.createdAt), desc(historiquePost.id))
    .limit(200),
  journaliser,
  relancerValidation: relancerValidationSiEdite,
};
