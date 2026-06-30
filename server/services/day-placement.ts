// Placement horaire des tâches du JOUR restées sans heure (cause : génération tardive →
// genFindSlot ne trouvait plus de créneau avant la fin de journée, voir routes генération).
// Règle stricte (garde-fou) :
//  - on ne place JAMAIS dans le passé : départ au plus tôt à max(début de journée, maintenant+buffer) ;
//  - on ne place JAMAIS au-delà de la fin de journée de travail ;
//  - une tâche qui ne rentre pas reste SANS heure (→ « À planifier »), jamais forcée dans un créneau passé/hors fenêtre.

export interface Range { start: number; end: number } // minutes depuis minuit
export interface PlaceableTask {
  id: number;
  durationMin: number;
  // Heure actuelle de la tâche (HH:MM) si elle en a déjà une. GARANTIE : une tâche déjà placée
  // — par Naya OU déplacée à la main — n'est JAMAIS replacée automatiquement.
  currentScheduledTime?: string | null;
}
export interface PlacementResult { id: number; startMin: number; endMin: number }
export interface PlaceOptions {
  workDayStartMin: number;
  workDayEndMin: number;
  nowMin: number;          // heure courante (minutes) — utilisée seulement si on planifie pour aujourd'hui
  bufferMin?: number;      // marge après "maintenant" avant le 1er placement (défaut 15)
  usedRanges?: Range[];    // créneaux occupés (tâches déjà datées, agenda, pauses)
  slotStepMin?: number;    // pas de sondage (défaut 15)
}

// Place une liste de tâches dans les créneaux libres, en partant de l'heure courante.
// Retourne les placements trouvés + les ids restés sans heure.
export function placeTasksFromNow(
  tasks: PlaceableTask[],
  opts: PlaceOptions,
): { placed: PlacementResult[]; unplaced: number[] } {
  const buffer = opts.bufferMin ?? 15;
  const step = opts.slotStepMin ?? 15;
  // Départ : au plus tôt maintenant+buffer, jamais avant le début de journée. → jamais dans le passé.
  let cursor = Math.max(opts.workDayStartMin, opts.nowMin + buffer);

  const used: Range[] = [...(opts.usedRanges ?? [])].sort((a, b) => a.start - b.start);
  const overlaps = (s: number, e: number) => used.some((r) => s < r.end && e > r.start);

  const placed: PlacementResult[] = [];
  const unplaced: number[] = [];

  for (const task of tasks) {
    // GARDE-FOU : tâche déjà placée (heure existante) → on n'y touche JAMAIS.
    if (task.currentScheduledTime && /^\d{2}:\d{2}$/.test(task.currentScheduledTime)) {
      continue;
    }
    const dur = task.durationMin > 0 ? task.durationMin : 30;
    let slot = cursor;
    let safety = 0;
    while (overlaps(slot, slot + dur) && safety < 200) {
      const blocking = used.find((r) => slot < r.end && slot + dur > r.start);
      slot = blocking ? blocking.end : slot + step;
      safety++;
    }
    if (slot + dur > opts.workDayEndMin) {
      // Plus de place avant la fin de journée (ex. il est 22h) → reste SANS heure.
      unplaced.push(task.id);
      continue;
    }
    placed.push({ id: task.id, startMin: slot, endMin: slot + dur });
    used.push({ start: slot, end: slot + dur });
    used.sort((a, b) => a.start - b.start);
    cursor = slot + dur;
  }

  return { placed, unplaced };
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
