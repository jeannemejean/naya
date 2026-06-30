// Whitelist des champs modifiables via PATCH /api/projects/:id.
// Tout champ hors de cette liste (id, userId, slug, isPrimary, createdAt, updatedAt,
// ou champ inconnu/malveillant) est ignoré et n'atteint jamais la base.
// isPrimary se règle uniquement via la route dédiée /api/projects/:id/set-primary.
export const ALLOWED_PROJECT_PATCH_FIELDS = [
  "name",
  "icon",
  "color",
  "type",
  "description",
  "monetizationIntent",
  "priorityLevel",
  "projectStatus",
] as const;

export function pickAllowedProjectFields(body: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object") return out;
  for (const key of ALLOWED_PROJECT_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}
