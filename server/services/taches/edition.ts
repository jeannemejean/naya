// Ce que PATCH /api/tasks/:id a le droit de modifier sur une tâche (fonction pure).
//
// Avant : la route écrivait le corps tel quel en base — n'importe quel champ, `userId`
// compris. On ne garde plus que les champs que les clients (web + mobile) envoient
// réellement, plus le titre / la description / la priorité (édition « Modifier »).

export const CHAMPS_EDITABLES = [
  "title",
  "description",
  "priority",
  "completed",
  "completedAt",
  "scheduledDate",
  "scheduledTime",
  "scheduledEndTime",
  "estimatedDuration",
] as const;

export const TITRE_MAX = 200;
export const DESCRIPTION_MAX = 5000;

export type ResultatEdition =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; erreur: "invalid_title" | "invalid_description" | "no_editable_fields" };

export function filtrerEditionTache(corps: unknown): ResultatEdition {
  const brut = corps && typeof corps === "object" && !Array.isArray(corps) ? (corps as Record<string, unknown>) : {};
  const updates: Record<string, unknown> = {};
  for (const champ of CHAMPS_EDITABLES) {
    if (Object.prototype.hasOwnProperty.call(brut, champ)) updates[champ] = brut[champ];
  }

  if ("title" in updates) {
    const t = updates.title;
    if (typeof t !== "string" || !t.trim() || t.trim().length > TITRE_MAX) return { ok: false, erreur: "invalid_title" };
    updates.title = t.trim();
  }
  if ("description" in updates) {
    const d = updates.description;
    if (d === null) {
      // effacer la description est permis
    } else if (typeof d !== "string" || d.length > DESCRIPTION_MAX) {
      return { ok: false, erreur: "invalid_description" };
    }
  }

  if (Object.keys(updates).length === 0) return { ok: false, erreur: "no_editable_fields" };
  return { ok: true, updates };
}
