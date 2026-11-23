// Dépendances de la validation client (lot 8). Injectées : les tests de routes les simulent
// sans base.
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  content, mediaLibrary, portailsValidation, projects, validationProjet, validationsPost,
  type Content, type PortailValidation, type ValidationPost, type ValidationProjet,
} from "@shared/schema";
import type { Relecteur, RegleValidation, StatutValidation } from "@shared/validation-client";
import { journaliser } from "../gestion-posts/historique";

/** Ce que le portail et la carte montrent d'un post. */
export type PostValidation = Pick<Content,
  "id" | "userId" | "projectId" | "title" | "body" | "platform" | "postFormat" | "mediaIds" | "mediaUrl" | "couvertureUrl"
  | "scheduledFor" | "publishedAt" | "postStatus" | "validationStatut" | "validationDemandeeAt" | "supprimeLe">;

export interface DepsValidation {
  maintenant(): Date;
  jeton(): string;
  projet(id: number, userId: string): Promise<{ id: number; name?: string | null; clientName?: string | null } | undefined>;
  /** Projet lu sans utilisatrice (portail public) — jamais exposé tel quel. */
  projetParId(id: number): Promise<{ id: number; userId: string; name?: string | null; clientName?: string | null } | undefined>;
  langue(userId: string): Promise<"fr" | "en">;

  reglages(projectId: number): Promise<ValidationProjet | undefined>;
  enregistrerReglages(v: { userId: string; projectId: number; actif: boolean; regle: RegleValidation; relecteurs: Relecteur[] }): Promise<ValidationProjet>;

  portail(userId: string, projectId: number): Promise<PortailValidation | undefined>;
  portailParJeton(token: string): Promise<PortailValidation | undefined>;
  /** Un lien neuf : les anciens liens de la marque sont coupés. */
  nouveauPortail(userId: string, projectId: number, token: string): Promise<PortailValidation>;
  couperPortail(userId: string, projectId: number): Promise<void>;

  /** Posts vivants de l'utilisatrice parmi ces ids. */
  posts(userId: string, ids: number[]): Promise<PostValidation[]>;
  /** Posts de la marque en validation (à valider d'abord, puis décidés récemment). */
  postsDuProjet(userId: string, projectId: number, depuis: Date): Promise<PostValidation[]>;
  decisions(contentIds: number[]): Promise<ValidationPost[]>;
  ajouterDecision(v: { contentId: number; relecteurEmail: string; decision: string; commentaire: string | null }): Promise<ValidationPost>;
  /**
   * Pose le statut de validation. `si` : seulement si le post a encore ce statut et cette
   * demande (une modification entre-temps gagne). Rend false si rien n'a changé.
   */
  poserStatut(id: number, userId: string, statut: StatutValidation | null, demandeeAt: Date | null,
    si?: { statut: StatutValidation; demandeeAt: Date | null }): Promise<boolean>;
  medias(userId: string, ids: number[]): Promise<Array<{ id: number; url: string; thumbnailUrl: string | null; mimeType: string }>>;
  journaliser: typeof journaliser;
}

const colonnesPost = {
  id: content.id, userId: content.userId, projectId: content.projectId, title: content.title, body: content.body,
  platform: content.platform, postFormat: content.postFormat, mediaIds: content.mediaIds, mediaUrl: content.mediaUrl,
  couvertureUrl: content.couvertureUrl, scheduledFor: content.scheduledFor, publishedAt: content.publishedAt,
  postStatus: content.postStatus, validationStatut: content.validationStatut,
  validationDemandeeAt: content.validationDemandeeAt, supprimeLe: content.supprimeLe,
};

