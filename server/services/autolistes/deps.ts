// Dépendances réelles des autolistes (lot 6) : le passage qui pose les créneaux et les routes.
// Toute lecture et écriture passe par l'utilisatrice propriétaire (userId), sauf la liste des
// listes actives du planificateur, qui tourne pour tout le monde.
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { autolistePosts, autolistes, content, mediaLibrary, modelesPost, validationProjet, type Autoliste, type AutolistePost, type Content } from "@shared/schema";
import { journaliser } from "../gestion-posts/historique";
import type { DepsMaterialiser, ListeAutoliste, PostAutoliste } from "./materialiser";

const versListe = (a: Autoliste): ListeAutoliste => ({
  id: a.id, userId: a.userId, projectId: a.projectId ?? null, nom: a.nom, actif: a.actif, enBoucle: a.enBoucle,
  creneaux: a.creneaux, comptes: a.comptes, fuseau: a.fuseau,
});
const versPost = (p: AutolistePost): PostAutoliste => ({
  id: p.id, ordre: p.ordre, actif: p.actif, contenu: p.contenu, publieFois: p.publieFois, dernierPassageAt: p.dernierPassageAt ?? null,
});

const COLONNES_MAT = {
  id: content.id, autolistePostId: content.autolistePostId, autolisteCreneau: content.autolisteCreneau,
  socialAccountId: content.socialAccountId, postStatus: content.postStatus, publishedAt: content.publishedAt,
  supprimeLe: content.supprimeLe, scheduledFor: content.scheduledFor,
};

export const depsMaterialiser: DepsMaterialiser = {
  maintenant: () => new Date(),
  listesActives: async () => (await db.select().from(autolistes).where(eq(autolistes.actif, true))).map(versListe),
  async liste(userId, id) {
    const [a] = await db.select().from(autolistes).where(and(eq(autolistes.id, id), eq(autolistes.userId, userId)));
    return a ? versListe(a) : undefined;
  },
  posts: async (autolisteId) => (await db.select().from(autolistePosts)
    .where(eq(autolistePosts.autolisteId, autolisteId))
    .orderBy(asc(autolistePosts.ordre), asc(autolistePosts.id))).map(versPost),
  materialisations: (userId, autolisteId, depuis) => db.select(COLONNES_MAT).from(content).where(and(
    eq(content.userId, userId), eq(content.autolisteId, autolisteId),
    or(
      gte(content.autolisteCreneau, depuis),
      and(isNull(content.supprimeLe), isNull(content.publishedAt), notInArray(content.postStatus, ["posted", "failed"])),
    ),
  )),
  publies: (userId, autolisteId) => db.select({
    autolistePostId: content.autolistePostId, autolisteCreneau: content.autolisteCreneau, publishedAt: content.publishedAt,
  }).from(content).where(and(
    eq(content.userId, userId), eq(content.autolisteId, autolisteId),
    or(isNotNull(content.publishedAt), eq(content.postStatus, "posted")),
  )),
  async majPost(autolisteId, id, maj) {
    await db.update(autolistePosts).set(maj as any).where(and(eq(autolistePosts.id, id), eq(autolistePosts.autolisteId, autolisteId)));
  },
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  comptes: (userId) => storage.getSocialAccounts(userId),
  medias: async (userId, ids) => (ids.length === 0 ? [] : db
    .select({ id: mediaLibrary.id, url: mediaLibrary.url, mimeType: mediaLibrary.mimeType })
    .from(mediaLibrary)
    .where(and(eq(mediaLibrary.userId, userId), inArray(mediaLibrary.id, ids)))),
  async creerContenu(row) {
    const [c] = await db.insert(content).values(row as any).onConflictDoNothing().returning({ id: content.id });
    return c ?? null;
  },
  journaliser: (userId, contentId, evenement, details) => journaliser(userId, contentId, evenement, details ?? null),
  creerTache: (t) => storage.createTask(t as any),
  async validationActive(projectId) {
    const [v] = await db.select({ actif: validationProjet.actif }).from(validationProjet).where(eq(validationProjet.projectId, projectId)).limit(1);
    return v?.actif === true;
  },
  async noterPassage(userId, autolisteId, problemes, le) {
    await db.update(autolistes).set({ problemes: problemes as any, derniereMaterialisationAt: le })
      .where(and(eq(autolistes.id, autolisteId), eq(autolistes.userId, userId)));
  },
  async supprimerFuturs(userId, autolisteId, apres, postId) {
    // Jamais un post publié, ni en train de partir : seulement « pending » ou « failed », à venir.
    // Le créneau est libéré (null) pour que la liste puisse le reposer.
    const r = await db.update(content)
      .set({ supprimeLe: new Date(), autolisteCreneau: null, autoPost: false, updatedAt: new Date() })
      .where(and(
        eq(content.userId, userId), eq(content.autolisteId, autolisteId),
        postId != null ? eq(content.autolistePostId, postId) : sql`true`,
        isNull(content.supprimeLe), isNull(content.publishedAt),
        inArray(content.postStatus, ["pending", "failed"]),
        gt(content.scheduledFor, apres),
        // Modifié dans le calendrier depuis sa pose (texte, date, médias…) : il appartient
        // désormais à l'utilisatrice. Gardé, son créneau reste pris (jamais reposé en double).
        // La pose écrit created_at = updated_at ; 2 s de marge.
        sql`${content.updatedAt} <= ${content.createdAt} + interval '2 seconds'`,
      ))
      .returning({ id: content.id });
    return r.map((x) => x.id);
  },
};

