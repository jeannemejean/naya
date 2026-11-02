/**
 * Rythme des actions LinkedIn : environ une action toutes les 20 minutes, entre 8 h et
 * 18 h en semaine, avec de temps en temps une pause d'une à deux heures pour ressembler
 * à une personne. Les plafonds de volume (montée en charge, 80/semaine, arrêt sur
 * restriction) restent dans `prospection-linkedin-guard.ts`, inchangés.
 */

export const LINKEDIN_FENETRE = {
  startMin: 8 * 60,
  endMin: 18 * 60,
  workDays: new Set(["mon", "tue", "wed", "thu", "fri"]),
};

const BASE_MS = 15 * 60_000;
const JITTER_MS = 10 * 60_000; // 15–25 min
const PAUSE_BASE_MS = 60 * 60_000;
const PAUSE_JITTER_MS = 60 * 60_000; // 60–120 min
const PAUSE_PROBABILITY = 1 / 6;

/** Générateur déterministe (mulberry32) amorcé par un hash FNV-1a de la graine. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Écart exigé après une action LinkedIn partie à `lastSentAt` : 15 à 25 minutes, et une
 * fois sur six environ, 1 à 2 h de pause en plus. Déterministe pour un même couple
 * (compte, instant) : le worker repasse chaque minute et doit toujours tomber sur la même réponse.
 */
export function linkedinGapMs(lastSentAt: Date, accountKey: string): number {
  const next = rng(`${accountKey}|${lastSentAt.getTime()}`);
  let gap = BASE_MS + Math.floor(next() * JITTER_MS);
  if (next() < PAUSE_PROBABILITY) gap += PAUSE_BASE_MS + Math.floor(next() * PAUSE_JITTER_MS);
  return gap;
}
