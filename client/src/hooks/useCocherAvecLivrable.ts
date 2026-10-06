// Cocher une tâche de production sans livrable ouvre le dépôt au lieu de cocher.
// « Naya demande, sans bloquer » : la sortie « Fait hors Naya » coche quand même.
import { useQueryClient } from "@tanstack/react-query";
import { decisionAuCochage } from "@shared/livrables";
import { cleLivrablesTache, type LivrableClient } from "@/lib/livrables-api";

export type TacheMin = { id: number; title: string; completed: boolean };

export function useCocherAvecLivrable(options: {
  cocher: (taskId: number) => void;
  ouvrirDepot: (task: TacheMin) => void;
}) {
  const qc = useQueryClient();
  return async (task: TacheMin) => {
    let nbLivrables = 0;
    if (!task.completed) {
      try {
        const liste = await qc.fetchQuery<LivrableClient[]>({ queryKey: cleLivrablesTache(task.id), staleTime: 0 });
        nbLivrables = liste?.length ?? 0;
      } catch {
        // Lecture impossible : on ne bloque jamais le cochage.
        options.cocher(task.id);
        return;
      }
    }
    const decision = decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables });
    if (decision === "demander") options.ouvrirDepot(task);
    else options.cocher(task.id);
  };
}
