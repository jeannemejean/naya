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

/** Dépendance telle que l'IA la déclare : par INDICE dans le tableau de tâches généré. */
export interface DeclaredDependency {
  taskIndex: number;
  dependsOnIndex: number;
  relationType?: string;
}

/**
 * Trie des tâches NON ENCORE ENREGISTRÉES sur les dépendances déclarées par l'IA. PURE.
 *
 * Pourquoi cette fonction existe : `sortTasksByDependencies` lit les dépendances en base et
 * ne peut donc rien faire des tâches qui viennent d'être générées — elles n'ont pas d'id, et
 * son garde `taskIds.length === 0` la fait sortir sans rien trier. Le planificateur l'appelait
 * malgré tout sur des tâches fraîches : le tri n'a jamais eu lieu, et l'ordre observé était
 * celui que le modèle avait produit, sans contrainte.
 *
 * Tri topologique (Kahn) STABLE : à contrainte égale, l'ordre d'entrée est conservé, ou celui
 * que `preference` impose. Sans stabilité, deux générations identiques donneraient deux
 * plannings différents.
 *
 * `preference[i]` = rang souhaité de la tâche i quand plus rien ne la contraint. Les
 * dépendances priment toujours : une tâche n'entre dans la file que lorsque tous ses
 * prérequis en sont sortis.
 *
 * Robustesse : un indice hors bornes, non entier, ou une tâche déclarée dépendante
 * d'elle-même sont ignorés. Le modèle produit ces valeurs, et une génération entière ne doit
 * pas tomber pour une arête aberrante. Un cycle ne fait perdre aucune tâche : les tâches
 * non résolues sont ajoutées à la fin, dans leur ordre d'origine.
 */
export function sortByDeclaredDependencies<T>(
  tasks: T[],
  deps: DeclaredDependency[] | undefined | null,
  preference?: number[],
): T[] {
  const n = tasks.length;
  if (n === 0) return [];

  const rangDe = (i: number) => (preference?.[i] ?? 0) * n + i;

  const succICesseurs: number[][] = Array.from({ length: n }, () => []);
  const degreEntrant = new Array<number>(n).fill(0);

  const valide = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n;

  for (const dep of deps ?? []) {
    const dependant = dep?.taskIndex;
    const prerequis = dep?.dependsOnIndex;
    if (!valide(dependant) || !valide(prerequis)) continue;
    if (dependant === prerequis) continue; // une tâche ne se bloque pas elle-même
    succICesseurs[prerequis].push(dependant);
    degreEntrant[dependant] += 1;
  }

  // File des tâches prêtes, maintenue triée par préférence puis indice d'origine.
  const pretes: number[] = [];
  const enfiler = (i: number) => {
    const r = rangDe(i);
    let pos = pretes.length;
    while (pos > 0 && rangDe(pretes[pos - 1]) > r) pos -= 1;
    pretes.splice(pos, 0, i);
  };

  for (let i = 0; i < n; i += 1) if (degreEntrant[i] === 0) enfiler(i);

  const ordre: number[] = [];
  const sorti = new Array<boolean>(n).fill(false);

  while (pretes.length > 0) {
    const i = pretes.shift()!;
    ordre.push(i);
    sorti[i] = true;
    for (const j of succICesseurs[i]) {
      degreEntrant[j] -= 1;
      if (degreEntrant[j] === 0) enfiler(j);
    }
  }

  // Cycle : ce qui reste n'a jamais atteint un degré entrant nul. On le rend tel quel plutôt
  // que de le perdre — une tâche absente du planning est pire qu'une tâche mal placée.
  for (let i = 0; i < n; i += 1) if (!sorti[i]) ordre.push(i);

  return ordre.map((i) => tasks[i]);
}

const WORKFLOW_ORDER = ['strategy', 'content', 'product', 'client', 'prospection', 'admin', 'general'];

/**
 * Ordre définitif des tâches générées : dépendances déclarées d'abord, regroupement par
 * workflow comme départage. PURE.
 *
 * L'ancien enchaînement appliquait le regroupement APRÈS le tri, ce qui pouvait défaire
 * l'ordre que le tri venait d'établir — un prérequis `admin` repassait derrière un dépendant
 * `strategy`. Le commentaire du module affirmait déjà que « les dépendances priment » ; ici
 * elles priment réellement, parce que le workflow n'intervient qu'entre tâches qu'aucune
 * dépendance ne relie.
 */
export function orderGeneratedTasks<T extends { workflowGroup?: string | null }>(
  tasks: T[],
  deps: DeclaredDependency[] | undefined | null,
): T[] {
  const preference = tasks.map((t) => {
    const rang = WORKFLOW_ORDER.indexOf(t.workflowGroup ?? 'general');
    return rang === -1 ? WORKFLOW_ORDER.length : rang;
  });
  return sortByDeclaredDependencies(tasks, deps, preference);
}

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
