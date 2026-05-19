import { storage } from '../storage';

interface SortableTask {
  id?: number;
  title: string;
  workflowGroup?: string;
  [key: string]: any;
}

/**
 * Trie un tableau de tâches en respectant les dépendances existantes en DB.
 * Utilise Kahn's algorithm (tri topologique).
 * Les tâches dans un cycle ou sans dépendances sont ajoutées à la fin sans modification.
 */
export async function sortTasksByDependencies(
  tasks: SortableTask[],
  _userId: string,
): Promise<SortableTask[]> {
  if (tasks.length === 0) return tasks;

  const taskIds = tasks.map(t => t.id).filter((id): id is number => typeof id === 'number');
  if (taskIds.length === 0) return tasks;

  const deps = await storage.getTaskDependenciesForIds(taskIds).catch(() => []);
  if (deps.length === 0) return tasks;

  // Construire le graphe
  const graph = new Map<number, number[]>();
  const inDegree = new Map<number, number>();

  for (const task of tasks) {
    if (!task.id) continue;
    graph.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const dep of deps) {
    const prereq = dep.dependsOnTaskId;
    const dependent = dep.taskId;
    if (graph.has(prereq) && graph.has(dependent)) {
      graph.get(prereq)!.push(dependent);
      inDegree.set(dependent, (inDegree.get(dependent) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: SortableTask[] = tasks.filter(t => t.id && (inDegree.get(t.id) ?? 0) === 0);
  const sorted: SortableTask[] = [];

  while (queue.length > 0) {
    const task = queue.shift()!;
    sorted.push(task);
    if (!task.id) continue;
    for (const dependentId of (graph.get(task.id) ?? [])) {
      const newDeg = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, newDeg);
      if (newDeg === 0) {
        const dep = tasks.find(t => t.id === dependentId);
        if (dep) queue.push(dep);
      }
    }
  }

  // Tâches dans un cycle ou non résolues → fin
  const missing = tasks.filter(t => !sorted.includes(t));
  return [...sorted, ...missing];
}

const WORKFLOW_ORDER = ['strategy', 'content', 'product', 'client', 'prospection', 'admin', 'general'];

/**
 * Regroupe les tâches par workflowGroup (cognitif → opérationnel → admin).
 * S'applique APRÈS le tri par dépendances. En cas de conflit, les dépendances priment.
 */
export function groupTasksByWorkflow(tasks: SortableTask[]): SortableTask[] {
  const groups = new Map<string, SortableTask[]>();
  for (const task of tasks) {
    const group = task.workflowGroup ?? 'general';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(task);
  }

  const sorted: SortableTask[] = [];
  for (const group of WORKFLOW_ORDER) {
    if (groups.has(group)) {
      sorted.push(...groups.get(group)!);
      groups.delete(group);
    }
  }
  // Groupes non listés dans l'ordre
  for (const groupTasks of Array.from(groups.values())) {
    sorted.push(...groupTasks);
  }
  return sorted;
}
