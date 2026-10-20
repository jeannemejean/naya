// Tâches passées jamais planifiées : déplacé tel quel de l'ancien dashboard vers la tête du Planning.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatLocalDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowRight, X } from "lucide-react";

// Section « Non planifiées » : tâches en retard (scheduled_date < aujourd'hui, non complétées,
// non archivées) qui n'apparaissent plus nulle part. Surface PASSIVE + 2 actions par tâche.
// Invisible s'il n'y a aucune tâche orpheline.
export default function OverdueTasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = formatLocalDate(new Date());

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks/overdue", today],
    queryFn: async () => { const r = await apiRequest("GET", `/api/tasks/overdue?clientToday=${today}`); return r.json(); },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks/overdue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks/range"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const defer = useMutation({
    mutationFn: (id: number) => {
      const now = new Date();
      const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      return apiRequest("POST", `/api/tasks/${id}/defer-to-today`, { clientToday: today, clientTime });
    },
    onSuccess: () => { invalidate(); toast({ title: "Reportée à aujourd'hui" }); },
    onError: () => toast({ title: "Échec du report", variant: "destructive" }),
  });

  const archive = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/archive`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Tâche ignorée" }); },
    onError: () => toast({ title: "Échec", variant: "destructive" }),
  });

  if (tasks.length === 0) return null; // condition 4 : section invisible quand aucune orpheline

  return (
    <Card className="mb-6 border-naya-olive-18">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Non planifiées</h3>
          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{tasks.length}</span>
        </div>
        <p className="text-xs text-naya-olive-55 mt-1">
          Tâches passées jamais planifiées, qui ne remontent plus ailleurs. Reporte-les à aujourd'hui ou ignore-les.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((tk: any) => (
          <div key={tk.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-naya-olive-18 bg-naya-olive-06">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{tk.title}</p>
              <span className="text-[11px] text-naya-olive-35">{tk.scheduledDate}</span>
            </div>
            <Button size="sm" variant="outline" disabled={defer.isPending} onClick={() => defer.mutate(tk.id)}>
              <ArrowRight className="h-3.5 w-3.5 mr-1" /> Aujourd'hui
            </Button>
            <button
              title="Ignorer"
              disabled={archive.isPending}
              onClick={() => archive.mutate(tk.id)}
              className="p-1.5 rounded-lg text-naya-olive-55 hover:bg-naya-olive-10 transition-colors disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
