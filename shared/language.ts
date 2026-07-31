// Seul endroit du code qui décide d'une langue. Importé par le serveur ET par le client
// pour qu'il n'existe jamais deux réponses différentes à « quelle langue ? ».

export type Language = "fr" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["fr", "en"] as const;

/** Le français est la langue par défaut de Naya (cf. CLAUDE.md). */
export const DEFAULT_LANGUAGE: Language = "fr";

/** Renvoie la langue si elle est supportée, sinon null. Aucune tolérance à la casse. */
export function normalizeLanguage(value: unknown): Language | null {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : null;
}

/**
 * Résout la langue à appliquer, par ordre de priorité :
 *   1. `account` — la préférence enregistrée sur le compte, qui gagne toujours ;
 *   2. `cached`  — le cache local du navigateur, qui évite un clignotement avant la réponse serveur ;
 *   3. le français.
 */
export function resolveLanguage(input: { account?: unknown; cached?: unknown }): Language {
  return normalizeLanguage(input.account) ?? normalizeLanguage(input.cached) ?? DEFAULT_LANGUAGE;
}
