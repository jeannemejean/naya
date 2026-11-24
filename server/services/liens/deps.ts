// Dépendances des liens courts et des SmartLinks (lot 5). Injectées : les tests de routes les
// simulent sans base. Aucune IP ni user-agent n'est jamais écrit : un clic est un compteur.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { clicsLiens, content, liensCourts, mediaLibrary, smartlinks, type LienCourt, type Smartlink } from "@shared/schema";
import { FORMATS_FIL } from "@shared/apercu-instagram";

export interface NouveauLien {
  userId: string;
  projectId: number | null;
  code: string;
  urlCible: string;
  utm: Record<string, string>;
  origine: "composeur" | "smartlink";
}

export interface PublicationTuile {
  id: number;
  mediaIds: unknown;
  mediaUrl: string | null;
  couvertureUrl: string | null;
  publishedAt: Date | null;
}

export interface DepsLiens {
  projet(id: number, userId: string): Promise<{ id: number; name?: string | null; slug?: string | null } | undefined>;
  octets(n: number): Uint8Array;
  maintenant(): Date;

  compterLiensDepuis(userId: string, depuis: Date): Promise<number>;
  /** Lève une erreur code 23505 si le code existe déjà. */
  creerLien(v: NouveauLien): Promise<LienCourt>;
  liens(userId: string, projectId: number | null, origine: string): Promise<LienCourt[]>;
  liensParIds(userId: string, ids: number[]): Promise<LienCourt[]>;
  lienParCode(code: string): Promise<Pick<LienCourt, "id" | "urlCible" | "utm"> | undefined>;
  compterClic(lienId: number, jour: string, quand: Date): Promise<void>;
  clicsDepuis(lienIds: number[], depuisJour: string): Promise<Array<{ lienId: number; jour: string; clics: number }>>;

  smartlinkDe(userId: string, projectId: number | null): Promise<Smartlink | undefined>;
  smartlink(userId: string, id: number): Promise<Smartlink | undefined>;
  smartlinkParSlug(slug: string): Promise<Smartlink | undefined>;
  creerSmartlink(row: Record<string, any>): Promise<Smartlink>;
  modifierSmartlink(userId: string, id: number, row: Record<string, any>): Promise<Smartlink | undefined>;
  supprimerSmartlink(userId: string, id: number): Promise<boolean>;

  /** Dernières publications Instagram du fil, publiées depuis Naya, de la marque (null = sans marque). */
  publications(userId: string, projectId: number | null, limite: number): Promise<PublicationTuile[]>;
  medias(userId: string, ids: number[]): Promise<Array<{ id: number; url: string; thumbnailUrl: string | null; mimeType: string }>>;
}

export const depsLiens: DepsLiens = {
  projet: async (id, userId) => (await storage.getProject(id, userId)) ?? undefined,
  octets: (n) => randomBytes(n),
  maintenant: () => new Date(),

  async compterLiensDepuis(userId, depuis) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(liensCourts)
      .where(and(eq(liensCourts.userId, userId), gte(liensCourts.createdAt, depuis)));
    return Number(r?.n ?? 0);
  },
  async creerLien(v) {
    const [l] = await db.insert(liensCourts).values(v).returning();
    return l;
  },
  liens: (userId, projectId, origine) => db.select().from(liensCourts)
    .where(and(
      eq(liensCourts.userId, userId),
      projectId == null ? isNull(liensCourts.projectId) : eq(liensCourts.projectId, projectId),
      eq(liensCourts.origine, origine),
    ))
    .orderBy(desc(liensCourts.createdAt), desc(liensCourts.id))
    .limit(200),
  liensParIds: async (userId, ids) => (ids.length === 0 ? [] : db.select().from(liensCourts)
    .where(and(eq(liensCourts.userId, userId), inArray(liensCourts.id, ids)))),
  async lienParCode(code) {
    const [l] = await db.select({ id: liensCourts.id, urlCible: liensCourts.urlCible, utm: liensCourts.utm })
      .from(liensCourts).where(eq(liensCourts.code, code)).limit(1);
    return l;
  },
  async compterClic(lienId, jour, quand) {
    await db.update(liensCourts)
      .set({ clics: sql`${liensCourts.clics} + 1`, dernierClicAt: quand })
      .where(eq(liensCourts.id, lienId));
    await db.insert(clicsLiens).values({ lienId, jour, clics: 1 })
      .onConflictDoUpdate({ target: [clicsLiens.lienId, clicsLiens.jour], set: { clics: sql`${clicsLiens.clics} + 1` } });
  },
  async clicsDepuis(lienIds, depuisJour) {
    if (lienIds.length === 0) return [];
    const rows = await db.select().from(clicsLiens)
      .where(and(inArray(clicsLiens.lienId, lienIds), gte(clicsLiens.jour, depuisJour)));
    return rows.map((r) => ({ lienId: r.lienId, jour: String(r.jour), clics: r.clics }));
  },

  async smartlinkDe(userId, projectId) {
    const [s] = await db.select().from(smartlinks)
      .where(and(eq(smartlinks.userId, userId), projectId == null ? isNull(smartlinks.projectId) : eq(smartlinks.projectId, projectId)))
      .orderBy(smartlinks.id).limit(1);
    return s;
  },
  async smartlink(userId, id) {
    const [s] = await db.select().from(smartlinks).where(and(eq(smartlinks.id, id), eq(smartlinks.userId, userId)));
    return s;
  },
  async smartlinkParSlug(slug) {
    const [s] = await db.select().from(smartlinks).where(eq(smartlinks.slug, slug)).limit(1);
    return s;
  },
  async creerSmartlink(row) {
    const [s] = await db.insert(smartlinks).values(row as any).returning();
    return s;
  },
  async modifierSmartlink(userId, id, row) {
    const [s] = await db.update(smartlinks).set({ ...row, updatedAt: new Date() })
      .where(and(eq(smartlinks.id, id), eq(smartlinks.userId, userId))).returning();
    return s;
  },
  async supprimerSmartlink(userId, id) {
    const r = await db.delete(smartlinks).where(and(eq(smartlinks.id, id), eq(smartlinks.userId, userId)))
      .returning({ id: smartlinks.id });
    return r.length > 0;
  },

  publications: (userId, projectId, limite) => db
    .select({ id: content.id, mediaIds: content.mediaIds, mediaUrl: content.mediaUrl, couvertureUrl: content.couvertureUrl, publishedAt: content.publishedAt })
    .from(content)
    .where(and(
      eq(content.userId, userId),
      projectId == null ? isNull(content.projectId) : eq(content.projectId, projectId),
      isNull(content.supprimeLe),
      sql`lower(trim(${content.platform})) = 'instagram'`,
      or(isNull(content.postFormat), inArray(content.postFormat, [...FORMATS_FIL])),
      or(isNotNull(content.publishedAt), eq(content.postStatus, "posted")),
    ))
    .orderBy(desc(sql`coalesce(${content.publishedAt}, ${content.scheduledFor})`), desc(content.id))
    .limit(limite),
  medias: async (userId, ids) => (ids.length === 0 ? [] : db
    .select({ id: mediaLibrary.id, url: mediaLibrary.url, thumbnailUrl: mediaLibrary.thumbnailUrl, mimeType: mediaLibrary.mimeType })
    .from(mediaLibrary)
    .where(and(eq(mediaLibrary.userId, userId), inArray(mediaLibrary.id, ids)))),
};
