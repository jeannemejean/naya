import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Loader2, Plus, List, LayoutGrid, Clock, CheckCircle2, Circle, X, RotateCcw } from "lucide-react";
import { useProject } from "@/lib/project-context";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";
import { useTranslation } from "react-i18next";
import TaskWorkspace from "@/components/task-workspace";
import TaskFeedbackModal from "@/components/task-feedback-modal";
import type { Project } from "@shared/schema";

interface Task {
  id: number;
  title: string;
  description: string;
  type: string;
  category: string;
  priority: number;
  completed: boolean;
  completedAt?: string;
  dueDate?: string;
  projectId?: number;
  suggestedStartTime?: string;
  suggestedEndTime?: string;
  estimatedDuration?: number;
  source?: string;
  taskEnergyType?: string;
  setupCost?: string;
  canBeFragmented?: boolean;
  recommendedTimeOfDay?: string;
  workflowGroup?: string;
  activationPrompt?: string;
}

const ENERGY_BADGES: Record<string, { emoji: string; label: string; cls: string }> = {
  deep_work:  { emoji: '🎯', label: 'Focus',     cls: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' },
  creative:   { emoji: '✨', label: 'Creative',  cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
  admin:      { emoji: '📋', label: 'Admin',     cls: 'bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-400' },
  social:     { emoji: '💬', label: 'Social',    cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
  logistics:  { emoji: '📦', label: 'Logistics', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
  execution:  { emoji: '⚡', label: 'Execute',   cls: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500' },
};

const TIME_OF_DAY_HINTS: Record<string, { emoji: string; label: string }> = {
  morning:   { emoji: '🌅', label: 'Morning' },
  afternoon: { emoji: '☀️', label: 'Afternoon' },
  evening:   { emoji: '🌙', label: 'Evening' },
};

const CATEGORY_COLORS: Record<string, string> = {
  trust: 'bg-secondary/10 text-secondary',
  conversion: 'bg-accent/10 text-accent',
  engagement: 'bg-info/10 text-info',
  visibility: 'bg-primary/10 text-primary',
  planning: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
};

const TYPE_ICONS: Record<string, string> = {
  content: '📝',
  outreach: '📧',
  admin: '⚙️',
  planning: '🗺️',
};

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

function formatHour(h: number) {
  return h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
}

function getProjectColor(projectId: number | undefined, projects: Project[]): string {
  if (!projectId) return '#6366f1';
  const p = projects.find(p => p.id === projectId);
  return p?.color || '#6366f1';
}

function PlannerTaskPopover({ task, projects, onToggle, isToggling }: {
  task: Task;
  projects: Project[];
  onToggle: (task: Task) => void;
  isToggling: boolean;
}) {
  const { t } = useTranslation();
  const projColor = getProjectColor(task.projectId, projects);
  const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;

  return (
    <PopoverContent className="w-72 p-4" side="right" align="start">
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <span className="text-base mt-0.5">{TYPE_ICONS[task.type] || '📋'}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-slate-900 dark:text-white leading-tight">{task.title}</p>
            {task.description && (
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 line-clamp-3">{task.description}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {task.category && (
            <Badge className={`${CATEGORY_COLORS[task.category] || 'bg-slate-100 text-slate-600'} text-xs h-5 border-0`}>
              {task.category}
            </Badge>
          )}
          {task.estimatedDuration && (
            <span className="text-xs text-slate-400 dark:text-gray-500 flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {task.estimatedDuration}m
            </span>
          )}
          {project && (
            <span className="text-xs flex items-center gap-1" style={{ color: projColor }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: projColor }} />
              {project.icon} {project.name}
            </span>
          )}
        </div>

        {(task as any).activationPrompt && !task.completed && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-md px-2.5 py-2">
            <p className="text-[11px] text-indigo-600 dark:text-indigo-300 leading-snug">
              <span className="font-medium">{t('todaysTasks.toStart')} </span>{(task as any).activationPrompt}
            </p>
          </div>
        )}

        <Button
          size="sm"
          variant={task.completed ? "outline" : "default"}
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => onToggle(task)}
          disabled={isToggling}
        >
          {isToggling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : task.completed ? (
            <><Circle className="h-3 w-3" />{t('todaysTasks.markIncomplete')}</>
          ) : (
            <><CheckCircle2 className="h-3 w-3" />{t('todaysTasks.markComplete')}</>
          )}
        </Button>
      </div>
    </PopoverContent>
  );
}

export default function TodaysTasks() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeProjectId } = useProject();
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'planner'>('list');
  const [openPopover, setOpenPopover] = useState<number | null>(null);
  const [workspaceTask, setWorkspaceTask] = useState<Task | null>(null);
  const { triggerAutoRebalance } = useAutoRebalance();
  const [feedbackTask, setFeedbackTask] = useState<Task | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanPreview, setReplanPreview] = useState<any>(null);
  const [replanLoading, setReplanLoading] = useState(false);

  const today = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const tasksQueryKey = activeProjectId
    ? ['/api/tasks/range', { start: today, end: today, projectId: activeProjectId }]
    : ['/api/tasks/range', { start: today, end: today }];

  const tasksUrl = activeProjectId
    ? `/api/tasks/range?start=${today}&end=${today}&projectId=${activeProjectId}`
    : `/api/tasks/range?start=${today}&end=${today}`;

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: tasksQueryKey,
    queryFn: async () => {
      const res = await fetch(tasksUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects?limit=200'],
  });

  const { data: dependencies = [] } = useQuery<any[]>({
    queryKey: ['/api/tasks/dependencies', activeProjectId],
    queryFn: async () => {
      const url = activeProjectId ? `/api/tasks/dependencies?projectId=${activeProjectId}` : '/api/tasks/dependencies';
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const blockedByMap: Record<number, number> = {};
  const followsMap: Record<number, number> = {};
  for (const dep of dependencies) {
    if (dep.relationType === 'blocked_by') blockedByMap[dep.taskId] = dep.dependsOnTaskId;
    else if (dep.relationType === 'follows') followsMap[dep.taskId] = dep.dependsOnTaskId;
  }

  const deleteFeedbackMutation = useMutation({
    mutationFn: async ({ taskId, feedbackType, reason, freeText }: { taskId: number; feedbackType: string; reason: string; freeText?: string }) => {
      if (feedbackType === 'deleted') {
        const res = await apiRequest("DELETE", `/api/tasks/${taskId}`, { feedbackType, reason, freeText });
        return res.json();
      } else {
        const res = await apiRequest("POST", `/api/tasks/${taskId}/feedback`, { feedbackType, reason, freeText });
        return res.json();
      }
    },
    onSuccess: (_, vars) => {
      if (vars.feedbackType === 'deleted') {
        queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
        toast({ title: t('todaysTasks.taskRemoved') });
        triggerAutoRebalance();
      } else {
        toast({ title: t('todaysTasks.nayaNotedFeedback') });
      }
      setFeedbackTask(null);
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('todaysTasks.failedFeedback'), variant: "destructive" });
    },
  });

  const replanMutation = useMutation({
    mutationFn: async () => {
      setReplanLoading(true);
      const res = await apiRequest("POST", "/api/tasks/replan", { projectId: activeProjectId, scope: "today" });
      return res.json();
    },
    onSuccess: (data) => {
      setReplanPreview(data);
      setReplanOpen(true);
      setReplanLoading(false);
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('todaysTasks.failedReplan'), variant: "destructive" });
      setReplanLoading(false);
    },
  });

  const applyReplanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks/replan/apply", {
        tasks: replanPreview?.suggestedTasks,
        projectId: activeProjectId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setReplanOpen(false);
      setReplanPreview(null);
      toast({ title: t('todaysTasks.replanApplied'), description: t('todaysTasks.replanAppliedDescription') });
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('todaysTasks.failedApplyReplan'), variant: "destructive" });
    },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest("POST", `/api/tasks/${taskId}/toggle`);
      return res.json();
    },
    onSuccess: (updatedTask: Task) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/schedule-preview'] });
      setOpenPopover(null);
      const msg = updatedTask.completed ? t('todaysTasks.taskCompleted') : t('todaysTasks.taskMarkedIncomplete');
      toast({ title: msg });
      triggerAutoRebalance();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: t('todaysTasks.unauthorized'), description: t('todaysTasks.loggingIn'), variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: t('common.error'), description: t('todaysTasks.failedUpdateTask'), variant: "destructive" });
    },
  });

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      const now = new Date();
      const clientTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const d = now;
      const clientToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const body = activeProjectId
        ? { projectId: activeProjectId, clientToday, clientTime }
        : { clientToday, clientTime };
      const res = await apiRequest("POST", "/api/tasks/generate-daily", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      const rr = data?.realismReport;
      if (rr && (rr.deferredCount > 0 || rr.workflowBundlesDeferredCount > 0 || rr.contextSwitchCorrected)) {
        const parts: string[] = [t('todaysTasks.tasksGenerated')];
        if (rr.deferredCount > 0) parts.push(t('todaysTasks.movedTomorrow', { count: rr.deferredCount }));
        if (rr.workflowBundlesDeferredCount > 0) parts.push(t('todaysTasks.bundlesPreserved', { count: rr.workflowBundlesDeferredCount }));
        if (rr.contextSwitchCorrected) parts.push(t('todaysTasks.contextSwitchBalanced'));
        toast({ title: parts[0], description: parts.slice(1).join(' · ') || undefined });
      } else {
        toast({ title: t('todaysTasks.newTasksGenerated'), description: t('todaysTasks.newTasksDescription') });
      }
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: t('todaysTasks.unauthorized'), variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      const errMsg = error?.message || '';
      const message = errMsg.includes("429") || errMsg.includes("quota")
        ? t('todaysTasks.aiUnavailable')
        : t('todaysTasks.failedGenerateTasks');
      toast({ title: t('todaysTasks.tasksGeneration'), description: message, variant: "destructive" });
    },
    onSettled: () => setIsGenerating(false),
  });

  const completedTasks = tasks.filter((t: Task) => t.completed);
  const pendingTasks = tasks.filter((t: Task) => !t.completed);
  const scheduledTasks = pendingTasks.filter((t: Task) => t.suggestedStartTime);
  const unscheduledTasks = pendingTasks.filter((t: Task) => !t.suggestedStartTime);

  function getTaskPosition(task: Task): { top: number; height: number } {
    if (!task.suggestedStartTime) return { top: 0, height: 60 };
    const start = new Date(task.suggestedStartTime);
    const startHour = start.getHours() + start.getMinutes() / 60;
    const duration = task.estimatedDuration || 30;
    const slotHeight = 64;
    const top = (startHour - 7) * slotHeight;
    const height = Math.max(40, (duration / 60) * slotHeight);
    return { top, height };
  }

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-slate-200 dark:border-gray-700">
        <div className="p-6 border-b border-slate-200 dark:border-gray-700">
          <h2 className="text-lg text-slate-900 dark:text-white">{t('todaysTasks.title')}</h2>
        </div>
        <div className="p-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-slate-200 dark:border-gray-700">
      <div className="p-5 border-b border-slate-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base text-slate-900 dark:text-white">{t('todaysTasks.title')}</h2>
            <span className="text-xs text-slate-500 dark:text-gray-400">
              {completedTasks.length}/{tasks.length} {t('todaysTasks.done')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-slate-400'}`}
                title={t('todaysTasks.listView')}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('planner')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'planner' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-slate-400'}`}
                title={t('todaysTasks.timelineView')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-500 dark:text-gray-400 text-sm">{t('todaysTasks.noTasks')}</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-3">
            {completedTasks.map((task: Task) => {
              const projColor = getProjectColor(task.projectId, projects);
              return (
                <div
                  key={task.id}
                  data-task-title={task.title}
                  className="flex items-start space-x-3 p-3.5 bg-secondary/5 dark:bg-green-900/10 rounded-lg border border-secondary/20 dark:border-green-800/20"
                  style={{ borderLeftWidth: 3, borderLeftColor: projColor }}
                >
                  <Checkbox
                    checked={true}
                    onCheckedChange={() => toggleTaskMutation.mutate(task.id)}
                    disabled={toggleTaskMutation.isPending}
                    className="mt-0.5 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-900 dark:text-white line-through text-sm">{task.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {task.category && (
                        <Badge className={`${CATEGORY_COLORS[task.category] || 'bg-slate-100 text-slate-600'} text-xs h-4 border-0`}>
                          {task.category}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-500 dark:text-gray-400">
                        ✅ {task.completedAt ? new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : t('todaysTasks.done')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {(() => {
              const grouped: { group: string | null; tasks: Task[] }[] = [];
              const seen = new Set<string>();
              for (const task of pendingTasks) {
                const g = task.workflowGroup || null;
                if (g && !seen.has(g)) {
                  seen.add(g);
                  grouped.push({ group: g, tasks: pendingTasks.filter(t => t.workflowGroup === g) });
                } else if (!g) {
                  grouped.push({ group: null, tasks: [task] });
                }
              }
              const ordered = [
                ...grouped.filter(g => g.group !== null),
                ...grouped.filter(g => g.group === null),
              ];

              return ordered.map(({ group, tasks: groupTasks }, gIdx) => {
                const groupTotalMin = group
                  ? groupTasks.reduce((s, t) => s + (t.estimatedDuration || 0), 0)
                  : 0;
                return (
                  <div key={group ?? `ungrouped-${gIdx}`}>
                    {group && (
                      <div className="flex items-center gap-2 py-1.5 border-b border-dashed border-slate-200 dark:border-gray-700 mb-1">
                        <span className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">
                          ▸ {group}
                        </span>
                        {groupTotalMin > 0 && (
                          <span className="text-xs text-slate-400 dark:text-gray-500">·  ~{groupTotalMin}m</span>
                        )}
                        <span className="text-xs text-slate-400 dark:text-gray-500">· {groupTasks.length} {t('todaysTasks.tasksLabel')}</span>
                      </div>
                    )}
                    {groupTasks.map((task: Task) => {
                      const isBlocked = blockedByMap[task.id] !== undefined;
                      const blockerTask = isBlocked ? tasks.find((t: Task) => t.id === blockedByMap[task.id]) : null;
                      const followsTaskId = followsMap[task.id];
                      const followsTask = followsTaskId ? tasks.find((t: Task) => t.id === followsTaskId) : null;
                      const projColor = isBlocked ? '#94a3b8' : getProjectColor(task.projectId, projects);
                      const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;
                      const energyBadge = task.taskEnergyType ? ENERGY_BADGES[task.taskEnergyType] : null;
                      const todHint = task.recommendedTimeOfDay && task.recommendedTimeOfDay !== 'flexible'
                        ? TIME_OF_DAY_HINTS[task.recommendedTimeOfDay] : null;
                      return (
                        <div
                          key={task.id}
                          data-task-title={task.title}
                          className={`flex items-start space-x-3 p-3.5 border rounded-lg transition-colors ${group ? 'ml-2' : ''} ${
                            isBlocked
                              ? 'opacity-60 bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700'
                              : 'border-slate-200 dark:border-gray-700 hover:border-primary/40 dark:hover:border-primary/30'
                          }`}
                          style={{ borderLeftWidth: 3, borderLeftColor: group ? projColor : projColor }}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={false}
                              onCheckedChange={() => toggleTaskMutation.mutate(task.id)}
                              disabled={toggleTaskMutation.isPending}
                              className="mt-0.5 cursor-pointer"
                            />
                          </div>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setWorkspaceTask(task)}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isBlocked && <span className="text-base flex-shrink-0">🔒</span>}
                                <h3 className={`font-medium text-sm hover:text-primary transition-colors ${isBlocked ? 'text-slate-500 dark:text-gray-400' : 'text-slate-900 dark:text-white'}`}>
                                  {task.title}
                                </h3>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {task.type && (
                                  <span className="text-xs" title={task.type}>{TYPE_ICONS[task.type] || '📋'}</span>
                                )}
                                {task.priority && task.priority <= 2 && (
                                  <span className="text-xs">🔴</span>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setFeedbackTask(task); }}
                                  className="p-0.5 text-slate-300 hover:text-slate-500 dark:text-gray-600 dark:hover:text-gray-400 transition-colors ml-0.5"
                                  title={t('todaysTasks.removeTask')}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            {isBlocked && blockerTask && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                🔒 {t('todaysTasks.blockedBy', { title: blockerTask.title })}
                              </p>
                            )}
                            {!isBlocked && followsTask && (
                              <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
                                ↑ {t('todaysTasks.after', { title: followsTask.title })}
                              </p>
                            )}
                            <p className="text-xs text-slate-600 dark:text-gray-400 mt-0.5 line-clamp-2">{task.description}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
                              {todHint && (
                                <span className="text-[10px] text-slate-400 dark:text-gray-500">
                                  {todHint.emoji} {todHint.label}
                                </span>
                              )}
                              {task.estimatedDuration && (
                                <span className="text-xs text-slate-400 dark:text-gray-500 flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  ~{task.estimatedDuration}m
                                </span>
                              )}
                              {!activeProjectId && project && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                                  style={{ backgroundColor: `${projColor}20`, color: projColor }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: projColor }} />
                                  {project.icon} {project.name}
                                </span>
                              )}
                            </div>
                            {task.activationPrompt && (
                              <p className="text-[11px] text-indigo-500 dark:text-indigo-400 mt-1.5 italic">
                                ↳ {task.activationPrompt}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <div className="relative" style={{ minHeight: `${HOURS.length * 64}px` }}>
                {HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-slate-100 dark:border-gray-800 flex items-start"
                    style={{ top: `${(h - 7) * 64}px`, height: 64 }}
                  >
                    <span className="text-xs text-slate-400 dark:text-gray-500 w-10 flex-shrink-0 -mt-2.5 pr-2 text-right">
                      {formatHour(h)}
                    </span>
                    <div className="flex-1 ml-2 border-l border-slate-100 dark:border-gray-800 h-full" />
                  </div>
                ))}

                {scheduledTasks.map((task: Task) => {
                  const { top, height } = getTaskPosition(task);
                  const projColor = getProjectColor(task.projectId, projects);
                  const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;
                  return (
                    <Popover
                      key={task.id}
                      open={openPopover === task.id}
                      onOpenChange={(open) => setOpenPopover(open ? task.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <div
                          data-task-title={task.title}
                          className="absolute left-12 right-0 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity select-none"
                          style={{ top, height, backgroundColor: `${projColor}15`, borderLeft: `3px solid ${projColor}` }}
                        >
                          <div className="p-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{TYPE_ICONS[task.type] || '📋'}</span>
                              <p className="text-xs text-slate-900 dark:text-white truncate">{task.title}</p>
                            </div>
                            {task.estimatedDuration && height > 50 && (
                              <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5 flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {task.estimatedDuration}m
                                {project ? ` · ${project.icon} ${project.name}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </PopoverTrigger>
                      <PlannerTaskPopover
                        task={task}
                        projects={projects}
                        onToggle={(t) => toggleTaskMutation.mutate(t.id)}
                        isToggling={toggleTaskMutation.isPending}
                      />
                    </Popover>
                  );
                })}
              </div>
            </div>

            {unscheduledTasks.length > 0 && (
              <div className="w-48 flex-shrink-0">
                <p className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t('todaysTasks.unscheduled')}</p>
                <div className="space-y-2">
                  {unscheduledTasks.map((task: Task) => {
                    const projColor = getProjectColor(task.projectId, projects);
                    return (
                      <Popover
                        key={task.id}
                        open={openPopover === task.id}
                        onOpenChange={(open) => setOpenPopover(open ? task.id : null)}
                      >
                        <PopoverTrigger asChild>
                          <div
                            data-task-title={task.title}
                            className="p-2.5 rounded-lg border bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 cursor-pointer hover:border-primary/40 transition-colors select-none"
                            style={{ borderLeftWidth: 2, borderLeftColor: projColor }}
                          >
                            <p className="text-xs text-slate-900 dark:text-white line-clamp-2">{task.title}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-xs">{TYPE_ICONS[task.type] || '📋'}</span>
                              {task.estimatedDuration && (
                                <span className="text-[10px] text-slate-400 dark:text-gray-500">~{task.estimatedDuration}m</span>
                              )}
                            </div>
                          </div>
                        </PopoverTrigger>
                        <PlannerTaskPopover
                          task={task}
                          projects={projects}
                          onToggle={(t) => toggleTaskMutation.mutate(t.id)}
                          isToggling={toggleTaskMutation.isPending}
                        />
                      </Popover>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <TaskWorkspace
        task={workspaceTask as any}
        project={workspaceTask?.projectId ? (projects.find(p => p.id === workspaceTask.projectId) ?? null) : null}
        open={!!workspaceTask}
        onClose={() => setWorkspaceTask(null)}
      />

      <TaskFeedbackModal
        task={feedbackTask}
        open={!!feedbackTask}
        onClose={() => setFeedbackTask(null)}
        onConfirm={(feedbackType, reason, freeText) => {
          if (!feedbackTask) return;
          deleteFeedbackMutation.mutate({ taskId: feedbackTask.id, feedbackType, reason, freeText });
        }}
        isPending={deleteFeedbackMutation.isPending}
      />

      <Dialog open={replanOpen} onOpenChange={(v) => { if (!v) { setReplanOpen(false); setReplanPreview(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('todaysTasks.nayasReplan')}</DialogTitle>
          </DialogHeader>
          {replanPreview && (
            <div className="space-y-4">
              {replanPreview.reasoning && (
                <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-slate-600 dark:text-gray-300 italic">
                  {replanPreview.reasoning}
                </blockquote>
              )}
              {(replanPreview.blockedCount > 0 || replanPreview.deferredCount > 0) && (
                <div className="space-y-1.5">
                  {replanPreview.blockedCount > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ {t('todaysTasks.blockedTasksWarning', { count: replanPreview.blockedCount })}
                    </p>
                  )}
                  {replanPreview.deferredCount > 0 && (
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      ↩ {t('todaysTasks.deferredTasksNotice', { count: replanPreview.deferredCount })}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {(replanPreview.suggestedTasks || []).map((t: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 border border-slate-100 dark:border-gray-700 rounded-lg">
                    <span className="text-sm flex-shrink-0">{TYPE_ICONS[t.type] || '📋'}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 dark:text-white">{t.title}</p>
                      {t.category && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[t.category] || 'bg-slate-100 text-slate-600'}`}>
                          {t.category}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setReplanOpen(false); setReplanPreview(null); }}>
                  {t('todaysTasks.cancel')}
                </Button>
                <Button size="sm" className="flex-1" onClick={() => applyReplanMutation.mutate()} disabled={applyReplanMutation.isPending}>
                  {applyReplanMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />{t('todaysTasks.applying')}</> : t('todaysTasks.applyReplan')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
