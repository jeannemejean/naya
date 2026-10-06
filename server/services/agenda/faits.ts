// Événements Google Agenda marqués « faits » dans Naya.
//
// Demande de Jeanne (6 octobre 2026) : cocher dans Naya un rendez-vous de son agenda, le
// voir barré, pouvoir le décocher — sans jamais toucher à Google Agenda. Avant, cocher un
// événement injecté dans le planning envoyait son identifiant fictif (-1000…) à la route
// des tâches, qui répondait 500.
//
// Les événements restent injectés en lecture seule par /api/tasks/range ; la table
// `evenements_agenda_faits` ne porte que leur état. L'identifiant Google d'une occurrence
// (singleEvents: true) est stable d'un chargement à l'autre, contrairement à l'id fictif.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { evenementsAgendaFaits } from "@shared/schema";

/** Identifiant d'événement Google plausible : non vide, borné, sans espace ni séparateur de chemin. PUR. */
export function idEvenementValide(id: string): boolean {
  return typeof id === "string" && /^[A-Za-z0-9_@.-]{1,1024}$/.test(id);
}

/**
 * Reporte l'état « fait » sur les événements d'agenda injectés. PUR, ne mute pas l'entrée.
 * Seuls les éléments `source: "gcal"` sont concernés : une vraie tâche Naya garde son état.
 */
export function appliquerEtatFait<T extends { source?: string; gcalEventId?: string; completed?: boolean }>(
  taches: T[],
  idsFaits: Set<string>,
): T[] {
  return taches.map((t) =>
    t.source === "gcal" && t.gcalEventId && idsFaits.has(t.gcalEventId) ? { ...t, completed: true } : t,
  );
}

/** Les ids, parmi `eventIds`, que l'utilisateur a marqués faits. */
export async function lireFaits(userId: string, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const lignes = await db
    .select({ eventId: evenementsAgendaFaits.eventId })
    .from(evenementsAgendaFaits)
    .where(and(eq(evenementsAgendaFaits.userId, userId), inArray(evenementsAgendaFaits.eventId, eventIds)));
  return new Set(lignes.map((l) => l.eventId));
}

/** Marque fait. Idempotent : un second appel ne crée pas de doublon. */
export async function marquerFait(userId: string, eventId: string, date: string | null): Promise<void> {
  await db
    .insert(evenementsAgendaFaits)
    .values({ userId, eventId, date })
    .onConflictDoNothing({ target: [evenementsAgendaFaits.userId, evenementsAgendaFaits.eventId] });
}

/** Remet à faire. Sans effet si l'événement n'était pas marqué. */
export async function retirerFait(userId: string, eventId: string): Promise<void> {
  await db
    .delete(evenementsAgendaFaits)
    .where(and(eq(evenementsAgendaFaits.userId, userId), eq(evenementsAgendaFaits.eventId, eventId)));
}
