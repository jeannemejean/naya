import { normaliserApparence } from "@shared/saisons";

// Le corps du PATCH /api/preferences est écrit tel quel en base : on ne laisse
// passer qu'une apparence valide (saison connue, decor booléen), jamais du libre.
export function assainirPatchPreferences(corps: unknown): Record<string, unknown> {
  if (typeof corps !== "object" || corps === null || Array.isArray(corps)) return {};
  const patch: Record<string, unknown> = { ...(corps as Record<string, unknown>) };
  if ("apparence" in patch) patch.apparence = normaliserApparence(patch.apparence);
  return patch;
}
