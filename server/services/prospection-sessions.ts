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

/** Un créneau exploitable : bornes UTC (ms) déjà restreintes à la fenêtre de
 *  l'utilisatrice, et le nombre de cibles en attente qu'il dessert. */
interface Creneau { start: number; end: number; weight: number }

/**
 * Découpe la journée en 2 ou 3 sessions, placées LÀ OÙ LES CIBLES EN ATTENTE SONT
 * JOIGNABLES.
 *
 * L'ordre est inversé par rapport à l'intuition : on ne tire pas des sessions au
 * hasard pour chercher ensuite qui peut recevoir. Le placement décide de qui est
 * joignable ce jour-là — sans cela, les leads hors d'Europe attendraient qu'une
 * session tombe au bon endroit par chance.
 *
 * PURE : aucune horloge, aucun aléa interne. `pendingCountryCodes` est une liste
 * PAR CIBLE (un code pays par lead en attente, doublons attendus — ex. 16 "FR", 6
 * "EG", 1 "MG") : `targetWindowUTC` est appelée avec `city: null` pour chaque pays
 * distinct — chaque pays multi-fuseau retombe sur l'intersection de TOUS ses
 * fuseaux (repli sûr, voir prospection-target-hours.ts), plus étroite que ce
 * qu'offrirait une ville reconnue. Résoudre par ville exigerait de faire remonter
 * la ville de chaque cible en attente jusqu'ici, ce que l'input actuel ne porte
 * pas — hypothèse notée dans le commit.
 *
 * PONDÉRATION : le choix du créneau pour chaque session est tiré au sort (via
 * `seed`) avec une probabilité proportionnelle au nombre de cibles en attente
 * que ce créneau dessert — pas à poids égal entre pays présents. Une file avec
 * 16 cibles FR et 1 cible MG doit favoriser le créneau FR, pas lui donner la
 * même part de temps qu'au créneau MG : « placer les sessions là où sont les
 * cibles » porte sur le VOLUME de cibles, pas seulement sur la liste des pays
 * présents.
 *
 * INVARIANT : dès qu'au moins un créneau existe, exactement `combien` sessions
 * (2 ou 3) sont produites — jamais moins, jamais en silence. La durée tirée
 * (10-20 min) est plafonnée à la taille du créneau qui l'accueille : un créneau
 * étroit (ex. fenêtre utilisatrice de 12 minutes) reçoit une session plus
 * courte plutôt que d'être sauté sans le dire. Le plancher
 * `SESSION_MIN_DURATION_MS` reste garanti car seuls les créneaux d'au moins
 * cette taille sont retenus (voir le filtre `e - s >= SESSION_MIN_DURATION_MS`
 * ci-dessous) — un créneau plus étroit que ça n'a de toute façon aucune session
 * viable à offrir et n'est pas retenu.
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

  // Poids = nombre de cibles en attente pour ce pays (pas sa simple présence).
  const comptes = new Map<string, number>();
  for (const cc of input.pendingCountryCodes) {
    comptes.set(cc, (comptes.get(cc) ?? 0) + 1);
  }

  // Intervalles réellement exploitables : intersection fenêtre utilisatrice × fenêtre
  // de chaque pays présent. Un pays inconnu ou sans créneau commun est simplement
  // absent d'ici — il sera signalé côté lead, pas ignoré en silence.
  const creneaux: Creneau[] = [];
  for (const [cc, weight] of Array.from(comptes)) {
    const w = targetWindowUTC(cc, null, input.dateStr);
    if (!w.reachable) continue;
    const s = Math.max(uStart, w.start.getTime());
    const e = Math.min(uEnd, w.end.getTime());
    if (e - s >= SESSION_MIN_DURATION_MS) creneaux.push({ start: s, end: e, weight });
  }
  if (creneaux.length === 0) return [];

  const totalPoids = creneaux.reduce((sum, c) => sum + c.weight, 0);

  const rand = rng(input.seed);
  const combien = SESSIONS_MIN_PER_DAY +
    Math.floor(rand() * (SESSIONS_MAX_PER_DAY - SESSIONS_MIN_PER_DAY + 1));

  const sessions: Session[] = [];
  for (let i = 0; i < combien; i++) {
    // Choix pondéré par le nombre de cibles que dessert chaque créneau : une file
    // très déséquilibrée (16 FR contre 1 MG) favorise le créneau FR, pas un simple
    // tour de rôle à poids égal.
    let tirage = rand() * totalPoids;
    let choisi = creneaux[creneaux.length - 1];
    for (const c of creneaux) {
      if (tirage < c.weight) { choisi = c; break; }
      tirage -= c.weight;
    }
    const cs = choisi.start;
    const ce = choisi.end;

    // Durée plafonnée à la taille du créneau : garantit marge >= 0 toujours (le
    // créneau a déjà été filtré à >= SESSION_MIN_DURATION_MS ci-dessus), donc
    // cette session n'est JAMAIS sautée — l'invariant "2 à 3 sessions" tient dès
    // qu'un créneau existe.
    const dureeBrute = SESSION_MIN_DURATION_MS +
      Math.floor(rand() * (SESSION_MAX_DURATION_MS - SESSION_MIN_DURATION_MS + 1));
    const duree = Math.min(dureeBrute, ce - cs);
    const marge = ce - cs - duree;
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
