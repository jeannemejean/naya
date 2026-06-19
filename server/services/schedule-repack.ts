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
 * Garantit l'absence de chevauchement même si la journée déborde de l'horaire de
 * travail (mieux vaut une tâche après 18h qu'un chevauchement — exigence produit).
 */

export interface RepackTask {
  id: number;
  startMin: number;      // minutes depuis minuit
  durationMin: number;
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

/** Retourne uniquement les tâches à déplacer (avec leur nouvelle position). */
export function repackDay(tasks: RepackTask[], opts: RepackOptions): RepackMove[] {
  const floor = Math.max(opts.dayStartMin, opts.floorMin ?? opts.dayStartMin);

  const skipLunch = (start: number, duration: number): number => {
    if (opts.lunchEnabled && start < opts.lunchEndMin && start + duration > opts.lunchStartMin) {
      return opts.lunchEndMin;
    }
    return start;
  };

  const sorted = [...tasks].sort((a, b) => a.startMin - b.startMin);
  const moves: RepackMove[] = [];
  let cursor = floor;

  for (const task of sorted) {
    let start = Math.max(task.startMin, cursor);
    start = skipLunch(start, task.durationMin);
    // skipLunch peut avoir reculé… non : il avance toujours. Re-garantir >= cursor.
    start = Math.max(start, cursor);

    if (start !== task.startMin) {
      moves.push({ id: task.id, newStartMin: start, newEndMin: start + task.durationMin });
    }
    cursor = start + task.durationMin;
  }

  return moves;
}
