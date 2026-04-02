/**
 * MilestoneChain — widget compact affiché sur le dashboard.
 * Montre la chaîne de jalons du projet actif : actifs en premier plan,
 * bloqués visibles mais grisés (pas cachés).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Lock, Unlock, Zap, Check, Flag, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Config statuts ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { icon: React.ReactNode; label: string; dot: string; row: string; text: string }> = {
  locked:    { icon: <Lock className="h-3 w-3" />,          label: "Bloqué",   dot: "bg-border text-muted-foreground",                row: "opacity-50",  text: "text-muted-foreground" },
  unlocked:  { icon: <Unlock className="h-3 w-3" />,        label: "Débloqué", dot: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400", row: "", text: "text-foreground" },
  active:    { icon: <Zap className="h-3 w-3" />,           label: "Actif",    dot: "bg-primary/10 text-primary",                     row: "",            text: "text-foreground font-medium" },
  completed: { icon: <Check className="h-3 w-3" />,         label: "Complété", dot: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400", row: "opacity-70", text: "text-muted-foreground line-through" },
  skipped:   { icon: <ChevronRight className="h-3 w-3" />,  label: "Ignoré",   dot: "bg-muted text-muted-foreground",                 row: "opacity-40",  text: "text-muted-foreground" },
};

// ─── Composant ────────────────────────────────────────────────────────────────

interface MilestoneChainProps {
  projectId: number;
  projectName?: string;
}

export default function MilestoneChain({ projectId, projectName }: MilestoneChainProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: milestones = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/projects/${projectId}/milestones`],
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: (milestoneId: number) =>
      apiRequest("POST", `/api/milestones/${milestoneId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/milestones`] });
      toast({ title: "✅ Jalon confirmé", description: "Le jalon suivant est maintenant débloqué." });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de confirmer le jalon.", variant: "destructive" }),
  });

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card">
        <div className="h-4 w-24 bg-muted rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  // ─── Empty state ───────────────────────────────────────────────────────────

  if (milestones.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Roadmap</span>
          {projectName && <span className="text-xs text-muted-foreground/60 truncate max-w-[120px]">{projectName}</span>}
        </div>
        <div className="text-center py-5 border border-dashed border-border rounded-xl">
          <Flag className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground/70">Aucun jalon défini</p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">Décris ta roadmap à Naya pour commencer</p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // Afficher max 5 jalons, avec priorité aux actifs/débloqués d'abord
  const sorted = [...milestones].sort((a, b) => {
    const order = { active: 0, unlocked: 1, locked: 2, completed: 3, skipped: 4 };
    return (order[a.status as keyof typeof order] ?? 2) - (order[b.status as keyof typeof order] ?? 2);
  });
  const visible = sorted.slice(0, 5);
  const hasMore = milestones.length > 5;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Roadmap</span>
        <div className="flex items-center gap-2">
          {projectName && <span className="text-xs text-muted-foreground/60 truncate max-w-[100px]">{projectName}</span>}
          <Link href="/projects">
            <a className="text-xs text-primary hover:underline flex items-center gap-0.5">
              Voir tout <ArrowRight className="h-2.5 w-2.5" />
            </a>
          </Link>
        </div>
      </div>

      {/* Chaîne */}
      <div className="space-y-1.5">
        {visible.map((milestone: any, idx: number) => {
          const cfg = STATUS_CFG[milestone.status] ?? STATUS_CFG.locked;
          const isLast = idx === visible.length - 1;
          const canConfirm =
            ["unlocked", "active"].includes(milestone.status) &&
            milestone.conditions?.some((c: any) => c.conditionType === "manual_confirm" && !c.isFulfilled);

          return (
            <div key={milestone.id} className="relative">
              {/* Connecteur vertical */}
              {!isLast && (
                <div className={`absolute left-[11px] top-[26px] w-0.5 h-3 ${
                  milestone.status === "completed" ? "bg-green-200 dark:bg-green-800" :
                  milestone.status === "locked"    ? "bg-border" :
                  "bg-primary/20"
                }`} />
              )}

              <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 transition-opacity ${cfg.row}`}>
                {/* Dot statut */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.dot}`}>
                  {cfg.icon}
                </div>

                {/* Titre */}
                <p className={`flex-1 text-sm leading-snug truncate ${cfg.text}`}>
                  {milestone.title}
                </p>

                {/* Action confirmer */}
                {canConfirm && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2 flex-shrink-0"
                    onClick={() => confirmMutation.mutate(milestone.id)}
                    disabled={confirmMutation.isPending}
                  >
                    Confirmer
                  </Button>
                )}

                {/* Badge statut */}
                {!canConfirm && milestone.status !== "locked" && (
                  <span className={`text-xs flex-shrink-0 ${cfg.text}`}>{cfg.label}</span>
                )}
              </div>

              {/* Conditions bloquantes (si bloqué) */}
              {milestone.status === "locked" && milestone.conditions?.length > 0 && (
                <div className="ml-[30px] mb-1 flex flex-wrap gap-1">
                  {milestone.conditions.slice(0, 2).map((c: any) => (
                    <span key={c.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      <Lock className="h-2 w-2" />
                      {c.label.length > 35 ? c.label.slice(0, 35) + "…" : c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {hasMore && (
          <Link href="/projects">
            <a className="block text-center text-xs text-muted-foreground/60 hover:text-primary py-1">
              +{milestones.length - 5} jalons · voir tout →
            </a>
          </Link>
        )}
      </div>
    </div>
  );
}
