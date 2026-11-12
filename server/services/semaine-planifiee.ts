// Ce qui est déjà posé dans la semaine d'un jour donné : la génération quotidienne le reçoit
// pour produire les tâches de SON jour sans répéter celles des autres (12 nov. 2026).

/** Lundi et dimanche (YYYY-MM-DD) de la semaine qui contient `dateStr`. */
export function bornesSemaine(dateStr: string): [string, string] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jour = new Date(Date.UTC(y, m - 1, d));
  const decalage = (jour.getUTCDay() + 6) % 7; // lundi = 0
  const lundi = new Date(jour); lundi.setUTCDate(jour.getUTCDate() - decalage);
  const dimanche = new Date(lundi); dimanche.setUTCDate(lundi.getUTCDate() + 6);
  return [lundi.toISOString().slice(0, 10), dimanche.toISOString().slice(0, 10)];
}

/**
 * Titres déjà planifiés dans la semaine, pour `dejaPlanifieesSemaine` : sans les jalons ni les
 * tâches archivées, sans doublon, bornés (le prompt n'a pas à porter une semaine entière).
 */
export function titresDejaPlanifies(taches: Array<{ title?: string | null; type?: string | null; archivedAt?: unknown }>, max = 40): string[] {
  const titres = taches
    .filter((t) => t && t.type !== 'milestone' && !t.archivedAt)
    .map((t) => (t.title ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(titres)).slice(0, max);
}
