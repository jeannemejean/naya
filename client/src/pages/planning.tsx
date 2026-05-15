import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
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
  milestoneId?: number | null;
  source?: string | null;
  taskEnergyType?: string | null;
  workflowGroup?: string | null;
  setupCost?: string | null;
  canBeFragmented?: boolean | null;
  recommendedTimeOfDay?: string | null;
  _virtual?: boolean;
}

type ViewScope = 'day' | 'week' | 'month';

const ENERGY_BADGES: Record<string, { symbol: string; label: string; cls: string }> = {
  deep_work:  { symbol: '◆', label: 'Focus',       cls: 'bg-naya-olive-10 text-naya-olive border border-naya-olive-18' },
  creative:   { symbol: '◇', label: 'Créatif',     cls: 'bg-[rgba(212,201,122,0.18)] text-[#5a4f0d] border border-[rgba(212,201,122,0.40)]' },
  admin:      { symbol: '—', label: 'Admin',       cls: 'bg-naya-olive-06 text-naya-olive-55 border border-naya-olive-10' },
  social:     { symbol: '◯', label: 'Social',      cls: 'bg-[rgba(125,143,168,0.18)] text-[#354963] border border-[rgba(125,143,168,0.40)]' },
  logistics:  { symbol: '▷', label: 'Logistique',  cls: 'bg-[rgba(158,126,135,0.18)] text-[#5c3d45] border border-[rgba(158,126,135,0.40)]' },
  execution:  { symbol: '▶', label: 'Exécution',   cls: 'bg-[rgba(212,201,122,0.12)] text-[#4a3e08] border border-[rgba(212,201,122,0.30)]' },
};

const CATEGORY_COLORS: Record<string, string> = {
  revenue:       'bg-[rgba(212,201,122,0.18)] text-[#5a4f0d] border border-[rgba(212,201,122,0.40)]',
  visibility:    'bg-[rgba(125,143,168,0.18)] text-[#354963] border border-[rgba(125,143,168,0.40)]',
  relationships: 'bg-[rgba(158,126,135,0.18)] text-[#5c3d45] border border-[rgba(158,126,135,0.40)]',
  operations:    'bg-naya-olive-06 text-naya-olive-55 border border-naya-olive-10',
  growth:        'bg-naya-olive-10 text-naya-olive border border-naya-olive-18',
};

const PROJECT_COLORS = [
  '#D4C97A', '#7D8FA8', '#9E7E87', '#2B2D1C',
  '#b8af6a', '#6d7e93', '#8e6e76',
];

