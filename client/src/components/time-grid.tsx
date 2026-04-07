import { useState, useRef, useCallback, useMemo } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";
import type { Project } from "@shared/schema";

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
  estimatedDuration?: number | null;
  projectId?: number | null;
  milestoneId?: number | null;
  milestoneStatus?: string | null;
  source?: string | null;
  taskEnergyType?: string | null;
  workflowGroup?: string | null;
  recommendedTimeOfDay?: string | null;
  canBeFragmented?: boolean | null;
  _virtual?: boolean;
}

interface DayAvailability {
  date: string;
  dayType: string;
  workStart?: string | null;
  workEnd?: string | null;
  breaks?: { start: string; end: string; label?: string }[] | null;
}

interface TimeGridProps {
  dates: string[];
  tasks: Task[];
  projects: Project[];
  dependencies?: Record<number, number>;
  availability?: DayAvailability[];
  defaultWorkStart?: string;
  defaultWorkEnd?: string;
  today: string;
  onTaskClick: (task: Task) => void;
  onToggle: (taskId: number) => void;
  onMilestoneConfirm?: (milestoneId: number) => void;
  rangeQueryKey: any[];
}

// Project-based card palette (matches todays-tasks + planning)
const TASK_PALETTES = [
  { bg: '#EDE9FE', text: '#5B21B6', border: '#DDD6FE' }, // lavender
  { bg: '#FFF9C4', text: '#92400E', border: '#FDE68A' }, // yellow
  { bg: '#DCFCE7', text: '#14532D', border: '#BBF7D0' }, // green
  { bg: '#DBEAFE', text: '#1E3A5F', border: '#BFDBFE' }, // blue
  { bg: '#FFE4E6', text: '#9F1239', border: '#FECDD3' }, // pink
  { bg: '#FEF3C7', text: '#78350F', border: '#FDE68A' }, // orange
  { bg: '#CFFAFE', text: '#164E63', border: '#A5F3FC' }, // cyan
];

// Dark-mode variants
const TASK_PALETTES_DARK = [
  { bg: '#2D1B6B', text: '#C4B5FD', border: '#4C3999' },
  { bg: '#3D2E00', text: '#FDE68A', border: '#6B4E00' },
  { bg: '#0A2E1A', text: '#86EFAC', border: '#14532D' },
  { bg: '#0C1E3D', text: '#93C5FD', border: '#1E3A5F' },
  { bg: '#3D0A0F', text: '#FCA5A5', border: '#7F1D1D' },
  { bg: '#3D2200', text: '#FCD34D', border: '#713F12' },
  { bg: '#062030', text: '#67E8F9', border: '#0C4A6E' },
];

const PROJECT_COLORS = [
  '#6C5CE7', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
];

function getProjectColor(projectId: number | null | undefined) {
  if (!projectId) return '#6C5CE7';
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length];
}

function getTaskPalette(task: Task, isDark: boolean) {
  const idx = task.projectId ? task.projectId % TASK_PALETTES.length : 0;
  return isDark ? TASK_PALETTES_DARK[idx] : TASK_PALETTES[idx];
}

