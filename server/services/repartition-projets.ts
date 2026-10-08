// Répartition des tâches générées ENTRE projets, au sein d'une journée. PURE.
//
// 9 octobre 2026 : une journée entière était liée à un seul projet. Trois causes :
//  - l'auto-planner ne traitait que le projet sélectionné dans la barre latérale ;
//  - il sautait toute journée qui contenait déjà une tâche ;
//  - generate-daily concaténait les tâches projet par projet, puis le rééquilibrage
//    remplissait chaque jour jusqu'au plafond dans cet ordre — aujourd'hui = projet 1,
//    demain = projet 2.

import { budgetWeight } from "./task-allocation";

/**
 * Entrelace les tâches à tour de rôle entre projets (A1, B1, C1, A2, B2…). L'ordre interne
 * de chaque projet est conservé — il porte déjà le tri par dépendances — et les projets se
 * succèdent dans l'ordre de leur première apparition. Rend les mêmes objets.
 */
export function entrelacerParProjet<T>(taches: T[], cle: (t: T) => string): T[] {
  const files = new Map<string, T[]>();
  for (const t of taches) {
    const k = cle(t);
    if (!files.has(k)) files.set(k, []);
    files.get(k)!.push(t);
  }
  if (files.size <= 1) return [...taches];

  const listes = Array.from(files.values());
  const sortie: T[] = [];
  for (let rang = 0; sortie.length < taches.length; rang++) {
    for (const l of listes) if (rang < l.length) sortie.push(l[rang]);
  }
  return sortie;
}

/**
 * Nombre de tâches à générer par projet pour une journée de `capacite` tâches.
 * Chaque projet reçoit d'abord une tâche (dans l'ordre des budgets décroissants si la
 * capacité ne suffit pas pour tous), puis le reste est réparti au prorata du budget
 * temps/jour (plus forts restes). La somme vaut exactement `capacite`.
 */
export function repartirCapaciteDuJour(
  projets: Array<{ dailyTimeBudgetHours?: number | null }>,
  capacite: number,
): number[] {
  const n = projets.length;
  const caps = new Array<number>(n).fill(0);
  let reste = Math.max(0, Math.floor(capacite));
  if (n === 0 || reste === 0) return caps;

  const poids = projets.map((p) => budgetWeight(p.dailyTimeBudgetHours));
  // Ordre de priorité : budget décroissant, puis ordre d'origine (tri stable).
  const ordre = poids.map((_, i) => i).sort((a, b) => poids[b] - poids[a]);

  // 1. Une tâche par projet, tant que la capacité le permet.
  for (const i of ordre) {
    if (reste === 0) break;
    caps[i] = 1;
    reste--;
  }
  if (reste === 0) return caps;

  // 2. Le reste au prorata du budget (méthode des plus forts restes).
  const total = poids.reduce((a, b) => a + b, 0) || 1;
  const quotas = poids.map((w) => (reste * w) / total);
  let distribue = 0;
  quotas.forEach((q, i) => { const f = Math.floor(q); caps[i] += f; distribue += f; });
  const parReste = quotas
    .map((q, i) => ({ i, r: q - Math.floor(q) }))
    .sort((a, b) => b.r - a.r || poids[b.i] - poids[a.i] || a.i - b.i);
  for (let k = 0; k < reste - distribue; k++) caps[parReste[k % n].i]++;
  return caps;
}

/**
 * Combien de tâches l'auto-planner peut encore générer sur une journée.
 * Une journée entamée (rituel, tâche de production du calendrier, vérification de
 * prospection, report) reçoit le reste de sa capacité au lieu d'être sautée. Une tâche
 * faite compte : elle a occupé sa place. Les jalons ne comptent pas.
 * Une journée qui porte déjà des tâches de l'auto-planner (source « auto ») n'est pas
 * regénérée : sinon chaque passage du matin re-remplirait ce que l'utilisatrice a retiré.
 */
export function capaciteRestanteDuJour(
  tachesDuJour: Array<{ source?: string | null; type?: string | null; completed?: boolean | null }>,
  capaciteMax: number,
): number {
  const comptees = tachesDuJour.filter((t) => t.type !== "milestone");
  if (comptees.some((t) => t.source === "auto")) return 0;
  return Math.max(0, Math.floor(capaciteMax) - comptees.length);
}
