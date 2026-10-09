// Décision au cochage, IMMÉDIATE : jamais d'appel réseau entre le clic et l'effet.
// « Naya demande, sans bloquer » : une tâche de production sans livrable ouvre le dépôt.
//
// Avant, la liste des livrables était relue sur le serveur à chaque coche d'une tâche de
// production (jusqu'à 1,5 s d'attente avant que quoi que ce soit ne bouge). On décide
// désormais avec ce que le client sait déjà : la liste en cache si elle a été chargée.
// Inconnue, on ouvre le dépôt — tout de suite — et le panneau affiche les livrables
// existants avec « Terminer la tâche » : rien n'est perdu, rien n'attend.
import { decisionAuCochage } from "@shared/livrables";

export type TacheCochage = { id: number; title: string; completed: boolean };

export function deciderCochage(
  task: TacheCochage,
  livrablesEnCache: readonly unknown[] | undefined,
): "cocher" | "demander" {
  // Hors production ou déjà terminée (décocher) : cocher, sans rien regarder.
  if (decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables: 0 }) === "cocher") {
    return "cocher";
  }
  if (livrablesEnCache === undefined) return "demander";
  return decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables: livrablesEnCache.length });
}
