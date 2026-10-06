// Décision au cochage, sans réseau tant que ce n'est pas nécessaire.
// « Naya demande, sans bloquer » : seules les tâches de production lisent la liste
// des livrables, et la lecture ne bloque jamais plus de `delaiMs`.
import { decisionAuCochage } from "@shared/livrables";

export type TacheCochage = { id: number; title: string; completed: boolean };
export const DELAI_LECTURE_LIVRABLES_MS = 1500;

export async function deciderCochage(
  task: TacheCochage,
  lireLivrables: (taskId: number) => Promise<unknown[]>,
  delaiMs: number = DELAI_LECTURE_LIVRABLES_MS,
): Promise<"cocher" | "demander"> {
  // Pré-décision sans réseau : hors production ou déjà terminée, cocher reste instantané.
  if (decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables: 0 }) === "cocher") {
    return "cocher";
  }
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  try {
    const liste = await Promise.race([
      lireLivrables(task.id),
      new Promise<never>((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error("timeout")), delaiMs); }),
    ]);
    return decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables: liste?.length ?? 0 });
  } catch {
    // Lecture impossible ou trop lente : on ne bloque jamais le cochage.
    return "cocher";
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
}
