import { targetWindowUTC } from "./prospection-target-hours";

/** ⚠️ DÉFAUTS RÉVISABLES. Un humain ouvre LinkedIn, traite quelques personnes, referme. */
export const SESSIONS_MIN_PER_DAY = 2;
export const SESSIONS_MAX_PER_DAY = 3;
export const SESSION_MIN_DURATION_MS = 10 * 60_000;
export const SESSION_MAX_DURATION_MS = 20 * 60_000;

export interface Session { start: Date; end: Date }

/** Générateur déterministe (mulberry32) : l'aléa entre par la graine, jamais tiré ici. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Découpe la journée en 2 ou 3 sessions, placées LÀ OÙ LES CIBLES EN ATTENTE SONT
 * JOIGNABLES.
 *
 * L'ordre est inversé par rapport à l'intuition : on ne tire pas des sessions au
 * hasard pour chercher ensuite qui peut recevoir. Le placement décide de qui est
 * joignable ce jour-là — sans cela, les leads hors d'Europe attendraient qu'une
 * session tombe au bon endroit par chance.
 *
 * PURE : aucune horloge, aucun aléa interne. `pendingCountryCodes` est ici une
 * liste de codes pays (sans ville) : `targetWindowUTC` est donc appelée avec
 * `city: null` — chaque pays multi-fuseau retombe sur l'intersection de TOUS ses
 * fuseaux (repli sûr, voir prospection-target-hours.ts), plus étroite que ce
 * qu'offrirait une ville reconnue. Résoudre par ville exigerait de faire remonter
 * la ville de chaque cible en attente jusqu'ici, ce que l'input actuel ne porte
 * pas — hypothèse notée dans le commit.
 */
export function planDailySessions(input: {
  userWindowStart: Date;
  userWindowEnd: Date;
  pendingCountryCodes: string[];
  dateStr: string;
  seed: number;
}): Session[] {
  const uStart = input.userWindowStart.getTime();
  const uEnd = input.userWindowEnd.getTime();
  if (!(uEnd > uStart)) return [];

  // Intervalles réellement exploitables : intersection fenêtre utilisatrice × fenêtre
  // de chaque pays présent. Un pays inconnu ou sans créneau commun est simplement
  // absent d'ici — il sera signalé côté lead, pas ignoré en silence.
  const creneaux: Array<[number, number]> = [];
  for (const cc of Array.from(new Set(input.pendingCountryCodes))) {
    const w = targetWindowUTC(cc, null, input.dateStr);
    if (!w.reachable) continue;
    const s = Math.max(uStart, w.start.getTime());
    const e = Math.min(uEnd, w.end.getTime());
    if (e - s >= SESSION_MIN_DURATION_MS) creneaux.push([s, e]);
  }
  if (creneaux.length === 0) return [];

  const rand = rng(input.seed);
  const combien = SESSIONS_MIN_PER_DAY +
    Math.floor(rand() * (SESSIONS_MAX_PER_DAY - SESSIONS_MIN_PER_DAY + 1));

  const sessions: Session[] = [];
  for (let i = 0; i < combien; i++) {
    // On répartit les sessions sur les créneaux disponibles, en tournant : une file
    // mixte FR + US obtient ainsi de la matinée ET de la fin d'après-midi.
    const [cs, ce] = creneaux[i % creneaux.length];
    const duree = SESSION_MIN_DURATION_MS +
      Math.floor(rand() * (SESSION_MAX_DURATION_MS - SESSION_MIN_DURATION_MS + 1));
    const marge = ce - cs - duree;
    if (marge < 0) continue;
    const start = cs + Math.floor(rand() * (marge + 1));
    sessions.push({ start: new Date(start), end: new Date(start + duree) });
  }
  return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Borne de fin exclusive, comme partout ailleurs dans ce lot. */
export function isWithinAnySession(sessions: Session[], now: Date): boolean {
  const t = now.getTime();
  return sessions.some((s) => t >= s.start.getTime() && t < s.end.getTime());
}
