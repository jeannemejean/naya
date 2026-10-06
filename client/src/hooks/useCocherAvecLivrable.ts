// Cocher une tâche de production sans livrable ouvre le dépôt au lieu de cocher.
// « Naya demande, sans bloquer » : la sortie « Fait hors Naya » coche quand même.
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cleLivrablesTache, type LivrableClient } from "@/lib/livrables-api";
import { deciderCochage, type TacheCochage } from "@/lib/cochage-livrable";

export type TacheMin = TacheCochage;

export function useCocherAvecLivrable(options: {
  cocher: (taskId: number) => void;
  ouvrirDepot: (task: TacheMin) => void;
}) {
  const qc = useQueryClient();
  // Ids en cours de traitement : un double-clic pendant la lecture ne coche pas deux fois.
  const enCours = useRef<Set<number>>(new Set());
  return async (task: TacheMin) => {
    if (enCours.current.has(task.id)) return;
    enCours.current.add(task.id);
    try {
      const decision = await deciderCochage(task, (id) =>
        qc.fetchQuery<LivrableClient[]>({ queryKey: cleLivrablesTache(id), staleTime: 0 }),
      );
      if (decision === "demander") options.ouvrirDepot(task);
      else options.cocher(task.id);
    } finally {
      enCours.current.delete(task.id);
    }
  };
}
