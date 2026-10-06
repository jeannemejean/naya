// Date à partir de laquelle relancer le filet (précédences + anti-chevauchement) après un
// déplacement de carte. Déplacer un prérequis de mardi à jeudi doit recharger aussi le
// mercredi (où vit son dépendant) : on part donc du MIN(ancienne, nouvelle date), jamais
// avant aujourd'hui (heure de Paris) — le passé n'est pas retouché.

export function aujourdhuiParis(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return p; // YYYY-MM-DD
}

export function dateDeRetassage(
  ancienne: string | null | undefined,
  nouvelle: string | null | undefined,
  aujourdhui: string = aujourdhuiParis(),
): string | null {
  const dates = [ancienne, nouvelle].filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const min = dates.reduce((a, b) => (a < b ? a : b));
  return min > aujourdhui ? min : aujourdhui;
}
