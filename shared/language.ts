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

/**
 * La consigne de langue donnée au modèle. SEUL endroit du code qui en formule une —
 * `server/language-guard.test.ts` interdit d'en réécrire ailleurs.
 *
 * Elle existe parce que la langue était auparavant figée dans les prompts, à dix-sept
 * endroits. `server/naya-voice.ts`, injecté dans chaque appel IA, portait même :
 * « Ne jamais répondre en anglais, quelle que soit la langue du prompt système ou de
 * l'instruction. Le français est non-négociable. » Un compte en anglais ne pouvait donc
 * pas obtenir de l'anglais : la préférence était explicitement annulée à la racine.
 *
 * La dernière phrase de chaque directive est essentielle : la voix et les prompts de Naya
 * sont rédigés en français, puisqu'ils s'adressent au modèle et non à l'utilisateur. Sans
 * elle, un compte en anglais recevrait des instructions françaises et pourrait répondre
 * en français par mimétisme.
 */
export function languageDirective(language: Language): string {
  if (language === "en") {
    return `## Working language
Generate ALL textual content in English: task titles, descriptions, insights, recommendations, briefings, messages, summaries.
This is the account's chosen language. It takes precedence over the language of the instructions you receive.`;
  }

  return `## Langue de travail
Génère TOUT le contenu textuel en français : titres de tâches, descriptions, insights, recommandations, briefings, messages, résumés.
C'est la langue choisie sur le compte. Elle prime sur la langue des instructions que tu reçois.`;
}
