// Sélection des tâches « orphelines » : non complétées, non archivées, dont scheduled_date est
// STRICTEMENT antérieure à aujourd'hui — quelle que soit la semaine. Ce sont les tâches qui
// existent en base mais ne sont plus remontées nulle part (ni Today, ni rebalance après bascule
// de semaine). Fonction pure → testable sans DB.

export interface OverdueCandidate {
  completed?: boolean | null;
  archivedAt?: unknown;            // non nul = archivée (ignorée)
  scheduledDate?: string | null;   // YYYY-MM-DD
  type?: string | null;
  source?: string | null;
}

export function selectOverdueTasks<T extends OverdueCandidate>(tasks: T[], today: string): T[] {
  return tasks.filter((t) =>
    !t.completed &&
    (t.archivedAt === null || t.archivedAt === undefined) &&
    t.type !== "milestone" &&
    t.source !== "milestone" &&
    t.source !== "gcal" &&
    typeof t.scheduledDate === "string" &&
    t.scheduledDate.length > 0 &&
    t.scheduledDate < today, // strictement avant aujourd'hui (pas == aujourd'hui → pas de doublon avec Today)
  );
}
