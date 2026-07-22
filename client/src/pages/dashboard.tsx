import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/lib/project-context";
import { usePageVisible } from "@/hooks/usePageVisible";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { formatLocalDate } from "@/lib/dateUtils";
import Sidebar from "@/components/sidebar";
import TodaysTasks from "@/components/todays-tasks";
import SchedulePreview from "@/components/schedule-preview";
import MilestoneChain from "@/components/milestone-chain";
import { StuckTasksCard } from "@/components/StuckTasksCard";
import PlanningStartBanner from "@/components/PlanningStartBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Zap, ArrowRight, Brain, User, Users, Plus, X, Sparkles, Activity, PauseCircle, PlayCircle, Gauge, StickyNote,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Project, ProjectGoal, PersonaAnalysisResult, TargetPersona, QuickCaptureEntry, MilestoneTrigger } from "@shared/schema";
import { Link, useLocation } from "wouter";

interface DashboardProps {
  onSearchClick?: () => void;
}

const SUCCESS_MODE_COLORS: Record<string, string> = {
  revenue:     "bg-[rgba(212,201,122,0.18)] text-[#6f6526] border-[rgba(212,201,122,0.35)]",
  visibility:  "bg-[rgba(125,143,168,0.18)] text-[#46556d] border-[rgba(125,143,168,0.35)]",
  consistency: "bg-naya-olive-10 text-naya-olive border-naya-olive-18",
  exploration: "bg-[rgba(158,126,135,0.18)] text-[#6e4b53] border-[rgba(158,126,135,0.35)]",
  learning:    "bg-[rgba(125,143,168,0.18)] text-[#46556d] border-[rgba(125,143,168,0.35)]",
  wellbeing:   "bg-[rgba(158,126,135,0.18)] text-[#6e4b53] border-[rgba(158,126,135,0.35)]",
};

const PERSONA_ICONS: Record<string, string> = {
  Strategist:           "◆",
  Builder:              "▶",
  "Creative Marketer":  "◇",
  "Analytical Thinker": "—",
};

const SELF_CARE_OPTIONS = [
  { id: "meditation",  labelKey: "selfCareOptions.meditation",  promptKey: "selfCareOptions.meditationPrompt"  },
  { id: "focus-music", labelKey: "selfCareOptions.focusMusic",  promptKey: "selfCareOptions.focusMusicPrompt"  },
  { id: "breathing",   labelKey: "selfCareOptions.breathing",   promptKey: "selfCareOptions.breathingPrompt"   },
  { id: "journal",     labelKey: "selfCareOptions.journal",     promptKey: "selfCareOptions.journalPrompt"     },
];

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

