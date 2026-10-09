// Cochage instantané : la tâche se barre au clic, sans attendre le serveur.
//
// Avant, la case ne changeait qu'après DEUX allers-retours (le POST /toggle, puis le
// rechargement de toute la liste). On bascule donc `completed` dans toutes les listes de
// tâches en cache, puis on resynchronise avec le serveur. Si le serveur refuse (étape
// verrouillée, réseau), on remet exactement l'état d'avant.
import type { QueryClient, QueryKey } from "@tanstack/react-query";

type TacheEnCache = { id: number; completed?: boolean | null; completedAt?: unknown };

/** Listes de tâches en cache : /api/tasks, /api/tasks/range… (jamais les dépendances). */
export function estCleListeTaches(key: readonly unknown[]): boolean {
  const k = key[0];
  return typeof k === "string" && (k === "/api/tasks" || k.startsWith("/api/tasks/range") || k.startsWith("/api/tasks?"));
}

/** Copie de la liste avec la tâche `taskId` basculée ; la même référence si elle n'y est pas. */
export function basculerDansListe<T extends TacheEnCache>(liste: unknown, taskId: number, maintenant = new Date()): unknown {
  if (!Array.isArray(liste)) return liste;
  let trouve = false;
  const suite = liste.map((t: any) => {
    if (!t || t.id !== taskId) return t;
    trouve = true;
    const completed = !t.completed;
    return { ...t, completed, completedAt: completed ? maintenant.toISOString() : null } as T;
  });
  return trouve ? suite : liste;
}

/** Bascule la tâche partout en cache ; rend la fonction qui annule. */
export async function cocherDansLeCache(qc: QueryClient, taskId: number): Promise<() => void> {
  const filtre = { predicate: (q: { queryKey: QueryKey }) => estCleListeTaches(q.queryKey) };
  // Un rechargement en vol écraserait la bascule avec l'ancien état.
  await qc.cancelQueries(filtre);
  const avant = qc.getQueriesData(filtre);
  for (const [key, data] of avant) {
    const apres = basculerDansListe(data, taskId);
    if (apres !== data) qc.setQueryData(key, apres);
  }
  return () => { for (const [key, data] of avant) qc.setQueryData(key, data); };
}

/** Clé commune des mutations de cochage, pour savoir s'il en reste en vol. */
export const CLE_MUTATION_COCHAGE = ["cocher-tache"] as const;

/**
 * Vrai quand la mutation qui se termine est la dernière en vol. Recharger avant, c'est
 * risquer qu'une réponse lue avant l'écriture d'une coche suivante la fasse « décocher »
 * un instant à l'écran.
 */
export function derniereCocheEnVol(qc: QueryClient): boolean {
  return qc.isMutating({ mutationKey: CLE_MUTATION_COCHAGE }) <= 1;
}
