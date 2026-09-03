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

import { isIntent, type Intent } from "./score";

/**
 * Le vocabulaire n'est pas redéclaré ici : il vit dans `score.ts` (`KNOWN_INTENTS`, typé
 * `readonly Intent[]` — une faute de frappe ne compile pas) et la vérification est la même
 * fonction `isIntent` que celle qui garde le chemin BASE. Une seule liste, un seul test
 * d'appartenance : le chemin IA et le chemin base ne peuvent plus diverger.
 */
export function validateGeneratedIntent(raw: unknown): Intent | null {
  return isIntent(raw) ? raw : null;
}
