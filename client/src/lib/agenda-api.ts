// Cocher / décocher dans Naya un événement Google Agenda injecté dans le planning.
// L'agenda n'est jamais modifié : seul l'état « fait » côté Naya change.
import { apiRequest } from "@/lib/queryClient";

export type TacheAgenda = { source?: string; gcalEventId?: string; completed?: boolean; scheduledDate?: string | null };

/** Vrai pour un événement d'agenda injecté (et non une tâche Naya). */
export function estEvenementAgenda(t: { source?: string }): boolean {
  return t?.source === "gcal";
}

/** Bascule l'état « fait » : coche s'il ne l'est pas, décoche sinon. */
export async function basculerEvenementAgenda(t: TacheAgenda): Promise<void> {
  if (!t.gcalEventId) throw new Error("event_id_missing");
  const url = `/api/agenda/evenements/${encodeURIComponent(t.gcalEventId)}/fait`;
  if (t.completed) await apiRequest("DELETE", url);
  else await apiRequest("POST", url, { date: t.scheduledDate ?? null });
}
