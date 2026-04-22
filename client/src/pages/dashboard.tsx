import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/lib/project-context";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import { NayaCompanionBar } from "@/components/NayaCompanion";
import MilestoneChain from "@/components/milestone-chain";
import TodaysTasks from "@/components/todays-tasks";
import { StuckTasksCard } from "@/components/StuckTasksCard";
import PlanningStartBanner from "@/components/PlanningStartBanner";
import SchedulePreview from "@/components/schedule-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Zap, ArrowRight, Clock,
  Brain, User, Users, Plus, CheckCircle2, X,
  Sparkles, Activity, AlertTriangle,
  Loader2, Dna, ExternalLink, Copy, Save, ChevronRight,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Project, ProjectGoal, PersonaAnalysisResult, TargetPersona, QuickCaptureEntry, MilestoneTrigger, UserOperatingProfile } from "@shared/schema";
import { Link, useLocation } from "wouter";
import { formatLocalDate } from "@/lib/dateUtils";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";

interface DashboardProps {
  onSearchClick?: () => void;
}

const CAPTURE_TYPES = ["task", "note", "idea", "reminder"] as const;

const SUCCESS_MODE_COLORS: Record<string, string> = {
  revenue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  visibility: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  consistency: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  exploration: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  learning: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  wellbeing: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
};

const PERSONA_ICONS: Record<string, string> = {
  Strategist: "🧭",
  Builder: "⚡",
  "Creative Marketer": "🎨",
  "Analytical Thinker": "📊",
};

function useSelfCareOptions() {
  const { t } = useTranslation();
  return [
    { id: "meditation", label: t('dashboard.selfCareOptions.meditation'), prompt: t('dashboard.selfCareOptions.meditationPrompt') },
    { id: "focus-music", label: t('dashboard.selfCareOptions.focusMusic'), prompt: t('dashboard.selfCareOptions.focusMusicPrompt') },
    { id: "breathing", label: t('dashboard.selfCareOptions.breathing'), prompt: t('dashboard.selfCareOptions.breathingPrompt') },
    { id: "journal", label: t('dashboard.selfCareOptions.journal'), prompt: t('dashboard.selfCareOptions.journalPrompt') },
  ];
}

const ENERGY_LEVELS = [
  { value: 'high',     label: 'High',     symbol: '⚡', color: '', activeRing: '' },
  { value: 'medium',   label: 'Medium',   symbol: '○',  color: '', activeRing: '' },
  { value: 'low',      label: 'Low',      symbol: '↓',  color: '', activeRing: '' },
  { value: 'depleted', label: 'Depleted', symbol: '✕',  color: '', activeRing: '' },
] as const;

