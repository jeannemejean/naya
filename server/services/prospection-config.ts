/**
 * Configuration DÉDIÉE de la prospection — valeurs modifiables sans toucher au reste du code.
 * Limite LinkedIn, coûts unitaires (tracking interne, non visible utilisateur), fuseau/reset.
 */

/** Plafond de demandes LinkedIn par semaine et par utilisateur (plan enrichissement). */
export const LINKEDIN_WEEKLY_LIMIT = 30;

/** Jour de réinitialisation du compteur hebdomadaire (affiché à l'utilisateur). */
export const PROSPECTION_WEEK_RESET_DAY = "monday" as const;

/** Fuseau de référence pour le calcul de la semaine (lundi 00:00 local). */
export const PROSPECTION_TIMEZONE = "Europe/Paris";

/**
 * Coûts unitaires internes en CENTS (garde-fou de rentabilité, jamais exposé à l'utilisateur).
 * Modifier ici pour ajuster la comptabilité sans toucher au code.
 */
export const PROSPECTION_USAGE_COSTS_CENTS = {
  BRIGHT_DATA_SEARCH: 1,
  BRIGHT_DATA_LINKEDIN_ENRICH: 8,
  BRIGHT_DATA_INSTAGRAM: 1,
  BRIGHT_DATA_WEB_SCRAPE: 1,
  CLAUDE_AUDIT: 2,
  CLAUDE_MESSAGE: 1,
} as const;

/** Types d'opérations tracées dans `prospection_usage` (clés stockées en base). */
export type ProspectionOperationType =
  | "bright_data_search"
  | "bright_data_linkedin_enrich"
  | "bright_data_instagram"
  | "bright_data_web_scrape"
  | "claude_audit"
  | "claude_message";

/** Coût (cents) par type d'opération stockée. */
export const OPERATION_COST_CENTS: Record<ProspectionOperationType, number> = {
  bright_data_search: PROSPECTION_USAGE_COSTS_CENTS.BRIGHT_DATA_SEARCH,
  bright_data_linkedin_enrich: PROSPECTION_USAGE_COSTS_CENTS.BRIGHT_DATA_LINKEDIN_ENRICH,
  bright_data_instagram: PROSPECTION_USAGE_COSTS_CENTS.BRIGHT_DATA_INSTAGRAM,
  bright_data_web_scrape: PROSPECTION_USAGE_COSTS_CENTS.BRIGHT_DATA_WEB_SCRAPE,
  claude_audit: PROSPECTION_USAGE_COSTS_CENTS.CLAUDE_AUDIT,
  claude_message: PROSPECTION_USAGE_COSTS_CENTS.CLAUDE_MESSAGE,
};

/**
 * Opérations qui comptent comme une « demande LinkedIn » vis-à-vis du plafond hebdomadaire.
 * Une seule source de vérité : le compteur dérive de la table `prospection_usage`.
 */
export const LINKEDIN_REQUEST_OPERATIONS: ProspectionOperationType[] = [
  "bright_data_linkedin_enrich",
];
