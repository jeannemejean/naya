// Bandeau résumé factuel (Task 6) — 4 tuiles calculées côté client, zéro IA, instantané :
// Stade, Objectif actif, Jalons, Activité récente. Mapping jalons calqué EXACTEMENT sur
// server/services/project-summary.ts::summarizeMilestones (completed→done,
// active|unlocked→inProgress, locked→upcoming, skipped ignoré).
//
// + bouton "Demander un point à Naya" — POST /api/projects/:id/situation via useSituation(id)
// (Task 5). Appel à la demande uniquement, jamais déclenché automatiquement. Gère le 429
// (ai_monthly_limit_reached) sans jamais afficher de montant.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, Target, Flag, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSituation, type ProjectDetail } from "./useProjectPage";
import type { ProjectGoal, ProjectMilestone, ProjectStrategyProfile, Task } from "@shared/schema";

interface ProjectSummaryBarProps {
  project: ProjectDetail;
  goals: ProjectGoal[];
  strategyProfile: ProjectStrategyProfile | null;
  milestones: ProjectMilestone[] | undefined;
  projectId: number;
}

const STAGE_LABELS: Record<string, string> = {
  ideation: "Idéation",
  early: "Lancement",
  growth: "Croissance",
  mature: "Mature",
};

// Même bucketing que server/services/project-summary.ts::summarizeMilestones — recalculé côté
// client pour un affichage instantané (pas d'aller-retour réseau dédié).
function summarizeMilestonesClient(milestones: { status: string }[]) {
  let done = 0,
    inProgress = 0,
    upcoming = 0;
  for (const m of milestones) {
    if (m.status === "completed") done++;
    else if (m.status === "active" || m.status === "unlocked") inProgress++;
    else if (m.status === "locked") upcoming++;
  }
  return { done, inProgress, upcoming };
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Nb de tâches complétées cette semaine (fenêtre glissante de 7 jours, aujourd'hui inclus) —
// via GET /api/tasks/range?start&end&projectId (même endpoint que planning.tsx). Exclut les
// tâches "virtuelles" de jalon injectées par cet endpoint (type/source === 'milestone'). En cas
// d'échec réseau, on affiche « — » plutôt que de faire planter le bandeau (widget non critique).
function useRecentCompletedCount(projectId: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const startStr = toDateOnly(start);
  const endStr = toDateOnly(end);
  const url = `/api/tasks/range?start=${startStr}&end=${endStr}&projectId=${projectId}`;

  return useQuery<number | null>({
    queryKey: [url, "recent-activity"],
    queryFn: async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return null;
        const data: Task[] = await res.json();
        const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return data.filter((t: any) => {
          if (t.type === "milestone" || t.source === "milestone") return false;
          if (!t.completed || !t.completedAt) return false;
          return new Date(t.completedAt).getTime() >= cutoffMs;
        }).length;
      } catch {
        return null;
      }
    },
  });
}

function SummaryTile({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5 text-naya-olive-55">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      {children}
    </Card>
  );
}

export default function ProjectSummaryBar({
  goals,
  strategyProfile,
  milestones,
  projectId,
}: ProjectSummaryBarProps) {
  const { toast } = useToast();
  const situation = useSituation(projectId);
  const recentActivity = useRecentCompletedCount(projectId);
  const [aiLimitReached, setAiLimitReached] = useState(false);

  const stageLabel = strategyProfile?.currentStage
    ? STAGE_LABELS[strategyProfile.currentStage] ?? "Non renseigné"
    : "Non renseigné";

  const activeGoal = goals.find((g) => g.status === "active") ?? null;
  let goalPct: number | null = null;
  if (activeGoal) {
    const current = parseFloat(activeGoal.currentValue ?? "");
    const target = parseFloat(activeGoal.targetValue ?? "");
    if (Number.isFinite(current) && Number.isFinite(target) && target > 0) {
      goalPct = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
    }
  }

  const { done, inProgress, upcoming } = summarizeMilestonesClient(milestones ?? []);

  const handleAskSituation = () => {
    setAiLimitReached(false);
    situation.mutate(undefined, {
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ai_monthly_limit_reached")) {
          setAiLimitReached(true);
          toast({
            title: "Limite atteinte",
            description: "Limite d'utilisation de l'IA atteinte pour ce mois-ci.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Erreur",
            description: "Impossible de générer le point de situation.",
            variant: "destructive",
          });
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Résumé factuel — 4 tuiles, calcul instantané, zéro IA ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile label="Stade">
          <span className="text-lg font-semibold text-foreground">{stageLabel}</span>
        </SummaryTile>

        <SummaryTile icon={<Target className="w-3.5 h-3.5" />} label="Objectif actif">
          {activeGoal ? (
            <>
              <span className="text-sm font-semibold text-foreground truncate" title={activeGoal.title}>
                {activeGoal.title}
              </span>
              {goalPct !== null && (
                <div className="flex items-center gap-2 mt-0.5">
                  <Progress value={goalPct} className="h-1.5" />
                  <span className="text-xs text-naya-olive-55 flex-shrink-0">{goalPct}%</span>
                </div>
              )}
            </>
          ) : (
            <span className="text-sm text-naya-olive-55">Aucun objectif actif</span>
          )}
        </SummaryTile>

        <SummaryTile icon={<Flag className="w-3.5 h-3.5" />} label="Jalons">
          <span className="text-sm font-semibold text-foreground">
            {done} fait{done > 1 ? "s" : ""} · {inProgress} en cours · {upcoming} à venir
          </span>
        </SummaryTile>

        <SummaryTile icon={<Activity className="w-3.5 h-3.5" />} label="Activité récente">
          {recentActivity.isLoading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <span className="text-lg font-semibold text-foreground">
              {recentActivity.data === null || recentActivity.data === undefined ? (
                <span className="text-naya-olive-55">—</span>
              ) : (
                <>
                  {recentActivity.data} tâche{recentActivity.data > 1 ? "s" : ""}
                  <span className="text-xs font-normal text-naya-olive-55"> cette semaine</span>
                </>
              )}
            </span>
          )}
        </SummaryTile>
      </div>

      {/* ── Point de situation Naya — sur demande uniquement ── */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-naya-sulphur" />
            <p className="text-sm font-medium text-foreground">Point de situation Naya</p>
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 bg-primary text-primary-foreground"
            disabled={situation.isPending}
            onClick={handleAskSituation}
          >
            {situation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {situation.isPending
              ? "Analyse en cours…"
              : situation.data
                ? "Régénérer"
                : "Demander un point à Naya"}
          </Button>
        </div>

        {aiLimitReached && (
          <p className="mt-3 text-sm text-naya-mauve">
            Limite d'utilisation de l'IA atteinte pour ce mois-ci.
          </p>
        )}

        {situation.data && !aiLimitReached && (
          <div className="mt-3 rounded-lg bg-naya-olive-06 p-4">
            <p className="text-sm text-foreground whitespace-pre-line">{situation.data.text}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
