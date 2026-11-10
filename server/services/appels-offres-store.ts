// Accès base des appels d'offres. Chaque lecture et écriture porte le userId : une ligne
// d'une autre utilisatrice n'existe pas pour celle qui demande.
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as dbParDefaut } from "../db";
import { appelsOffres, type AppelOffres, type InsertAppelOffres } from "@shared/schema";
import type { StatutAO } from "@shared/appels-offres";

export interface ModifAppelOffres { statut?: StatutAO; notes?: string | null }

/** Une ligne venue de la veille (import Notion, futur collecteur) : source et source_id obligatoires. */
export type LigneVeilleAO = Omit<InsertAppelOffres, "id" | "userId" | "projectId" | "createdAt" | "updatedAt" | "source" | "sourceId">
  & { source: string; sourceId: string };

export interface OptionsUpsertVeille {
  /** Projet de rattachement ; absent (null/undefined) : celui déjà en base est gardé. */
  projectId?: number | null;
}

export interface DepsAppelsOffres {
  listerAppelsOffres(userId: string): Promise<AppelOffres[]>;
  lireAppelOffres(id: number, userId: string): Promise<AppelOffres | undefined>;
  modifierAppelOffres(id: number, userId: string, modif: ModifAppelOffres): Promise<AppelOffres | undefined>;
}

/**
 * Upsert sur (user_id, source, source_id). Une ligne neuve prend tout ce qui vient de la veille ;
 * une ligne existante voit ses champs de veille rafraîchis, mais jamais son statut ni ses notes,
 * qui vivent dans Naya. Une seule transaction : tout ou rien.
 */
export async function upsertDepuisVeille(
  userId: string,
  lignes: LigneVeilleAO[],
  opts: OptionsUpsertVeille = {},
  db: NodePgDatabase<any> = dbParDefaut,
): Promise<{ ecrites: number }> {
  if (!userId) throw new Error("upsertDepuisVeille : userId requis");
  for (const l of lignes) {
    if (!l.source || !l.sourceId) throw new Error("upsertDepuisVeille : source et source_id requis sur chaque ligne");
  }
  const projectId = opts.projectId ?? null;
  await db.transaction(async (tx) => {
    for (const l of lignes) {
      const { statut: _statut, notes: _notes, ...veille } = l;
      await tx.insert(appelsOffres).values({ ...l, userId, projectId })
        .onConflictDoUpdate({
          target: [appelsOffres.userId, appelsOffres.source, appelsOffres.sourceId],
          set: { ...veille, projectId: projectId ?? sql`${appelsOffres.projectId}`, updatedAt: new Date() },
        });
    }
  });
  return { ecrites: lignes.length };
}

/** Ce que la veille doit connaître pour ne rien créer en double (toutes sources). */
export async function existantsPourVeille(userId: string, db: NodePgDatabase<any> = dbParDefaut) {
  return db.select({
    id: appelsOffres.id, source: appelsOffres.source, sourceId: appelsOffres.sourceId,
    reference: appelsOffres.reference, lienAvis: appelsOffres.lienAvis, objet: appelsOffres.objet,
    acheteur: appelsOffres.acheteur, dateLimite: appelsOffres.dateLimite,
  }).from(appelsOffres).where(eq(appelsOffres.userId, userId));
}

/** Faits qu'un passage de veille peut rafraîchir. Jamais statut, notes ni qualification. */
export interface FaitsVeille {
  dateLimite?: Date;
  procedure?: string;
  departement?: string;
  montantEstimeHt?: string;
  lienDce?: string;
}
const CHAMPS_FAITS = ["dateLimite", "procedure", "departement", "montantEstimeHt", "lienDce"] as const;

/** Met à jour les seuls faits fournis (non vides) d'une ligne de l'utilisatrice. */
export async function rafraichirDepuisVeille(
  userId: string, id: number, faits: FaitsVeille, db: NodePgDatabase<any> = dbParDefaut,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  for (const k of CHAMPS_FAITS) if (faits[k] !== undefined && faits[k] !== null && faits[k] !== "") set[k] = faits[k];
  if (Object.keys(set).length === 0) return false;
  const r = await db.update(appelsOffres).set({ ...set, updatedAt: new Date() })
    .where(and(eq(appelsOffres.id, id), eq(appelsOffres.userId, userId))).returning({ id: appelsOffres.id });
  return r.length > 0;
}

export const appelsOffresStore: DepsAppelsOffres = {
  async listerAppelsOffres(userId) {
    return dbParDefaut.select().from(appelsOffres).where(eq(appelsOffres.userId, userId))
      .orderBy(sql`${appelsOffres.dateLimite} asc nulls last`, asc(appelsOffres.id));
  },
  async lireAppelOffres(id, userId) {
    const [ligne] = await dbParDefaut.select().from(appelsOffres)
      .where(and(eq(appelsOffres.id, id), eq(appelsOffres.userId, userId)));
    return ligne;
  },
  async modifierAppelOffres(id, userId, modif) {
    const [ligne] = await dbParDefaut.update(appelsOffres).set({ ...modif, updatedAt: new Date() })
      .where(and(eq(appelsOffres.id, id), eq(appelsOffres.userId, userId))).returning();
    return ligne;
  },
};
