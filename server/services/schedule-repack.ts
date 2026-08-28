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
  /**
   * Tâche « rituel » à créneau fixe (`schedulingMode === 'fixed'`). Le repack ne
   * la déplace JAMAIS : elle garde [startMin, startMin+durationMin] tel quel. Les
   * tâches flexibles s'organisent autour d'elle sans jamais la chevaucher. Seule
   * exception : si elle déborde elle-même de la journée de travail, elle part en
   * overflow comme n'importe quelle autre tâche.
   */
  anchored?: boolean;
}

export interface RepackOptions {
  dayStartMin: number;
  dayEndMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  lunchEnabled: boolean;
  /** Début minimal autorisé (jour courant = maintenant). Défaut : dayStartMin. */
  floorMin?: number;
  /**
   * Respiration insérée APRÈS chaque tâche flexible placée, en minutes. Elle avance
   * seulement le curseur : elle ne décale donc jamais une ancre ni une plage bloquée
   * (réservées avant la boucle), et n'entre pas dans le test de débordement — une tâche
   * qui finit pile à `dayEndMin` reste planifiée, son tampon est simplement tronqué.
   */
  bufferMin?: number;
  /**
   * Plages déjà occupées par des éléments que le re-tassage NE POSSÈDE PAS et ne peut
   * donc ni déplacer ni reprogrammer :
   *  - les rendez-vous Google Agenda ;
   *  - les tâches DÉJÀ TERMINÉES (leur créneau est de l'histoire, pas du stock libre).
   *
   * Les tâches flexibles s'organisent autour, exactement comme autour d'un rituel ancré,
   * mais ces plages ne sortent jamais dans `moves` ni dans `overflow` : elles ne nous
   * appartiennent pas.
   */
  blockedRanges?: { start: number; end: number }[];
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

  const moves: RepackMove[] = [];
  const overflow: number[] = [];

  // --- Étape 1 : réserver les créneaux des tâches ancrées (rituels à heure fixe).
  // Une tâche ancrée garde IMPÉRATIVEMENT son créneau, elle n'entre jamais dans la
  // boucle de curseur ci-dessous. Deux cas la font quand même basculer en overflow :
  //  - elle déborde elle-même de la journée de travail (comme une tâche normale) ;
  //  - elle chevauche une autre ancre déjà réservée (saisie pathologique : on garde
  //    la première par heure de début, la suivante part en overflow — choix simple
  //    et déterministe, pas de résolution plus fine nécessaire ici).
  const anchoredSorted = tasks
    .filter((t) => t.anchored)
    .sort((a, b) => a.startMin - b.startMin);

  // Les plages externes (rendez-vous, tâches terminées) sont réservées AVANT tout le
  // reste : ni les ancres ni les tâches flexibles ne peuvent se poser dessus.
  const reservedBlocks: { start: number; end: number }[] = (opts.blockedRanges ?? [])
    .filter((b) => b.end > b.start)
    .map((b) => ({ start: b.start, end: b.end }));

  for (const anchor of anchoredSorted) {
    const end = anchor.startMin + anchor.durationMin;
    const overlapsReserved = reservedBlocks.some((b) => anchor.startMin < b.end && end > b.start);
    if (end > opts.dayEndMin || overlapsReserved) {
      overflow.push(anchor.id);
      continue;
    }
    reservedBlocks.push({ start: anchor.startMin, end });
  }

  // Renvoie la fin du bloc ancré chevauché par [start, start+duration), sinon `start` inchangé.
  const skipAnchors = (start: number, duration: number): number => {
    for (const block of reservedBlocks) {
      if (start < block.end && start + duration > block.start) {
        return block.end;
      }
    }
    return start;
  };

  // --- Étape 2 : couler les tâches flexibles autour des ancres et de la pause
  // déjeuner, exactement comme avant pour ce qui concerne la pause déjeuner seule.
  // Les tâches déjà horodatées gardent la main sur l'ordre de la journée ;
  // celles sans créneau viennent se glisser derrière, dans l'ordre reçu.
  const flexible = tasks.filter((t) => !t.anchored);
  const sorted = [...flexible].sort((a, b) => {
    if (!!a.unplaced !== !!b.unplaced) return a.unplaced ? 1 : -1;
    if (a.unplaced && b.unplaced) return 0;
    return a.startMin - b.startMin;
  });

  let cursor = floor;

  for (const task of sorted) {
    // Une tâche sans créneau démarre au curseur : son startMin ne veut rien dire.
    let start = task.unplaced ? cursor : Math.max(task.startMin, cursor);

    // On alterne pause déjeuner / blocs ancrés jusqu'à stabilisation : sauter l'un
    // peut faire retomber sur l'autre (ex. juste après l'ancre = dans la pause).
    // Borne de sécurité largement suffisante (au plus un saut par bloc bloquant).
    for (let guard = 0; guard < reservedBlocks.length + 2; guard++) {
      const next = Math.max(skipLunch(start, task.durationMin), skipAnchors(start, task.durationMin), cursor);
      if (next === start) break;
      start = next;
    }

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
    cursor = start + task.durationMin + (opts.bufferMin ?? 0);
  }

  return { moves, overflow };
}
