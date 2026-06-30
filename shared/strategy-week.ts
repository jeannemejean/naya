// Clé de semaine pour la stratégie hebdo — SOURCE UNIQUE, identique client ET serveur.
// Avant, le client utilisait la semaine ISO et le serveur Math.ceil(jour/7) → les clés
// ne correspondaient jamais, donc la stratégie générée n'était jamais retrouvée et un
// nouvel appel Claude se déclenchait à chaque chargement. Cette fonction règle ça.

// Numéro de semaine ISO 8601 d'une date.
export function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Format figé : "YYYY-MM-W<semaineISO>" (ex. "2026-06-W27").
export function strategyWeekKey(d: Date = new Date()): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-W" + getISOWeekNumber(d);
}
