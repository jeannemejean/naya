// Capture rapide (« Une idée, une note pour Naya… ») : extraite du dashboard telle quelle,
// pour servir aussi à l'accueil « Aujourd'hui ».
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/lib/project-context";
import { usePageVisible } from "@/hooks/usePageVisible";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Zap, Plus, X } from "lucide-react";
import type { QuickCaptureEntry, MilestoneTrigger } from "@shared/schema";

const CLASSIFIED_TYPE_CONFIG: Record<string, { icon: string; label: string; colorClass: string; noteKey?: string }> = {
  task:               { icon: "✓",  label: "Task",    colorClass: "bg-naya-olive-10 text-naya-olive border-naya-olive-18" },
  idea:               { icon: "◆",  label: "Idea",    colorClass: "bg-[rgba(212,201,122,0.18)] text-[#6f6526] border-[rgba(212,201,122,0.35)]" },
  note:               { icon: "—",  label: "Note",    colorClass: "bg-naya-olive-06 text-naya-olive-70 border-naya-olive-10" },
  reminder:           { icon: "○",  label: "Reminder",colorClass: "bg-[rgba(212,201,122,0.12)] text-[#6f6526] border-[rgba(212,201,122,0.25)]" },
  unknown:            { icon: "?",  label: "Unknown", colorClass: "bg-naya-olive-06 text-naya-olive-55 border-naya-olive-10" },
  emotional_signal:   { icon: "♥",  label: "Heard",   colorClass: "bg-[rgba(158,126,135,0.18)] text-[#6e4b53] border-[rgba(158,126,135,0.35)]", noteKey: "nayaNotedEmotional" },
  behavioral_insight: { icon: "◈",  label: "Noted",   colorClass: "bg-[rgba(125,143,168,0.18)] text-[#46556d] border-[rgba(125,143,168,0.35)]", noteKey: "nayaLoggedPattern" },
  milestone_trigger:  { icon: "⬡",  label: "Trigger", colorClass: "bg-naya-olive-10 text-naya-olive border-naya-olive-18", noteKey: "nayaCreatedRule" },
};

