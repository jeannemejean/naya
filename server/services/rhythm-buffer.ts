import { storage } from '../storage';

export const BUFFER_MIN_FLOOR = 0;
export const BUFFER_MIN_CEILING = 30;
export const BUFFER_STEP = 5;
const MIN_SIGNALS = 5;
const WINDOW_DAYS = 14;
const LOCK_DAYS = 7;

export interface RhythmSignal { signal: string }

export interface NextBufferInput {
  current: number;
  /** Retours des 14 derniers jours, tous types confondus. */
  signals: RhythmSignal[];
  lastAdjustedAt: Date | null;
  now: Date;
}

/**
 * Nouvelle respiration à appliquer, en minutes. PURE.
 *
 * Conservatrice par construction : il faut au moins 5 retours, un seul ajustement par
 * semaine, et des pas de 5 minutes. Sans ces garde-fous la valeur oscillerait à chaque
 * nouveau retour et l'utilisateur verrait son planning bouger sans comprendre pourquoi.
 *
 * `tasks_wrong` compte dans le total mais ne pousse ni dans un sens ni dans l'autre :
 * il parle de la pertinence des tâches, pas de la densité de la journée.
 */
export function nextBufferMin(input: NextBufferInput): number {
  const { current, signals, lastAdjustedAt, now } = input;

  if (signals.length < MIN_SIGNALS) return current;

  if (lastAdjustedAt) {
    const daysSince = (now.getTime() - lastAdjustedAt.getTime()) / 86_400_000;
    if (daysSince < LOCK_DAYS) return current;
  }

  const total = signals.length;
  const overloaded = signals.filter((s) => s.signal === 'felt_overloaded').length;
  const onTrack = signals.filter((s) => s.signal === 'on_track').length;

  let next = current;
  if (overloaded / total >= 0.6) next = current + BUFFER_STEP;
  else if (onTrack / total >= 0.8) next = current - BUFFER_STEP;

  return Math.min(BUFFER_MIN_CEILING, Math.max(BUFFER_MIN_FLOOR, next));
}

/** Enveloppe DB : lit les retours récents, applique la règle, persiste si ça a changé. */
export async function adjustBufferForUser(userId: string): Promise<void> {
  const prefs = await storage.getUserPreferences(userId);
  const signals = await storage.getRecentRhythmFeedback(userId, WINDOW_DAYS);

  const now = new Date();
  const current = prefs?.bufferMin ?? 10;
  const next = nextBufferMin({
    current,
    signals,
    lastAdjustedAt: prefs?.bufferAdjustedAt ?? null,
    now,
  });

  if (next === current) return;
  await storage.setBufferMin(userId, next, now);
  console.log(`[RhythmBuffer] user ${userId}: ${current} → ${next} min`);
}
