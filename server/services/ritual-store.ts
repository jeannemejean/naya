// Accès d'un créneau régulier (rituel) : lecture, mise à jour, retrait. Toujours borné à l'utilisatrice.
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { recurringRituals, tasks, type RecurringRitual } from "@shared/schema";

export async function lireRituel(userId: string, id: number): Promise<RecurringRitual | undefined> {
  const [r] = await db.select().from(recurringRituals)
    .where(and(eq(recurringRituals.id, id), eq(recurringRituals.userId, userId))).limit(1);
  return r;
}

export async function majRituel(userId: string, id: number, champs: Partial<Pick<RecurringRitual, "active" | "title" | "days" | "startTime" | "durationMinutes" | "intervalWeeks">>): Promise<void> {
  await db.update(recurringRituals).set(champs)
    .where(and(eq(recurringRituals.id, id), eq(recurringRituals.userId, userId)));
}

// Le jour à Paris : le serveur tourne en UTC, et les tâches du soir même ne doivent pas rester.
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

/** Arrête le créneau : désactivé, et ses tâches à venir non faites retirées (les passées restent). */
export async function retirerRituel(userId: string, id: number, depuis: string = aujourdhui()): Promise<void> {
  await majRituel(userId, id, { active: false });
  await db.delete(tasks).where(and(
    eq(tasks.userId, userId), eq(tasks.ritualId, id), eq(tasks.completed, false), gte(tasks.scheduledDate, depuis),
  ));
}