// « carte » : le bloc complet du dashboard (champ + boîte de réception).
// « pilule » : le seul champ, discret, pour l'accueil ; la réception reste au dashboard.
export default function QuickCapture({ variante = "carte" }: { variante?: "carte" | "pilule" }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { activeProjectId } = useProject();
  const pageVisible = usePageVisible();
  const [content, setContent] = useState("");
  const [classifyingIds, setClassifyingIds] = useState<Set<number>>(new Set());
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set());

  const { data: entries = [] } = useQuery<QuickCaptureEntry[]>({
    queryKey: ["/api/capture"],
    // Une panne de la capture ne doit pas faire tomber la page qui l'héberge (l'accueil).
    throwOnError: false,
    // Poll rapide UNIQUEMENT tant qu'il reste des captures en cours de classification IA ;
    // sinon poll lent. ET en pause totale quand l'onglet n'est pas visible.
    refetchInterval: (q) => {
      if (!pageVisible) return false;
      const data = q.state.data as QuickCaptureEntry[] | undefined;
      const pending = Array.isArray(data) && data.some((e) => !e.classifiedType);
      return pending ? 4000 : 60000;
    },
  });

  const { data: milestoneTriggers = [] } = useQuery<MilestoneTrigger[]>({
    queryKey: ["/api/milestone-triggers"],
    refetchInterval: pageVisible ? 30000 : false, // en pause quand l'onglet n'est pas visible
    throwOnError: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { content: string; projectId?: number }) => {
      const res = await apiRequest("POST", "/api/capture", { ...data, captureType: "note" });
      return res.json();
    },
    onSuccess: (entry: QuickCaptureEntry) => {
      setContent("");
      setClassifyingIds(prev => new Set(prev).add(entry.id));
      queryClient.invalidateQueries({ queryKey: ["/api/capture"] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/capture"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        setClassifyingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; });
      }, 4500);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/capture/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/capture"] }),
  });

  const clearRoutedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/capture/clear-routed", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capture"] });
      toast({ title: t("dashboard.inboxCleared") });
    },
  });

  const handleSubmit = () => {
    if (!content.trim()) return;
    createMutation.mutate({
      content: content.trim(),
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
    });
  };

  const inboxEntries = entries.filter((e: any) => e.routingStatus !== "dismissed");
  const routedCount = inboxEntries.filter((e: any) => e.routingStatus === "routed").length;

  if (variante === "pilule") {
    return (
      <form
        className="space-y-2"
        onSubmit={e => { e.preventDefault(); handleSubmit(); }}
      >
        <div className="flex items-center gap-2 rounded-full bg-card p-1.5 pl-5 shadow-cocon focus-within:ring-2 focus-within:ring-ring">
          <input
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t("accueil.capture.placeholder")}
            aria-label={t("accueil.capture.placeholder")}
            // « ! » : les styles globaux des champs (index.css, hors couche Tailwind) l'emportent sinon.
            className="h-11 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 !font-[inherit] !text-[16px] text-foreground !shadow-none placeholder:text-muted-foreground placeholder:!opacity-100 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!content.trim() || createMutation.isPending}
            aria-label={t("accueil.capture.envoyer")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-150 disabled:opacity-40 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p aria-live="polite" className="min-h-[1.25rem] pl-5 text-[13px] text-muted-foreground">
          {classifyingIds.size > 0 ? t("accueil.capture.notee") : null}
        </p>
      </form>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
            <span className="font-display text-[11px] text-naya-olive-70">
              {t("dashboard.captureInbox")}
            </span>
            {inboxEntries.length > 0 && (
              <span className="font-display text-[9px] bg-naya-olive-10 text-naya-olive-55 px-1.5 py-0.5 rounded-pill">
                {inboxEntries.length}
              </span>
            )}
          </div>
          {routedCount > 0 && (
            <button
              onClick={() => clearRoutedMutation.mutate()}
              className="text-[10px] text-naya-olive-35 hover:text-naya-olive-70 transition-colors cursor-pointer"
            >
              {t("dashboard.clearRouted", { count: routedCount })}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t("dashboard.capturePlaceholder")}
            className="flex-1 min-h-[36px] max-h-[80px] text-sm resize-none py-1.5"
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!content.trim() || createMutation.isPending}
            className="self-start"
          >
            <Plus style={{ width: 14, height: 14 }} />
          </Button>
        </div>

        {inboxEntries.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {inboxEntries.slice(0, 8).map((entry: any) => {
              const isClassifying = classifyingIds.has(entry.id);
              const ct = entry.classifiedType;
              const config = ct ? CLASSIFIED_TYPE_CONFIG[ct] : undefined;
              const isRouted = entry.routingStatus === "routed";
              const isMilestone = ct === "milestone_trigger";
              const milestoneId = isMilestone && entry.routedTo?.startsWith("milestone:")
                ? parseInt(entry.routedTo.split(":")[1])
                : null;
              const linkedTrigger = milestoneId
                ? milestoneTriggers.find((t: MilestoneTrigger) => t.id === milestoneId)
                : null;
              type UnlockedTask = { title: string; estimatedDuration?: number };
              const tasksToUnlockList: UnlockedTask[] = linkedTrigger
                ? (linkedTrigger.tasksToUnlock as UnlockedTask[]) || []
                : [];
              const unlockCount = tasksToUnlockList.length;
              const isExpanded = expandedMilestones.has(entry.id);

              return (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 p-2 rounded-lg text-xs border transition-colors ${
                    isMilestone
                      ? "bg-naya-olive-10 border-naya-olive-18"
                      : isRouted
                        ? "bg-naya-olive-06 border-naya-olive-10"
                        : "bg-naya-olive-06 border-naya-olive-10"
                  }`}
                >
                  <span className="flex-shrink-0 mt-0.5 font-mono text-naya-olive-55">
                    {isClassifying ? "…" : config?.icon || "—"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-naya-olive-70 line-clamp-2">
                      {entry.aiSummary || entry.content}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {isClassifying ? (
                        <span className="text-[10px] text-naya-olive-35 italic">{t("dashboard.classifying")}</span>
                      ) : config ? (
                        <span className={`font-display text-[9px] px-1.5 py-0.5 rounded-pill border ${config.colorClass}`}>
                          {config.label}
                        </span>
                      ) : null}
                      {isMilestone && unlockCount > 0 && (
                        <>
                          <span className="font-display text-[9px] px-1.5 py-0.5 rounded-pill bg-naya-olive-10 text-naya-olive border border-naya-olive-18">
                            {t("dashboard.tasksWillUnlock", { count: unlockCount })}
                          </span>
                          <button
                            onClick={() => setExpandedMilestones(prev => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            })}
                            className="text-[10px] text-naya-olive hover:underline font-medium cursor-pointer"
                          >
                            {isExpanded ? t("dashboard.hideTasks") : t("dashboard.viewTasks")}
                          </button>
                        </>
                      )}
                      {isRouted && !isMilestone && (
                        <span className="text-[10px] text-naya-olive-55">{t("dashboard.addedToBoard")}</span>
                      )}
                    </div>
                    {isMilestone && isExpanded && tasksToUnlockList.length > 0 && (
                      <div className="mt-1.5 pl-1 space-y-1 border-l border-naya-olive-18 ml-1">
                        {tasksToUnlockList.map((task, idx) => (
                          <div key={idx} className="text-[10px] text-naya-olive-55 flex items-start gap-1">
                            <span className="text-naya-olive-35 mt-0.5">·</span>
                            <div>
                              <span className="font-medium text-naya-olive-70">{task.title}</span>
                              {task.estimatedDuration && (
                                <span className="text-naya-olive-35 ml-1">({t("common.dureeMin", { n: task.estimatedDuration })})</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {config?.noteKey && !isMilestone && !isRouted && (
                      <p className="text-[10px] text-naya-olive-35 italic mt-0.5">{t(`dashboard.${config.noteKey}`)}</p>
                    )}
                    {isMilestone && config?.noteKey && (
                      <p className="text-[10px] text-naya-olive-35 italic mt-0.5">{t(`dashboard.${config.noteKey}`)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(entry.id)}
                    className="text-naya-olive-18 hover:text-naya-olive-55 flex-shrink-0 mt-0.5 transition-colors cursor-pointer"
                    title={t("common.dismiss")}
                  >
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
