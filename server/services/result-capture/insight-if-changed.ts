/**
 * Naya ne parle que quand l'observation vient de CHANGER.
 *
 * PURE : aucune base, aucune horloge, aucun appel modèle. Ne modifie pas
 * `buildImmediateInsight` — l'appelle deux fois, une fois avec la réponse qui vient
 * d'arriver, une fois sans elle.
 *
 * Sans stockage, sans migration (arbitrage de Jeanne, 2026-09-08) : l'appelant doit
 * fournir deux fenêtres d'observations — `answersWithLatest` (la fenêtre habituelle,
 * qui contient déjà la réponse qu'on vient d'enregistrer) et `answersWithoutLatest`
 * (la même fenêtre, moins cette seule réponse). Si les deux phrases calculées sont
 * identiques, la réponse qui vient d'arriver n'a rien appris de neuf : silence. Si
 * elles diffèrent — y compris quand l'une des deux est `null` — l'observation a
 * littéralement changé, et c'est la version « avec » (l'état actuel, réel) qui doit
 * être dite. En particulier :
 *   - `null` → phrase (le seuil `MIN_OBSERVATIONS` vient d'être franchi) : elle parle.
 *   - phrase → `null` (la réponse qui vient d'arriver a fait retomber sous le seuil,
 *     ou a fait disparaître le motif) : elle se tait — jamais une phrase qui n'est
 *     plus vraie.
 *   - `null` des deux côtés, ou même phrase des deux côtés : silence.
 */

import { buildImmediateInsight, type TaskAnswer } from "./insight";

export function insightIfChanged(
  answersWithLatest: TaskAnswer[],
  answersWithoutLatest: TaskAnswer[],
): string | null {
  const withLatest = buildImmediateInsight(answersWithLatest);
  const withoutLatest = buildImmediateInsight(answersWithoutLatest);
  return withLatest === withoutLatest ? null : withLatest;
}
