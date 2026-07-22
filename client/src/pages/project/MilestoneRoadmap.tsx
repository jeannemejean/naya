// Roadmap Jalons — extrait de client/src/pages/projects.tsx (Task 7) pour être partagé entre
// le Sheet détail projet (projects.tsx) et la page projet dédiée (ProjectPage). Comportement
// inchangé : GET /api/projects/:id/milestones, confirmation manuelle via
// POST /api/milestones/:id/confirm.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lock, Unlock, Zap, Check, ChevronRight, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const MILESTONE_STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  locked: { icon: <Lock className="h-3.5 w-3.5" />, label: "Bloqué", color: "text-naya-olive-35 ", bg: "bg-naya-olive-10" },
  unlocked: { icon: <Unlock className="h-3.5 w-3.5" />, label: "Débloqué", color: "text-[#354963] ", bg: "bg-[rgba(125,143,168,0.12)] " },
  active: { icon: <Zap className="h-3.5 w-3.5" />, label: "Actif", color: "text-[#354963] ", bg: "bg-naya-olive-06 " },
  completed: { icon: <Check className="h-3.5 w-3.5" />, label: "Complété", color: "text-naya-olive ", bg: "bg-naya-olive-06 " },
  skipped: { icon: <ChevronRight className="h-3.5 w-3.5" />, label: "Ignoré", color: "text-naya-olive-18 ", bg: "bg-naya-olive-06" },
};

export default function MilestoneRoadmap({ project }: { project: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const { data: milestones, isLoading } = useQuery<any[]>({
    queryKey: [`/api/projects/${project.id}/milestones`],
    enabled: !!project.id,
  });

  const confirmMutation = useMutation({
    mutationFn: (milestoneId: number) =>
      apiRequest('POST', `/api/milestones/${milestoneId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${project.id}/milestones`] });
      toast({ title: t('milestoneRoadmap.confirmed'), description: t('milestoneRoadmap.confirmedDesc') });
    },
    onError: () => toast({ title: t('common.error'), description: t('milestoneRoadmap.errorConfirm'), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-naya-olive-10 rounded-lg animate-pulse" />)}</div>;
  }

  if (!milestones || milestones.length === 0) {
    return (
      <div className="text-center py-10 border-2 border-dashed border-naya-olive-18 rounded-lg">
        <Flag className="h-8 w-8 text-naya-olive-18 mx-auto mb-2" />
        <p className="text-sm text-naya-olive-55 font-medium">{t('milestoneRoadmap.noMilestones')}</p>
        <p className="text-xs text-naya-olive-35 mt-1">{t('milestoneRoadmap.noMilestonesHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {milestones.map((milestone: any, idx: number) => {
        const cfg = MILESTONE_STATUS_CONFIG[milestone.status] ?? MILESTONE_STATUS_CONFIG.locked;
        const isLocked = milestone.status === 'locked';
        const canConfirm = ['unlocked', 'active'].includes(milestone.status) &&
          milestone.conditions?.some((c: any) => c.conditionType === 'manual_confirm' && !c.isFulfilled);

        return (
          <div key={milestone.id} className="flex items-start gap-3">
            {/* Connecteur vertical */}
            <div className="flex flex-col items-center pt-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                {cfg.icon}
              </div>
              {idx < milestones.length - 1 && (
                <div className={`w-0.5 h-5 mt-1 ${isLocked ? 'bg-naya-olive-18 ' : 'bg-indigo-200 '}`} />
              )}
            </div>

            {/* Contenu */}
            <div className={`flex-1 min-w-0 pb-2 p-3 rounded-lg ${cfg.bg} ${isLocked ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${isLocked ? 'text-naya-olive-35 ' : 'text-foreground'}`}>
                    {milestone.title}
                  </p>
                  {milestone.description && (
                    <p className="text-xs text-naya-olive-55 mt-0.5 line-clamp-1">{milestone.description}</p>
                  )}
                  {milestone.conditions?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {milestone.conditions.map((c: any) => (
                        <span key={c.id} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${c.isFulfilled ? 'bg-naya-olive-10 text-naya-olive ' : 'bg-naya-olive-18 text-naya-olive-55 '}`}>
                          {c.isFulfilled ? <Check className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-medium ${cfg.color}`}>{t(`milestoneRoadmap.status.${milestone.status}`, cfg.label)}</span>
                  {canConfirm && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={() => confirmMutation.mutate(milestone.id)}
                      disabled={confirmMutation.isPending}
                    >
                      {t('milestoneRoadmap.confirm')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
