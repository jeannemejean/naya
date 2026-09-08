/**
 * Conversion explicite heure murale de Paris → instant absolu.
 *
 * Le serveur de production tourne en UTC. Le `Dockerfile` et `railway.toml` existent
 * bel et bien (contrairement à ce qu'une version antérieure de ce commentaire
 * affirmait) — mais ni l'un ni l'autre ne pose de variable `TZ` : l'image
 * `node:22-alpine` du `Dockerfile` tourne donc dans le fuseau par défaut du conteneur,
 * UTC, faute d'override. `new Date(`${date}T${time}:00`)` interprète donc
 * l'heure murale dans le fuseau du PROCESS (UTC en prod), pas celui de Paris : une
 * tâche finissant à 14:00 (heure que l'utilisatrice voit dans son planning, à Paris)
 * produirait une alarme à 14:00 UTC, soit 16:00 à Paris l'été. Ce module est la seule
 * façon correcte de faire cette conversion — voir `server/services/auto-planner.ts`
 * (`currentParisTimeMin`, `todayStringParis`) et `server/storage.ts` (bornage
 * `parisToday`/`parisNowMin`) pour la même conversion déjà appliquée ailleurs dans ce
 * dépôt, PARCE QUE le process n'est pas à l'heure de Paris.
 *
 * PUR : aucune horloge implicite, aucun accès base de données.
 */

/** Décalage Europe/Paris (en minutes, Paris = UTC + décalage) à un instant donné. */
function parisOffsetMinutesAt(instant: Date): number {
  // hourCycle: 'h23' est nécessaire — `hour12: false` seul peut, selon la version
  // d'ICU du runtime, rendre "24" au lieu de "00" pour minuit. Si ce "24" reste dans
  // les parts formatées et qu'on le recompose en chaîne ISO (plutôt qu'en le passant à
  // Date.UTC, qui normalise), `new Date(...)` peut échouer à parser l'heure ou donner
  // un résultat faux : `hourCycle: 'h23'` élimine le problème à la racine.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const byType: Record<string, string> = {};
  for (const part of parts) byType[part.type] = part.value;

  // Recompose l'heure murale de Paris à cet instant, comme si elle était en UTC — la
  // différence avec `instant` (qui, lui, EST en UTC) donne le décalage en minutes.
  const parisWallClockAsUTC = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second),
  );
  return (parisWallClockAsUTC - instant.getTime()) / 60_000;
}

/**
 * Convertit une heure murale de Paris ("YYYY-MM-DD", "HH:MM") en instant absolu.
 * Gère l'heure d'été et l'heure d'hiver — le décalage Europe/Paris est mesuré à
 * l'instant candidat lui-même via `Intl.DateTimeFormat`, sans dépendance externe.
 *
 * ⚠️ DÉFAUT CORRIGÉ (revue) : une première version échantillonnait le décalage une
 * seule fois, à `candidateUTC` (l'heure murale traitée comme si elle était déjà en
 * UTC), et faisait confiance à ce premier échantillon. Ça cassait silencieusement pour
 * toute heure murale dans `[01:00, 02:00)` les jours de transition — une heure qui
 * EXISTE et n'est PAS ambiguë, pas seulement « le trou ». Exemple : le 25/10/2026,
 * `candidateUTC` pour "01:30" tombe à "2026-10-25T01:30:00Z", DÉJÀ après l'instant de
 * transition (01:00 UTC) : le premier échantillon lisait donc le régime CET (après
 * bascule) alors que 01:30 murale, ce jour-là, est encore CEST (avant bascule) — 1h
 * d'erreur. La correction : recalculer le décalage à l'instant obtenu avec le premier
 * échantillon, et se fier à CE SECOND échantillon plutôt qu'au premier. Voir
 * `timezone.test.ts`, describe "zone dangereuse", pour la preuve par aller-retour
 * (reformater le résultat doit redonner l'heure demandée) — une assertion sur une
 * valeur UTC écrite à la main ne l'aurait pas détecté, car il fallait sonder
 * précisément 01:00-01:59, pas 03:30.
 *
 * POURQUOI DEUX PASSES ET PAS TROIS. Le nombre n'est pas arbitraire. Vérifié en revue
 * par balayage : sur 8640 couples (jour de transition, minute) couvrant les deux
 * bascules de 2024 à 2035, une troisième passe ne diverge JAMAIS de la deuxième —
 * sauf dans l'heure inexistante, où elle ne convergerait de toute façon pas, puisque
 * l'heure demandée n'existe pas et qu'il n'y a donc pas de point fixe. Deux passes
 * suffisent pour toute heure murale qui existe réellement.
 *
 * Deux cas n'ont pas de réponse « correcte » unique et sont documentés/figés par des
 * tests dédiés plutôt que laissés silencieux :
 * - Heure AMBIGUË (retour à l'heure d'hiver, 02:00-02:59, existe deux fois) : résout
 *   toujours vers la SECONDE occurrence (après le rétropassage, en CET).
 * - Heure INEXISTANTE (passage à l'heure d'été, 02:00-02:59, n'existe jamais) : se
 *   comporte comme si le trou d'une heure était traversé tel quel — le résultat
 *   reformate en heure de Paris à (heure demandée + 1h).
 */