const GRID_START_HOUR = 7;   // 7 AM
const GRID_END_HOUR = 21;    // 9 PM
const TOTAL_HOURS = GRID_END_HOUR - GRID_START_HOUR;
const PX_PER_HOUR = 80;       // pixels per hour
const PX_PER_MINUTE = PX_PER_HOUR / 60;
const HOUR_LABELS = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
  const h = GRID_START_HOUR + i;
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display} ${suffix}`;
});

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesToGridPx(totalMinutes: number): number {
  const minutesFromGridStart = totalMinutes - GRID_START_HOUR * 60;
  return minutesFromGridStart * PX_PER_MINUTE;
}

function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE + GRID_START_HOUR * 60;
}

function snapToQuarter(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

function assignLanes(tasks: Task[]): Map<number, { lane: number; totalLanes: number }> {
  const sorted = [...tasks].sort((a, b) => {
    const aMin = a.scheduledTime ? timeToMinutes(a.scheduledTime) : 0;
    const bMin = b.scheduledTime ? timeToMinutes(b.scheduledTime) : 0;
    return aMin - bMin;
  });

  const laneMap = new Map<number, { lane: number; totalLanes: number }>();
  const laneEnds: number[] = [];

  for (const task of sorted) {
    const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
    const dur = task.estimatedDuration || 30;
    const endMin = startMin + dur;

    let placed = false;
    for (let l = 0; l < laneEnds.length; l++) {
      if (laneEnds[l] <= startMin) {
        laneEnds[l] = endMin;
        laneMap.set(task.id, { lane: l, totalLanes: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneEnds.push(endMin);
      laneMap.set(task.id, { lane: laneEnds.length - 1, totalLanes: 0 });
    }
  }

  const totalLanes = laneEnds.length;
  Array.from(laneMap.entries()).forEach(([id, info]) => {
    laneMap.set(id, { ...info, totalLanes });
  });

  return laneMap;
}

function DayAvailabilityBadge({
  date,
  availability,
  onSelect,
}: {
  date: string;
  availability?: DayAvailability | null;
  onSelect: (date: string, type: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = availability?.dayType || 'full';

  const OPTIONS = [
    { key: 'full',      label: 'Full day',     emoji: '✅' },
    { key: 'half-am',   label: 'Half AM',      emoji: '🌤' },
    { key: 'half-pm',   label: 'Half PM',      emoji: '🌇' },
    { key: 'deep-work', label: 'Deep work',    emoji: '🎯' },
    { key: 'travel',    label: 'Travel',       emoji: '✈️' },
    { key: 'off',       label: 'Day off',      emoji: '🌴' },
  ];

  const currentOpt = OPTIONS.find(o => o.key === current) || OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-[9px] px-1.5 py-0.5 rounded-full transition-colors ${
          current === 'off' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : current === 'deep-work' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
          : current === 'travel' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
          : current === 'half-am' || current === 'half-pm' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-400'
        }`}
        title="Set day type"
      >
        {currentOpt.emoji}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-6 left-0 z-20 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl shadow-lg p-1.5 min-w-[130px]">
            {OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => { onSelect(date, opt.key); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-colors text-left ${
                  current === opt.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'
                }`}
              >
                <span>{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface TaskBlockProps {
  task: Task;
  lane: number;
  totalLanes: number;
  columnWidth: number;
  isBlocked: boolean;
  projColor: string;
  isDark: boolean;
  onTaskClick: (t: Task) => void;
  onToggle: (id: number) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onResize: (taskId: number, newDurationMin: number) => void;
  onMilestoneConfirm?: (milestoneId: number) => void;
}

function TaskBlock({
  task, lane, totalLanes, columnWidth, isBlocked, projColor, isDark, onTaskClick, onToggle, onDragStart, onResize, onMilestoneConfirm,
}: TaskBlockProps) {
  const palette = getTaskPalette(task, isDark);
  const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
  const duration = Math.max(task.estimatedDuration || 30, 15);
  const top = minutesToGridPx(startMin);
  const height = Math.max(duration * PX_PER_MINUTE, 36);

  const laneWidth = totalLanes > 0 ? (columnWidth - 6) / totalLanes : columnWidth - 6;
  const left = 3 + lane * laneWidth;

  const resizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartDur = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = true;
    resizeStartY.current = e.clientY;
    resizeStartDur.current = duration;

    function onMove(ev: MouseEvent) {
      if (!resizing.current) return;
      const delta = ev.clientY - resizeStartY.current;
      const deltaMin = delta / PX_PER_MINUTE;
      const newDur = snapToQuarter(Math.max(15, resizeStartDur.current + deltaMin));
      onResize(task.id, newDur);
    }
    function onUp() {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [duration, task.id, onResize]);

  const showDuration = height >= 54;
  const showGroup = height >= 70;

  const ENERGY_EMOJI: Record<string, string> = {
    deep_work: '🎯', creative: '✨', admin: '📋', social: '💬', logistics: '📦', execution: '⚡',
  };
  const emoji = task.taskEnergyType ? ENERGY_EMOJI[task.taskEnergyType] : '';

  const isGcalEvent = (task as any).source === 'gcal';
  const isMilestone = !isGcalEvent && (task.type === 'milestone' || task._virtual || task.id < 0);
  const mStatus = (task as any).milestoneStatus || 'active';

  // Palette par statut de jalon
  const MILESTONE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
    active:    { bg: isDark ? '#3d2e00' : '#fffbeb', border: '#f59e0b', text: isDark ? '#fcd34d' : '#92400e' },
    unlocked:  { bg: isDark ? '#0c1e3d' : '#eff6ff', border: '#3b82f6', text: isDark ? '#93c5fd' : '#1d4ed8' },
    locked:    { bg: isDark ? '#1e1e1e' : '#f8fafc', border: '#94a3b8', text: isDark ? '#64748b' : '#94a3b8' },
    completed: { bg: isDark ? '#0a2e1a' : '#f0fdf4', border: '#22c55e', text: isDark ? '#86efac' : '#15803d' },
  };
  const milestoneStyle = isMilestone ? (MILESTONE_STYLES[mStatus] || MILESTONE_STYLES.locked) : null;

  const bgColor = isGcalEvent ? (isDark ? '#0c1e3d' : '#eff6ff') : isMilestone ? milestoneStyle!.bg : isBlocked ? (isDark ? '#1e293b' : '#f1f5f9') : palette.bg;
  const borderColor = isGcalEvent ? '#3b82f6' : isMilestone ? milestoneStyle!.border : isBlocked ? '#64748b' : palette.border;
  const textColor = isGcalEvent ? (isDark ? '#93c5fd' : '#1d4ed8') : isMilestone ? milestoneStyle!.text : isBlocked ? (isDark ? '#64748b' : '#94a3b8') : palette.text;
  const isLockedMilestone = isMilestone && mStatus === 'locked';
  const isActiveMilestone = isMilestone && (mStatus === 'active' || mStatus === 'unlocked');

  return (
    <div
      draggable={!isMilestone && !isGcalEvent}
      onDragStart={(isMilestone || isGcalEvent) ? undefined : (e) => onDragStart(e, task)}
      className={`absolute overflow-hidden select-none transition-all hover:shadow-float hover:-translate-y-px ${
        isMilestone || isGcalEvent ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${task.completed ? 'opacity-35 saturate-0' : isLockedMilestone ? 'opacity-50' : isBlocked ? 'opacity-55' : ''}`}
      style={{
        top,
        height,
        left,
        width: laneWidth - 2,
        backgroundColor: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderLeft: (isMilestone || isGcalEvent) ? `3px solid ${borderColor}` : `1.5px solid ${borderColor}`,
        borderRadius: 10,
        zIndex: isMilestone ? 15 : 10,
      }}
      onClick={() => {
        if (isGcalEvent) return;
        onTaskClick(task);
      }}
    >
      <div className="px-2 pt-1.5 pb-1 h-full flex flex-col gap-0.5 relative">
        <div className="flex items-start gap-1">
          {isMilestone ? (
            <span className="flex-shrink-0 text-[11px] mt-px">
              {mStatus === 'completed' ? '✅' : mStatus === 'locked' ? '🔒' : '🏁'}
            </span>
          ) : isGcalEvent ? null : (
            <div
              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
              className="flex-shrink-0 w-3 h-3 rounded-sm border-2 mt-0.5 cursor-pointer transition-colors"
              style={{
                borderColor: task.completed ? '#22c55e' : textColor,
                backgroundColor: task.completed ? '#22c55e' : 'transparent',
                opacity: 0.7,
              }}
            >
              {task.completed && (
                <svg viewBox="0 0 10 10" className="w-full h-full" fill="none">
                  <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
          )}
          <p
            className={`text-[10px] leading-tight flex-1 ${isMilestone ? 'font-bold' : 'font-semibold'} ${task.completed ? 'line-through opacity-60' : ''}`}
            style={{ color: textColor }}
          >
            {isGcalEvent && <span className="mr-1 opacity-60">📅</span>}
            {!isMilestone && !isGcalEvent && emoji && <span className="mr-0.5">{emoji}</span>}
            {task.title}
          </p>
        </div>
        {showDuration && task.estimatedDuration && !isMilestone && (
          <p className="text-[9px] pl-4 font-medium opacity-60" style={{ color: textColor }}>
            {task.estimatedDuration}m
          </p>
        )}
        {showGroup && task.workflowGroup && (
          <p className="text-[9px] pl-4 opacity-50 truncate" style={{ color: textColor }}>
            {task.workflowGroup}
          </p>
        )}
        {isBlocked && !isMilestone && (
          <span className="absolute right-1 top-1 text-[9px]">🔒</span>
        )}
        {/* Indication de clic — jalons actifs */}
        {isActiveMilestone && height >= 38 && (
          <p className="text-[8px] opacity-70 mt-0.5 font-medium" style={{ color: textColor }}>
            Cliquer pour confirmer →
          </p>
        )}
        {isLockedMilestone && height >= 38 && (
          <p className="text-[8px] opacity-50 mt-0.5" style={{ color: textColor }}>
            En attente du précédent
          </p>
        )}
      </div>
      {!isMilestone && !isGcalEvent && (
        <div
          className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-b-[10px]"
          onMouseDown={handleResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-5 h-1 rounded-full" style={{ backgroundColor: textColor, opacity: 0.35 }} />
        </div>
      )}
    </div>
  );
}

export default function TimeGrid({
  dates,
  tasks,
  projects,
  dependencies = {},
  availability = [],
  defaultWorkStart = '09:00',
  defaultWorkEnd = '18:00',
  today,
  onTaskClick,
  onToggle,
  onMilestoneConfirm,
  rangeQueryKey,
}: TimeGridProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { triggerAutoRebalance } = useAutoRebalance();
  const isDark = document.documentElement.classList.contains('dark');

  const availByDate = useMemo(() => {
    const m: Record<string, DayAvailability> = {};
    for (const a of availability) m[a.date] = a;
    return m;
  }, [availability]);

  const tasksByDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) {
      const key = t.scheduledDate || '';
      if (!m[key]) m[key] = [];
      m[key].push(t);
    }
    return m;
  }, [tasks]);

  const updateTaskMutation = useMutation({
    mutationFn: async (payload: { taskId: number; scheduledDate?: string; scheduledTime?: string; scheduledEndTime?: string; estimatedDuration?: number }) => {
      const { taskId, ...body } = payload;
      if (taskId < 0) return null; // tâche virtuelle (jalon) — pas de PATCH
      const res = await apiRequest("PATCH", `/api/tasks/${taskId}`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Failed to update task" }));
        throw new Error(errorData.message || "Failed to update task");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update task.";

      // Determine toast variant based on error type
      const isConflict = errorMessage.includes("conflict") || errorMessage.includes("overlap");
      const isWeekend = errorMessage.includes("weekend");

      toast({
        title: isConflict ? "⚠️ Schedule Conflict" : isWeekend ? "📅 Invalid Day" : "Error",
        description: errorMessage,
        variant: "destructive"
      });
    },
  });

  const availMutation = useMutation({
    mutationFn: async ({ date, dayType }: { date: string; dayType: string }) => {
      const res = await apiRequest("PUT", `/api/availability/${date}`, { dayType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/availability'] });
      triggerAutoRebalance();
    },
  });

  // Drag state
  const draggingTask = useRef<Task | null>(null);
  const dragOriginDate = useRef<string | null>(null);
  const dragOffsetMinutes = useRef<number>(0);

  function handleDragStart(e: React.DragEvent, task: Task) {
    draggingTask.current = task;
    dragOriginDate.current = task.scheduledDate || null;
    const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetPx = e.clientY - rect.top;
    dragOffsetMinutes.current = Math.round(offsetPx / PX_PER_MINUTE);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent, targetDate: string, gridRef: HTMLDivElement | null) {
    e.preventDefault();
    const task = draggingTask.current;
    if (!task || !gridRef) return;

    const gridRect = gridRef.getBoundingClientRect();
    const relY = e.clientY - gridRect.top;
    const rawMinutes = pxToMinutes(relY) - dragOffsetMinutes.current;
    const snapped = snapToQuarter(Math.max(GRID_START_HOUR * 60, Math.min(rawMinutes, (GRID_END_HOUR - 0.25) * 60)));
    const newTime = minutesToHHMM(snapped);
    const newEndTime = minutesToHHMM(snapped + (task.estimatedDuration || 30));

    updateTaskMutation.mutate({
      taskId: task.id,
      scheduledDate: targetDate,
      scheduledTime: newTime,
      scheduledEndTime: newEndTime,
    });

    draggingTask.current = null;
  }

  const gridRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function handleResize(taskId: number, newDurationMin: number) {
    updateTaskMutation.mutate({ taskId, estimatedDuration: newDurationMin });
  }

  const totalGridHeight = TOTAL_HOURS * PX_PER_HOUR;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Column headers */}
      <div className="flex flex-shrink-0 border-b border-border" style={{ paddingLeft: 48 }}>
        {dates.map(date => {
          const d = new Date(date + 'T00:00:00');
          const isToday = date === today;
          const avail = availByDate[date];
          const isPast = date < today;
          const dayNum = d.getDate();
          const weekdayShort = d.toLocaleDateString('en-US', { weekday: 'short' });
          const count = (tasksByDate[date] || []).length;
          return (
            <div
              key={date}
              className="flex-1 flex flex-col items-center pb-2.5 pt-2 gap-0.5"
              style={{ minWidth: 0 }}
            >
              {/* Weekday label */}
              <span className={`text-[10px] font-semibold uppercase tracking-widest ${
                isToday ? 'text-primary' : isPast ? 'text-muted-foreground/30' : 'text-muted-foreground'
              }`}>
                {weekdayShort}
              </span>
              {/* Day number */}
              <div className="flex items-center gap-1.5">
                {isToday ? (
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shadow-float">
                    <span className="text-lg font-black text-primary-foreground leading-none">
                      {dayNum}
                    </span>
                  </div>
                ) : (
                  <span className={`text-2xl font-black leading-none tracking-tight ${
                    isPast ? 'text-muted-foreground/25' : 'text-foreground'
                  }`}>
                    {dayNum}
                  </span>
                )}
                <DayAvailabilityBadge
                  date={date}
                  availability={avail || null}
                  onSelect={(d, t) => availMutation.mutate({ date: d, dayType: t })}
                />
              </div>
              {/* Task count */}
              {count > 0 && (
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                  isToday
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Unscheduled tasks strip */}
      {dates.some(d => (tasksByDate[d] || []).some(t => !t.scheduledTime)) && (
        <div className="flex flex-shrink-0 border-b border-border bg-muted/30" style={{ paddingLeft: 48 }}>
          {dates.map(date => {
            const unscheduled = (tasksByDate[date] || []).filter(t => !t.scheduledTime);
            return (
              <div key={date} className="flex-1 border-l border-border min-w-0 px-1.5 py-1.5">
                {unscheduled.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    {unscheduled.map(task => {
                      const isGcalTask = (task as any).source === 'gcal';
                      const isMTask = !isGcalTask && (task.type === 'milestone' || task._virtual || task.id < 0);
                      const mStatus = (task as any).milestoneStatus || 'active';
                      const MSTYLES: Record<string, { bg: string; border: string; text: string }> = {
                        active:    { bg: isDark ? '#292000' : '#fffbeb', border: '#f59e0b', text: isDark ? '#fbbf24' : '#b45309' },
                        unlocked:  { bg: isDark ? '#001a2e' : '#eff6ff', border: '#3b82f6', text: isDark ? '#60a5fa' : '#1d4ed8' },
                        locked:    { bg: isDark ? '#1e1e1e' : '#f8fafc', border: '#94a3b8', text: isDark ? '#64748b' : '#94a3b8' },
                        completed: { bg: isDark ? '#0a2e1a' : '#f0fdf4', border: '#22c55e', text: isDark ? '#86efac' : '#15803d' },
                      };
                      const palette = isMTask ? MSTYLES[mStatus] || MSTYLES.locked : getTaskPalette(task, isDark);
                      const milestoneIcon = mStatus === 'locked' ? '🔒' : mStatus === 'completed' ? '✅' : '🏁';
                      return (
                        <div
                          key={task.id}
                          draggable={!isMTask}
                          onDragStart={isMTask ? undefined : (e) => handleDragStart(e, task)}
                          className={`flex items-center gap-1 py-1 px-1.5 rounded-lg transition-opacity ${isMTask ? 'cursor-default opacity-70' : 'cursor-grab active:cursor-grabbing'} ${task.completed ? 'opacity-40' : 'hover:opacity-90'}`}
                          style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}`, borderLeft: isMTask ? `3px solid ${palette.border}` : `1px solid ${palette.border}` }}
                          onClick={() => onTaskClick(task)}
                        >
                          {isMTask ? (
                            <span className="flex-shrink-0 text-[10px]">{milestoneIcon}</span>
                          ) : (
                            <div
                              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
                              className="flex-shrink-0 w-2.5 h-2.5 rounded-sm border-2 cursor-pointer"
                              style={{ borderColor: palette.text, backgroundColor: task.completed ? '#22c55e' : 'transparent' }}
                            />
                          )}
                          <p className="text-[9px] font-semibold truncate flex-1" style={{ color: palette.text }}>
                            {task.title}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex" style={{ height: totalGridHeight }}>
          {/* Hour labels */}
          <div className="flex-shrink-0 w-12 relative" style={{ height: totalGridHeight }}>
            {HOUR_LABELS.map((label, i) => (
              <div
                key={i}
                className="absolute right-2 text-[9px] text-muted-foreground/40 whitespace-nowrap font-medium"
                style={{ top: i * PX_PER_HOUR - 6, userSelect: 'none' }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Columns */}
          {dates.map(date => {
            const avail = availByDate[date];
            const dayType = avail?.dayType || 'full';
            const workStart = timeToMinutes(avail?.workStart || defaultWorkStart);
            const workEnd = timeToMinutes(avail?.workEnd || defaultWorkEnd);
            const breaks: { start: string; end: string }[] = (avail?.breaks as any) || [];
            const dayTasks = tasksByDate[date] || [];
            const scheduledTasks = dayTasks.filter(t => t.scheduledTime != null);
            const unscheduledTasks = dayTasks.filter(t => t.scheduledTime == null);
            const laneMap = assignLanes(scheduledTasks);
            const maxLanes = Math.max(...Array.from(laneMap.values()).map(v => v.totalLanes), 1);
            const isOff = dayType === 'off';
            const isHalfAm = dayType === 'half-am';
            const isHalfPm = dayType === 'half-pm';
            const isPast = date < today;
            const isToday = date === today;

            const effectiveStart = isHalfPm ? Math.max(workStart, 12 * 60) : workStart;
            const effectiveEnd = isHalfAm ? Math.min(workEnd, 13 * 60) : workEnd;

            return (
              <div
                key={date}
                className={`flex-1 relative border-l border-border ${isPast ? 'opacity-60' : ''} ${isToday ? 'bg-primary/[0.03]' : ''}`}
                style={{ height: totalGridHeight }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, date, gridRefs.current[date])}
                ref={(el) => { gridRefs.current[date] = el; }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-border/60"
                    style={{ top: i * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`h${i}`}
                    className="absolute left-0 right-0 border-t border-border/25"
                    style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Working hours highlight */}
                {!isOff && (
                  <div
                    className="absolute left-0 right-0 bg-card"
                    style={{
                      top: minutesToGridPx(effectiveStart),
                      height: Math.max(0, (effectiveEnd - effectiveStart)) * PX_PER_MINUTE,
                    }}
                  />
                )}

                {/* Non-working zones (hatched) */}
                {!isOff && effectiveStart > GRID_START_HOUR * 60 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: 0,
                      height: minutesToGridPx(effectiveStart),
                      backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(148,163,184,0.08) 4px, rgba(148,163,184,0.08) 8px)',
                    }}
                  />
                )}
                {!isOff && effectiveEnd < GRID_END_HOUR * 60 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: minutesToGridPx(effectiveEnd),
                      height: (GRID_END_HOUR * 60 - effectiveEnd) * PX_PER_MINUTE,
                      backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(148,163,184,0.08) 4px, rgba(148,163,184,0.08) 8px)',
                    }}
                  />
                )}

                {/* Day off overlay */}
                {isOff && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(148,163,184,0.12) 6px, rgba(148,163,184,0.12) 12px)' }}
                  >
                    <span className="text-muted-foreground/30 text-xs font-medium rotate-[-30deg] select-none">Day off</span>
                  </div>
                )}

                {/* Break zones */}
                {breaks.map((brk, bi) => {
                  const bStart = timeToMinutes(brk.start);
                  const bEnd = timeToMinutes(brk.end);
                  return (
                    <div
                      key={bi}
                      className="absolute left-0 right-0 z-5"
                      style={{
                        top: minutesToGridPx(bStart),
                        height: (bEnd - bStart) * PX_PER_MINUTE,
                        backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(148,163,184,0.1) 4px, rgba(148,163,184,0.1) 8px)',
                        borderTop: '1px dashed rgba(148,163,184,0.3)',
                        borderBottom: '1px dashed rgba(148,163,184,0.3)',
                      }}
                    />
                  );
                })}

                {/* Current time indicator */}
                {date === today && (() => {
                  const now = new Date();
                  const nowMin = now.getHours() * 60 + now.getMinutes();
                  if (nowMin < GRID_START_HOUR * 60 || nowMin > GRID_END_HOUR * 60) return null;
                  return (
                    <div
                      className="absolute left-0 right-0 z-20 flex items-center"
                      style={{ top: minutesToGridPx(nowMin) }}
                    >
                      <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
                      <div className="flex-1 h-px bg-red-400" />
                    </div>
                  );
                })()}

                {/* Scheduled tasks */}
                {scheduledTasks.map(task => {
                  const { lane, totalLanes: tl } = laneMap.get(task.id) || { lane: 0, totalLanes: 1 };
                  const isBlocked = dependencies[task.id] !== undefined;
                  const projColor = getProjectColor(task.projectId);
                  return (
                    <TaskBlock
                      key={task.id}
                      task={task}
                      lane={lane}
                      totalLanes={tl || 1}
                      columnWidth={gridRefs.current[date]?.clientWidth || 120}
                      isBlocked={isBlocked}
                      projColor={projColor}
                      isDark={isDark}
                      onTaskClick={onTaskClick}
                      onToggle={onToggle}
                      onDragStart={handleDragStart}
                      onResize={handleResize}
                      onMilestoneConfirm={onMilestoneConfirm}
                    />
                  );
                })}

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
