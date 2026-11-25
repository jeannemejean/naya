// Envois aux marques : accès base, toujours borné à l'utilisatrice.
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../db";
import { envois, tasks, type Envoi, type InsertEnvoi } from "@shared/schema";

export type NouvelEnvoi = Omit<InsertEnvoi, "id" | "userId" | "createdAt" | "updatedAt">;
export type ChampsEnvoi = Partial<Pick<Envoi, "statut" | "prochaineRelance" | "notes" | "contact">>;

export async function creerEnvoi(userId: string, e: NouvelEnvoi): Promise<Envoi> {
  const [ligne] = await db.insert(envois).values({ ...e, userId }).returning();
  return ligne;
}

export async function getEnvoi(id: number, userId: string): Promise<Envoi | undefined> {
  const [ligne] = await db.select().from(envois).where(and(eq(envois.id, id), eq(envois.userId, userId))).limit(1);
  return ligne;
}

export async function majEnvoi(userId: string, id: number, champs: ChampsEnvoi): Promise<Envoi | undefined> {
  const [ligne] = await db.update(envois).set({ ...champs, updatedAt: new Date() })
    .where(and(eq(envois.id, id), eq(envois.userId, userId))).returning();
  return ligne;
}

export async function supprimerEnvoi(userId: string, id: number): Promise<void> {
  await db.delete(envois).where(and(eq(envois.id, id), eq(envois.userId, userId)));
}

export async function envoisDe(userId: string, filtre: { projectId?: number } = {}): Promise<Envoi[]> {
  const conds = [eq(envois.userId, userId)];
  if (filtre.projectId != null) conds.push(eq(envois.projectId, filtre.projectId));
  return db.select().from(envois).where(and(...conds)).orderBy(asc(envois.prochaineRelance), desc(envois.envoyeLe));
}

export async function envoisARelancer(userId: string, date: string): Promise<Envoi[]> {
  return db.select().from(envois).where(and(eq(envois.userId, userId), lte(envois.prochaineRelance, date)));
}

export async function tachesDeRelance(userId: string, source: string) {
  return db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.source, source), isNull(tasks.archivedAt)));
}
