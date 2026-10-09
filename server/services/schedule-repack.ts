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
   * Tâche tenue par une échéance (ex. préparation d'un post) qui ne peut pas être
   * reportée au jour suivant : elle est coulée AVANT les autres tâches flexibles,
   * pour que ce soient ces dernières qui débordent.
   */
  prioritaire?: boolean;
  /**
   * Tâche « rituel » à créneau fixe (`schedulingMode === 'fixed'`). Le repack ne
   * la déplace JAMAIS : elle garde [startMin, startMin+durationMin] tel quel. Les
   * tâches flexibles s'organisent autour d'elle sans jamais la chevaucher. Seule
   * exception : si elle déborde elle-même de la journée de travail, elle part en
   * overflow comme n'importe quelle autre tâche.
   */
  anchored?: boolean;
  /**
   * Tâches du même jour qui doivent passer AVANT celle-ci (ex. l'étape précédente d'un
   * post, ou la préparation d'un post publié plus tôt). Un id absent du jour est ignoré.
   */
  apres?: number[];
  /**
   * Sous-ensemble de `apres` dont elle DÉPEND (étapes du même post) : si l'une d'elles
   * déborde au jour suivant, celle-ci la suit — elle ne peut pas passer avant elle.
   */
  depend?: number[];
  /**
   * Démarre au plus tôt (au curseur), au lieu de garder son heure si elle est plus tardive.
   * Pour les étapes de production : une heure tardive héritée laisserait la matinée vide et
   * ferait déborder l'étape suivante au-delà de son échéance.
   */
  auPlusTot?: boolean;
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
    if (!!a.prioritaire !== !!b.prioritaire) return a.prioritaire ? -1 : 1;
    if (!!a.unplaced !== !!b.unplaced) return a.unplaced ? 1 : -1;
    if (a.unplaced && b.unplaced) return 0;
    // Les tâches « au plus tôt » (préparation des posts) ouvrent la journée.
    if (!!a.auPlusTot !== !!b.auPlusTot) return a.auPlusTot ? -1 : 1;
    return a.startMin - b.startMin;
  });

  let cursor = floor;

  // Ordre de passage : celui du tri, sauf qu'une tâche attend que les tâches qu'elle doit
  // suivre (`apres`) soient placées ou reportées. Sans contrainte, c'est exactement le tri.
  const presents = new Set(sorted.map((t) => t.id));
  const traites = new Set<number>();
  const reportes = new Set<number>();
  const restants = [...sorted];
  const prochaine = (): RepackTask => {
    const i = restants.findIndex((t) => (t.apres ?? []).every((id) => !presents.has(id) || traites.has(id)));
    return restants.splice(i >= 0 ? i : 0, 1)[0]; // i < 0 : cycle impossible ici, on garde le tri
  };

  while (restants.length > 0) {
    const task = prochaine();
    traites.add(task.id);
    // L'étape précédente du même post part au jour suivant : celle-ci la suit.
    if ((task.depend ?? []).some((id) => reportes.has(id))) {
      overflow.push(task.id);
      reportes.add(task.id);
      continue;
    }
    // Une tâche sans créneau démarre au curseur : son startMin ne veut rien dire.
    // Une tâche prioritaire passe devant : elle prend le curseur, pas son ancienne heure.
    let start = task.unplaced || task.prioritaire || task.auPlusTot ? cursor : Math.max(task.startMin, cursor);

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
      reportes.add(task.id);
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

export interface RepackTaskEcheance extends RepackTask {
  /** Dernier jour (YYYY-MM-DD) où la tâche peut être faite — ex. le jour de publication du post. */
  echeance?: string | null;
}

export interface RepackResultEcheances extends RepackResult {
  /**
   * Tâches à échéance qui ne tiennent pas dans la journée même en passant en priorité.
   * Elles ne sont NI déplacées NI reportées : les reporter les ferait tomber après le post.
   */
  forcees: number[];
}

/**
 * `repackDay` qui respecte les échéances : une tâche qui déborderait vers `jourSuivant`
 * alors que son échéance tombe avant ne part pas — elle passe devant, et ce sont les
 * tâches sans échéance (ou à échéance plus lointaine) qui débordent à sa place.
 */
export function repackDayAvecEcheances(
  tasks: RepackTaskEcheance[],
  opts: RepackOptions,
  _date?: string,
  jourSuivant?: string,
): RepackResultEcheances {
  const premier = repackDay(tasks, opts);
  if (!jourSuivant) return { ...premier, forcees: [] };
  const bloquee = (t: RepackTaskEcheance) => !!t.echeance && t.echeance < jourSuivant;
  const debordeTrop = new Set(premier.overflow);
  if (!tasks.some((t) => debordeTrop.has(t.id) && bloquee(t))) return { ...premier, forcees: [] };

  const second = repackDay(tasks.map((t) => (bloquee(t) ? { ...t, prioritaire: true } : t)), opts);
  const parId = new Map(tasks.map((t) => [t.id, t]));
  const forcees = second.overflow.filter((id) => bloquee(parId.get(id)!));
  const forceesSet = new Set(forcees);
  return { moves: second.moves, overflow: second.overflow.filter((id) => !forceesSet.has(id)), forcees };
}

/**
 * Tâches qu'un rééquilibrage de semaine a le droit de déplacer : non faites, et non liées
 * à un post — une tâche de production est tenue par la date de publication de son post,
 * un plafond de charge ne doit jamais la pousser après.
 */
export function tachesARebalancer<T extends { completed?: boolean | null; contentId?: number | null }>(taches: T[]): T[] {
  return taches.filter((t) => !t.completed && t.contentId == null);
}
