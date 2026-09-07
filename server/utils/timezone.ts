/**
 * Conversion explicite heure murale de Paris → instant absolu.
 *
 * Le serveur de production tourne en UTC (aucun `TZ` n'est configuré — pas de
 * Dockerfile, pas de railway.toml). `new Date(`${date}T${time}:00`)` interprète donc
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
 */
export function parisWallClockToInstant(dateStr: string, hhmm: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);

  // Instant candidat : l'heure murale traitée comme si elle était déjà en UTC. Il est
  // à au plus ~2h de l'instant réel (le décalage Europe/Paris ne dépasse jamais 2h),
  // ce qui suffit pour échantillonner le bon régime (CET/CEST) — sauf pendant l'heure
  // qui n'existe pas (le trou du passage à l'heure d'été), non couvert ici.
  const candidateUTC = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsetMin = parisOffsetMinutesAt(new Date(candidateUTC));
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
