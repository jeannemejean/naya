// Cocher une tâche de production sans livrable ouvre le dépôt au lieu de cocher.
// « Naya demande, sans bloquer » : la sortie « Fait hors Naya » coche quand même.
// La décision est immédiate (voir lib/cochage-livrable.ts) : aucun appel réseau avant l'effet.
import { useQueryClient } from "@tanstack/react-query";
import { cleLivrablesTache, type LivrableClient } from "@/lib/livrables-api";
import { deciderCochage, type TacheCochage } from "@/lib/cochage-livrable";

export type TacheMin = TacheCochage;

export function useCocherAvecLivrable(options: {
  cocher: (taskId: number) => void;
  ouvrirDepot: (task: TacheMin) => void;
}) {
  const qc = useQueryClient();
  return (task: TacheMin) => {
    const enCache = qc.getQueryData<LivrableClient[]>(cleLivrablesTache(task.id));
    if (deciderCochage(task, enCache) === "demander") options.ouvrirDepot(task);
    else options.cocher(task.id);
  };
}