// ── Routes ─────────────────────────────────────────────────────────────────────────────
export interface DepsAutolistes {
  materialiser: DepsMaterialiser;
  projet(id: number, userId: string): Promise<{ id: number; projectKind?: string | null } | undefined>;
  comptes(userId: string): Promise<any[]>;
  listes(userId: string): Promise<Array<Autoliste & { nbPosts: number }>>;
  liste(userId: string, id: number): Promise<Autoliste | undefined>;
  creerListe(userId: string, v: Record<string, unknown>): Promise<Autoliste>;
  modifierListe(userId: string, id: number, v: Record<string, unknown>): Promise<Autoliste | undefined>;
  supprimerListe(userId: string, id: number): Promise<boolean>;
  posts(autolisteId: number): Promise<AutolistePost[]>;
  ajouterPost(autolisteId: number, contenu: unknown): Promise<AutolistePost>;
  modifierPost(autolisteId: number, id: number, v: { actif?: boolean; ordre?: number }): Promise<AutolistePost | undefined>;
  supprimerPost(autolisteId: number, id: number): Promise<boolean>;
  /** Posts posés par la liste dont le créneau est à venir (vivants ou retirés). */
  materialisationsAVenir(userId: string, autolisteId: number, depuis: Date): Promise<Array<Record<string, any>>>;
  /** Source d'un ajout depuis le calendrier : post vivant, et ses frères du même envoi. */
  post(id: number, userId: string): Promise<Content | undefined>;
  freres(userId: string, groupe: string): Promise<Content[]>;
  modele(userId: string, id: number): Promise<{ id: number; nom: string; contenu: unknown } | undefined>;
}

export const depsAutolistes: DepsAutolistes = {
  materialiser: depsMaterialiser,
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  comptes: (userId) => storage.getSocialAccounts(userId),
  async listes(userId) {
    const rows = await db.select().from(autolistes).where(eq(autolistes.userId, userId)).orderBy(desc(autolistes.createdAt), desc(autolistes.id));
    if (rows.length === 0) return [];
    const nb = await db.select({ id: autolistePosts.autolisteId, n: sql<number>`count(*)::int` }).from(autolistePosts)
      .where(inArray(autolistePosts.autolisteId, rows.map((r) => r.id))).groupBy(autolistePosts.autolisteId);
    const parId = new Map(nb.map((x) => [x.id, Number(x.n)]));
    return rows.map((r) => ({ ...r, nbPosts: parId.get(r.id) ?? 0 }));
  },
  async liste(userId, id) {
    const [a] = await db.select().from(autolistes).where(and(eq(autolistes.id, id), eq(autolistes.userId, userId)));
    return a;
  },
  async creerListe(userId, v) {
    const [a] = await db.insert(autolistes).values({ ...(v as any), userId }).returning();
    return a;
  },
  async modifierListe(userId, id, v) {
    const [a] = await db.update(autolistes).set({ ...(v as any), updatedAt: new Date() })
      .where(and(eq(autolistes.id, id), eq(autolistes.userId, userId))).returning();
    return a;
  },
  async supprimerListe(userId, id) {
    const r = await db.delete(autolistes).where(and(eq(autolistes.id, id), eq(autolistes.userId, userId))).returning({ id: autolistes.id });
    return r.length > 0;
  },
  posts: (autolisteId) => db.select().from(autolistePosts).where(eq(autolistePosts.autolisteId, autolisteId))
    .orderBy(asc(autolistePosts.ordre), asc(autolistePosts.id)),
  async ajouterPost(autolisteId, contenu) {
    const [m] = await db.select({ max: sql<number>`coalesce(max(${autolistePosts.ordre}), -1)::int` }).from(autolistePosts)
      .where(eq(autolistePosts.autolisteId, autolisteId));
    const [p] = await db.insert(autolistePosts).values({ autolisteId, contenu: contenu as any, ordre: Number(m?.max ?? -1) + 1 }).returning();
    return p;
  },
  async modifierPost(autolisteId, id, v) {
    const [p] = await db.update(autolistePosts).set(v).where(and(eq(autolistePosts.id, id), eq(autolistePosts.autolisteId, autolisteId))).returning();
    return p;
  },
  async supprimerPost(autolisteId, id) {
    const r = await db.delete(autolistePosts).where(and(eq(autolistePosts.id, id), eq(autolistePosts.autolisteId, autolisteId))).returning({ id: autolistePosts.id });
    return r.length > 0;
  },
  materialisationsAVenir: (userId, autolisteId, depuis) => db.select(COLONNES_MAT).from(content).where(and(
    eq(content.userId, userId), eq(content.autolisteId, autolisteId), gte(content.autolisteCreneau, depuis),
  )).orderBy(asc(content.autolisteCreneau)),
  post: (id, userId) => storage.getContentById(id, userId),
  freres: (userId, groupe) => db.select().from(content)
    .where(and(eq(content.userId, userId), eq(content.crossPostGroupId, groupe), isNull(content.supprimeLe))),
  async modele(userId, id) {
    const [m] = await db.select().from(modelesPost).where(and(eq(modelesPost.id, id), eq(modelesPost.userId, userId)));
    return m;
  },
};