const TIME_OF_DAY_HINTS: Record<string, { emoji: string; label: string }> = {
  morning:   { emoji: '○', label: 'Morning' },
  afternoon: { emoji: '◑', label: 'Afternoon' },
  evening:   { emoji: '◆', label: 'Evening' },
  anytime:   { emoji: '—', label: 'Anytime' },
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
  const [location, setLocation] = useLocation();

  // Parse URL params ?date=YYYY-MM-DD&taskId=<id>
  const urlParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      date: params.get('date'),
      taskId: params.get('taskId') ? Number(params.get('taskId')) : null,
    };
  }, [location]);

  const [viewScope, setViewScope] = useState<ViewScope>('week');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('date');
    if (d) { const parsed = new Date(d + 'T12:00:00'); if (!isNaN(parsed.getTime())) return parsed; }
    return new Date();
  });
  const [workspaceTask, setWorkspaceTask] = useState<Task | null>(null);
  const [milestoneConfirmTarget, setMilestoneConfirmTarget] = useState<Task | null>(null);
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    // Note: auto-open deep-linked task is handled in the effect below
    staleTime: 0, // Toujours re-fetch au focus
  });

  // Auto-open workspace for deep link ?taskId=<id>
  useEffect(() => {
    if (!urlParams.taskId || rangeTasks.length === 0 || workspaceTask) return;
    const target = rangeTasks.find(t => t.id === urlParams.taskId);
    if (target) {
      setWorkspaceTask(target);
      setLocation('/planning', { replace: true });
    }
  }, [urlParams.taskId, rangeTasks]);

  // Le planner tourne automatiquement à 06:00 via le cron serveur.
  // On ne déclenche plus le planner complet depuis l'UI pour éviter les runs
  // concurrents qui épuisaient le pool Neon et bloquaient le serveur.

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
      if (taskId < 0) return null; // tâche virtuelle (jalon) — pas de mutation
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

  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/planning/pause").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      toast({ title: t('planning.pausedTitle'), description: t('planning.pausedDesc') });
    },
    onError: () => toast({ title: t('common.error'), variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/planning/resume").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      toast({ title: t('planning.resumedTitle'), description: t('planning.resumedDesc') });
    },
    onError: () => toast({ title: t('common.error'), variant: "destructive" }),
  });

  const restartMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/planning/restart").then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: t('planning.restartedTitle'), description: t('planning.restartedDesc', { count: data.tasksDeleted }) });
    },
    onError: () => toast({ title: t('common.error'), variant: "destructive" }),
  });

  const confirmMilestoneMutation = useMutation({
    mutationFn: async (milestoneId: number) => {
      const res = await apiRequest("POST", `/api/milestones/${milestoneId}/confirm`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: "Jalon confirmé", description: "Le jalon suivant est maintenant débloqué." });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de confirmer le jalon.", variant: "destructive" }),
  });

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
              {energyBadge.symbol}{energyBadge.label.slice(0, 3)}
            </span>
          )}
          <span className="truncate text-naya-olive-70">{task.title}</span>
          {isBlocked && <span className="flex-shrink-0 text-naya-olive-35 text-[9px]">○</span>}
        </div>
      );
    }

    const TASK_PALETTES = [
      { bg: 'rgba(212,201,122,0.18)', text: '#5a4f0d', border: 'rgba(212,201,122,0.45)' },
      { bg: 'rgba(125,143,168,0.18)', text: '#354963', border: 'rgba(125,143,168,0.45)' },
      { bg: 'rgba(158,126,135,0.18)', text: '#5c3d45', border: 'rgba(158,126,135,0.45)' },
      { bg: 'rgba(43,45,28,0.08)',    text: '#2B2D1C', border: 'rgba(43,45,28,0.22)'   },
      { bg: 'rgba(212,201,122,0.11)', text: '#4a3e08', border: 'rgba(212,201,122,0.30)' },
      { bg: 'rgba(125,143,168,0.11)', text: '#354963', border: 'rgba(125,143,168,0.30)' },
      { bg: 'rgba(158,126,135,0.11)', text: '#5c3d45', border: 'rgba(158,126,135,0.30)' },
    ];
    const palette = task.projectId && !isBlocked && !task.completed
      ? TASK_PALETTES[task.projectId % TASK_PALETTES.length]
      : null;

    return (
      <div
        className={`flex items-start gap-3 p-3.5 rounded-lg border transition-shadow cursor-pointer hover:shadow-rest ${
          isBlocked ? 'opacity-50 bg-naya-olive-06 border-naya-olive-10'
          : task.completed ? 'opacity-40 bg-naya-olive-06 border-naya-olive-10'
          : 'border-transparent'
        }`}
        style={palette ? { backgroundColor: palette.bg, borderColor: palette.border } : undefined}
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
            {isBlocked && <span className="text-[11px] text-naya-olive-35">○</span>}
            <p
              className={`text-sm font-medium leading-snug ${task.completed ? 'line-through opacity-40' : ''}`}
              style={palette ? { color: palette.text } : undefined}
            >
              {task.title}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {energyBadge && (
              <span
                className={`font-display uppercase tracking-xwide text-[9px] px-1.5 py-0.5 rounded-pill border ${energyBadge.cls}`}
              >
                {energyBadge.symbol} {energyBadge.label}
              </span>
            )}
            {task.estimatedDuration && (
              <span
                className="text-[10px] flex items-center gap-0.5 opacity-50 font-mono"
                style={palette ? { color: palette.text } : undefined}
              >
                <Clock className="h-2.5 w-2.5" />{task.estimatedDuration}min
              </span>
            )}
            {project && (
              <span
                className="text-[10px] opacity-50"
                style={palette ? { color: palette.text } : undefined}
              >
                {project.name}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 flex flex-col min-h-0 bg-card">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-naya-olive-10 flex-shrink-0">
            <div className="flex items-center gap-5">
              <div>
                <h1 className="font-display uppercase tracking-xwide text-[11px] text-foreground">{t('planning.title')}</h1>
                <p className="text-xs text-naya-olive-55 mt-0.5">{headerLabel}</p>
              </div>
              <div className="flex items-center gap-px bg-naya-olive-06 border border-naya-olive-10 rounded-sm p-0.5">
                {(['day', 'week', 'month'] as ViewScope[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setViewScope(v)}
                    className={`font-display uppercase tracking-xwide text-[9px] px-3 py-1.5 rounded-xs transition-colors cursor-pointer ${
                      viewScope === v
                        ? 'bg-naya-olive text-naya-cream'
                        : 'text-naya-olive-55 hover:text-naya-olive'
                    }`}
                  >
                    {t(`planning.${v}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-naya-olive-06 border border-naya-olive-10 rounded-sm p-0.5">
              <button
                onClick={() => navigate(-1)}
                className="p-1.5 rounded-xs hover:bg-naya-olive-10 transition-colors text-naya-olive-55 hover:text-naya-olive cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setSelectedDate(new Date())}
                className="font-display uppercase tracking-xwide text-[9px] px-3 py-1.5 rounded-xs text-naya-olive-55 hover:bg-naya-olive-10 hover:text-naya-olive transition-colors cursor-pointer"
              >
                {t('common.today')}
              </button>
              <button
                onClick={() => navigate(1)}
                className="p-1.5 rounded-xs hover:bg-naya-olive-10 transition-colors text-naya-olive-55 hover:text-naya-olive cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Planning status controls */}
            <div className="flex items-center gap-2 ml-3">
              {preferences?.planningStatus === 'paused' ? (
                <button
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="flex items-center gap-1.5 font-display uppercase tracking-xwide text-[9px] px-3 py-1.5 rounded-sm bg-naya-sulphur/20 border border-naya-sulphur/40 text-naya-olive hover:bg-naya-sulphur/30 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="text-[10px]">▶</span>
                  {t('planning.resume')}
                </button>
              ) : (
                <button
                  onClick={() => pauseMutation.mutate()}
                  disabled={pauseMutation.isPending}
                  className="flex items-center gap-1.5 font-display uppercase tracking-xwide text-[9px] px-3 py-1.5 rounded-sm border border-naya-olive-18 text-naya-olive-55 hover:text-naya-olive hover:border-naya-olive-35 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="text-[10px]">◑</span>
                  {t('planning.pause')}
                </button>
              )}
              <button
                onClick={() => setRestartConfirmOpen(true)}
                className="flex items-center gap-1.5 font-display uppercase tracking-xwide text-[9px] px-3 py-1.5 rounded-sm border border-naya-olive-18 text-naya-olive-55 hover:text-naya-olive hover:border-naya-olive-35 transition-colors cursor-pointer"
              >
                <span className="text-[10px]">◈</span>
                {t('planning.restart')}
              </button>
            </div>
          </div>

          {/* Paused banner */}
          {preferences?.planningStatus === 'paused' && (
            <div className="px-5 py-2.5 bg-naya-sulphur/10 border-b border-naya-sulphur/20 flex items-center justify-between">
              <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55">
                {t('planning.pausedBanner')}
              </p>
              <button
                onClick={() => resumeMutation.mutate()}
                className="font-display uppercase tracking-xwide text-[9px] text-naya-olive underline cursor-pointer hover:no-underline"
              >
                {t('planning.resume')}
              </button>
            </div>
          )}

          {/* Restart confirmation dialog */}
          <AlertDialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display uppercase tracking-xwide text-[11px]">
                  {t('planning.restartConfirmTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[13px] text-naya-olive-55">
                  {t('planning.restartConfirmDesc')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="font-display uppercase tracking-xwide text-[9px]">
                  {t('common.cancel')}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { setRestartConfirmOpen(false); restartMutation.mutate(); }}
                  className="font-display uppercase tracking-xwide text-[9px] bg-naya-olive text-naya-cream hover:opacity-90"
                >
                  {t('planning.restartConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
                  <div key={d} className="text-center font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 py-1">
                    {t(`planning.days.${d}`)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  if (!day) {
                    return <div key={`empty-${i}`} className="h-28 rounded bg-naya-olive-06/40" />;
                  }
                  const dateKey = formatDate(day);
                  const isToday = dateKey === today;
                  const isPast  = dateKey < today;
                  const dayTasks = tasksByDate[dateKey] || [];
                  const avail   = availabilityData.find((a: any) => a.date === dateKey);
                  const dayType = avail?.dayType;
                  const visible  = dayTasks.slice(0, 4);
                  const overflow = dayTasks.length - visible.length;

                  const DAY_TYPE_SYMBOL: Record<string, string> = {
                    off: '○', 'deep-work': '◆', travel: '→', 'half-am': '◑', 'half-pm': '◐',
                  };

                  return (
                    <div
                      key={dateKey}
                      className={`h-28 border p-2 flex flex-col cursor-pointer transition-shadow hover:shadow-rest rounded ${
                        isToday  ? 'border-naya-olive bg-naya-olive-06'
                        : isPast ? 'border-naya-olive-10 opacity-50'
                        : 'border-naya-olive-10 hover:border-naya-olive-18 bg-card'
                      }`}
                      onClick={() => { setSelectedDate(day); setViewScope('day'); }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`font-display text-[11px] ${isToday ? 'text-naya-olive font-medium' : 'text-naya-olive-55'}`}>
                          {day.getDate()}
                        </span>
                        {dayType && dayType !== 'full' && (
                          <span className="text-[9px] text-naya-olive-35 font-mono">
                            {DAY_TYPE_SYMBOL[dayType] || ''}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5 flex-1 overflow-hidden">
                        {visible.map((task: Task) => {
                          const MONTH_PALETTES = [
                            { bg: 'rgba(212,201,122,0.18)', text: '#5a4f0d' },
                            { bg: 'rgba(125,143,168,0.18)', text: '#354963' },
                            { bg: 'rgba(158,126,135,0.18)', text: '#5c3d45' },
                            { bg: 'rgba(43,45,28,0.08)',    text: '#2B2D1C' },
                          ];
                          const pal = MONTH_PALETTES[(task.projectId || 0) % MONTH_PALETTES.length];
                          return (
                            <div
                              key={task.id}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[9px] truncate"
                              style={{ backgroundColor: pal.bg, color: pal.text }}
                              onClick={e => { e.stopPropagation(); setWorkspaceTask(task); }}
                            >
                              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: pal.text, opacity: 0.5 }} />
                              <span className="truncate">{task.title}</span>
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <p className="text-[9px] text-naya-olive-35 pl-1">+{overflow}</p>
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
                <div className="mx-1 mb-2 bg-naya-olive-06 border border-naya-olive-18 rounded-lg px-3 py-1.5 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Brain className="h-3 w-3 text-naya-olive-55 flex-shrink-0" />
                    <p className="text-[11px] text-naya-olive-70 truncate flex-1">{lastStrategySignal.focus}</p>
                    {lastStrategySignal.reasoning && (
                      <button
                        onClick={() => setStrategyExpanded(!strategyExpanded)}
                        className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 hover:text-naya-olive flex-shrink-0 whitespace-nowrap cursor-pointer"
                      >
                        {strategyExpanded ? t('planning.less') : 'Pourquoi ?'}
                      </button>
                    )}
                  </div>
                  {strategyExpanded && lastStrategySignal.reasoning && (
                    <div className="mt-1.5 space-y-1.5 border-t border-naya-olive-10 pt-1.5">
                      <p className="text-[11px] text-naya-olive-55 leading-relaxed">{lastStrategySignal.reasoning}</p>
                      {lastStrategySignal.bottleneck && (
                        <p className="text-[10px] text-naya-olive-70"><span className="font-medium">Blocage :</span> {lastStrategySignal.bottleneck}</p>
                      )}
                      {lastStrategySignal.suggestedNextMove && (
                        <p className="text-[10px] text-naya-olive"><span className="font-medium">→ Prochain move :</span> {lastStrategySignal.suggestedNextMove}</p>
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
                onTaskClick={(task) => {
                  if (task._virtual || task.id < 0 || task.type === 'milestone') { setMilestoneConfirmTarget(task); return; }
                  setWorkspaceTask(task);
                }}
                onToggle={(taskId) => toggleMutation.mutate(taskId)}
                onMilestoneConfirm={(mid) => confirmMilestoneMutation.mutate(mid)}
                rangeQueryKey={rangeQueryKey}
              />
            </div>
          ) : (
            // ─── DAY TIME-GRID VIEW ──────────────────────────────────
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {lastStrategySignal && (
                  <div className="mx-1 mb-2 bg-[rgba(125,143,168,0.10)] border border-[rgba(125,143,168,0.28)] rounded-lg px-3 py-1.5 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5 text-naya-salvia flex-shrink-0" />
                      <p className="text-[11px] text-[#354963] truncate flex-1">{lastStrategySignal.focus}</p>
                      {lastStrategySignal.reasoning && (
                        <button
                          onClick={() => setStrategyExpanded(!strategyExpanded)}
                          className="text-[10px] text-naya-salvia hover:text-[#354963] flex-shrink-0 whitespace-nowrap"
                        >
                          {strategyExpanded ? t('planning.less') : 'Why these tasks?'}
                        </button>
                      )}
                    </div>
                    {strategyExpanded && lastStrategySignal.reasoning && (
                      <div className="mt-1.5 space-y-1.5 border-t border-[rgba(125,143,168,0.20)] pt-1.5">
                        <p className="text-[11px] text-[#354963] leading-relaxed">{lastStrategySignal.reasoning}</p>
                        {lastStrategySignal.bottleneck && (
                          <p className="text-[10px] text-[#5a4f0d]"><span className="font-medium">! Bottleneck:</span> {lastStrategySignal.bottleneck}</p>
                        )}
                        {lastStrategySignal.suggestedNextMove && (
                          <p className="text-[10px] text-naya-olive"><span className="font-medium">→ Next move:</span> {lastStrategySignal.suggestedNextMove}</p>
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
                  onTaskClick={(task) => {
                    if (task._virtual || task.id < 0 || task.type === 'milestone') { setMilestoneConfirmTarget(task); return; }
                    setWorkspaceTask(task);
                  }}
                  onToggle={(taskId) => toggleMutation.mutate(taskId)}
                  onMilestoneConfirm={(mid) => confirmMilestoneMutation.mutate(mid)}
                  rangeQueryKey={rangeQueryKey}
                />
              </div>

              {/* Right panel — strategy + feedback (day view only) */}
              <div className="w-72 flex-shrink-0 border-l border-naya-olive-10 overflow-y-auto p-4 flex flex-col gap-4">
                {/* Daily feedback */}
                {startDate === today && (tasksByDate[startDate] || []).length > 0 && !todayFeedbackStored && !dailyFeedbackGiven && (
                  <div className="p-3.5 border border-naya-olive-18 rounded-lg bg-naya-olive-06">
                    <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55 mb-2">{t('planning.howDidTodayGo')}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {DAILY_FEEDBACK_OPTIONS.map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => handleDailyFeedback(opt.key)}
                          className="font-display uppercase tracking-xwide text-[9px] px-2.5 py-1.5 rounded-sm border border-naya-olive-18 hover:border-naya-olive-35 hover:bg-naya-olive-10 transition-colors text-naya-olive-55 hover:text-naya-olive cursor-pointer"
                        >
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {startDate === today && (dailyFeedbackGiven || todayFeedbackStored) && dailyFeedbackThanks && (
                  <p className="font-display uppercase tracking-xwide text-[9px] text-center text-naya-olive-35">{t('planning.thanksFeedback')}</p>
                )}

                {/* Strategy panel */}
                {lastStrategySignal ? (
                  <div className="border border-naya-olive-18 rounded-lg bg-naya-olive-06 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55">
                        {t('planning.nayasReadToday')}
                      </span>
                      <span className="text-[9px] text-naya-olive-35">{lastStrategySignal.generatedAt}</span>
                    </div>
                    <div className="mb-3">
                      <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-1">{t('planning.focus')}</p>
                      <p className="text-xs text-foreground">{lastStrategySignal.focus}</p>
                    </div>
                    {lastStrategySignal.reasoning && (
                      <div className="mb-3">
                        <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-1">{t('planning.whyTheseTasks')}</p>
                        <p className={`text-xs text-naya-olive-70 leading-relaxed ${!strategyExpanded ? 'line-clamp-4' : ''}`}>
                          {lastStrategySignal.reasoning}
                        </p>
                        {lastStrategySignal.reasoning.length > 150 && (
                          <button onClick={() => setStrategyExpanded(v => !v)} className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-55 hover:text-naya-olive mt-1 cursor-pointer">
                            {strategyExpanded ? t('planning.less') : t('planning.more')}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="space-y-2">
                      {lastStrategySignal.bottleneck && (
                        <div className="bg-naya-olive-10 rounded-sm p-2">
                          <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-0.5">{t('planning.bottleneck')}</p>
                          <p className="text-[10px] text-naya-olive-70">{lastStrategySignal.bottleneck}</p>
                        </div>
                      )}
                      {lastStrategySignal.suggestedNextMove && (
                        <div className="bg-naya-olive-10 rounded-sm p-2">
                          <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-0.5">{t('planning.nextMove')}</p>
                          <p className="text-[10px] text-naya-olive-70">{lastStrategySignal.suggestedNextMove}</p>
                        </div>
                      )}
                    </div>
                    {lastStrategySignal.skippedProjects && lastStrategySignal.skippedProjects.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-naya-olive-10">
                        <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-1">{t('planning.projectsWithoutTasks')}</p>
                        {lastStrategySignal.skippedProjects.map((sp, i) => (
                          <p key={i} className="text-[10px] text-naya-olive-55">{sp.name}: {sp.reason}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-dashed border-naya-olive-18 rounded-lg p-5 text-center">
                    <p className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-35 mb-1">{t('planning.nayasStrategicRead')}</p>
                    <p className="text-[10px] text-naya-olive-35">{t('planning.generateToSee')}</p>
                  </div>
                )}

                {/* Unscheduled tasks list */}
                {(() => {
                  const unscheduled = (tasksByDate[startDate] || []).filter((t: Task) => !t.scheduledTime && (t as any).source !== 'gcal');
                  if (!unscheduled.length) return null;
                  return (
                    <div>
                      <p className="text-[10px] text-naya-olive-55 uppercase tracking-wide mb-2">
                        {t('planning.unscheduled')} ({unscheduled.length})
                      </p>
                      <div className="space-y-1.5">
                        {unscheduled.map((task: Task) => (
                          <TaskCard key={task.id} task={task} compact />
                        ))}
                      </div>
                      <p className="text-[9px] text-naya-olive-35 mt-2">{t('planning.dragToSchedule')}</p>
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

          {/* Dialog de confirmation de jalon */}
          <AlertDialog open={!!milestoneConfirmTarget} onOpenChange={(o) => { if (!o) setMilestoneConfirmTarget(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {(milestoneConfirmTarget as any)?.milestoneStatus === 'locked'
                    ? '○ Jalon bloqué'
                    : '→ Confirmer ce jalon'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {(milestoneConfirmTarget as any)?.milestoneStatus === 'locked' ? (
                    <>Ce jalon est <strong>bloqué</strong> — il sera débloqué automatiquement une fois le jalon précédent complété.</>
                  ) : (
                    <>Confirmer que <strong>«&nbsp;{milestoneConfirmTarget?.title}&nbsp;»</strong> est accompli ?
                    Cela débloquera le jalon suivant et créera ses tâches dans ton planning.</>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setMilestoneConfirmTarget(null)}>Annuler</AlertDialogCancel>
                {(milestoneConfirmTarget as any)?.milestoneStatus !== 'locked' && (
                  <AlertDialogAction
                    onClick={() => {
                      const mid = milestoneConfirmTarget?.milestoneId;
                      if (mid) confirmMilestoneMutation.mutate(mid);
                      setMilestoneConfirmTarget(null);
                    }}
                    className="bg-naya-sulphur hover:opacity-90 text-naya-olive"
                  >
                    ✓ Confirmer le jalon
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