function ActiveProjectBand({ projectId, compact = false }: { projectId: number; compact?: boolean }) {
  const [brandDnaOpen, setBrandDnaOpen] = useState(false);

  const { data: project } = useQuery<Project & { goals: ProjectGoal[] }>({
    queryKey: [`/api/projects/${projectId}`],
  });

  const { data: brandDna } = useQuery<any>({
    queryKey: ['/api/projects', projectId, 'brand-dna'],
    queryFn: () => fetch(`/api/projects/${projectId}/brand-dna`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!projectId,
  });

  const activeGoals = (project as any)?.goals?.filter((g: ProjectGoal) => g.status === 'active') || [];
  const topGoal = activeGoals[0] as ProjectGoal | undefined;

  if (!project) return null;

  const hasProjectSpecificDna = brandDna?.projectId === projectId;

  const daysLeft = topGoal?.dueDate
    ? Math.ceil((new Date(topGoal.dueDate as any).getTime() - Date.now()) / 86400000)
    : null;

  const progressPct = topGoal?.targetValue && topGoal?.currentValue
    ? Math.min(100, (parseFloat(topGoal.currentValue) / parseFloat(topGoal.targetValue)) * 100)
    : null;

  return (
    <div className={`bg-white dark:bg-card border border-border rounded-2xl p-4 shadow-card ${compact ? '' : 'mb-6'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: project.color || '#6366f1' }} />
          <span className="text-sm text-slate-900 dark:text-white">{project.icon || '📁'} {project.name}</span>
          {topGoal?.successMode && (
            <Badge className={`text-xs border-0 ${SUCCESS_MODE_COLORS[topGoal.successMode] || 'bg-slate-100 text-slate-600'}`}>
              {topGoal.successMode}
            </Badge>
          )}
        </div>
        {daysLeft !== null && daysLeft >= 0 && (
          <span className={`text-xs ${daysLeft <= 7 ? 'text-red-500' : daysLeft <= 14 ? 'text-yellow-500' : 'text-slate-500 dark:text-gray-400'}`}>
            {daysLeft}d left
          </span>
        )}
      </div>
      {topGoal ? (
        <>
          <p className="text-sm text-slate-700 dark:text-gray-300 mb-2">{topGoal.title}</p>
          {progressPct !== null && (
            <div>
              <Progress value={progressPct} className="h-1.5" />
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{topGoal.currentValue} / {topGoal.targetValue}</p>
            </div>
          )}
          {progressPct === null && (
            <Progress value={0} className="h-1.5 opacity-30" />
          )}
        </>
      ) : (
        <Link href="/projects">
          <a className="text-xs text-primary hover:underline">No active goals — add one</a>
        </Link>
      )}

      {!hasProjectSpecificDna && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-gray-800">
          <button
            onClick={() => setBrandDnaOpen(true)}
            className="w-full flex items-center gap-2 text-xs text-[hsl(150,20%,45%)] dark:text-[hsl(150,20%,60%)] hover:text-[hsl(150,20%,35%)] dark:hover:text-[hsl(150,20%,70%)] transition-colors"
          >
            <Dna className="h-3.5 w-3.5" />
            <span>Configure Brand DNA for AI-powered planning aligned with {project.name}'s goals</span>
            <ArrowRight className="h-3 w-3 ml-auto" />
          </button>
        </div>
      )}

      {project && <BrandDnaDialog project={project} open={brandDnaOpen} onOpenChange={setBrandDnaOpen} />}
    </div>
  );
}

function AllProjectsBand() {
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const active = projects.filter(p => p.projectStatus === 'active');

  if (active.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      {active.slice(0, 4).map(p => (
        <ActiveProjectBand key={p.id} projectId={p.id} compact />
      ))}
    </div>
  );
}

function AIRecommendations({ projectId }: { projectId: number | null }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const singleProjectQuery = useQuery<any>({
    queryKey: ['/api/projects', projectId, 'recommendations'],
    queryFn: () => apiRequest('POST', `/api/projects/${projectId}/recommendations`, {}),
    enabled: !!projectId,
    staleTime: 300000,
  });

  const allProjectsRecs = useQuery<any>({
    queryKey: ['/api/projects', 'all', 'recommendations'],
    queryFn: async () => {
      const active = projects.filter(p => p.projectStatus === 'active').slice(0, 3);
      const results = await Promise.allSettled(
        active.map(p => apiRequest('POST', `/api/projects/${p.id}/recommendations`, {}).then(r => r.json()))
      );
      const merged: any[] = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value?.recommendations) {
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

  const TYPE_ICONS: Record<string, string> = {
    deadline: "⏰",
    action: "⚡",
    setup: "🔧",
    momentum: "🚀",
    behavioral: "🧠",
    blocker: "🚧",
    energy: "⚡",
    optimization: "📈"
  };

  return (
    <Card className="shadow-card border-border bg-white dark:bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t('dashboard.aiRecommendations')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-1.5">
            {[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : recs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-gray-400 text-center py-4">
            {projects.length === 0 ? t('dashboard.createProjectForRecs') : t('dashboard.noRecommendationsNow')}
          </p>
        ) : (
          <TooltipProvider>
            <div className="space-y-1">
              {recs.map((rec: any, i: number) => (
                <div key={i}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors text-left"
                      >
                        <span className="text-xs flex-shrink-0">{TYPE_ICONS[rec.type] || "💡"}</span>
                        <span className="text-xs text-slate-900 dark:text-white truncate flex-1">{rec.title}</span>
                        {rec.projectName && !projectId && (
                          <span className="text-[10px] text-primary flex-shrink-0">{rec.projectName}</span>
                        )}
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 flex-shrink-0">{rec.type || "tip"}</Badge>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-64">
                      <p className="text-xs">{rec.description}</p>
                    </TooltipContent>
                  </Tooltip>
                  {expandedIdx === i && rec.description && (
                    <div className="ml-6 mr-2 mb-1 px-2 py-1.5 bg-slate-50 dark:bg-gray-800 rounded text-xs text-slate-600 dark:text-gray-400 space-y-1.5">
                      <p>{rec.description}</p>
                      {rec.insight && (
                        <p className="text-slate-500 dark:text-gray-500 italic text-[11px] flex items-start gap-1">
                          <span className="flex-shrink-0">💡</span>
                          <span>{rec.insight}</span>
                        </p>
                      )}
                      {rec.basedOn && (
                        <p className="text-slate-400 dark:text-gray-600 text-[10px] flex items-start gap-1">
                          <span className="flex-shrink-0">📊</span>
                          <span>Based on: {rec.basedOn}</span>
                        </p>
                      )}
                      {rec.action && (
                        <p className="text-primary mt-1 flex items-center gap-1">
                          <ArrowRight className="h-3 w-3" />
                          {rec.action}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

const CLASSIFIED_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string; note?: string }> = {
  task:               { icon: '✅', label: 'Task',     color: 'bg-primary/10 text-primary border-primary/20' },
  idea:               { icon: '💡', label: 'Idea',     color: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300' },
  note:               { icon: '📝', label: 'Note',     color: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300' },
  reminder:           { icon: '🔔', label: 'Reminder', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300' },
  unknown:            { icon: '❓', label: 'Unknown',  color: 'bg-slate-100 text-slate-500 border-slate-200' },
  emotional_signal:   { icon: '💜', label: 'Heard',    color: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300', note: "Naya noted this. It'll shape how your tasks are framed." },
  behavioral_insight: { icon: '🧠', label: 'Noted',    color: 'bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300', note: "Naya has logged this pattern about how you work." },
  milestone_trigger:  { icon: '🎯', label: 'Trigger',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300', note: "Naya created a conditional rule. Tasks will unlock when the condition is met." },
};

function QuickCapture() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { activeProjectId } = useProject();
  const [content, setContent] = useState("");
  const [classifyingIds, setClassifyingIds] = useState<Set<number>>(new Set());
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set());

  const { data: entries = [] } = useQuery<QuickCaptureEntry[]>({
    queryKey: ['/api/capture'],
    refetchInterval: 4000,
  });

  const { data: milestoneTriggers = [] } = useQuery<MilestoneTrigger[]>({
    queryKey: ['/api/milestone-triggers'],
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { content: string; projectId?: number }) => {
      const res = await apiRequest('POST', '/api/capture', { ...data, captureType: 'note' });
      return res.json();
    },
    onSuccess: (entry: QuickCaptureEntry) => {
      setContent("");
      setClassifyingIds(prev => new Set(prev).add(entry.id));
      queryClient.invalidateQueries({ queryKey: ['/api/capture'] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/capture'] });
        queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
        setClassifyingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; });
      }, 4500);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/capture/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/capture'] }),
  });

  const clearRoutedMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/capture/clear-routed', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/capture'] });
      toast({ title: "Inbox cleared" });
    },
  });

  const [savedToMemoryIds, setSavedToMemoryIds] = useState<Set<number>>(new Set());
  const saveToMemoryMutation = useMutation({
    mutationFn: async ({ content, sourceEntryId, classifiedType }: { content: string; sourceEntryId: number; classifiedType?: string }) => {
      const memType = classifiedType && ['decision', 'lesson'].includes(classifiedType) ? classifiedType : 'observation';
      const res = await apiRequest('POST', '/api/memory', { type: memType, content, sourceEntryId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      setSavedToMemoryIds(prev => new Set(prev).add(vars.sourceEntryId));
      queryClient.invalidateQueries({ queryKey: ['/api/memory'] });
      toast({ title: "Saved to memory" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!content.trim()) return;
    createMutation.mutate({
      content: content.trim(),
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
    });
  };

  const inboxEntries = entries.filter((e: any) => e.routingStatus !== 'dismissed');
  const routedCount = inboxEntries.filter((e: any) => e.routingStatus === 'routed').length;

  return (
    <Card className="shadow-card border-border bg-white dark:bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            {t('dashboard.captureInbox')}
            {inboxEntries.length > 0 && (
              <span className="text-[10px] font-normal bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                {inboxEntries.length}
              </span>
            )}
          </CardTitle>
          {routedCount > 0 && (
            <button
              onClick={() => clearRoutedMutation.mutate()}
              className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 transition-colors"
            >
              {t('dashboard.clearRouted', { count: routedCount })}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t('dashboard.capturePlaceholder')}
            className="flex-1 min-h-[36px] max-h-[80px] text-sm resize-none py-1.5"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
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
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {inboxEntries.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {inboxEntries.slice(0, 8).map((entry: any) => {
              const isClassifying = classifyingIds.has(entry.id);
              const ct = entry.classifiedType;
              const config = ct ? CLASSIFIED_TYPE_CONFIG[ct] : undefined;
              const isRouted = entry.routingStatus === 'routed';
              const taskId = isRouted && entry.routedTo?.startsWith('task:')
                ? parseInt(entry.routedTo.split(':')[1])
                : null;
              const isMilestone = ct === 'milestone_trigger';
              const milestoneId = isMilestone && entry.routedTo?.startsWith('milestone:')
                ? parseInt(entry.routedTo.split(':')[1])
                : null;
              const linkedTrigger = milestoneId
                ? milestoneTriggers.find((t: MilestoneTrigger) => t.id === milestoneId)
                : null;
              type UnlockedTask = { title: string; description: string; type?: string; category?: string; priority?: number; estimatedDuration?: number; taskEnergyType?: string };
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
                      ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
                      : isRouted
                        ? 'bg-primary/5 border-primary/20 dark:bg-primary/10'
                        : 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700'
                  }`}
                >
                  <span className="flex-shrink-0 mt-0.5">
                    {isClassifying ? '⏳' : config?.icon || '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-700 dark:text-gray-300 line-clamp-2">
                      {entry.aiSummary || entry.content}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {isClassifying ? (
                        <span className="text-[10px] text-slate-400 italic">{t('dashboard.classifying')}</span>
                      ) : config ? (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${config.color}`}>
                          {config.icon} {config.label}
                        </span>
                      ) : null}
                      {isMilestone && unlockCount > 0 && (
                        <>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            {t('dashboard.tasksWillUnlock', { count: unlockCount })}
                          </span>
                          <button
                            onClick={() => setExpandedMilestones(prev => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            })}
                            className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline"
                          >
                            {isExpanded ? t('dashboard.hideTasks') : t('dashboard.viewTasks')}
                          </button>
                        </>
                      )}
                      {!isClassifying && !isMilestone && !isRouted && !savedToMemoryIds.has(entry.id) && (!ct || ct === 'decision' || ct === 'lesson') && (
                        <button
                          onClick={() => saveToMemoryMutation.mutate({
                            content: entry.aiSummary || entry.content,
                            sourceEntryId: entry.id,
                            classifiedType: ct || undefined,
                          })}
                          disabled={saveToMemoryMutation.isPending}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          {t('dashboard.saveToMemory')}
                        </button>
                      )}
                      {savedToMemoryIds.has(entry.id) && (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{t('dashboard.savedToMemory')}</span>
                      )}
                      {isRouted && !isMilestone && (
                        <span className="text-[10px] text-primary">{t('dashboard.addedToBoard')}</span>
                      )}
                    </div>
                    {isMilestone && isExpanded && tasksToUnlockList.length > 0 && (
                      <div className="mt-1.5 pl-1 space-y-1 border-l-2 border-emerald-200 dark:border-emerald-800 ml-1">
                        {tasksToUnlockList.map((task, idx) => (
                          <div key={idx} className="text-[10px] text-slate-600 dark:text-gray-400 flex items-start gap-1">
                            <span className="text-emerald-500 mt-0.5">•</span>
                            <div>
                              <span className="font-medium">{task.title}</span>
                              {task.estimatedDuration && (
                                <span className="text-slate-400 dark:text-gray-500 ml-1">({task.estimatedDuration}min)</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {config?.note && !isMilestone && !isRouted && (
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 italic mt-0.5">{config.note}</p>
                    )}
                    {isMilestone && config?.note && (
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 italic mt-0.5">{config.note}</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(entry.id)}
                    className="text-slate-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 flex-shrink-0 mt-0.5 transition-colors"
                    title="Dismiss"
                  >
                    <X className="h-3 w-3" />
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
  const SELF_CARE_OPTIONS = useSelfCareOptions();
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('naya_selfcare') || null);

  const toggleOption = (id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    if (next) localStorage.setItem('naya_selfcare', next);
    else localStorage.removeItem('naya_selfcare');
  };

  const activeOption = SELF_CARE_OPTIONS.find(o => o.id === selected);

  return (
    <Card className="dark:bg-gray-900 dark:border-gray-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Activity className="h-4 w-4 text-teal-500" />
          Take a moment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {SELF_CARE_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              className={`text-xs py-2 px-3 rounded-lg border transition-colors text-left ${
                selected === option.id
                  ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                  : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:border-teal-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {activeOption && (
          <p className="text-xs text-slate-600 dark:text-gray-400 italic bg-slate-50 dark:bg-gray-800 p-2.5 rounded-lg">
            {activeOption.prompt}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PersonaCard() {
  const { activeProjectId } = useProject();
  const [addPersonaOpen, setAddPersonaOpen] = useState(false);
  const [personaDescription, setPersonaDescription] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: personaResult } = useQuery<PersonaAnalysisResult | null>({
    queryKey: ['/api/persona/my-persona'],
  });

  const { data: targetPersonas = [] } = useQuery<TargetPersona[]>({
    queryKey: ['/api/persona/target-personas', activeProjectId],
    queryFn: () => {
      const url = activeProjectId
        ? `/api/persona/target-personas?projectId=${activeProjectId}`
        : '/api/persona/target-personas';
      return fetch(url, { credentials: 'include' }).then(r => r.json());
    },
  });

  const analyzeTargetMutation = useMutation({
    mutationFn: (data: { description: string; projectId?: number }) =>
      apiRequest('POST', '/api/persona/analyze-target', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/persona/target-personas'] });
      setAddPersonaOpen(false);
      setPersonaDescription("");
      toast({ title: "Target persona analyzed!" });
    },
    onError: () => toast({ title: "Failed to analyze persona", variant: "destructive" }),
  });

  const analysisResult = personaResult?.analysisResult as any;
  const personaName = analysisResult?.personaName as string | undefined;
  const outputStyle = analysisResult?.outputStyleGuidelines as string | undefined;
  const primaryTarget = targetPersonas[0] as TargetPersona | undefined;

  return (
    <>
      <Card className="shadow-card border-border bg-white dark:bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Persona Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {personaName ? (
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                <span className="text-xs text-purple-700 dark:text-purple-300">Your Archetype</span>
              </div>
              <p className="text-sm text-slate-900 dark:text-white">
                {PERSONA_ICONS[personaName] || "🧠"} {personaName}
              </p>
              {outputStyle && (
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 line-clamp-2">{outputStyle}</p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-slate-50 dark:bg-gray-800 rounded-lg">
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Complete onboarding to detect your persona archetype.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-xs text-slate-700 dark:text-gray-300">
                  {activeProjectId ? "Target Persona" : "My Target Personas"}
                </span>
              </div>
              {activeProjectId && (
                <button
                  onClick={() => setAddPersonaOpen(true)}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              )}
            </div>

            {primaryTarget ? (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-slate-900 dark:text-white">{primaryTarget.name}</p>
                {primaryTarget.jobTitle && (
                  <p className="text-xs text-slate-500 dark:text-gray-400">{primaryTarget.jobTitle}{primaryTarget.industry ? ` · ${primaryTarget.industry}` : ''}</p>
                )}
                {primaryTarget.decisionTriggers && primaryTarget.decisionTriggers.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-1">Decision Trigger</p>
                    <p className="text-xs text-slate-700 dark:text-gray-300">{primaryTarget.decisionTriggers[0]}</p>
                  </div>
                )}
                {primaryTarget.persuasionDrivers && primaryTarget.persuasionDrivers.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-1">What moves them</p>
                    <p className="text-xs text-slate-700 dark:text-gray-300">{primaryTarget.persuasionDrivers[0]}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-slate-50 dark:bg-gray-800 rounded-lg text-center">
                <p className="text-xs text-slate-400 dark:text-gray-500">
                  {activeProjectId ? "No target persona yet." : "Select a project to see its target persona."}
                </p>
                {activeProjectId && (
                  <button
                    onClick={() => setAddPersonaOpen(true)}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Describe your ideal audience member
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
            <DialogTitle>Describe Your Target Persona</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 dark:text-gray-400">
            Write a plain description of the specific person you're trying to reach — their role, industry, challenges, and aspirations. Naya will analyze it into a structured persona profile.
          </p>
          <Textarea
            value={personaDescription}
            onChange={e => setPersonaDescription(e.target.value)}
            placeholder="e.g. A 35-year-old marketing director at a B2B SaaS company with 50-200 employees. She struggles to prove ROI on content marketing and is looking for tools that make reporting faster..."
            rows={5}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setAddPersonaOpen(false)}>Cancel</Button>
            <Button
              onClick={() => analyzeTargetMutation.mutate({
                description: personaDescription,
                ...(activeProjectId ? { projectId: activeProjectId } : {}),
              })}
              disabled={!personaDescription.trim() || analyzeTargetMutation.isPending}
            >
              {analyzeTargetMutation.isPending ? "Analyzing..." : "Analyze Persona"}
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
  const dayName = time.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = time.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="text-right text-xs text-slate-500 dark:text-gray-400">
      <p className="font-medium">{dayName}, {dateStr}</p>
      <p>{timeStr}</p>
    </div>
  );
}

// ─── État vide : aucune tâche planifiée ──────────────────────────────────────

function EmptyTasksState({ onGenerated }: { onGenerated: () => void }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auto-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => { onGenerated(); }, 1200);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center gap-3 relative z-10">
      {done ? (
        <div className="flex items-center gap-2">
          <span className="text-emerald-300 text-sm font-semibold">✓ Tâches générées !</span>
        </div>
      ) : (
        <>
          <p
            style={{
              fontFamily: '"Cormorant Garamond", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '0.9375rem',
              color: 'var(--primary-foreground)',
              opacity: 0.7,
              margin: 0,
            }}
          >
            Aucune tâche planifiée aujourd'hui
          </p>
          <button
            onClick={generate}
            disabled={loading}
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.5625rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 400,
              color: 'var(--primary)',
              background: 'var(--primary-foreground)',
              border: 'none',
              padding: '5px 12px',
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Génération…' : '◆ Générer mes tâches'}
          </button>
          <p
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.5625rem',
              fontWeight: 300,
              color: 'var(--primary-foreground)',
              opacity: 0.35,
            }}
          >
            Naya va analyser tes projets et objectifs
          </p>
        </>
      )}
    </div>
  );
}

function BentoTileNextAction() {
  const { activeProjectId } = useProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const { data: todayTasks = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/today', activeProjectId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      let url = `/api/tasks/range?start=${today}&end=${today}`;
      if (activeProjectId) url += `&projectId=${activeProjectId}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: number) => apiRequest('PATCH', `/api/tasks/${taskId}`, { completed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today', activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setStarted(false);
      setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
      toast({ title: "✅ Tâche terminée !" });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err?.message || "Impossible de compléter la tâche", variant: "destructive" });
    },
  });

  const pending = (Array.isArray(todayTasks) ? todayTasks : [])
    .filter((t: any) => !t.completed && !t.isBlockedByMilestone)
    .sort((a, b) => {
      const aMin = a.scheduledTime ? parseInt(a.scheduledTime.replace(':', '')) : 9999;
      const bMin = b.scheduledTime ? parseInt(b.scheduledTime.replace(':', '')) : 9999;
      return aMin - bMin;
    });

  const next = pending[0] || null;
  const remaining = pending.length;
  const safeTasks = Array.isArray(todayTasks) ? todayTasks : [];
  const done = safeTasks.filter((t: any) => t.completed).length;
  const total = safeTasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const ENERGY_EMOJI: Record<string, string> = {
    deep_work: '🎯', creative: '✨', admin: '📋', social: '💬', logistics: '📦', execution: '⚡',
  };

  // Timer
  useEffect(() => {
    if (started) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [started]);

  // Reset timer when task changes
  useEffect(() => {
    setStarted(false);
    setElapsed(0);
  }, [next?.id]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div
      className="p-5 flex flex-col h-full min-h-[140px] relative overflow-hidden"
      style={{
        background: 'var(--primary)',
        border: '1px solid rgba(139,127,168,0.3)',
        borderRadius: 12,
        boxShadow: '0 4px 16px rgba(139,127,168,0.2)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.5625rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 400,
            color: 'var(--primary-foreground)',
            opacity: 0.6,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Zap style={{ width: 10, height: 10 }} />
          Maintenant
        </span>
        {total > 0 && (
          <span
            style={{
              fontFamily: '"Cormorant Garamond", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '0.875rem',
              fontWeight: 400,
              color: 'var(--primary-foreground)',
              opacity: 0.5,
            }}
          >
            {done}/{total}
          </span>
        )}
      </div>

      {next ? (
        <div className="flex-1 flex flex-col justify-between min-h-0">
          <button
            onClick={() => setWorkspaceOpen(true)}
            className="text-left w-full"
          >
            <div className="flex items-start gap-2 mb-1">
              <p
                style={{
                  fontFamily: '"Cormorant Garamond", Georgia, serif',
                  fontStyle: 'italic',
                  fontWeight: 500,
                  fontSize: '1.1rem',
                  lineHeight: 1.2,
                  color: 'var(--primary-foreground)',
                  margin: 0,
                  flex: 1,
                  letterSpacing: '-0.01em',
                  textTransform: 'uppercase',
                }}
              >
                {next.title}
              </p>
              <ChevronRight
                style={{ width: 14, height: 14, color: 'var(--primary-foreground)', opacity: 0.4, flexShrink: 0, marginTop: 3 }}
              />
            </div>
            {next.activationPrompt && (
              <p
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.6875rem',
                  fontWeight: 300,
                  color: 'var(--primary-foreground)',
                  opacity: 0.5,
                  lineHeight: 1.5,
                  marginTop: 6,
                  fontStyle: 'normal',
                }}
              >
                {next.activationPrompt}
              </p>
            )}
          </button>

          <div className="flex items-center gap-2 mt-3">
            {started ? (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.8125rem',
                  fontWeight: 400,
                  color: 'var(--primary-foreground)',
                }}
              >
                {formatElapsed(elapsed)}
              </span>
            ) : next.estimatedDuration ? (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.6125rem',
                  fontWeight: 300,
                  color: 'var(--primary-foreground)',
                  opacity: 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <Clock style={{ width: 10, height: 10 }} />{next.estimatedDuration}m
              </span>
            ) : null}
            {remaining > 1 && !started && (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.5625rem',
                  fontWeight: 300,
                  color: 'var(--primary-foreground)',
                  opacity: 0.4,
                }}
              >
                +{remaining - 1} après
              </span>
            )}
            <div className="flex-1" />
            {started ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setStarted(false); }}
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '0.5625rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 400,
                    color: 'var(--primary-foreground)',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    padding: '4px 10px',
                    cursor: 'pointer',
                  }}
                >
                  ⏸
                </button>
                <button
                  onClick={() => completeMutation.mutate(next.id)}
                  disabled={completeMutation.isPending}
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '0.5625rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 400,
                    color: 'var(--primary)',
                    background: 'var(--primary-foreground)',
                    border: 'none',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <CheckCircle2 style={{ width: 10, height: 10 }} /> Terminé
                </button>
              </div>
            ) : (
              <button
                onClick={() => setStarted(true)}
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.5625rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 400,
                  color: 'var(--primary)',
                  background: 'var(--primary-foreground)',
                  border: 'none',
                  padding: '5px 14px',
                  cursor: 'pointer',
                  transition: 'opacity 120ms ease',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
              >
                Commencer →
              </button>
            )}
          </div>

          {!started && pct > 0 && (
            <div
              style={{
                height: 1,
                background: 'rgba(255,255,255,0.15)',
                marginTop: 10,
                overflow: 'hidden',
              }}
            >
              <div style={{ height: '100%', background: 'var(--accent)', width: `${pct}%`, transition: 'width 300ms ease' }} />
            </div>
          )}
        </div>
      ) : total === 0 ? (
        <EmptyTasksState onGenerated={() => queryClient.invalidateQueries({ queryKey: ['/api/tasks/today', activeProjectId] })} />
      ) : (
        <div className="flex-1 flex flex-col justify-center gap-1">
          <p
            style={{
              fontFamily: '"Cormorant Garamond", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '1rem',
              color: 'var(--primary-foreground)',
              margin: 0,
            }}
          >
            {t('dashboard.allDone')}
          </p>
          <p
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.625rem',
              fontWeight: 300,
              color: 'var(--primary-foreground)',
              opacity: 0.5,
            }}
          >
            {t('dashboard.tasksCompletedCount', { count: done })}
          </p>
        </div>
      )}

      {/* Espace de travail — Sheet */}
      {next && (
        <TaskWorkspaceSheet
          task={next}
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          started={started}
          elapsed={elapsed}
          formatElapsed={formatElapsed}
          onStart={() => setStarted(true)}
          onPause={() => setStarted(false)}
          onComplete={() => completeMutation.mutate(next.id)}
          isCompleting={completeMutation.isPending}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/tasks/today', activeProjectId] });
            queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Espace de travail d'une tâche ────────────────────────────────────────────

// Détecte si le titre/description suggère une tâche de rédaction
function detectWritingTask(task: any): boolean {
  const keywords = ["write", "draft", "rédige", "rédiger", "post", "article", "contenu", "texte", "message", "email"];
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  return keywords.some(k => text.includes(k));
}

// Déduit le label de la zone de production depuis le titre/type
function inferProductionLabel(task: any): { label: string; placeholder: string } {
  const title = task.title.toLowerCase();
  if (title.includes("post") || title.includes("linkedin") || title.includes("article"))
    return { label: "Ton post", placeholder: "Rédige ton post ici…" };
  if (title.includes("email") || title.includes("mail"))
    return { label: "Ton email", placeholder: "Rédige ton email ici…" };
  if (title.includes("message"))
    return { label: "Ton message", placeholder: "Rédige ton message ici…" };
  if (title.includes("script") || title.includes("texte") || title.includes("contenu"))
    return { label: "Ton contenu", placeholder: "Rédige ton contenu ici…" };
  return { label: "Ta production", placeholder: "Ce que tu produis, rédiges ou décides ici…" };
}

const WORKSPACE_CONFIG: Record<string, { icon: string; title: string }> = {
  post_publish:     { icon: "📣", title: "Post à publier" },
  linkedin_message: { icon: "💬", title: "Message LinkedIn" },
  email:            { icon: "✉️", title: "Email" },
  canva_task:       { icon: "🎨", title: "Visuel Canva" },
  outreach_action:  { icon: "🎯", title: "Action de prospection" },
  generic:          { icon: "✏️", title: "Tâche" },
};

function TaskWorkspaceSheet({
  task, open, onClose,
  started, elapsed, formatElapsed,
  onStart, onPause, onComplete, isCompleting, onSaved,
}: {
  task: any;
  open: boolean;
  onClose: () => void;
  started: boolean;
  elapsed: number;
  formatElapsed: (s: number) => string;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  isCompleting: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const actionData = task.actionData || {};
  const type = task.taskType || "generic";
  const cfg = WORKSPACE_CONFIG[type] || WORKSPACE_CONFIG.generic;
  const isWritingTask = detectWritingTask(task);
  const { label: productionLabel, placeholder: productionPlaceholder } = inferProductionLabel(task);

  // Contenu produit : uniquement depuis actionData (jamais depuis description)
  const [content, setContent] = useState<string>(
    actionData.postContent || actionData.message || actionData.content || ""
  );
  const [subject, setSubject] = useState<string>(actionData.subject || "");

  // Reset uniquement si la tâche change
  useEffect(() => {
    setContent(actionData.postContent || actionData.message || actionData.content || "");
    setSubject(actionData.subject || "");
  }, [task.id]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const updatedActionData: any = { ...actionData };
      if (type === "post_publish") updatedActionData.postContent = content;
      else if (type === "linkedin_message") updatedActionData.message = content;
      else if (type === "email") { updatedActionData.message = content; updatedActionData.subject = subject; }
      else updatedActionData.content = content; // generic, outreach, canva notes
      return apiRequest('PATCH', `/api/tasks/${task.id}`, { actionData: updatedActionData });
    },
    onSuccess: () => {
      toast({ title: "Sauvegardé ✓", description: "Le contenu est enregistré dans ta tâche." });
      onSaved();
    },
    onError: () => toast({ title: "Erreur lors de la sauvegarde", variant: "destructive" }),
  });

  const handleComplete = () => {
    saveMutation.mutate(undefined, {
      onSettled: () => { onComplete(); onClose(); }
    });
  };

  const charCount = content.length;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0">

        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <span>{cfg.icon}</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{cfg.title}</span>
          </div>
          <SheetTitle className="text-base font-bold leading-snug text-foreground">
            {task.title}
          </SheetTitle>

          {/* Timer */}
          <div className="flex items-center gap-2 mt-3">
            {started ? (
              <>
                <span className="text-sm font-mono font-bold text-indigo-600 dark:text-indigo-400 tabular-nums bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-lg">
                  {formatElapsed(elapsed)}
                </span>
                <button onClick={onPause} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold transition-colors">
                  ⏸ Pause
                </button>
              </>
            ) : (
              <button onClick={onStart} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors flex items-center gap-1.5">
                <Zap className="h-3 w-3" /> Commencer le chrono
              </button>
            )}
            {task.estimatedDuration && !started && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />{task.estimatedDuration}min
              </span>
            )}
          </div>
        </SheetHeader>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Brief Naya — toujours en lecture seule, jamais dans l'éditeur */}
          {task.description && (
            <details className="group" open={!content}>
              <summary className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none list-none">
                <Sparkles className="h-3 w-3 text-indigo-400" />
                Brief Naya
                <span className="ml-auto text-[10px] font-normal normal-case group-open:hidden">Afficher</span>
                <span className="ml-auto text-[10px] font-normal normal-case hidden group-open:block">Réduire</span>
              </summary>
              <div className="mt-2 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-3.5 text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
                {task.description}
              </div>
            </details>
          )}

          {/* ── ZONE DE PRODUCTION ── */}

          {/* Post */}
          {type === "post_publish" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Ton post {actionData.platform && <span className="font-normal text-muted-foreground">({actionData.platform})</span>}</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{charCount} car.</span>
              </div>
              <Textarea value={content} onChange={e => setContent(e.target.value)}
                className="min-h-[280px] text-sm leading-relaxed resize-none" placeholder="Rédige ton post ici…" />
              {content && <button onClick={() => { navigator.clipboard.writeText(content); toast({ title: "Copié !" }); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"><Copy className="h-3 w-3" /> Copier</button>}
            </div>
          )}

          {/* LinkedIn message */}
          {type === "linkedin_message" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Ton message {actionData.leadName && <span className="font-normal text-muted-foreground">→ {actionData.leadName}</span>}</Label>
                <span className={`text-xs font-mono tabular-nums ${charCount > 200 ? "text-red-500" : "text-muted-foreground"}`}>{charCount}/300</span>
              </div>
              <Textarea value={content} onChange={e => setContent(e.target.value)}
                className="min-h-[180px] text-sm leading-relaxed resize-none" placeholder="Rédige ou modifie ton message…" />
              {content && <button onClick={() => { navigator.clipboard.writeText(content); toast({ title: "Copié !" }); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"><Copy className="h-3 w-3" /> Copier</button>}
            </div>
          )}

          {/* Email */}
          {type === "email" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Objet</Label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Objet de l'email…" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Corps</Label>
                <Textarea value={content} onChange={e => setContent(e.target.value)}
                  className="min-h-[220px] text-sm leading-relaxed resize-none" placeholder="Rédige ton email…" />
              </div>
              {content && <button onClick={() => { navigator.clipboard.writeText(`Objet : ${subject}\n\n${content}`); toast({ title: "Copié !" }); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"><Copy className="h-3 w-3" /> Copier</button>}
            </div>
          )}

          {/* Canva */}
          {type === "canva_task" && (
            <div className="space-y-4">
              {actionData.canvaBrief && (
                <div className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 rounded-xl p-3.5 text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
                  {actionData.canvaBrief}
                </div>
              )}
              <a href={actionData.externalUrl || "https://www.canva.com/design/new"} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7c3aed] text-white font-semibold transition-colors">
                <ExternalLink className="h-4 w-4" /> Ouvrir Canva
              </a>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Notes sur le visuel réalisé</Label>
                <Textarea value={content} onChange={e => setContent(e.target.value)}
                  className="min-h-[120px] text-sm resize-none" placeholder="Lien Canva, ajustements, décisions de design…" />
              </div>
            </div>
          )}

          {/* Generic / outreach — avec détection rédaction */}
          {(type === "outreach_action" || type === "generic") && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">{isWritingTask ? productionLabel : "Notes de réalisation"}</Label>
                {isWritingTask && <span className="text-xs text-muted-foreground tabular-nums">{charCount} car.</span>}
              </div>
              <Textarea value={content} onChange={e => setContent(e.target.value)}
                className={`text-sm leading-relaxed resize-none ${isWritingTask ? "min-h-[300px]" : "min-h-[180px]"}`}
                placeholder={isWritingTask ? productionPlaceholder : "Ce que tu as fait, les résultats, les blocages…"} />
              {isWritingTask && content && (
                <button onClick={() => { navigator.clipboard.writeText(content); toast({ title: "Copié !" }); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
                  <Copy className="h-3 w-3" /> Copier
                </button>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-border flex-shrink-0 bg-background">
          <Button variant="outline" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Sauvegarder
          </Button>
          <Button size="sm" onClick={handleComplete} disabled={isCompleting || saveMutation.isPending}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white ml-auto">
            {isCompleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Marquer terminé
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BentoTileWeekPulse() {
  const { activeProjectId } = useProject();
  const { t } = useTranslation();
  const mon = (() => {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().split('T')[0];
  })();
  const sun = (() => { const d = new Date(mon); d.setDate(d.getDate() + 6); return d.toISOString().split('T')[0]; })();

  const { data: weekTasks = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/range', mon, sun, activeProjectId, 'pulse'],
    queryFn: async () => {
      let url = `/api/tasks/range?start=${mon}&end=${sun}`;
      if (activeProjectId) url += `&projectId=${activeProjectId}`;
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const tasks = weekTasks as any[];
  const done = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-border shadow-card p-5 flex flex-col h-full min-h-[140px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-label text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-emerald-500" />
          Cette semaine
        </span>
        <span className="text-stat" style={{ fontSize: '1.5rem', color: pct >= 75 ? 'var(--accent)' : 'var(--muted-foreground)' }}>
          {pct}<span className="text-base font-medium opacity-60">%</span>
        </span>
      </div>
      <div className="flex gap-1.5 flex-1 items-end mb-2">
        {days.map((day, i) => {
          const d = new Date(mon); d.setDate(d.getDate() + i);
          const key = d.toISOString().split('T')[0];
          const dayTasks = tasks.filter(t => t.scheduledDate === key);
          const dayDone = dayTasks.filter(t => t.completed).length;
          const barPct = dayTasks.length > 0 ? dayDone / dayTasks.length : 0;
          const isToday = i === todayIdx;
          const isPast = i < todayIdx;
          return (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full bg-muted rounded-md overflow-hidden flex flex-col justify-end" style={{ height: '40px' }}>
                <div
                  style={{
                    width: '100%',
                    transition: 'all 300ms ease',
                    height: `${Math.max(barPct * 100, dayTasks.length > 0 ? 12 : 0)}%`,
                    background: isToday
                      ? 'var(--primary)'
                      : isPast
                        ? 'var(--accent)'
                        : 'var(--muted-foreground)',
                    opacity: isPast && barPct === 0 ? 0.3 : 1,
                  }}
                />
              </div>
              <span className={`text-[10px] font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{day}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('dashboard.tasksCompletedFraction', { done, total })}</p>
    </div>
  );
}

function BentoTileMyState() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { triggerAutoRebalance } = useAutoRebalance();
  const [pendingLevel, setPendingLevel] = useState<string | null>(null);
  const [contextText, setContextText] = useState("");

  const { data: personaResult } = useQuery<PersonaAnalysisResult | null>({
    queryKey: ['/api/persona/my-persona'],
  });
  const { data: opProfile } = useQuery<UserOperatingProfile | null>({
    queryKey: ['/api/me/operating-profile'],
  });
  const { data: energyData } = useQuery<{ energyLevel: string; emotionalContext: string | null; updatedDate: string | null }>({
    queryKey: ['/api/user/energy'],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { energyLevel: string; emotionalContext?: string }) => {
      const res = await apiRequest('PATCH', '/api/user/energy', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/energy'] });
      toast({ title: "Energy updated", description: "Your tasks will adapt to your energy level." });
      setPendingLevel(null);
      setContextText("");
      triggerAutoRebalance();
    },
  });

  const personaName = (personaResult?.analysisResult as any)?.personaName as string | undefined;
  const avoidance = (opProfile?.avoidanceTriggers as string[] | undefined)?.[0];
  const currentLevel = energyData?.energyLevel || 'high';
  const showContextPrompt = pendingLevel === 'low' || pendingLevel === 'depleted';

  return (
    <div className="bg-white dark:bg-card rounded-2xl border border-border shadow-card p-5 flex flex-col h-full min-h-[130px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-label text-muted-foreground">Mon état</span>
        </div>
        {personaName && (
          <span className="text-xs font-medium text-muted-foreground">
            {PERSONA_ICONS[personaName] || "🧠"} {personaName}
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col justify-between min-h-0">
        <div className="grid grid-cols-2 gap-1.5">
          {ENERGY_LEVELS.map((level) => {
            const isActive = (pendingLevel || currentLevel) === level.value;
            return (
              <button
                key={level.value}
                onClick={() => {
                  if (level.value === 'low' || level.value === 'depleted') {
                    setPendingLevel(level.value);
                  } else {
                    setPendingLevel(null);
                    setContextText("");
                    updateMutation.mutate({ energyLevel: level.value });
                  }
                }}
                disabled={updateMutation.isPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '6px 8px',
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.5625rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: isActive ? 400 : 300,
                  background: isActive ? 'var(--foreground)' : 'transparent',
                  color: isActive ? 'var(--background)' : 'var(--muted-foreground)',
                  border: `1px solid ${isActive ? 'var(--foreground)' : 'var(--border)'}`,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                <span style={{ fontStyle: 'normal' }}>{level.symbol}</span>
                <span>{level.label}</span>
              </button>
            );
          })}
        </div>

        {showContextPrompt && (
          <div className="mt-1.5 space-y-1">
            <Textarea
              value={contextText}
              onChange={e => setContextText(e.target.value)}
              placeholder="Anything you want Naya to know? (optional)"
              className="text-[10px] min-h-[24px] max-h-[36px] resize-none py-1 px-2"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-5 flex-1 px-1"
                onClick={() => updateMutation.mutate({ energyLevel: pendingLevel!, emotionalContext: contextText || undefined })}
                disabled={updateMutation.isPending}
              >
                {contextText ? 'Save with note' : 'Continue'}
              </Button>
              <button
                onClick={() => updateMutation.mutate({ energyLevel: pendingLevel! })}
                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-gray-300"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {!showContextPrompt && avoidance && (
          <div className="mt-1.5 flex-shrink-0">
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.5625rem',
                letterSpacing: '0.08em',
                fontWeight: 300,
                color: 'var(--muted-foreground)',
                border: '1px solid var(--border)',
                padding: '2px 6px',
              }}
            >
              {avoidance}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectSetupBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('naya_project_banner_dismissed') === '1');
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });

  if (dismissed || projects.length === 0) return null;

  const hasEditedProject = projects.some(p => p.description && p.description.length > 0);
  if (hasEditedProject) return null;

  return (
    <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-4 mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-xl">🏗️</span>
        <div>
          <p className="text-sm text-slate-900 dark:text-white">We've set up your first project from your onboarding.</p>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Review and refine it to help Naya give better recommendations.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/projects">
          <a className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">
            Review Project
          </a>
        </Link>
        <button
          onClick={() => { setDismissed(true); localStorage.setItem('naya_project_banner_dismissed', '1'); }}
          className="p-1 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Brand DNA Setup Dialog ────────────────────────────────────────────────
function BrandDnaDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dna, isLoading } = useQuery<any>({
    queryKey: ['/api/projects', project.id, 'brand-dna'],
    queryFn: () => fetch(`/api/projects/${project.id}/brand-dna`, { credentials: 'include' }).then(r => r.json()),
    enabled: open,
  });

  const [fields, setFields] = useState<Record<string, string>>({});

  const set = (k: string) => (v: string) => setFields(f => ({ ...f, [k]: v }));

  // Reset and populate form when dialog opens or project changes
  useEffect(() => {
    if (open && dna) {
      setFields({
        businessType: dna.businessType || '',
        businessModel: dna.businessModel || '',
        targetAudience: dna.targetAudience || '',
        corePainPoint: dna.corePainPoint || '',
        audienceAspiration: dna.audienceAspiration || '',
        uniquePositioning: dna.uniquePositioning || '',
        communicationStyle: dna.communicationStyle || '',
        platformPriority: dna.platformPriority || '',
        primaryGoal: dna.primaryGoal || '',
        revenueUrgency: dna.revenueUrgency || '',
        activeBusinessPriority: dna.activeBusinessPriority || '',
        authorityLevel: dna.authorityLevel || '',
      });
    }
  }, [open, project.id, dna]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiRequest('PATCH', `/api/projects/${project.id}/brand-dna`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', project.id, 'brand-dna'] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${project.id}`] });
      toast({ title: "Brand DNA saved for " + project.name });
      onOpenChange(false);
      setFields({});
    },
    onError: () => toast({ title: t('common.error'), variant: "destructive" }),
  });

  const Field = ({ label, k, placeholder, rows }: { label: string; k: string; placeholder?: string; rows?: number }) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-600 dark:text-gray-400">{label}</Label>
      {rows ? (
        <Textarea value={fields[k] || ''} onChange={e => set(k)(e.target.value)} rows={rows} placeholder={placeholder} className="text-sm" />
      ) : (
        <Input value={fields[k] || ''} onChange={e => set(k)(e.target.value)} placeholder={placeholder} className="text-sm" />
      )}
    </div>
  );

  const SelectField = ({ label, k, options }: { label: string; k: string; options: {value: string; label: string}[] }) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-600 dark:text-gray-400">{label}</Label>
      <Select value={fields[k] || ''} onValueChange={set(k)}>
        <SelectTrigger className="text-sm"><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dna className="h-5 w-5 text-[hsl(150,20%,45%)]" />
            Brand DNA for {project.name}
          </DialogTitle>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
            Configure business strategy for AI-powered planning aligned with this project's goals
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : (
          <ScrollArea className="max-h-[calc(85vh-140px)] pr-4">
            <div className="space-y-5 py-2">
              {!dna?.projectId && dna && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">Showing your global Brand DNA as a starting point. Save to create a profile specific to <strong>{project.name}</strong>.</p>
                </div>
              )}

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">Business</p>
                <div className="space-y-3">
                  <Field label="What type of business is this?" k="businessType" placeholder="e.g. Agency, Freelance, SaaS, Coaching…" />
                  <Field label="Business model" k="businessModel" placeholder="e.g. services, productized, subscription…" />
                  <SelectField label="Authority level" k="authorityLevel" options={[
                    { value: 'emerging', label: 'Emerging — building credibility' },
                    { value: 'established', label: 'Established — known in niche' },
                    { value: 'authority', label: 'Authority — widely recognized' },
                    { value: 'thought-leader', label: 'Thought leader — industry voice' },
                  ]} />
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">Audience</p>
                <div className="space-y-3">
                  <Field label="Target audience" k="targetAudience" placeholder="Who you serve — role, context, mindset…" rows={2} />
                  <Field label="Core pain point" k="corePainPoint" placeholder="The #1 frustration your audience faces…" rows={2} />
                  <Field label="Audience aspiration" k="audienceAspiration" placeholder="What they most want to achieve…" rows={2} />
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">Voice & Platform</p>
                <div className="space-y-3">
                  <Field label="Unique positioning" k="uniquePositioning" placeholder="What sets this project apart…" rows={2} />
                  <SelectField label="Communication style" k="communicationStyle" options={[
                    { value: 'direct', label: 'Direct & bold' },
                    { value: 'nurturing', label: 'Nurturing & supportive' },
                    { value: 'educational', label: 'Educational & informative' },
                    { value: 'inspiring', label: 'Inspiring & visionary' },
                    { value: 'conversational', label: 'Conversational & relatable' },
                    { value: 'authoritative', label: 'Authoritative & expert' },
                  ]} />
                  <SelectField label="Primary platform" k="platformPriority" options={[
                    { value: 'linkedin', label: 'LinkedIn' },
                    { value: 'instagram', label: 'Instagram' },
                    { value: 'twitter', label: 'Twitter / X' },
                    { value: 'newsletter', label: 'Newsletter' },
                    { value: 'youtube', label: 'YouTube' },
                    { value: 'podcast', label: 'Podcast' },
                    { value: 'blog', label: 'Blog / SEO' },
                    { value: 'tiktok', label: 'TikTok' },
                  ]} />
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-2">Priorities</p>
                <div className="space-y-3">
                  <Field label="Primary goal for this project" k="primaryGoal" placeholder="e.g. sign 2 retainer clients, grow to 5k subscribers…" rows={2} />
                  <SelectField label="Revenue urgency" k="revenueUrgency" options={[
                    { value: 'revenue-now', label: 'Need revenue now — critical' },
                    { value: '3-months', label: 'Within 3 months' },
                    { value: 'growing-steadily', label: 'Growing steadily — not urgent' },
                    { value: 'authority-building', label: 'Building authority first' },
                    { value: 'scale-existing', label: 'Scaling what\'s already working' },
                  ]} />
                  <Field label="Active priority right now" k="activeBusinessPriority" placeholder="e.g. launch podcast, close discovery calls…" />
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate(fields)}
            disabled={saveMutation.isPending || isLoading}
            className="gap-1.5"
          >
            {saveMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving...</> : <><Dna className="h-3.5 w-3.5" />Save Brand DNA</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard({ onSearchClick }: DashboardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { activeProjectId, isAllProjects } = useProject();
  const { data: brandDna, isLoading: brandDnaLoading } = useQuery({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
  // Pour les jalons : projet actif en priorité, sinon le premier projet disponible
  const milestoneProjectId = activeProjectId ?? (projects[0]?.id ?? null);
  const milestoneProjectName = activeProject?.name ?? projects[0]?.name;

  // Rollover silencieux au chargement du dashboard : ramène les tâches des jours passés
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    apiRequest('POST', '/api/tasks/rollover')
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
        queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
        queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
      })
      .catch(() => { /* silencieux */ });
  }, [isAuthenticated, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => { window.location.href = "/"; }, 500);
    }
  }, [isAuthenticated, isLoading, toast]);

  useEffect(() => {
    if (!brandDnaLoading && !brandDna) {
      window.location.href = "/onboarding";
    }
  }, [brandDna, brandDnaLoading]);

  const greeting = () => {
    return t('dashboard.goodMorning');
  };

  if (isLoading || brandDnaLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div style={{ width: 40, height: 40, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <span style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--primary-foreground)' }}>N</span>
          </div>
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </div>
      </div>
    );
  }

  if (!brandDna) {
    return null;
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-card border-b border-border flex-shrink-0 relative overflow-hidden">
          {/* Thin gradient bar at top */}
          <div className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ background: 'var(--primary)', height: 2 }} />
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-baseline gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {greeting()}, {(() => {
                      const n = (user as any);
                      return n?.firstName || n?.name?.split(' ')[0] || n?.claims?.name?.split(' ')[0] || n?.email?.split('@')[0] || 'there';
                    })()}
                  </h1>
                  <span className="text-sm font-medium text-muted-foreground hidden sm:inline">
                    {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {isAllProjects ? (
                    <span className="text-xs text-muted-foreground">{t('sidebar.allProjects')}</span>
                  ) : activeProject ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: activeProject.color || 'var(--accent)' }} />
                      <span className="text-xs text-muted-foreground">{activeProject.icon || '📁'} {activeProject.name}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <NayaCompanionBar />
                <LiveClock />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="lg:col-span-2">
                <BentoTileNextAction />
              </div>
              <BentoTileWeekPulse />
              <BentoTileMyState />
            </div>

            <PlanningStartBanner />
            <ProjectSetupBanner />

            {isAllProjects ? <AllProjectsBand /> : activeProjectId ? <ActiveProjectBand projectId={activeProjectId} /> : null}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6" id="todays-tasks-section">
                <StuckTasksCard onOpenCompanion={() => {
                  window.dispatchEvent(new CustomEvent('naya:open-companion'));
                }} />
                <TodaysTasks />
                <SchedulePreview />
              </div>

              <div className="space-y-4">
                <QuickCapture />
                {milestoneProjectId && (
                  <MilestoneChain
                    projectId={milestoneProjectId}
                    projectName={milestoneProjectName}
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
