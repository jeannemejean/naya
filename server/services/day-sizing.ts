/**
 * Dimensionnement de la journée générée par l'auto-planner. PUR (voir day-sizing.test.ts).
 *
 * Extrait de generateForUser (auto-planner.ts) — la logique était inline et donc
 * impossible à couvrir isolément (cf. revue finale de branche, finding IMPORTANT 2).
 */

/** Durée moyenne supposée d'une tâche, en minutes — sert à calibrer le plafond dur. */
export const AVG_TASK_MIN = 45;

/** Plafond dur historique (avant la respiration), calibré pour des journées sans tampon. */
const BASE_CAP = 8;

export interface MaxTasksForDayInput {
  /** Minutes de travail réellement disponibles dans la journée (hors pause déjeuner). */
  availableMin: number;
  /** Facteur d'énergie du jour (1.0 = pleine forme, jusqu'à 0.4 = épuisé). */
  energyFactor: number;
  /** Respiration insérée entre les tâches, en minutes. */
  bufferMin: number;
}

/**
 * Nombre max de tâches à générer pour la journée.
 *
 * Deux contraintes, on garde la plus stricte :
 *  - un plafond dur, ramené proportionnellement au coût réel d'un créneau
 *    (`round(8 * AVG_TASK_MIN / slotCostMin)`) : sans tampon (bufferMin=0) il vaut
 *    encore 8 (aucun changement de comportement quand la feature est désactivée) ;
 *    avec le tampon par défaut (10 min) il tombe à 7 — une tâche de moins, comme
 *    voulu ("une journée honnête plutôt qu'une journée pleine qui déborde") ;
 *  - le temps réellement disponible, pondéré par l'énergie du jour, divisé par le
 *    coût d'un créneau (tâche + tampon).
 *
 * Plancher à 1 dans tous les cas : même avec un tampon énorme, on ne génère jamais
 * zéro tâche.
 */
export function maxTasksForDay(input: MaxTasksForDayInput): number {
  const { availableMin, energyFactor, bufferMin } = input;
  const slotCostMin = AVG_TASK_MIN + bufferMin;

  const cap = Math.round((BASE_CAP * AVG_TASK_MIN) / slotCostMin);
  const timeBasedTotal = Math.floor((availableMin * energyFactor) / slotCostMin);

  return Math.max(1, Math.min(cap, timeBasedTotal));
}
