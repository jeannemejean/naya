// Absence : aucune colonne « dernière visite » n'existe. La dernière activité est la plus récente
// de trois traces : une tâche cochée, un message écrit dans le chat, un événement de planning.
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { companionConversations, taskScheduleEvents, tasks } from "@shared/schema";

export const SEUIL_ABSENCE_JOURS = 7;

export interface DepsAbsence {
  derniereTacheCochee(userId: string): Promise<Date | null>;
  dernierMessage(userId: string): Promise<Date | null>;
  dernierEvenementPlanning(userId: string): Promise<Date | null>;
}

const premiere = (l: Array<{ t: Date | null }>) => l[0]?.t ?? null;

export const depsAbsence: DepsAbsence = {
  derniereTacheCochee: async (userId) => premiere(await db.select({ t: tasks.completedAt }).from(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.completedAt))).orderBy(desc(tasks.completedAt)).limit(1)),
  dernierMessage: async (userId) => premiere(await db.select({ t: companionConversations.createdAt }).from(companionConversations)
    .where(and(eq(companionConversations.userId, userId), eq(companionConversations.role, "user")))
    .orderBy(desc(companionConversations.createdAt)).limit(1)),
  dernierEvenementPlanning: async (userId) => premiere(await db.select({ t: taskScheduleEvents.createdAt }).from(taskScheduleEvents)
    .where(eq(taskScheduleEvents.userId, userId)).orderBy(desc(taskScheduleEvents.createdAt)).limit(1)),
};

export async function derniereActivite(userId: string, deps: DepsAbsence = depsAbsence): Promise<Date | null> {
  const dates = (await Promise.all([deps.derniereTacheCochee(userId), deps.dernierMessage(userId), deps.dernierEvenementPlanning(userId)]))
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

/** Absente depuis au moins SEUIL_ABSENCE_JOURS. Un compte sans aucune activité n'est pas « absent ». */
export function absenceDetectee(derniere: Date | null, maintenant: Date): boolean {
  return !!derniere && maintenant.getTime() - derniere.getTime() >= SEUIL_ABSENCE_JOURS * 86_400_000;
}
