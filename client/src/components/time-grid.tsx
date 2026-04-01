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
  source?: string | null;
  taskEnergyType?: string | null;
  workflowGroup?: string | null;
  recommendedTimeOfDay?: string | null;
  canBeFragmented?: boolean | null;
}

interface DayAvailability {
  date: string;
  dayType: string;
  workStart?: string | null;
  workEnd?: string | null;
  breaks?: { start: string; end: string; label?: string }[] | null;
}

interface TimeGridProps {
  dates: string[];                          // YYYY-MM-DD for each column (1 for day, 7 for week)
  tasks: Task[];
  projects: Project[];
  dependencies?: Record<number, number>;    // taskId → blockedByTaskId
  availability?: DayAvailability[];
  defaultWorkStart?: string;
  defaultWorkEnd?: string;
  today: string;
  onTaskClick: (task: Task) => void;
  onToggle: (taskId: number) => void;
  rangeQueryKey: any[];
}

const ENERGY_COLORS: Record<string, { bg: string; border: string; text: string; darkBg: string; darkBorder: string; darkText: string }> = {
  deep_work: { bg: '#eef2ff', border: '#6366f1', text: '#4338ca', darkBg: '#1e1b4b', darkBorder: '#818cf8', darkText: '#a5b4fc' },
  creative:  { bg: '#faf5ff', border: '#a855f7', text: '#7c3aed', darkBg: '#2e1065', darkBorder: '#c084fc', darkText: '#d8b4fe' },
  admin:     { bg: '#f8fafc', border: '#94a3b8', text: '#475569', darkBg: '#1e293b', darkBorder: '#64748b', darkText: '#94a3b8' },
  social:    { bg: '#f0fdf4', border: '#22c55e', text: '#16a34a', darkBg: '#052e16', darkBorder: '#4ade80', darkText: '#86efac' },
  logistics: { bg: '#fff7ed', border: '#f97316', text: '#ea580c', darkBg: '#431407', darkBorder: '#fb923c', darkText: '#fdba74' },
  execution: { bg: '#fefce8', border: '#eab308', text: '#ca8a04', darkBg: '#1a1000', darkBorder: '#facc15', darkText: '#fde047' },
};

const DEFAULT_ENERGY = { bg: '#f8fafc', border: '#6366f1', text: '#4338ca', darkBg: '#1e1b4b', darkBorder: '#818cf8', darkText: '#a5b4fc' };

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
];

function getProjectColor(projectId: number | null | undefined) {
  if (!projectId) return '#6366f1';
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length];
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
}

