// Liste des rituels d'un projet. Sans ce composant, un rituel créé par erreur
// serait impossible à retirer.
import { useRituals, useDeactivateRitual } from "./useProjectPage";
import { formatDays } from "./ritual-format";
import { useToast } from "@/hooks/use-toast";
import { Repeat, X } from "lucide-react";

export default function RitualList({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: rituals = [] } = useRituals(projectId);
  const deactivate = useDeactivateRitual(projectId);

  const active = rituals.filter((r) => r.active);
  if (active.length === 0) return null;

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <p className="text-xs font-medium text-foreground">Rituels de ce projet</p>
      <ul className="space-y-1.5">
        {active.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-xs text-naya-olive-70">
            <Repeat className="w-3 h-3 text-naya-olive-55 flex-shrink-0" />
            <span className="flex-1 truncate">
              <strong className="font-medium text-foreground">{r.title}</strong>
              {" — "}{formatDays(r.days)}, {r.startTime}, {r.durationMinutes} min
            </span>
            <button
              onClick={() =>
                deactivate.mutate(r.id, {
                  onSuccess: () => toast({ title: "Rituel désactivé" }),
                  onError: () => toast({ title: "Échec de la désactivation", variant: "destructive" }),
                })
              }
              disabled={deactivate.isPending}
              title="Désactiver ce rituel"
              className="text-naya-olive-55 hover:text-naya-olive transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