// Popover LÉGER « Dis à Naya où tu en es » accessible en 1 clic depuis chaque carte projet,
// sans naviguer vers la vue projet. Édite le seul champ statusNote (contexte non tracké par
// l'app) et sauvegarde via PATCH. L'icône est REMPLIE si une note existe déjà, VIDE sinon.
function StatusNotePopover({ projectId, initialNote }: { projectId: number; initialNote: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const seedRef = useRef(initialNote);
  seedRef.current = initialNote; // dernière valeur serveur, lue sans re-déclencher l'effet de seed
  // #3 — Re-seed du brouillon UNIQUEMENT à l'ouverture (jamais pendant que le popover est ouvert) :
  // un refetch en arrière-plan ne peut donc pas écraser la saisie en cours.
  useEffect(() => { if (open) setNote(seedRef.current); }, [open]);
  const hasNote = (initialNote || "").trim().length > 0;
  const dirty = note !== initialNote; // modifié localement mais pas encore persisté

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/projects/${projectId}`, { statusNote: note }),
    onSuccess: () => {
      toast({ title: "Enregistré", description: "Naya en tiendra compte pour ce projet." });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "full"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects?limit=200"] });
      setOpen(false); // #1 — on ne ferme QU'au succès : un PATCH échoué garde le popover ouvert, brouillon intact
    },
    onError: () => toast({ title: "Échec de l'enregistrement — ta note est conservée", variant: "destructive" }),
  });

  // Abandon : le clic-dehors / Échap (via onOpenChange={setOpen}) ET « Annuler » ferment SANS
  // sauvegarder. Le brouillon local est perdu (re-seedé depuis le serveur à la prochaine ouverture).
  // Seul le bouton « Enregistrer » déclenche le PATCH.
  const handleCancel = () => { setNote(initialNote); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={hasNote ? "Note pour Naya (remplie) — modifier" : "Dis à Naya où tu en es"}
          aria-label="Dis à Naya où tu en es"
          className={`flex-shrink-0 transition-colors ${hasNote ? "text-naya-olive hover:text-naya-olive-70" : "text-naya-olive-35 hover:text-naya-olive"}`}
        >
          <StickyNote className="h-3.5 w-3.5" fill={hasNote ? "currentColor" : "none"} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-naya-olive" />
          <h4 className="text-sm font-medium text-foreground">Dis à Naya où tu en es</h4>
          {dirty && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[#6f6526]" title="Modifications non enregistrées">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4c97a]" />
              non enregistré
            </span>
          )}
        </div>
        <p className="text-[11px] text-naya-olive-55 leading-relaxed">
          Naya connaît déjà tout ce que tu fais <strong>dans</strong> l'app (tâches, contenus, campagnes).
          Note ici seulement ce qu'elle ne peut pas deviner : un événement externe, une décision, un blocage.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex : j'ai signé un client hors Naya ; le lancement est repoussé à octobre…"
          rows={4}
          className="text-sm resize-none"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7 text-xs">Annuler</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="h-7 text-xs">
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActiveProjectBand({ projectId, compact = false, overcommitted = false }: { projectId: number; compact?: boolean; overcommitted?: boolean }) {
  const [, navigate] = useLocation();
  const { data: project } = useQuery<Project & { goals: ProjectGoal[] }>({
    queryKey: [`/api/projects/${projectId}`],
  });

  const activeGoals = (project as any)?.goals?.filter((g: ProjectGoal) => g.status === "active") || [];
  const topGoal = activeGoals[0] as ProjectGoal | undefined;

  if (!project) return null;

  // Signal de surcharge SOBRE (jamais rouge/alerte). Traitement différencié par catégorie :
  //  · revenu  → indicateur AMBRÉ visible mais non bloquant (liseré + badge « Planning chargé »)
  //  · passion → ton plus DOUX (texte grisé « planning chargé »), pas de liseré ni d'icône
  // Catégorie non renseignée → traité comme passion (le moins présomptueux). Seuil = 1.25 uniforme.
  const isRevenue = project.category === "revenue";
  const showAmber = overcommitted && isRevenue;
  const showSoft  = overcommitted && !isRevenue;

  const daysLeft = topGoal?.dueDate
    ? Math.ceil((new Date(topGoal.dueDate as any).getTime() - Date.now()) / 86400000)
    : null;

  const progressPct = topGoal?.targetValue && topGoal?.currentValue
    ? Math.min(100, (parseFloat(topGoal.currentValue) / parseFloat(topGoal.targetValue)) * 100)
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/${project.id}`); } }}
      className={`bg-card border border-naya-olive-18 rounded-lg p-4 shadow-rest cursor-pointer hover:border-naya-olive-35 transition-colors ${compact ? "" : "mb-6"}`}
      style={showAmber ? { borderLeft: "3px solid rgba(212,201,122,0.75)" } : undefined}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: project.color || "#2B2D1C" }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-display uppercase tracking-xwide text-[11px] text-foreground truncate">{project.name}</span>
              {(project as any).projectKind === "client" && (
                <span
                  className="flex-shrink-0 text-[9px] font-display uppercase tracking-xwide px-1.5 py-0.5 rounded border border-[rgba(125,143,168,0.45)] bg-[rgba(125,143,168,0.18)] text-[#354963]"
                  title="Projet client"
                >
                  💼 Client
                </span>
              )}
              {topGoal?.successMode && (
                <Badge className={`text-[9px] border ${SUCCESS_MODE_COLORS[topGoal.successMode] || "bg-naya-olive-06 text-naya-olive-55"}`}>
                  {topGoal.successMode}
                </Badge>
              )}
              {showAmber && (
                <span
                  className="flex items-center gap-1 flex-shrink-0 text-[9px] font-display uppercase tracking-xwide px-1.5 py-0.5 rounded border border-[rgba(212,201,122,0.55)] bg-[rgba(212,201,122,0.18)] text-[#6f6526]"
                  title="Ce projet dépasse son budget de tâches du jour"
                >
                  <Gauge className="h-3 w-3" />
                  Planning chargé
                </span>
              )}
              {showSoft && (
                <span className="flex-shrink-0 text-[10px] text-naya-olive-35 italic" title="Journée bien remplie sur ce projet">
                  planning chargé
                </span>
              )}
            </div>
            {(project as any).projectKind === "client" && (project as any).clientName && (
              <span className="block text-[10px] text-naya-olive-55 truncate" title="Client">{(project as any).clientName}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {daysLeft !== null && daysLeft >= 0 && (
            <span className={`font-display uppercase tracking-xwide text-[9px] ${
              daysLeft <= 7 ? "text-[#6f6526]" : daysLeft <= 14 ? "text-[#6e4b53]" : "text-naya-olive-55"
            }`}>
              {daysLeft}j
            </span>
          )}
          <StatusNotePopover projectId={project.id} initialNote={(project as any).statusNote ?? ""} />
        </div>
      </div>
      {topGoal ? (
        <>
          <p className="text-sm text-foreground mb-2">{topGoal.title}</p>
          {progressPct !== null ? (
            <div>
              <Progress value={progressPct} className="h-[2px]" />
              <p className="text-[10px] text-naya-olive-55 mt-1">{topGoal.currentValue} / {topGoal.targetValue}</p>
            </div>
          ) : (
            <Progress value={0} className="h-[2px] opacity-20" />
          )}
        </>
      ) : (
        <Link href="/projects" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-naya-olive-55 hover:text-foreground transition-colors cursor-pointer border-b border-naya-olive-18 hover:border-naya-olive pb-px">
            Aucun objectif actif — en ajouter un
          </span>
        </Link>
      )}
    </div>
  );
}

