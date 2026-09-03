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
  "category",
  "dailyTimeBudgetHours",
  "statusNote",
  "projectKind",
  "clientName",
  "clientContact",
  "clientBrief",
  "attributionWindowDays",
] as const;

export function pickAllowedProjectFields(body: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object") return out;
  for (const key of ALLOWED_PROJECT_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}

/** Bornes de la fenêtre d'attribution, en jours. Partagées avec le clamp de l'écran. */
export const ATTRIBUTION_WINDOW_MIN_DAYS = 1;
export const ATTRIBUTION_WINDOW_MAX_DAYS = 365;

export type ProjectPatchValidation =
  | { ok: true; fields: Record<string, any> }
  | { ok: false; field: string; message: string };

/**
 * Validation SERVEUR des champs whitelistés, appliquée après `pickAllowedProjectFields`.
 *
 * Pourquoi ici et pas seulement à l'écran : `attributionWindowDays` est le seul champ de la
 * whitelist dont une valeur aberrante est ensuite recopiée TELLE QUELLE, et définitivement,
 * dans un historique append-only que le lot promet de ne jamais réécrire — la fenêtre est
 * FIGÉE sur chaque ligne `brand_conversions` au moment de la déclaration (voir
 * attribute-conversion.ts). Le clamp de `dashboard.tsx` ne protège que l'écran : un
 * `PATCH /api/projects/:id` direct posait `0` (fenêtre de largeur nulle → aucun contenu
 * crédité), `-5` (début > fin → même effet), ou une valeur non numérique qui faisait
 * échouer la requête ENTIÈRE en 500, perdant au passage les autres champs du même
 * enregistrement.
 *
 * Règle : entier, 1–365 jours. Le refus est explicite et NOMME le champ, pour que l'appelant
 * corrige la fenêtre au lieu de perdre sa sauvegarde. Les autres champs sont rendus
 * inchangés — cette fonction ne normalise QUE ce qu'elle valide.
 */
export function validateProjectPatchFields(fields: Record<string, any>): ProjectPatchValidation {
  const out = { ...fields };

  if (Object.prototype.hasOwnProperty.call(out, "attributionWindowDays")) {
    const brut = out.attributionWindowDays;
    // Garde de type AVANT toute coercition : `Number(true)`, `Number([30])` et `Number(null)`
    // valent respectivement 1, 30 et 0 — trois valeurs fabriquées à partir d'une saisie qui
    // n'est pas un nombre. Seuls un number et une chaîne non vide sont recevables.
    const estRecevable =
      typeof brut === "number" || (typeof brut === "string" && brut.trim() !== "");
    const n = estRecevable ? Number(brut) : NaN;
    if (!Number.isInteger(n) || n < ATTRIBUTION_WINDOW_MIN_DAYS || n > ATTRIBUTION_WINDOW_MAX_DAYS) {
      return {
        ok: false,
        field: "attributionWindowDays",
        message:
          `attributionWindowDays doit être un entier entre ${ATTRIBUTION_WINDOW_MIN_DAYS} et ` +
          `${ATTRIBUTION_WINDOW_MAX_DAYS} (jours). Cette fenêtre est figée sur chaque conversion ` +
          `déclarée ensuite : une valeur aberrante y resterait pour toujours.`,
      };
    }
    // Normalisé en nombre : la colonne est un `integer`, on n'y écrit jamais une chaîne.
    out.attributionWindowDays = n;
  }

  return { ok: true, fields: out };
}
