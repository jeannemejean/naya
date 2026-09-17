/**
 * Le verrou de séquence : une tâche dont l'étape précédente n'est pas cochée ne peut pas
 * être cochée. PURE.
 *
 * Demande de Jeanne (17 septembre) : « on est obligé de passer par toutes les étapes, et
 * pour que l'étape suivante soit mise dans le calendrier il faut que la précédente soit
 * validée — donc il faut que l'utilisateur les coche. »
 *
 * Arbitrage : la tâche suivante reste VISIBLE, verrouillée, avec le nom de ce qui la bloque.
 * On voit la chaîne entière plutôt que de découvrir les étapes une par une.
 *
 * Portée réelle, et elle compte : les 58 tâches actuelles n'ont AUCUNE dépendance
 * enregistrée — `task_dependencies` est vide. Le verrou ne changera donc rien pour elles. Il
 * n'agira que sur les tâches générées après le correctif du lot A, qui remplit enfin ce
 * tableau. Ce module ne répare pas le passé, il empêche que ça recommence.
 */

export interface DependanceTache {
  dependsOnTaskId: number | null | undefined;
}

export interface PrerequisTache {
  title: string | null | undefined;
  completed: boolean | null | undefined;
}

export interface Bloqueur {
  id: number;
  titre: string;
}

export interface Verrou {
  verrouillee: boolean;
  /** Vide quand la tâche est libre. Jamais `null` : « rien ne bloque » est une réponse. */
  bloqueePar: Bloqueur[];
}

/** Affiché quand un prérequis existe mais n'a pas de titre — jamais « undefined » à l'écran. */
const TITRE_INCONNU = "Étape précédente";

export function verrouDeTache(input: {
  dependances: DependanceTache[];
  /** Les tâches dont celle-ci dépend, par identifiant. Absente = introuvable. */
  prerequis: Map<number, PrerequisTache>;
  /** Identifiant de la tâche évaluée, pour ignorer une dépendance sur elle-même. */
  tacheId?: number;
}): Verrou {
  const bloqueurs = new Map<number, Bloqueur>();

  for (const dep of input.dependances ?? []) {
    const id = dep?.dependsOnTaskId;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    // Une tâche qui se bloque elle-même serait incochable à jamais.
    if (input.tacheId !== undefined && id === input.tacheId) continue;

    const prereq = input.prerequis.get(id);
    // Prérequis INTROUVABLE — tâche supprimée, ou dépendance héritée d'un plan disparu. Il ne
    // sera jamais coché : le traiter comme bloquant verrouillerait la suivante pour toujours,
    // sans que rien n'indique pourquoi ni comment en sortir. Un lien cassé libère.
    if (!prereq) continue;
    if (prereq.completed) continue;

    // Map : le même prérequis cité deux fois ne doit pas être nommé deux fois à l'écran.
    bloqueurs.set(id, { id, titre: (prereq.title ?? "").trim() || TITRE_INCONNU });
  }

  const bloqueePar = Array.from(bloqueurs.values());
  return { verrouillee: bloqueePar.length > 0, bloqueePar };
}
