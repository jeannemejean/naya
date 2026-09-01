/**
 * Validation de l'intention déduite par le modèle lors de la génération IA de contenu
 * (`POST /api/content/generate`, voir `services/openai.ts::generateContent`).
 *
 * PURE — aucune base, aucun réseau, aucun modèle — donc testable isolément (voir
 * validate-generated-intent.test.ts).
 *
 * Règle absolue (voir score.ts et le commentaire sur `content.intent` dans
 * shared/schema.ts) : une intention n'est JAMAIS devinée ni par défaut. Si la réponse du
 * modèle ne contient pas EXACTEMENT l'une des trois valeurs attendues — bonne casse,
 * aucun espace parasite, aucune valeur composée — cette fonction renvoie `null`. Pas de
 * correction silencieuse, pas de repli sur "awareness".
 */

import type { Intent } from "./score";

const VALID_INTENTS: readonly string[] = ["awareness", "consideration", "conversion"];

export function validateGeneratedIntent(raw: unknown): Intent | null {
  if (typeof raw !== "string") return null;
  return VALID_INTENTS.includes(raw) ? (raw as Intent) : null;
}