function TaskBlock({
  task, lane, totalLanes, columnWidth, isBlocked, projColor, isDark, onTaskClick, onToggle, onDragStart, onResize,
}: TaskBlockProps) {
  const energy = task.taskEnergyType ? (ENERGY_COLORS[task.taskEnergyType] || DEFAULT_ENERGY) : DEFAULT_ENERGY;
  const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
  const duration = Math.max(task.estimatedDuration || 30, 15);
  const top = minutesToGridPx(startMin);
  const height = Math.max(duration * PX_PER_MINUTE, 44);

  const laneWidth = totalLanes > 0 ? (columnWidth - 4) / totalLanes : columnWidth - 4;
  const left = 2 + lane * laneWidth;

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

  const bgColor = isDark ? energy.darkBg : energy.bg;
  const borderColor = isBlocked ? '#94a3b8' : projColor;
  const textColor = isDark ? energy.darkText : energy.text;

  const showTitle = true;
  const showDuration = height >= 56;
  const showFull = height >= 72;

  const ENERGY_EMOJI: Record<string, string> = {
    deep_work: '🎯', creative: '✨', admin: '📋', social: '💬', logistics: '📦', execution: '⚡',
  };
  const emoji = task.taskEnergyType ? ENERGY_EMOJI[task.taskEnergyType] : '';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      className={`absolute rounded-md overflow-hidden cursor-grab active:cursor-grabbing select-none transition-shadow hover:shadow-md ${
        task.completed ? 'opacity-35 saturate-0' : isBlocked ? 'opacity-60' : ''
      }`}
      style={{
        top,
        height,
        left,
        width: laneWidth - 1,
        backgroundColor: bgColor,
        borderLeft: `3px solid ${borderColor}`,
        zIndex: 10,
      }}
      onClick={() => onTaskClick(task)}
    >
      <div className="px-1.5 pt-1 pb-4 h-full flex flex-col gap-0.5 relative">
        {showTitle && (
          <div className="flex items-start gap-1">
            <div
              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
              className={`flex-shrink-0 w-3 h-3 rounded-sm border mt-0.5 cursor-pointer transition-colors ${
                task.completed
                  ? 'bg-green-500 border-green-500'
                  : 'border-slate-300 dark:border-gray-600 hover:border-primary'
              }`}
            >
              {task.completed && (
                <svg viewBox="0 0 10 10" className="w-full h-full text-white" fill="none">
                  <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <p
              className={`text-[10px] leading-tight flex-1 ${task.completed ? 'line-through opacity-60' : ''}`}
              style={{ color: textColor }}
            >
              {emoji && <span className="mr-0.5">{emoji}</span>}
              {task.title}
            </p>
          </div>
        )}
        {showDuration && task.estimatedDuration && (
          <p className="text-[9px] opacity-70 pl-4" style={{ color: textColor }}>
            {task.estimatedDuration}m
          </p>
        )}
        {showFull && task.workflowGroup && (
          <p className="text-[9px] opacity-60 truncate pl-4" style={{ color: textColor }}>
            {task.workflowGroup}
          </p>
        )}
        {isBlocked && (
          <span className="absolute right-1 top-1 text-[9px]">🔒</span>
        )}
      </div>
      {/* Resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
        onMouseDown={handleResizeMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-6 h-1 rounded-full bg-current opacity-30" style={{ color: borderColor }} />
      </div>
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
      <div className="flex flex-shrink-0" style={{ paddingLeft: 48 }}>
        {dates.map(date => {
          const d = new Date(date + 'T00:00:00');
          const isToday = date === today;
          const avail = availByDate[date];
          const isPast = date < today;
          return (
            <div
              key={date}
              className="flex-1 flex flex-col items-center pb-2 pt-1 border-b border-slate-200 dark:border-gray-700"
              style={{ minWidth: 0 }}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] uppercase tracking-wide ${isToday ? 'text-primary' : isPast ? 'text-slate-300 dark:text-gray-600' : 'text-slate-500 dark:text-gray-400'}`}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className={`text-lg leading-none ${isToday ? 'text-primary' : isPast ? 'text-slate-300 dark:text-gray-600' : 'text-slate-800 dark:text-white'}`}>
                  {d.getDate()}
                </span>
                <DayAvailabilityBadge
                  date={date}
                  availability={avail || null}
                  onSelect={(d, t) => availMutation.mutate({ date: d, dayType: t })}
                />
              </div>
              {/* Task count chip */}
              {(() => {
                const count = (tasksByDate[date] || []).length;
                return count > 0 ? (
                  <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">{count} task{count > 1 ? 's' : ''}</span>
                ) : null;
              })()}
            </div>
          );
        })}
      </div>

      {/* Unscheduled tasks strip — sits above the scrollable grid, one column per date */}
      {dates.some(d => (tasksByDate[d] || []).some(t => !t.scheduledTime)) && (
        <div className="flex flex-shrink-0 border-b border-slate-100 dark:border-gray-800" style={{ paddingLeft: 48 }}>
          {dates.map(date => {
            const unscheduled = (tasksByDate[date] || []).filter(t => !t.scheduledTime);
            return (
              <div key={date} className="flex-1 border-l border-slate-100 dark:border-gray-800 min-w-0 px-1 py-1">
                {unscheduled.length > 0 && (
                  <>
                    <p className="text-[8px] uppercase tracking-wide text-slate-400 dark:text-gray-600 mb-0.5">Unscheduled</p>
                    {unscheduled.map(task => {
                      const projColor = getProjectColor(task.projectId);
                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task)}
                          className={`flex items-center gap-1 py-0.5 px-0.5 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800/40 ${task.completed ? 'opacity-40' : ''}`}
                          onClick={() => onTaskClick(task)}
                        >
                          <div
                            onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
                            className={`flex-shrink-0 w-2.5 h-2.5 rounded-sm border cursor-pointer ${task.completed ? 'bg-green-500 border-green-500' : 'border-slate-300 dark:border-gray-500'}`}
                          />
                          <p className="text-[9px] truncate flex-1 text-slate-700 dark:text-gray-300" style={{ color: projColor }}>
                            {task.title}
                          </p>
                          <span className="text-[8px] text-slate-400 dark:text-gray-600 flex-shrink-0">
                            {task.estimatedDuration || 30}m
                          </span>
                        </div>
                      );
                    })}
                  </>
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
                className="absolute right-2 text-[9px] text-slate-300 dark:text-gray-600 whitespace-nowrap"
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

            const effectiveStart = isHalfPm ? Math.max(workStart, 12 * 60) : workStart;
            const effectiveEnd = isHalfAm ? Math.min(workEnd, 13 * 60) : workEnd;

            return (
              <div
                key={date}
                className={`flex-1 relative border-l border-slate-100 dark:border-gray-800 ${isPast ? 'opacity-60' : ''}`}
                style={{ height: totalGridHeight }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, date, gridRefs.current[date])}
                ref={(el) => { gridRefs.current[date] = el; }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-slate-100 dark:border-gray-800/60"
                    style={{ top: i * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`h${i}`}
                    className="absolute left-0 right-0 border-t border-slate-50 dark:border-gray-900"
                    style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Working hours highlight */}
                {!isOff && (
                  <div
                    className="absolute left-0 right-0 bg-white dark:bg-gray-900/60"
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
                    <span className="text-slate-300 dark:text-gray-600 text-xs rotate-[-30deg] select-none">Day off</span>
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