export function parisWallClockToInstant(dateStr: string, hhmm: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);

  // Instant candidat : l'heure murale traitée comme si elle était déjà en UTC. Il est
  // à au plus ~2h de l'instant réel (le décalage Europe/Paris ne dépasse jamais 2h),
  // ce qui suffit pour un PREMIER échantillon du régime (CET/CEST) — mais ce premier
  // échantillon peut appartenir au mauvais régime si l'heure murale demandée est juste
  // avant une transition (voir le commentaire de fonction). D'où la seconde passe.
  const candidateUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuessOffsetMin = parisOffsetMinutesAt(new Date(candidateUTC));

  // Seconde passe : on recalcule le décalage à l'instant obtenu avec le premier
  // échantillon, et c'est CE décalage qu'on retranche — pas le premier. Loin de toute
  // transition, les deux échantillons sont identiques (aucun changement de résultat).
  const correctedInstant = candidateUTC - firstGuessOffsetMin * 60_000;
  const offsetMin = parisOffsetMinutesAt(new Date(correctedInstant));
  return new Date(candidateUTC - offsetMin * 60_000);
}

/** "YYYY-MM-DD" du jour suivant, en arithmétique UTC pure (indépendant du fuseau local). */
function nextDateStr(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Bornes \[start, end\[ d'une journée murale de Paris, en instants UTC. `end` est
 * EXCLUSIF (minuit Paris du jour suivant) — pas de "23:59:59.999" approximatif, qui
 * serait de toute façon dans le mauvais fuseau avec le pattern naïf.
 */
export function parisDayBoundsUTC(dateStr: string): { start: Date; end: Date } {
  return {
    start: parisWallClockToInstant(dateStr, "00:00"),
    end: parisWallClockToInstant(nextDateStr(dateStr), "00:00"),
  };
}

/**
 * L'heure murale de Paris (0-23) d'un instant — jamais `date.getHours()`, qui lit
 * l'heure du fuseau du PROCESS (UTC en prod). `hourCycle: 'h23'` (pas `hour12: false`)
 * pour que minuit rende bien "00" et non "24" selon la version d'ICU du runtime.
 */
export function parisHourOf(instant: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(instant)
    .find((p) => p.type === "hour")!.value;
  return Number(hour);
}

/**
 * Le jour calendaire de Paris ("YYYY-MM-DD") d'un instant — jamais
 * `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`, qui lit le calendrier du
 * fuseau du PROCESS (UTC en prod). Entre minuit et 1h/2h du matin heure de Paris
 * (selon la saison), le jour UTC est encore la veille : lire le jour du process
 * renverrait le mauvais jour. `now` entre par la signature — fonction pure, aucune
 * horloge implicite (même convention que `unansweredStreak`, throttle.ts).
 */
export function parisTodayString(now: Date): string {
  // Locale en-CA : le seul format standard dont Intl garantit la sortie en YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
}

/**
 * Heure murale (minutes depuis minuit, 0-1439) et jour de semaine abrégé ("mon"…"sun")
 * d'un instant, dans un fuseau IANA ARBITRAIRE (pas seulement Europe/Paris) — pour les
 * gardes qui dépendent du fuseau propre à CHAQUE utilisateur (`userPreferences.timezone`),
 * comme la fenêtre d'envoi LinkedIn (`prospection-linkedin-guard.ts`).
 *
 * Contrairement à `parisWallClockToInstant` (heure murale → instant), ce sens de
 * conversion (instant → heure murale) n'a PAS besoin de la correction DST en deux passes :
 * `Intl.DateTimeFormat` avec un `timeZone` explicite lit directement le bon régime
 * (été/hiver, ou équivalent) pour l'instant DONNÉ — il n'y a qu'une seule réponse possible,
 * jamais d'heure ambiguë ni inexistante dans ce sens-là. `hourCycle: 'h23'` (pas
 * `hour12: false`) pour que minuit rende bien "00" et non "24" selon l'ICU du runtime —
 * même piège que `parisHourOf`.
 *
 * PUR : aucune horloge implicite, aucun accès base de données. `now`/`timeZone` entrent
 * par la signature, donc indépendant du fuseau du PROCESS qui exécute l'appelant (UTC en
 * prod, potentiellement autre chose en local) — vérifié par test sous TZ=UTC et
 * TZ=Europe/Paris.
 */
export function localWallClock(timeZone: string, instant: Date): { minuteOfDay: number; dayAbbr: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(instant);

  const byType: Record<string, string> = {};
  for (const part of parts) byType[part.type] = part.value;

  const minuteOfDay = Number(byType.hour) * 60 + Number(byType.minute);
  const dayAbbr = byType.weekday.toLowerCase().slice(0, 3);
  return { minuteOfDay, dayAbbr };
}
