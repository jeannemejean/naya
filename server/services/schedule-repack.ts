/**
 * Re-tassage déterministe d'une journée pour garantir ZÉRO chevauchement.
 *
 * Logique (pure, testable) :
 * - on parcourt les tâches par heure de début croissante ;
 * - chaque tâche démarre au plus tôt à `cursor` (= fin de la tâche précédente)
 *   et jamais avant `floorMin` (pour le jour courant : « maintenant ») ;
 * - une tâche qui chevaucherait la pause déjeuner est poussée après ;
 * - on ne déplace QUE les tâches qui en ont besoin (chevauchement réel / pause / passé).
 *
 * Garantit l'absence de chevauchement ET le respect strict des heures de travail :
 * ce qui ne tient pas est renvoyé dans `overflow`, à reporter au jour suivant.
 */

export interface RepackTask {
  id: number;
  startMin: number;      // minutes depuis minuit
  durationMin: number;
  /**
   * Tâche sans créneau (heure absente) à placer dans la journée. Elle est traitée
   * APRÈS les tâches déjà horodatées et démarre au curseur courant, jamais à
   * `startMin` (qui est ignoré). Exigence produit : aucune tâche ne doit rester
   * « non planifiée ».
   */
  unplaced?: boolean;
}

export interface RepackOptions {
  dayStartMin: number;
  dayEndMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  lunchEnabled: boolean;
  /** Début minimal autorisé (jour courant = maintenant). Défaut : dayStartMin. */
  floorMin?: number;
}

export interface RepackMove {
  id: number;
  newStartMin: number;
  newEndMin: number;
}

export interface RepackResult {
  /** Tâches à repositionner (chevauchement / pause déjeuner). */
  moves: RepackMove[];
  /**
   * Tâches qui ne tiennent PAS dans la journée de travail. L'appelant DOIT les
   * reporter au jour ouvré suivant — jamais les laisser sans créneau (exigence
   * produit : aucune tâche « non planifiée »).
   */
  overflow: number[];
}

/**
 * Réorganise une journée : zéro chevauchement, respect de la pause déjeuner, ET respect strict
 * de la fin de journée de travail (`dayEndMin`). Toute tâche qui finirait après `dayEndMin` est
 * renvoyée dans `overflow`, à reporter au jour ouvré suivant par l'appelant.
 */
export function repackDay(tasks: RepackTask[], opts: RepackOptions): RepackResult {
  const floor = Math.max(opts.dayStartMin, opts.floorMin ?? opts.dayStartMin);

  const skipLunch = (start: number, duration: number): number => {
    if (opts.lunchEnabled && start < opts.lunchEndMin && start + duration > opts.lunchStartMin) {
      return opts.lunchEndMin;
    }
    return start;
  };

  // Les tâches déjà horodatées gardent la main sur l'ordre de la journée ;
  // celles sans créneau viennent se glisser derrière, dans l'ordre reçu.
  const sorted = [...tasks].sort((a, b) => {
    if (!!a.unplaced !== !!b.unplaced) return a.unplaced ? 1 : -1;
    if (a.unplaced && b.unplaced) return 0;
    return a.startMin - b.startMin;
  });
  const moves: RepackMove[] = [];
  const overflow: number[] = [];
  let cursor = floor;

  for (const task of sorted) {
    // Une tâche sans créneau démarre au curseur : son startMin ne veut rien dire.
    let start = task.unplaced ? cursor : Math.max(task.startMin, cursor);
    start = skipLunch(start, task.durationMin);
    start = Math.max(start, cursor);

    // La tâche ne tient pas dans la journée de travail → l'appelant la reporte
    // au jour ouvré suivant (curseur inchangé).
    if (start + task.durationMin > opts.dayEndMin) {
      overflow.push(task.id);
      continue;
    }

    // Une tâche sans créneau doit TOUJOURS produire un move : elle n'a pas d'heure.
    if (task.unplaced || start !== task.startMin) {
      moves.push({ id: task.id, newStartMin: start, newEndMin: start + task.durationMin });
    }
    cursor = start + task.durationMin;
  }

  return { moves, overflow };
}