function AllProjectsBand() {
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });
  const today = formatLocalDate(new Date());
  // Statut de surcharge PAR PROJET (seuil dérivé du budget/jour du projet, multiplicateur 1.25).
  const { data: overcommit = [] } = useQuery<Array<{ projectId: number; overcommitted: boolean }>>({
    queryKey: ["/api/projects/overcommit", today],
    queryFn: async () => { const r = await apiRequest("GET", `/api/projects/overcommit?clientToday=${today}`); return r.json(); },
  });
  const overcommitById = new Map(overcommit.map(o => [o.projectId, o.overcommitted]));
  const [kindFilter, setKindFilter] = useState<"all" | "client" | "personal">("all");

  const active = projects.filter(p => p.projectStatus === "active");
  if (active.length === 0) return null;

  // Le toggle n'apparaît que s'il y a au moins un projet client (sinon inutile → board plus propre).
  const hasClient = active.some(p => (p as any).projectKind === "client");
  const filtered = active.filter(p => {
    if (kindFilter === "all") return true;
    const kind = (p as any).projectKind === "client" ? "client" : "personal";
    return kind === kindFilter;
  });

  return (
    <div className="mb-6">
      {hasClient && (
        <div className="flex items-center gap-1 mb-3">
          {([["all", "Tous"], ["client", "Clients"], ["personal", "Personnels"]] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setKindFilter(val)}
              className={`text-[10px] font-display uppercase tracking-xwide px-2.5 py-1 rounded-full border transition-colors ${
                kindFilter === val
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "bg-naya-olive-06 text-naya-olive-55 border-naya-olive-18 hover:bg-naya-olive-10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="text-xs text-naya-olive-35 italic">Aucun projet {kindFilter === "client" ? "client" : "personnel"}.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.slice(0, 4).map(p => (
            <ActiveProjectBand key={p.id} projectId={p.id} compact overcommitted={overcommitById.get(p.id) ?? false} />
          ))}
        </div>
      )}
    </div>
  );
}

function AIRecommendations({ projectId }: { projectId: number | null }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });

  const singleProjectQuery = useQuery<any>({
    queryKey: ["/api/projects", projectId, "recommendations"],
    queryFn: () => apiRequest("POST", `/api/projects/${projectId}/recommendations`, {}),
    enabled: !!projectId,
    staleTime: 300000,
  });

  const allProjectsRecs = useQuery<any>({
    queryKey: ["/api/projects", "all", "recommendations"],
    queryFn: async () => {
      const active = projects.filter(p => p.projectStatus === "active").slice(0, 3);
      const results = await Promise.allSettled(
        active.map(p => apiRequest("POST", `/api/projects/${p.id}/recommendations`, {}).then(r => r.json()))
      );
      const merged: any[] = [];
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value?.recommendations) {
          merged.push(...r.value.recommendations.slice(0, 1).map((rec: any) => ({
            ...rec,
            projectName: r.value.projectName,
          })));
        }
      });
      return { recommendations: merged };
    },
    enabled: !projectId && projects.length > 0,
    staleTime: 300000,
  });

  const query = projectId ? singleProjectQuery : allProjectsRecs;
  const recs = query.data?.recommendations || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
          <span className="font-display uppercase tracking-xwide text-[11px] text-naya-olive-70">
            {t("dashboard.aiRecommendations")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-14 bg-naya-olive-06 rounded animate-pulse" />
            ))}
          </div>
        ) : recs.length === 0 ? (
          <p className="text-sm text-naya-olive-55 text-center py-4">
            {projects.length === 0 ? t("dashboard.createProjectForRecs") : t("dashboard.noRecommendationsNow")}
          </p>
        ) : (
          <div className="space-y-2">
            {recs.map((rec: any, i: number) => (
              <div key={i} className="p-3 bg-naya-olive-06 rounded-lg">
                <p className="text-xs font-medium text-foreground">{rec.title}</p>
                {rec.projectName && !projectId && (
                  <p className="text-[10px] text-naya-olive-55 mt-0.5">{rec.projectName}</p>
                )}
                <p className="text-xs text-naya-olive-55 mt-1 line-clamp-2">{rec.description}</p>
                {rec.action && (
                  <p className="text-xs text-naya-olive font-medium mt-1.5 flex items-center gap-1">
                    <ArrowRight style={{ width: 10, height: 10 }} />
                    {rec.action}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickCapture() {
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
            <span className="font-display uppercase tracking-xwide text-[11px] text-naya-olive-70">
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
                        <span className={`font-display uppercase tracking-xwide text-[9px] px-1.5 py-0.5 rounded-pill border ${config.colorClass}`}>
                          {config.label}
                        </span>
                      ) : null}
                      {isMilestone && unlockCount > 0 && (
                        <>
                          <span className="font-display uppercase tracking-xwide text-[9px] px-1.5 py-0.5 rounded-pill bg-naya-olive-10 text-naya-olive border border-naya-olive-18">
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
                                <span className="text-naya-olive-35 ml-1">({task.estimatedDuration}min)</span>
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
                    title="Dismiss"
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

function SelfCareBlock() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem("naya_selfcare") || null);

  const toggleOption = (id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    if (next) localStorage.setItem("naya_selfcare", next);
    else localStorage.removeItem("naya_selfcare");
  };

  const activeOption = SELF_CARE_OPTIONS.find(o => o.id === selected);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
          <span className="font-display uppercase tracking-xwide text-[11px] text-naya-olive-70">
            {t("dashboard.selfCare")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {SELF_CARE_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              className={`font-display uppercase tracking-xwide text-[9px] py-2 px-3 rounded-sm border transition-colors text-left cursor-pointer ${
                selected === option.id
                  ? "border-naya-olive bg-naya-olive text-naya-cream"
                  : "border-naya-olive-18 text-naya-olive-55 hover:border-naya-olive-35 hover:text-naya-olive"
              }`}
            >
              {t(`dashboard.${option.labelKey}`)}
            </button>
          ))}
        </div>
        {activeOption && (
          <p className="text-xs text-naya-olive-70 italic bg-naya-olive-06 p-3 rounded-lg leading-relaxed">
            {t(`dashboard.${activeOption.promptKey}`)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PersonaCard() {
  const { t } = useTranslation();
  const { activeProjectId } = useProject();
  const [addPersonaOpen, setAddPersonaOpen] = useState(false);
  const [personaDescription, setPersonaDescription] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: personaResult } = useQuery<PersonaAnalysisResult | null>({
    queryKey: ["/api/persona/my-persona"],
  });

  const { data: targetPersonas = [] } = useQuery<TargetPersona[]>({
    queryKey: ["/api/persona/target-personas", activeProjectId],
    queryFn: () => {
      const url = activeProjectId
        ? `/api/persona/target-personas?projectId=${activeProjectId}`
        : "/api/persona/target-personas";
      return fetch(url, { credentials: "include" }).then(r => r.json());
    },
  });

  const analyzeTargetMutation = useMutation({
    mutationFn: (data: { description: string; projectId?: number }) =>
      apiRequest("POST", "/api/persona/analyze-target", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/persona/target-personas"] });
      setAddPersonaOpen(false);
      setPersonaDescription("");
      toast({ title: "Persona cible analysé" });
    },
    onError: () => toast({ title: "Erreur lors de l'analyse", variant: "destructive" }),
  });

  const analysisResult = personaResult?.analysisResult as any;
  const personaName = analysisResult?.personaName as string | undefined;
  const outputStyle = analysisResult?.outputStyleGuidelines as string | undefined;
  const primaryTarget = targetPersonas[0] as TargetPersona | undefined;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Brain style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
            <span className="font-display uppercase tracking-xwide text-[11px] text-naya-olive-70">
              {t("dashboard.operatingProfile")}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {personaName ? (
            <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
              <div className="flex items-center gap-1.5 mb-1">
                <User style={{ width: 11, height: 11, strokeWidth: 1.5 }} className="text-naya-olive-55" />
                <span className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55">
                  Ton archétype
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">
                {PERSONA_ICONS[personaName] || "◈"} {personaName}
              </p>
              {outputStyle && (
                <p className="text-xs text-naya-olive-55 mt-1 line-clamp-2">{outputStyle}</p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
              <p className="text-xs text-naya-olive-55">
                Complète l'onboarding pour détecter ton archétype.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Users style={{ width: 11, height: 11, strokeWidth: 1.5 }} className="text-naya-olive-55" />
                <span className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55">
                  {activeProjectId ? "Persona cible" : "Mes personas"}
                </span>
              </div>
              {activeProjectId && (
                <button
                  onClick={() => setAddPersonaOpen(true)}
                  className="text-[10px] text-naya-olive-55 hover:text-naya-olive transition-colors flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus style={{ width: 10, height: 10 }} /> Ajouter
                </button>
              )}
            </div>

            {primaryTarget ? (
              <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
                <p className="text-sm font-medium text-foreground">{primaryTarget.name}</p>
                {primaryTarget.jobTitle && (
                  <p className="text-xs text-naya-olive-55">
                    {primaryTarget.jobTitle}{primaryTarget.industry ? ` · ${primaryTarget.industry}` : ""}
                  </p>
                )}
                {primaryTarget.decisionTriggers && primaryTarget.decisionTriggers.length > 0 && (
                  <div className="mt-2">
                    <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55 mb-1">
                      Déclencheur de décision
                    </p>
                    <p className="text-xs text-naya-olive-70">{primaryTarget.decisionTriggers[0]}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10 text-center">
                <p className="text-xs text-naya-olive-55">
                  {activeProjectId ? "Aucun persona cible." : "Sélectionne un projet pour voir son persona."}
                </p>
                {activeProjectId && (
                  <button
                    onClick={() => setAddPersonaOpen(true)}
                    className="text-xs text-naya-olive hover:underline mt-1 cursor-pointer"
                  >
                    Décrire ton audience idéale
                  </button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={addPersonaOpen} onOpenChange={setAddPersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Décris ton persona cible</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-naya-olive-55">
            Décris la personne précise que tu cherches à atteindre — son rôle, son secteur, ses défis et ses aspirations. Naya va l'analyser en profil structuré.
          </p>
          <Textarea
            value={personaDescription}
            onChange={e => setPersonaDescription(e.target.value)}
            placeholder="Ex : Directrice marketing dans une PME B2B, 35 ans, cherche à démontrer le ROI de son budget contenu..."
            rows={5}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setAddPersonaOpen(false)}>Annuler</Button>
            <Button
              onClick={() => analyzeTargetMutation.mutate({
                description: personaDescription,
                ...(activeProjectId ? { projectId: activeProjectId } : {}),
              })}
              disabled={!personaDescription.trim() || analyzeTargetMutation.isPending}
            >
              {analyzeTargetMutation.isPending ? "Analyse…" : "Analyser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const today = formatLocalDate(time);
  const dayName = time.toLocaleDateString("fr-FR", { weekday: "long" });
  const dateStr = time.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const timeStr = time.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="text-right">
      <p className="font-display uppercase tracking-xwide text-[10px] text-naya-olive-55">
        {dayName} {dateStr}
      </p>
      <p className="font-display text-[10px] text-naya-olive-35">{timeStr}</p>
    </div>
  );
}

function ProjectSetupBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("naya_project_banner_dismissed") === "1"
  );
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });

  if (dismissed || projects.length === 0) return null;
  const hasEditedProject = projects.some(p => p.description && p.description.length > 0);
  if (hasEditedProject) return null;

  return (
    <div className="bg-naya-olive-06 border border-naya-olive-18 rounded-lg p-4 mb-4 flex items-center justify-between">
      <div>
        <p className="font-display uppercase tracking-xwide text-[11px] text-foreground mb-1">
          Premier projet créé depuis l'onboarding
        </p>
        <p className="text-xs text-naya-olive-55">
          Affine-le pour que Naya puisse te donner de meilleures recommandations.
        </p>
      </div>
      <div className="flex items-center gap-2 ml-4">
        <Link href="/projects">
          <Button size="sm" variant="secondary">
            Voir le projet
          </Button>
        </Link>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem("naya_project_banner_dismissed", "1");
          }}
          className="p-1 text-naya-olive-35 hover:text-naya-olive-55 cursor-pointer transition-colors"
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  );
}

// « Dis à Naya où tu en es » + réglages du projet (catégorie / budget temps / priorité).
// La note de statut sert UNIQUEMENT au contexte non tracké par l'app (Naya connaît déjà
// les tâches faites, contenus, campagnes…). Tout est injecté dans le contexte IA du projet.
function ProjectStatusNote({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "full"],
    queryFn: async () => { const r = await apiRequest("GET", `/api/projects/${projectId}`); return r.json(); },
  });

  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [priority, setPriority] = useState("secondary");
  const [projectKind, setProjectKind] = useState<"personal" | "client">("personal");
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [clientBrief, setClientBrief] = useState("");

  useEffect(() => {
    if (!project) return;
    setNote(project.statusNote ?? "");
    setCategory(project.category ?? "");
    setBudget(project.dailyTimeBudgetHours != null ? String(project.dailyTimeBudgetHours) : "");
    setPriority(project.priorityLevel ?? "secondary");
    setProjectKind(project.projectKind === "client" ? "client" : "personal");
    setClientName(project.clientName ?? "");
    setClientContact(project.clientContact ?? "");
    setClientBrief(project.clientBrief ?? "");
  }, [project?.id, project?.statusNote, project?.category, project?.dailyTimeBudgetHours, project?.priorityLevel, project?.projectKind, project?.clientName, project?.clientContact, project?.clientBrief]);

  const save = useMutation({
    mutationFn: async () => {
      const budgetNum = budget.trim() === "" ? null : Math.max(0, parseInt(budget, 10) || 0);
      const isClient = projectKind === "client";
      return apiRequest("PATCH", `/api/projects/${projectId}`, {
        statusNote: note,
        category: category || null,
        dailyTimeBudgetHours: budgetNum,
        priorityLevel: priority,
        projectKind,
        // kind='personal' → on efface les métadonnées client (null) ; kind='client' → on les persiste.
        clientName: isClient ? (clientName.trim() || null) : null,
        clientContact: isClient ? (clientContact.trim() || null) : null,
        clientBrief: isClient ? (clientBrief.trim() || null) : null,
      });
    },
    onSuccess: () => {
      toast({ title: "Enregistré", description: "Naya en tiendra compte pour ce projet." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "full"] });
    },
    onError: () => toast({ title: "Échec de l'enregistrement", variant: "destructive" }),
  });

  const fieldCls = "w-full px-2 py-1.5 text-sm rounded-lg border border-naya-olive-18 bg-white text-naya-olive-70";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-naya-olive" />
          <h3 className="text-sm font-medium text-foreground">Dis à Naya où tu en es</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-naya-olive-55">
          Tout ce que tu fais <strong>dans</strong> Naya (tâches faites, contenus, campagnes…) est déjà connu —
          inutile de le réécrire. Note ici seulement ce que l'app ne peut pas savoir : un événement externe,
          une décision, un blocage, un changement de contexte.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex : j'ai signé un nouveau client hors Naya ; le lancement est repoussé à octobre…"
          rows={4}
          className="text-sm"
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Catégorie</label>
            <select className={fieldCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              <option value="revenue">Revenu</option>
              <option value="passion">Passion</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Heures/jour</label>
            <input type="number" min={0} max={16} className={fieldCls} value={budget}
              onChange={(e) => setBudget(e.target.value)} placeholder="ex : 4" />
          </div>
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Priorité</label>
            <select className={fieldCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="primary">Principale</option>
              <option value="secondary">Secondaire</option>
              <option value="background">En fond</option>
            </select>
          </div>
        </div>
        {/* Nature du projet : perso vs client + métadonnées client conditionnelles. */}
        <div className="space-y-2 pt-1 border-t border-naya-olive-10">
          <div>
            <label className="text-[11px] text-naya-olive-55 block mb-1">Nature du projet</label>
            <select className={fieldCls} value={projectKind} onChange={(e) => setProjectKind(e.target.value === "client" ? "client" : "personal")}>
              <option value="personal">🙂 Projet personnel</option>
              <option value="client">💼 Projet client</option>
            </select>
          </div>
          {projectKind === "client" && (
            <div className="space-y-2 rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-2.5">
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Nom du client</label>
                <input className={fieldCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ex : Acme SARL" />
              </div>
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Contact (optionnel)</label>
                <input className={fieldCls} value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="Nom · email · téléphone" />
              </div>
              <div>
                <label className="text-[11px] text-naya-olive-55 block mb-1">Brief (optionnel)</label>
                <textarea className={fieldCls} rows={2} value={clientBrief} onChange={(e) => setClientBrief(e.target.value)} placeholder="Contexte, objectifs, contraintes…" />
              </div>
            </div>
          )}
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
  );
}

// Section « Non planifiées » : tâches en retard (scheduled_date < aujourd'hui, non complétées,
// non archivées) qui n'apparaissent plus nulle part. Surface PASSIVE + 2 actions par tâche.
// Invisible s'il n'y a aucune tâche orpheline.
function OverdueTasks() {
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

export default function Dashboard({ onSearchClick }: DashboardProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { activeProjectId, isAllProjects } = useProject();

  const { data: brandDna, isLoading: brandDnaLoading } = useQuery({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const { data: preferences } = useQuery<any>({
    queryKey: ["/api/preferences"],
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/planning/pause").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      toast({ title: t("planning.pausedTitle"), description: t("planning.pausedDesc") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/planning/resume").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      toast({ title: t("planning.resumedTitle"), description: t("planning.resumedDesc") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Session expirée",
        description: "Reconnexion en cours…",
        variant: "destructive",
      });
      setTimeout(() => { window.location.href = "/"; }, 500); // "/" = Landing (login). /api/login servait le SPA → page 404 si encore authentifié.
    }
  }, [isAuthenticated, isLoading, toast]);

  useEffect(() => {
    if (!brandDnaLoading && !brandDna) {
      window.location.href = "/onboarding";
    }
  }, [brandDna, brandDnaLoading]);

  const greeting = () => {
    const h = new Date().getHours();
    const lang = i18n.language;
    if (lang === "fr") {
      if (h < 12) return "Bonjour";
      if (h < 18) return "Bon après-midi";
      return "Bonsoir";
    }
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const firstName = (() => {
    const u = user as any;
    return u?.firstName || u?.name?.split(" ")[0] || u?.email?.split("@")[0] || "";
  })();

  if (isLoading || brandDnaLoading) {
    return (
      <div className="min-h-screen naya-paper flex items-center justify-center">
        <div className="text-center">
          <img
            src="/naya-mark-elephant.png"
            alt="Naya"
            className="w-10 h-10 object-contain mx-auto mb-4 opacity-60"
          />
          <p className="font-display uppercase tracking-xwide text-[11px] text-naya-olive-55">
            Chargement…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--background)" }}>
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header
          className="px-6 py-4 flex-shrink-0 border-b"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display uppercase tracking-xwide text-[10px] text-naya-olive-55 mb-1">
                {isAllProjects
                  ? "Tous les projets"
                  : activeProject
                    ? activeProject.name
                    : "Pilot Board"}
              </p>
              <h1 className="font-display uppercase tracking-xwide text-xl font-light text-foreground">
                {greeting()}{firstName ? `, ${firstName}` : ""}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {preferences?.planningStatus === "paused" ? (
                <button
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="flex items-center gap-1.5 text-[10px] font-display uppercase tracking-xwide text-naya-olive-55 hover:text-naya-olive transition-colors"
                  title={t("planning.resume")}
                >
                  <PlayCircle style={{ width: 14, height: 14 }} />
                  <span className="hidden sm:inline">{t("planning.resume")}</span>
                </button>
              ) : (
                <button
                  onClick={() => pauseMutation.mutate()}
                  disabled={pauseMutation.isPending}
                  className="flex items-center gap-1.5 text-[10px] font-display uppercase tracking-xwide text-naya-olive-35 hover:text-naya-olive-55 transition-colors"
                  title={t("planning.pause")}
                >
                  <PauseCircle style={{ width: 14, height: 14 }} />
                  <span className="hidden sm:inline">{t("planning.pause")}</span>
                </button>
              )}
              <LiveClock />
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6" style={{ background: "var(--background)" }}>
          <div className="max-w-6xl mx-auto">
            {/* Banners */}
            <PlanningStartBanner />
            <ProjectSetupBanner />

            {/* Tâches en retard jamais planifiées — section distincte, masquée si vide */}
            <OverdueTasks />

            {/* Project band */}
            {isAllProjects
              ? <AllProjectsBand />
              : activeProjectId
                ? <ActiveProjectBand projectId={activeProjectId} />
                : null}

            {/* Grid layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left column — tasks */}
              <div className="lg:col-span-2 space-y-6">
                <TodaysTasks />
                <StuckTasksCard onOpenCompanion={() => window.dispatchEvent(new CustomEvent('naya:open-companion'))} />
                <SchedulePreview />
              </div>

              {/* Right column — widgets */}
              <div className="space-y-4">
                {activeProjectId && <ProjectStatusNote projectId={activeProjectId} />}
                <QuickCapture />
                {activeProjectId && (
                  <MilestoneChain
                    projectId={activeProjectId}
                    projectName={activeProject?.name}
                  />
                )}
                <AIRecommendations projectId={activeProjectId} />
                <PersonaCard />
                <SelfCareBlock />
              </div>
            </div>
          </div>
        </main>
      </div>

    </div>
  );
}
