import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/lib/project-context";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import TodaysTasks from "@/components/todays-tasks";
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
  Loader2, Dna
} from "lucide-react";
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
  { value: 'high', label: 'High', symbol: '⚡', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800', activeRing: 'ring-emerald-300' },
  { value: 'medium', label: 'Medium', symbol: '○', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800', activeRing: 'ring-amber-300' },
  { value: 'low', label: 'Low', symbol: '↓', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800', activeRing: 'ring-orange-300' },
  { value: 'depleted', label: 'Depleted', symbol: '✕', color: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800', activeRing: 'ring-red-300' },
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
    <div className={`bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl p-4 ${compact ? '' : 'mb-6'}`}>
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
    <Card className="dark:bg-gray-900 dark:border-gray-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
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
    <Card className="dark:bg-gray-900 dark:border-gray-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
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
      <Card className="dark:bg-gray-900 dark:border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
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

function BentoTileNextAction() {
  const { activeProjectId } = useProject();
  const { data: todayTasks = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/today', activeProjectId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      let url = `/api/tasks/range?start=${today}&end=${today}`;
      if (activeProjectId) url += `&projectId=${activeProjectId}`;
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const pending = (todayTasks as any[])
    .filter(t => !t.completed)
    .sort((a, b) => {
      const aMin = a.scheduledTime ? parseInt(a.scheduledTime.replace(':', '')) : 9999;
      const bMin = b.scheduledTime ? parseInt(b.scheduledTime.replace(':', '')) : 9999;
      return aMin - bMin;
    });

  const next = pending[0] || null;
  const remaining = pending.length;
  const done = (todayTasks as any[]).filter(t => t.completed).length;
  const total = (todayTasks as any[]).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const ENERGY_EMOJI: Record<string, string> = {
    deep_work: '🎯', creative: '✨', admin: '📋', social: '💬', logistics: '📦', execution: '⚡',
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl p-4 flex flex-col h-full min-h-[120px] max-h-[140px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-indigo-500" />
          Next Up
        </span>
        {total > 0 && (
          <span className="text-[10px] text-slate-400 dark:text-gray-500">{done}/{total} done</span>
        )}
      </div>
      {next ? (
        <div className="flex-1 flex flex-col justify-between min-h-0">
          <div className="flex items-start gap-2">
            {next.taskEnergyType && (
              <span className="text-sm flex-shrink-0 mt-0.5">{ENERGY_EMOJI[next.taskEnergyType] || '•'}</span>
            )}
            <p className="text-sm text-slate-900 dark:text-white line-clamp-2 leading-snug flex-1">
              {next.title}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            {next.estimatedDuration && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />{next.estimatedDuration}m
              </span>
            )}
            {remaining > 1 && <span className="text-[10px] text-slate-400">+{remaining - 1} more</span>}
            <div className="flex-1 h-1 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden ml-auto" style={{ maxWidth: '60px' }}>
              <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col justify-center">
          <p className="text-xs text-slate-500 dark:text-gray-400">No tasks yet today.</p>
          <Link href="/planning">
            <a className="text-xs text-primary hover:underline mt-1">Generate my plan →</a>
          </Link>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center items-start gap-1">
          <p className="text-sm text-emerald-600 dark:text-emerald-400">All done for today 🎉</p>
          <p className="text-[10px] text-slate-400">{done} tasks completed</p>
        </div>
      )}
    </div>
  );
}

function BentoTileWeekPulse() {
  const { activeProjectId } = useProject();
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
    <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl p-4 flex flex-col h-full min-h-[120px] max-h-[140px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-emerald-500" />
          This Week
        </span>
        <span className={`text-sm ${pct >= 75 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-slate-400'}`}>{pct}%</span>
      </div>
      <div className="flex gap-1 flex-1 items-end mb-1">
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
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-sm overflow-hidden flex flex-col justify-end" style={{ height: '36px' }}>
                <div
                  className={`w-full transition-all ${isToday ? 'bg-indigo-400' : isPast ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-gray-700'}`}
                  style={{ height: `${Math.max(barPct * 100, dayTasks.length > 0 ? 8 : 0)}%` }}
                />
              </div>
              <span className={`text-[9px] ${isToday ? 'text-indigo-500' : 'text-slate-400 dark:text-gray-500'}`}>{day}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-gray-500">{done} of {total} tasks done this week</p>
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
    <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl p-4 flex flex-col h-full min-h-[120px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500 flex-shrink-0" />
          <span className="text-xs text-slate-900 dark:text-white uppercase tracking-wider">My State</span>
        </div>
        {personaName && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{PERSONA_ICONS[personaName] || "🧠"}</span>
            <span className="text-xs text-slate-700 dark:text-gray-300">{personaName}</span>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col justify-between min-h-0">
        <div className="grid grid-cols-4 gap-1">
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
                className={`flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg border text-[10px] transition-all ${
                  isActive
                    ? `${level.color} ring-1 ${level.activeRing}`
                    : 'border-slate-200 dark:border-gray-700 text-slate-400 dark:text-gray-500 hover:border-slate-300 dark:hover:border-gray-600'
                }`}
              >
                <span>{level.symbol}</span>
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
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
              Watch: {avoidance}
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
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  const { data: brandDna, isLoading: brandDnaLoading } = useQuery({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  const generateAllProjectsPlan = async () => {
    setIsGeneratingAll(true);
    try {
      const res = await apiRequest('POST', '/api/tasks/generate-daily', { replaceExisting: true });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
      toast({
        title: "Plan régénéré pour tous les projets!",
        description: `${data.createdCount || 0} tâches dans le nouveau plan`
      });
    } catch (error: any) {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de générer le plan",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingAll(false);
    }
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => { window.location.href = "/api/login"; }, 500);
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
      <div className="min-h-screen bg-slate-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-sm">N</span>
          </div>
          <p className="text-slate-600 dark:text-gray-400">Chargement…</p>
        </div>
      </div>
    );
  }

  if (!brandDna) {
    return null;
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-gray-950">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-gray-700 px-6 py-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl text-slate-900 dark:text-white">
                {greeting()}, {(() => {
                  const n = (user as any);
                  return n?.firstName || n?.name?.split(' ')[0] || n?.claims?.name?.split(' ')[0] || n?.email?.split('@')[0] || 'there';
                })()} 👋
              </h1>
              <div className="flex items-center gap-2 mt-1">
                {isAllProjects ? (
                  <Badge variant="outline" className="text-xs text-slate-500 dark:text-gray-400">{t('sidebar.allProjects')}</Badge>
                ) : activeProject ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: activeProject.color || '#6366f1' }} />
                    <span className="text-sm text-slate-600 dark:text-gray-300">{activeProject.icon || '📁'} {activeProject.name}</span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-500 dark:text-gray-400">Loading...</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={generateAllProjectsPlan}
                disabled={isGeneratingAll}
                size="sm"
                className="gap-2 bg-[hsl(150,20%,45%)] hover:bg-[hsl(150,20%,40%)] text-white"
              >
                {isGeneratingAll ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Génération...</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Générer plan pour tous les projets</>
                )}
              </Button>
              <LiveClock />
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

            <ProjectSetupBanner />

            {isAllProjects ? <AllProjectsBand /> : activeProjectId ? <ActiveProjectBand projectId={activeProjectId} /> : null}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6" id="todays-tasks-section">
                <TodaysTasks />
                <SchedulePreview />
              </div>

              <div className="space-y-4">
                <QuickCapture />
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
