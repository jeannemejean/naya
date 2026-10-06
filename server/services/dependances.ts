/**
 * Dépendances entre tâches : un seul point d'entrée pour en créer une.
 *
 * Pourquoi. Plusieurs sites créaient des liens sans aucun contrôle : auto-références,
 * liens entre comptes, cycles. Une dépendance invalide fait osciller ou bloque l'ordre
 * du planning. Tout passe désormais par `ajouterDependance`, qui refuse sans lever.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { tasks, taskDependencies } from "@shared/schema";

type Arete = { taskId: number; dependsOnTaskId: number };

/**
 * PUR. Vrai si ajouter « taskId dépend de dependsOnTaskId » créerait un cycle :
 * auto-référence, ou `taskId` déjà atteignable depuis le prérequis en suivant les
 * arêtes « dépend de ». Parcours en largeur avec ensemble de visités : un graphe
 * déjà cyclique ne fait donc jamais boucler la fonction.
 */
export function creeraitUnCycle(aretes: Arete[], taskId: number, dependsOnTaskId: number): boolean {
  if (taskId === dependsOnTaskId) return true;
  const prerequis = new Map<number, number[]>();
  for (const e of aretes) {
    const l = prerequis.get(e.taskId);
    if (l) l.push(e.dependsOnTaskId);
    else prerequis.set(e.taskId, [e.dependsOnTaskId]);
  }
  const vus = new Set<number>([dependsOnTaskId]);
  const file = [dependsOnTaskId];
  while (file.length) {
    const courant = file.shift()!;
    for (const suivant of prerequis.get(courant) ?? []) {
      if (suivant === taskId) return true;
      if (!vus.has(suivant)) {
        vus.add(suivant);
        file.push(suivant);
      }
    }
  }
  return false;
}

/**
 * Crée la dépendance si elle est valide. Rend `true` si elle existe à l'issue de l'appel
 * (créée), `false` si refusée : tâche inexistante ou d'un autre compte, auto-référence,
 * cycle, doublon. Ne lève jamais.
 */
export async function ajouterDependance(
  userId: string,
  taskId: number,
  dependsOnTaskId: number,
  relationType: string = "blocked_by",
): Promise<boolean> {
  try {
    if (!Number.isInteger(taskId) || !Number.isInteger(dependsOnTaskId)) return false;
    if (taskId === dependsOnTaskId) return false;

    const lignes = await db
      .select({ id: tasks.id, userId: tasks.userId })
      .from(tasks)
      .where(inArray(tasks.id, [taskId, dependsOnTaskId]));
    if (lignes.length !== 2 || lignes.some((t) => t.userId !== userId)) return false;

    // Arêtes de l'utilisateur uniquement (jointure sur tasks.userId).
    const aretes = await db
      .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(tasks.userId, userId));

    if (aretes.some((e) => e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId)) return false;
    if (creeraitUnCycle(aretes, taskId, dependsOnTaskId)) return false;

    await db.insert(taskDependencies).values({ taskId, dependsOnTaskId, relationType: relationType as any });
    return true;
  } catch (e: any) {
    console.error("[dependances] ajout refusé (erreur):", e?.message ?? e);
    return false;
  }
}
