import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CalendarClock, X } from "lucide-react";
import { Link } from "wouter";

export default function PlanningStartBanner() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery<any>({
    queryKey: ['/api/preferences'],
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', '/api/preferences', { planningStartDate: null }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/preferences'] }),
  });

  const planningStartDate: string | null = prefs?.planningStartDate ?? null;
  const today = new Date().toISOString().slice(0, 10);

  if (!planningStartDate || planningStartDate <= today) return null;

  // Format date nicely
  const dateLabel = new Date(planningStartDate + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="mx-0 mb-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-xl px-4 py-3 flex items-center gap-3">
      <CalendarClock className="h-5 w-5 text-indigo-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200">
          Planification en pause
        </p>
        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
          Naya démarrera automatiquement le <span className="font-semibold">{dateLabel}</span>.
          D'ici là, aucune tâche ne sera générée ni déplacée.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href="/settings"
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 underline"
        >
          Modifier
        </Link>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Démarrer maintenant
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="p-1 text-indigo-400 hover:text-indigo-600 transition-colors"
          title="Fermer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
