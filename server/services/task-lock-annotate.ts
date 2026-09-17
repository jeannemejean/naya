import { verrouDeTache, type Bloqueur } from "./task-lock";

/**
 * Annote une liste de tâches avec leur verrou, pour que l'interface puisse afficher le
 * cadenas et le nom de ce qui bloque. PURE.
 *
 * Le piège que ce module existe pour éviter : calculer le verrou à partir des SEULES tâches
 * affichées. Un prérequis planifié la veille ne serait alors pas trouvé, donc traité comme
 * introuvable — et `task-lock.ts` libère volontairement sur un prérequis introuvable, pour ne
 * pas emprisonner sur un lien cassé. Les deux règles combinées désactiveraient le verrou en
 * silence, précisément dans le cas le plus courant : une chaîne étalée sur plusieurs jours.
 *
 * D'où `etats` : les prérequis qui ne sont pas dans la liste affichée, chargés à part par
 * l'appelant. `prerequisManquants` lui dit lesquels aller chercher.
 */

export interface DependanceAnnotation {
  taskId: number;
  dependsOnTaskId: number | null | undefined;
}

export interface EtatTache {
  title: string | null | undefined;
  completed: boolean | null | undefined;
}

export type TacheAnnotee<T> = T & { verrouillee: boolean; bloqueePar: Bloqueur[] };

/**
 * Identifiants des prérequis qu'il faut charger : ceux cités par une dépendance et absents
 * de la liste. L'appelant n'interroge ainsi que le strict nécessaire.
 */
export function prerequisManquants<T extends { id: number }>(
  taches: T[],
  dependances: DependanceAnnotation[],
): number[] {
  const presents = new Set(taches.map((t) => t.id));
  const manquants = new Set<number>();
  for (const d of dependances ?? []) {
    const id = d?.dependsOnTaskId;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    if (!presents.has(id)) manquants.add(id);
  }
  return Array.from(manquants);
}

export function annoterVerrous<T extends { id: number; title?: string | null; completed?: boolean | null }>(input: {
  taches: T[];
  dependances: DependanceAnnotation[];
  /** Prérequis absents de `taches`, chargés à part. */
  etats: Map<number, EtatTache>;
}): TacheAnnotee<T>[] {
  const { taches, dependances, etats } = input;

  // La liste affichée fait autorité sur les états fournis : une case cochée dans la page
  // courante doit libérer immédiatement, sans attendre que la table auxiliaire soit à jour.
  const parId = new Map<number, EtatTache>(etats);
  for (const t of taches) {
    parId.set(t.id, { title: t.title ?? null, completed: t.completed ?? null });
  }

  // Regroupement par tâche : appliquer toutes les dépendances à toutes les tâches
  // verrouillerait la journée entière dès qu'une seule est bloquée.
  const parTache = new Map<number, DependanceAnnotation[]>();
  for (const d of dependances ?? []) {
    if (typeof d?.taskId !== "number") continue;
    const liste = parTache.get(d.taskId) ?? [];
    liste.push(d);
    parTache.set(d.taskId, liste);
  }

  return taches.map((tache) => {
    const siennes = parTache.get(tache.id) ?? [];
    const { verrouillee, bloqueePar } = verrouDeTache({
      dependances: siennes,
      prerequis: parId,
      tacheId: tache.id,
    });
    // Étalement de la tâche d'origine : reconstruire un objet partiel perdrait l'heure, la
    // durée, le projet — tout ce dont l'affichage a besoin.
    return { ...tache, verrouillee, bloqueePar };
  });
}
