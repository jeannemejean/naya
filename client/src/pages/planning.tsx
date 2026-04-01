import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/lib/project-context";
import { ChevronLeft, ChevronRight, Clock, Loader2, Brain } from "lucide-react";
import TaskWorkspace from "@/components/task-workspace";
import Sidebar from "@/components/sidebar";
import TimeGrid from "@/components/time-grid";
import type { Project } from "@shared/schema";
import { formatLocalDate } from "@/lib/dateUtils";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";

interface Task {
  id: number;
  title: string;
  description?: string | null;
  type?: string | null;
  category?: string | null;
  priority?: number | null;
  completed: boolean;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduledEndTime?: string | null;
  dueDate?: string | null;
  estimatedDuration?: number | null;
  projectId?: number | null;
  source?: string | null;
  taskEnergyType?: string | null;
  workflowGroup?: string | null;
  setupCost?: string | null;
  canBeFragmented?: boolean | null;
  recommendedTimeOfDay?: string | null;
}

type ViewScope = 'day' | 'week' | 'month';

const ENERGY_BADGES: Record<string, { emoji: string; label: string; cls: string }> = {
  deep_work:  { emoji: '🎯', label: 'Focus',     cls: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' },
  creative:   { emoji: '✨', label: 'Creative',  cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
  admin:      { emoji: '📋', label: 'Admin',     cls: 'bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-400' },
  social:     { emoji: '💬', label: 'Social',    cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
  logistics:  { emoji: '📦', label: 'Logistics', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
  execution:  { emoji: '⚡', label: 'Execute',   cls: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500' },
};

const CATEGORY_COLORS: Record<string, string> = {
  revenue: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  visibility: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  relationships: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  operations: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  growth: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
};

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
];

const TIME_OF_DAY_HINTS: Record<string, { emoji: string; label: string }> = {
  morning:   { emoji: '🌅', label: 'Morning' },
  afternoon: { emoji: '☀️', label: 'Afternoon' },
  evening:   { emoji: '🌙', label: 'Evening' },
  anytime:   { emoji: '🕒', label: 'Anytime' },
};

function getProjectColor(projectId: number | null | undefined, _projects: Project[]): string {
  if (!projectId) return '#6366f1';
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length];
}

function formatDate(d: Date): string {
  return formatLocalDate(d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  r.setDate(r.getDate() + diff);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function formatHeaderLabel(d: Date, scope: ViewScope): string {
  const opts: Intl.DateTimeFormatOptions = scope === 'day'
    ? { weekday: 'long', month: 'short', day: 'numeric' }
    : scope === 'week'
    ? { month: 'short', day: 'numeric' }
    : { month: 'long', year: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

const DAILY_FEEDBACK_OPTIONS = [
  { key: 'on_track',        labelKey: 'planning.dailyFeedback.onTrack' },
  { key: 'felt_overloaded', labelKey: 'planning.dailyFeedback.feltOverloaded' },
  { key: 'tasks_wrong',     labelKey: 'planning.dailyFeedback.tasksWrong' },
];

interface Props {
  onSearchClick?: () => void;
}

export default function Planning({ onSearchClick }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeProjectId } = useProject();
  const { triggerAutoRebalance } = useAutoRebalance();

  const [viewScope, setViewScope] = useState<ViewScope>('week');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [workspaceTask, setWorkspaceTask] = useState<Task | null>(null);
  const [strategyExpanded, setStrategyExpanded] = useState(false);
  const [lastStrategySignal, setLastStrategySignal] = useState<{
    focus: string;
    reasoning: string;
    bottleneck?: string;
    suggestedNextMove?: string;
    generatedAt: string;
    skippedProjects?: Array<{ name: string; reason: string }>;
  } | null>(null);
  const [dailyFeedbackGiven, setDailyFeedbackGiven] = useState<string | null>(null);
  const [dailyFeedbackThanks, setDailyFeedbackThanks] = useState(false);

  const today = formatDate(new Date());

  const { startDate, endDate, headerLabel } = useMemo(() => {
    if (viewScope === 'day') {
      const s = formatDate(selectedDate);
      return { startDate: s, endDate: s, headerLabel: formatHeaderLabel(selectedDate, 'day') };
    }
    if (viewScope === 'week') {
      const mon = startOfWeek(selectedDate);
      const sun = addDays(mon, 6);
      return {
        startDate: formatDate(mon),
        endDate: formatDate(sun),
        headerLabel: `Week of ${formatHeaderLabel(mon, 'week')}`,
      };
    }
    const first = startOfMonth(selectedDate);
    const last = endOfMonth(selectedDate);
    return {
      startDate: formatDate(first),
      endDate: formatDate(last),
      headerLabel: formatHeaderLabel(selectedDate, 'month'),
    };
  }, [viewScope, selectedDate]);

  const rangeQueryKey = ['/api/tasks/range', startDate, endDate, activeProjectId];
  const { data: rangeTasks = [], isLoading: rangeLoading } = useQuery<Task[]>({
    queryKey: rangeQueryKey,
    queryFn: async () => {
      let url = `/api/tasks/range?start=${startDate}&end=${endDate}`;
      if (activeProjectId) url += `&projectId=${activeProjectId}`;
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['/api/projects?limit=200'] });

  const { data: dependencies = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/dependencies', activeProjectId],
    queryFn: async () => {
      const url = activeProjectId ? `/api/tasks/dependencies?projectId=${activeProjectId}` : '/api/tasks/dependencies';
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: preferences } = useQuery<any>({
    queryKey: ['/api/preferences'],
  });

  const { data: availabilityData = [] } = useQuery<any[]>({
    queryKey: ['/api/availability', startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/availability?startDate=${startDate}&endDate=${endDate}`, { credentials: 'include' });
      return res.json();
    },
  });

  const blockedByMap: Record<number, number> = {};
  for (const dep of dependencies) {
    if (dep.relationType === 'blocked_by') blockedByMap[dep.taskId] = dep.dependsOnTaskId;
  }

  const toggleMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest("POST", `/api/tasks/${taskId}/toggle`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      triggerAutoRebalance();
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('planning.failedToUpdate'), variant: "destructive" });
    },
  });

  const clientToday = formatDate(new Date());

  const generateMonthlyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/generate-monthly", {
        projectId: activeProjectId || undefined,
        month: selectedDate.getMonth() + 1,
        year: selectedDate.getFullYear(),
        clientToday,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      const msg = data?.monthlyRationale
        ? `${data.tasks?.length || 0} tasks planned · ${data.monthlyRationale.slice(0, 80)}${data.monthlyRationale.length > 80 ? '...' : ''}`
        : t('planning.tasksDistributed', { count: data?.tasks?.length || 0 });
      toast({ title: t('planning.monthlyPlanGenerated'), description: msg });
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('planning.failedToGenerate'), variant: "destructive" });
    },
  });

  const generateWeeklyMutation = useMutation({
    mutationFn: async () => {
      const mon = startOfWeek(selectedDate);
      const res = await apiRequest("POST", "/api/tasks/generate-weekly", {
        projectId: activeProjectId || undefined,
        weekStart: formatDate(mon),
        clientToday,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      const parts: string[] = [];
      if (data?.reschedules?.length) parts.push(t('planning.tasksRescheduled', { count: data.reschedules.length }));
      if (data?.newTasks?.length) parts.push(t('planning.fillInTasksAdded', { count: data.newTasks.length }));
      if (data?.weeklyRationale) parts.push(data.weeklyRationale.slice(0, 60));
      toast({ title: t('planning.weekRefined'), description: parts.join(' · ') || t('planning.weekRebalanced') });
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('planning.failedToRefine'), variant: "destructive" });
    },
  });

  const rebalanceWeekMutation = useMutation({
    mutationFn: async () => {
      const mon = startOfWeek(selectedDate);
      const now = new Date();
      const clientTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const res = await apiRequest("POST", "/api/tasks/rebalance-week", {
        weekStart: formatDate(mon),
        clientToday,
        clientTime,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
      const dayEntries = Object.entries(data?.days || {});
      const summary = dayEntries.map(([d, c]) => `${d}: ${c}`).join(', ');
      toast({ title: t('planning.weekRebalanced'), description: t('planning.weekRebalancedDescription', { moved: data?.moved || 0, summary }) });
    },
    onError: (err: any) => {
      const msg = err?.message || t('planning.failedToRebalance');
      const isAuth = msg.includes('401') || msg.includes('Unauthorized');
      toast({
        title: isAuth ? t('planning.sessionExpired') : t('common.error'),
        description: isAuth ? t('planning.sessionExpiredDescription') : msg,
        variant: 'destructive',
      });
    },
  });

  const clearWeekMutation = useMutation({
    mutationFn: async () => {
      const mon = startOfWeek(selectedDate);
      const res = await apiRequest("POST", "/api/tasks/clear-week", {
        weekStart: formatDate(mon),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
      toast({ title: t('planning.weekCleared'), description: t('planning.tasksUnscheduledDescription', { count: data?.cleared || 0 }) });
    },
    onError: (err: any) => {
      const msg = err?.message || t('planning.failedToClear');
      toast({ title: t('common.error'), description: msg, variant: "destructive" });
    },
  });

  const generateDailyMutation = useMutation({
    mutationFn: async (opts?: { replaceExisting?: boolean }) => {
      const now = new Date();
      const clientTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const res = await apiRequest("POST", "/api/tasks/generate-daily", {
        projectId: activeProjectId || undefined,
        clientToday,
        clientTime,
        ...(opts?.replaceExisting !== undefined ? { replaceExisting: opts.replaceExisting } : {}),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'], exact: false });

      setTimeout(() => triggerAutoRebalance(), 1500);

      if (data?.focus || data?.reasoning) {
        const reasoning = data.reasoning || '';
        let bottleneck = data.bottleneck || '';
        if (!bottleneck) {
          const m = reasoning.match(/bottleneck[:\s]+([^.]+\.)/i);
          if (m) bottleneck = m[1].trim();
        }
        let suggestedNextMove = data.suggestedNextMove || '';
        if (!suggestedNextMove) {
          const m = reasoning.match(/(?:next step|next move|priority|focus on)[:\s]+([^.]+\.)/i);
          if (m) suggestedNextMove = m[1].trim();
        }
        setLastStrategySignal({
          focus: data.focus || 'Daily execution',
          reasoning,
          bottleneck: bottleneck || undefined,
          suggestedNextMove: suggestedNextMove || undefined,
          generatedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          skippedProjects: data.skippedProjects || undefined,
        });
        setStrategyExpanded(false);
      }

      const rr = data?.realismReport;
      if (rr && (rr.deferredCount > 0 || rr.contextSwitchCorrected)) {
        const parts = [t('planning.planGenerated')];
        if (rr.deferredCount > 0) parts.push(t('planning.movedToTomorrow', { count: rr.deferredCount }));
        if (rr.contextSwitchCorrected) parts.push(t('planning.contextSwitchesBalanced'));
        toast({ title: parts[0], description: parts.slice(1).join(' · ') });
      } else {
        toast({ title: t('planning.planGenerated'), description: t('planning.tasksReadyForToday', { count: data?.tasks?.length || 0 }) });
      }
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('planning.failedToGenerate'), variant: "destructive" });
    },
  });

  const anyGenerating = generateMonthlyMutation.isPending || generateWeeklyMutation.isPending || generateDailyMutation.isPending;

  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [existingGeneratedCount, setExistingGeneratedCount] = useState(0);

  const doGenerate = useCallback(async (replaceExisting?: boolean) => {
    try {
      if (viewScope === 'month') {
        await generateMonthlyMutation.mutateAsync();
      }
      await generateDailyMutation.mutateAsync(replaceExisting !== undefined ? { replaceExisting } : undefined);
    } catch {
    }
  }, [viewScope, generateMonthlyMutation, generateDailyMutation]);

  const currentWeekStart = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const ws = new Date(d);
    ws.setDate(ws.getDate() + diff);
    return formatLocalDate(ws);
  }, []);

  const currentWeekEnd = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = (day === 0 ? 0 : 7 - day);
    const we = new Date(d);
    we.setDate(we.getDate() + diff);
    return formatLocalDate(we);
  }, []);

  const { data: weekTasksForDupCheck = [] } = useQuery<Task[]>({
    queryKey: ['/api/tasks/range', currentWeekStart, currentWeekEnd, activeProjectId, 'dup-check'],
    queryFn: async () => {
      let url = `/api/tasks/range?start=${currentWeekStart}&end=${currentWeekEnd}`;
      if (activeProjectId) url += `&projectId=${activeProjectId}`;
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  async function handleGeneratePlan() {
    const existingGenerated = weekTasksForDupCheck.filter(
      (t) => !t.completed && (t.source === 'generated' || t.source === 'ai')
    );
    if (existingGenerated.length > 0) {
      setExistingGeneratedCount(existingGenerated.length);
      setReplaceDialogOpen(true);
    } else {
      doGenerate();
    }
  }

  function handleDailyFeedback(key: string) {
    localStorage.setItem(`naya_daily_feedback_${today}`, key);
    setDailyFeedbackGiven(key);
    setDailyFeedbackThanks(true);
    setTimeout(() => setDailyFeedbackThanks(false), 2000);
  }

  const todayFeedbackStored = typeof window !== 'undefined'
    ? localStorage.getItem(`naya_daily_feedback_${today}`)
    : null;

  function navigate(dir: number) {
    setSelectedDate(prev => {
      if (viewScope === 'day') return addDays(prev, dir);
      if (viewScope === 'week') return addDays(prev, dir * 7);
      const d = new Date(prev);
      d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of rangeTasks) {
      const key = t.scheduledDate || '';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return map;
  }, [rangeTasks]);

  const weekDates = useMemo(() => {
    if (viewScope !== 'week') return [];
    const mon = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => formatDate(addDays(mon, i)));
  }, [viewScope, selectedDate]);

  const calendarDays = useMemo(() => {
    if (viewScope !== 'month') return [];
    const first = startOfMonth(selectedDate);
    const last = endOfMonth(selectedDate);
    const dayOfWeek = first.getDay();
    const startOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const days: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewScope, selectedDate]);

  // Full task card for the unscheduled list sidebar in day/week view
  function TaskCard({ task, compact = false }: { task: Task; compact?: boolean }) {
    const isBlocked = blockedByMap[task.id] !== undefined;
    const projColor = isBlocked ? '#94a3b8' : getProjectColor(task.projectId, projects);
    const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;
    const energyBadge = task.taskEnergyType ? ENERGY_BADGES[task.taskEnergyType] : null;
    const timeHint = task.recommendedTimeOfDay ? TIME_OF_DAY_HINTS[task.recommendedTimeOfDay] : null;

    if (compact) {
      return (
        <div
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:opacity-80 transition-opacity ${task.completed ? 'opacity-40 line-through' : ''} ${isBlocked ? 'opacity-50' : ''}`}
          style={{ backgroundColor: `${projColor}15`, borderLeft: `2px solid ${projColor}` }}
          onClick={() => setWorkspaceTask(task)}
        >
          {energyBadge && (
            <span className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1 rounded text-[8px] ${energyBadge.cls}`}>
              {energyBadge.emoji}{energyBadge.label.slice(0, 3)}
            </span>
          )}
          <span className="truncate text-slate-700 dark:text-gray-300">{task.title}</span>
          {isBlocked && <span className="flex-shrink-0">🔒</span>}
        </div>
      );
    }

    return (
      <div
        className={`flex items-start space-x-3 p-3 border rounded-lg transition-colors cursor-pointer ${
          isBlocked
            ? 'opacity-60 bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700'
            : task.completed
            ? 'opacity-50 border-slate-100 dark:border-gray-800'
            : 'border-slate-200 dark:border-gray-700 hover:border-primary/40 dark:hover:border-primary/30'
        }`}
        style={{ borderLeftWidth: 3, borderLeftColor: projColor }}
        onClick={() => setWorkspaceTask(task)}
      >
        <div onClick={e => e.stopPropagation()} className="flex-shrink-0 pt-0.5">
          <Checkbox
            checked={task.completed}
            onCheckedChange={() => toggleMutation.mutate(task.id)}
            disabled={toggleMutation.isPending}
            className="cursor-pointer"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isBlocked && <span className="text-sm">🔒</span>}
            <p className={`text-sm ${task.completed ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
              {task.title}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {task.category && (
              <Badge className={`${CATEGORY_COLORS[task.category] || 'bg-slate-100 text-slate-600'} text-xs h-4 border-0`}>
                {task.category}
              </Badge>
            )}
            {energyBadge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${energyBadge.cls}`}>
                {energyBadge.emoji} {energyBadge.label}
              </span>
            )}
            {timeHint && (
              <span className="text-[10px] text-slate-400 dark:text-gray-500">
                {timeHint.emoji} {timeHint.label}
              </span>
            )}
            {task.estimatedDuration && (
              <span className="text-xs text-slate-400 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                ~{task.estimatedDuration}m
              </span>
            )}
            {project && (
              <span className="text-[10px] text-slate-400 dark:text-gray-500">{project.icon} {project.name}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-gray-950">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-900">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-gray-800 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-base text-slate-900 dark:text-white">{t('planning.title')}</h1>
                <p className="text-xs text-slate-500 dark:text-gray-400">{headerLabel}</p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 rounded-lg p-1">
                {(['day', 'week', 'month'] as ViewScope[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setViewScope(v)}
                    className={`px-3 py-1 rounded-md text-xs transition-all ${
                      viewScope === v
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                    }`}
                  >
                    {t(`planning.${v}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 rounded-lg p-1">
                <button onClick={() => navigate(-1)} className="p-1.5 rounded-md hover:bg-white dark:hover:bg-gray-700 transition-colors">
                  <ChevronLeft className="h-4 w-4 text-slate-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={() => setSelectedDate(new Date())}
                  className="px-2 py-1 rounded-md text-xs text-slate-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                >
                  {t('common.today')}
                </button>
                <button onClick={() => navigate(1)} className="p-1.5 rounded-md hover:bg-white dark:hover:bg-gray-700 transition-colors">
                  <ChevronRight className="h-4 w-4 text-slate-600 dark:text-gray-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          {rangeLoading ? (
            <div className="flex items-center justify-center py-16 flex-1">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : viewScope === 'month' ? (
            // ─── MONTH VIEW — compact grid, click to drill ──────────
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-7 mb-2">
                {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => (
                  <div key={d} className="text-center text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide py-1">
                    {t(`planning.days.${d}`)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  if (!day) {
                    return <div key={`empty-${i}`} className="h-28 rounded-lg bg-slate-50 dark:bg-gray-800/30 opacity-40" />;
                  }
                  const dateKey = formatDate(day);
                  const isToday = dateKey === today;
                  const isPast = dateKey < today;
                  const dayTasks = tasksByDate[dateKey] || [];
                  const avail = availabilityData.find((a: any) => a.date === dateKey);
                  const dayType = avail?.dayType;
                  const visible = dayTasks.slice(0, 4);
                  const overflow = dayTasks.length - visible.length;
                  return (
                    <div
                      key={dateKey}
                      className={`h-28 rounded-lg border p-1.5 flex flex-col cursor-pointer hover:border-primary/40 transition-colors ${
                        isToday ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                        : isPast ? 'border-slate-100 dark:border-gray-800 opacity-60'
                        : 'border-slate-200 dark:border-gray-700'
                      }`}
                      onClick={() => { setSelectedDate(day); setViewScope('day'); }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs ${isToday ? 'text-primary' : 'text-slate-600 dark:text-gray-400'}`}>
                          {day.getDate()}
                        </span>
                        {dayType && dayType !== 'full' && (
                          <span className="text-[9px]">
                            {dayType === 'off' ? '🌴' : dayType === 'deep-work' ? '🎯' : dayType === 'travel' ? '✈️' : dayType === 'half-am' ? '🌤' : '🌇'}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5 flex-1 overflow-hidden">
                        {visible.map((task: Task) => {
                          const projColor = getProjectColor(task.projectId, projects);
                          return (
                            <div
                              key={task.id}
                              className="flex items-center gap-1 px-1 py-0.5 rounded text-[9px] truncate"
                              style={{ backgroundColor: `${projColor}18`, color: projColor }}
                              onClick={e => { e.stopPropagation(); setWorkspaceTask(task); }}
                            >
                              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: projColor }} />
                              <span className="truncate">{task.title}</span>
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <p className="text-[9px] text-slate-400 dark:text-gray-500 pl-1">+{overflow} {t('planning.more').toLowerCase()}</p>
                        )}
                        {dayTasks.length === 0 && (
                          <p className="text-[9px] text-slate-300 dark:text-gray-700 pl-1 mt-1">—</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : viewScope === 'week' ? (
            // ─── WEEK TIME-GRID VIEW ─────────────────────────────────
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {lastStrategySignal && (
                <div className="mx-1 mb-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg px-3 py-1.5 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                    <p className="text-[11px] text-indigo-800 dark:text-indigo-300 truncate flex-1">{lastStrategySignal.focus}</p>
                    {lastStrategySignal.reasoning && (
                      <button
                        onClick={() => setStrategyExpanded(!strategyExpanded)}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex-shrink-0 whitespace-nowrap"
                      >
                        {strategyExpanded ? t('planning.less') : 'Why these tasks?'}
                      </button>
                    )}
                  </div>
                  {strategyExpanded && lastStrategySignal.reasoning && (
                    <div className="mt-1.5 space-y-1.5 border-t border-indigo-200/50 dark:border-indigo-800/30 pt-1.5">
                      <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">{lastStrategySignal.reasoning}</p>
                      {lastStrategySignal.bottleneck && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400"><span className="font-medium">⚠ Bottleneck:</span> {lastStrategySignal.bottleneck}</p>
                      )}
                      {lastStrategySignal.suggestedNextMove && (
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400"><span className="font-medium">→ Next move:</span> {lastStrategySignal.suggestedNextMove}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <TimeGrid
                dates={weekDates}
                tasks={rangeTasks}
                projects={projects}
                dependencies={blockedByMap}
                availability={availabilityData}
                defaultWorkStart={preferences?.workDayStart || '09:00'}
                defaultWorkEnd={preferences?.workDayEnd || '18:00'}
                today={today}
                onTaskClick={setWorkspaceTask}
                onToggle={(id) => toggleMutation.mutate(id)}
                rangeQueryKey={rangeQueryKey}
              />
            </div>
          ) : (
            // ─── DAY TIME-GRID VIEW ──────────────────────────────────
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {lastStrategySignal && (
                  <div className="mx-1 mb-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg px-3 py-1.5 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                      <p className="text-[11px] text-indigo-800 dark:text-indigo-300 truncate flex-1">{lastStrategySignal.focus}</p>
                      {lastStrategySignal.reasoning && (
                        <button
                          onClick={() => setStrategyExpanded(!strategyExpanded)}
                          className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex-shrink-0 whitespace-nowrap"
                        >
                          {strategyExpanded ? t('planning.less') : 'Why these tasks?'}
                        </button>
                      )}
                    </div>
                    {strategyExpanded && lastStrategySignal.reasoning && (
                      <div className="mt-1.5 space-y-1.5 border-t border-indigo-200/50 dark:border-indigo-800/30 pt-1.5">
                        <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">{lastStrategySignal.reasoning}</p>
                        {lastStrategySignal.bottleneck && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-400"><span className="font-medium">⚠ Bottleneck:</span> {lastStrategySignal.bottleneck}</p>
                        )}
                        {lastStrategySignal.suggestedNextMove && (
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-400"><span className="font-medium">→ Next move:</span> {lastStrategySignal.suggestedNextMove}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <TimeGrid
                  dates={[startDate]}
                  tasks={rangeTasks}
                  projects={projects}
                  dependencies={blockedByMap}
                  availability={availabilityData}
                  defaultWorkStart={preferences?.workDayStart || '09:00'}
                  defaultWorkEnd={preferences?.workDayEnd || '18:00'}
                  today={today}
                  onTaskClick={setWorkspaceTask}
                  onToggle={(id) => toggleMutation.mutate(id)}
                  rangeQueryKey={rangeQueryKey}
                />
              </div>

              {/* Right panel — strategy + feedback (day view only) */}
              <div className="w-72 flex-shrink-0 border-l border-slate-200 dark:border-gray-800 overflow-y-auto p-4 flex flex-col gap-4">
                {/* Daily feedback */}
                {startDate === today && (tasksByDate[startDate] || []).length > 0 && !todayFeedbackStored && !dailyFeedbackGiven && (
                  <div className="p-3.5 border border-slate-200 dark:border-gray-700 rounded-xl">
                    <p className="text-xs text-slate-500 dark:text-gray-400 mb-2">{t('planning.howDidTodayGo')}</p>
                    <div className="flex gap-2 flex-wrap">
                      {DAILY_FEEDBACK_OPTIONS.map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => handleDailyFeedback(opt.key)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5 transition-colors text-slate-600 dark:text-gray-300"
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {startDate === today && (dailyFeedbackGiven || todayFeedbackStored) && dailyFeedbackThanks && (
                  <p className="text-xs text-center text-slate-400 dark:text-gray-500">{t('planning.thanksFeedback')}</p>
                )}

                {/* Strategy panel */}
                {lastStrategySignal ? (
                  <div className="border border-indigo-200 dark:border-indigo-800/50 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[10px] text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">
                        {t('planning.nayasReadToday')}
                      </h3>
                      <span className="text-[9px] text-slate-400">{lastStrategySignal.generatedAt}</span>
                    </div>
                    <div className="flex items-start gap-2 mb-3">
                      <span className="text-base">🎯</span>
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase">{t('planning.focus')}</p>
                        <p className="text-xs text-slate-900 dark:text-white">{lastStrategySignal.focus}</p>
                      </div>
                    </div>
                    {lastStrategySignal.reasoning && (
                      <div className="mb-3">
                        <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase mb-1">{t('planning.whyTheseTasks')}</p>
                        <p className={`text-xs text-slate-700 dark:text-gray-300 ${!strategyExpanded ? 'line-clamp-4' : ''}`}>
                          {lastStrategySignal.reasoning}
                        </p>
                        {lastStrategySignal.reasoning.length > 150 && (
                          <button onClick={() => setStrategyExpanded(v => !v)} className="text-[10px] text-indigo-600 mt-1 hover:underline">
                            {strategyExpanded ? t('planning.less') : t('planning.more')}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="space-y-2">
                      {lastStrategySignal.bottleneck && (
                        <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                          <p className="text-[9px] text-slate-400 uppercase mb-0.5">{t('planning.bottleneck')}</p>
                          <p className="text-[10px] text-slate-700 dark:text-gray-300">{lastStrategySignal.bottleneck}</p>
                        </div>
                      )}
                      {lastStrategySignal.suggestedNextMove && (
                        <div className="bg-white/60 dark:bg-gray-900/40 rounded-lg p-2">
                          <p className="text-[9px] text-slate-400 uppercase mb-0.5">{t('planning.nextMove')}</p>
                          <p className="text-[10px] text-slate-700 dark:text-gray-300">{lastStrategySignal.suggestedNextMove}</p>
                        </div>
                      )}
                    </div>
                    {lastStrategySignal.skippedProjects && lastStrategySignal.skippedProjects.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-indigo-200/50">
                        <p className="text-[9px] text-amber-600 uppercase mb-1">{t('planning.projectsWithoutTasks')}</p>
                        {lastStrategySignal.skippedProjects.map((sp, i) => (
                          <p key={i} className="text-[10px] text-slate-500">{sp.name}: {sp.reason}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 dark:border-gray-700 rounded-xl p-5 text-center">
                    <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">{t('planning.nayasStrategicRead')}</p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500">{t('planning.generateToSee')}</p>
                  </div>
                )}

                {/* Unscheduled tasks list */}
                {(() => {
                  const unscheduled = (tasksByDate[startDate] || []).filter((t: Task) => !t.scheduledTime);
                  if (!unscheduled.length) return null;
                  return (
                    <div>
                      <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        {t('planning.unscheduled')} ({unscheduled.length})
                      </p>
                      <div className="space-y-1.5">
                        {unscheduled.map((task: Task) => (
                          <TaskCard key={task.id} task={task} compact />
                        ))}
                      </div>
                      <p className="text-[9px] text-slate-400 dark:text-gray-500 mt-2">{t('planning.dragToSchedule')}</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          <TaskWorkspace
            task={workspaceTask as any}
            project={workspaceTask?.projectId ? (projects.find(p => p.id === workspaceTask.projectId) ?? null) : null}
            open={!!workspaceTask}
            onClose={() => setWorkspaceTask(null)}
          />
        </div>
      </div>
    </div>
  );
}
