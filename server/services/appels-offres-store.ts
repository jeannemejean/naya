// Accès base des appels d'offres. Chaque lecture et écriture porte le userId : une ligne
// d'une autre utilisatrice n'existe pas pour celle qui demande.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appelsOffres, type AppelOffres } from "@shared/schema";
import type { StatutAO } from "@shared/appels-offres";

export interface ModifAppelOffres { statut?: StatutAO; notes?: string | null }

export interface DepsAppelsOffres {
  listerAppelsOffres(userId: string): Promise<AppelOffres[]>;
  lireAppelOffres(id: number, userId: string): Promise<AppelOffres | undefined>;
  modifierAppelOffres(id: number, userId: string, modif: ModifAppelOffres): Promise<AppelOffres | undefined>;
}

export const appelsOffresStore: DepsAppelsOffres = {
  async listerAppelsOffres(userId) {
    return db.select().from(appelsOffres).where(eq(appelsOffres.userId, userId))
      .orderBy(sql`${appelsOffres.dateLimite} asc nulls last`, asc(appelsOffres.id));
  },
  async lireAppelOffres(id, userId) {
    const [ligne] = await db.select().from(appelsOffres)
      .where(and(eq(appelsOffres.id, id), eq(appelsOffres.userId, userId)));
    return ligne;
  },
  async modifierAppelOffres(id, userId, modif) {
    const [ligne] = await db.update(appelsOffres).set({ ...modif, updatedAt: new Date() })
      .where(and(eq(appelsOffres.id, id), eq(appelsOffres.userId, userId))).returning();
    return ligne;
  },
};