export const depsValidation: DepsValidation = {
  maintenant: () => new Date(),
  jeton: () => randomBytes(32).toString("base64url"),
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  async projetParId(id) {
    const [p] = await db.select({ id: projects.id, userId: projects.userId, name: projects.name, clientName: projects.clientName })
      .from(projects).where(eq(projects.id, id));
    return p;
  },
  async langue(userId) {
    const prefs: any = await storage.getUserPreferences(userId).catch(() => null);
    return prefs?.language === "en" ? "en" : "fr";
  },

  async reglages(projectId) {
    const [r] = await db.select().from(validationProjet).where(eq(validationProjet.projectId, projectId));
    return r;
  },
  async enregistrerReglages(v) {
    const [r] = await db.insert(validationProjet)
      .values({ userId: v.userId, projectId: v.projectId, actif: v.actif, regle: v.regle, relecteurs: v.relecteurs })
      .onConflictDoUpdate({
        target: validationProjet.projectId,
        set: { actif: v.actif, regle: v.regle, relecteurs: v.relecteurs, updatedAt: new Date() },
      })
      .returning();
    return r;
  },

  async portail(userId, projectId) {
    const [p] = await db.select().from(portailsValidation)
      .where(and(eq(portailsValidation.userId, userId), eq(portailsValidation.projectId, projectId), eq(portailsValidation.actif, true)))
      .orderBy(desc(portailsValidation.createdAt)).limit(1);
    return p;
  },
  async portailParJeton(token) {
    const [p] = await db.select().from(portailsValidation).where(eq(portailsValidation.token, token)).limit(1);
    return p;
  },
  async nouveauPortail(userId, projectId, token) {
    return db.transaction(async (tx) => {
      await tx.update(portailsValidation).set({ actif: false })
        .where(and(eq(portailsValidation.userId, userId), eq(portailsValidation.projectId, projectId)));
      const [p] = await tx.insert(portailsValidation).values({ userId, projectId, token, actif: true }).returning();
      return p;
    });
  },
  async couperPortail(userId, projectId) {
    await db.update(portailsValidation).set({ actif: false })
      .where(and(eq(portailsValidation.userId, userId), eq(portailsValidation.projectId, projectId)));
  },

  posts: async (userId, ids) => (ids.length === 0 ? [] : db.select(colonnesPost).from(content)
    .where(and(eq(content.userId, userId), inArray(content.id, ids), isNull(content.supprimeLe)))) as any,
  postsDuProjet: (userId, projectId, depuis) => db.select(colonnesPost).from(content)
    .where(and(
      eq(content.userId, userId), eq(content.projectId, projectId), isNull(content.supprimeLe),
      sql`(${content.validationStatut} = 'a_valider' or (${content.validationStatut} in ('validee', 'refusee') and ${content.updatedAt} >= ${depuis}))`,
    ))
    .orderBy(sql`case when ${content.validationStatut} = 'a_valider' then 0 else 1 end`, sql`${content.scheduledFor} asc nulls last`, content.id)
    .limit(100) as any,
  decisions: async (ids) => (ids.length === 0 ? [] : db.select().from(validationsPost)
    .where(inArray(validationsPost.contentId, ids)).orderBy(validationsPost.createdAt, validationsPost.id)),
  async ajouterDecision(v) {
    const [d] = await db.insert(validationsPost).values(v).returning();
    return d;
  },
  async poserStatut(id, userId, statut, demandeeAt, si) {
    const conditions = [eq(content.id, id), eq(content.userId, userId)];
    if (si) {
      conditions.push(eq(content.validationStatut, si.statut));
      conditions.push(si.demandeeAt ? eq(content.validationDemandeeAt, si.demandeeAt) : isNull(content.validationDemandeeAt));
    }
    const r = await db.update(content).set({ validationStatut: statut, validationDemandeeAt: demandeeAt, updatedAt: new Date() } as any)
      .where(and(...conditions)).returning({ id: content.id });
    return r.length > 0;
  },
  medias: async (userId, ids) => (ids.length === 0 ? [] : db
    .select({ id: mediaLibrary.id, url: mediaLibrary.url, thumbnailUrl: mediaLibrary.thumbnailUrl, mimeType: mediaLibrary.mimeType })
    .from(mediaLibrary)
    .where(and(eq(mediaLibrary.userId, userId), inArray(mediaLibrary.id, ids)))),
  journaliser,
};

/** Décisions postérieures à la demande en cours (une relance efface le passé). */
export function decisionsDeLaDemande<D extends { createdAt: Date | string | null }>(decisions: D[], demandeeAt: Date | string | null | undefined): D[] {
  if (!demandeeAt) return decisions;
  const t = new Date(demandeeAt).getTime();
  return decisions.filter((d) => d.createdAt != null && new Date(d.createdAt).getTime() >= t);
}

