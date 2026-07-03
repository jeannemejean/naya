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

// ── Naya brand palette for task slots ──────────────────────────────────────
// 5 couleurs × 2 intensités = 7 variations (rotation par projectId)
const NAYA_TASK_PALETTES = [
  { bg: 'rgba(212,201,122,0.22)', text: '#5a4f0d', border: 'rgba(212,201,122,0.55)' }, // sulphur
  { bg: 'rgba(125,143,168,0.22)', text: '#354963', border: 'rgba(125,143,168,0.55)' }, // salvia
  { bg: 'rgba(158,126,135,0.22)', text: '#5c3d45', border: 'rgba(158,126,135,0.55)' }, // mauve
  { bg: 'rgba(43,45,28,0.10)',    text: '#2B2D1C', border: 'rgba(43,45,28,0.28)'   }, // olive
  { bg: 'rgba(212,201,122,0.13)', text: '#4a3e08', border: 'rgba(212,201,122,0.38)' }, // sulphur léger
  { bg: 'rgba(125,143,168,0.13)', text: '#354963', border: 'rgba(125,143,168,0.38)' }, // salvia léger
  { bg: 'rgba(158,126,135,0.13)', text: '#5c3d45', border: 'rgba(158,126,135,0.38)' }, // mauve léger
];

// Palette jalons — statut → couleur Naya
const MILESTONE_PALETTE: Record<string, { bg: string; border: string; text: string }> = {
  active:    { bg: 'rgba(212,201,122,0.28)', border: '#c9bc60',  text: '#453b06' }, // sulphur — texte foncé fort
  unlocked:  { bg: 'rgba(125,143,168,0.28)', border: '#6a7f9a',  text: '#243450' }, // salvia — texte foncé fort
  locked:    { bg: 'rgba(43,45,28,0.10)',    border: 'rgba(43,45,28,0.28)', text: 'rgba(43,45,28,0.55)' }, // olive fantôme — lisible
  completed: { bg: 'rgba(43,45,28,0.14)',    border: 'rgba(43,45,28,0.40)', text: '#2B2D1C' }, // olive
};

// Couleur DÉDIÉE par jalon (déterministe) — utilisée à la fois sur le marqueur du jalon
// et sur le liseré des tâches qui y mènent, pour rendre le lien jalon↔tâches visible.
const MILESTONE_ACCENTS = ['#c9762e', '#3f7d8a', '#7d5ba6', '#a6543f', '#4a7a3f', '#b08a1e', '#5a6fb0', '#9a4f6e'];
function milestoneAccent(id?: number | null): string {
  if (id == null) return MILESTONE_PALETTE.active.border;
  return MILESTONE_ACCENTS[Math.abs(id) % MILESTONE_ACCENTS.length];
}

// Google Calendar events → salvia (ton info)
const GCAL_PALETTE = { bg: 'rgba(125,143,168,0.12)', border: '#7D8FA8', text: '#354963' };

// Tâches bloquées → olive fantôme
const BLOCKED_PALETTE = { bg: 'rgba(43,45,28,0.05)', border: 'rgba(43,45,28,0.15)', text: 'rgba(43,45,28,0.35)' };

function getNayaTaskPalette(task: Task) {
  const idx = task.projectId ? task.projectId % NAYA_TASK_PALETTES.length : 0;
  return NAYA_TASK_PALETTES[idx];
}

const GRID_START_HOUR = 7;
const GRID_END_HOUR   = 21;
const TOTAL_HOURS     = GRID_END_HOUR - GRID_START_HOUR;
const PX_PER_HOUR     = 80;
const PX_PER_MINUTE   = PX_PER_HOUR / 60;

// Labels 24h (style européen)
const HOUR_LABELS = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
  const h = GRID_START_HOUR + i;
  return `${h}h`;
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
  return (totalMinutes - GRID_START_HOUR * 60) * PX_PER_MINUTE;
}

function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE + GRID_START_HOUR * 60;
}

function snapToQuarter(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

// Maximum de colonnes visuelles dans une cellule de grille.
// Au-delà, les tâches partagent une colonne (z-stacking léger).
const MAX_VISUAL_LANES = 3;

/**
 * Safety net: if tasks arrive from the server with overlapping times (stale data,
 * concurrent writes, etc.), re-sequence them in memory before rendering so they
 * never appear as side-by-side columns. The DB fix is the real solution; this
 * prevents a bad visual while the data catches up.
 */
function deduplicateOverlaps(tasks: Task[]): Task[] {
  if (tasks.length < 2) return tasks;
  const sorted = [...tasks].sort((a, b) =>
    (a.scheduledTime ? timeToMinutes(a.scheduledTime) : 0) -
    (b.scheduledTime ? timeToMinutes(b.scheduledTime) : 0)
  );
  let cursor = -1;
  return sorted.map(task => {
    if (!task.scheduledTime) return task;
    const start = timeToMinutes(task.scheduledTime);
    const dur   = task.estimatedDuration || 30;
    if (cursor !== -1 && start < cursor) {
      console.error(
        `[time-grid] overlap detected: task ${task.id} "${task.title}" at ${task.scheduledTime} overlaps previous end ${cursor}min — shifting display to ${cursor}min`
      );
      const shifted = { ...task, scheduledTime: minutesToHHMM(cursor) };
      cursor = cursor + dur;
      return shifted;
    }
    cursor = start + dur;
    return task;
  });
}

function assignLanes(tasks: Task[]): Map<number, { lane: number; totalLanes: number }> {
  const sorted = deduplicateOverlaps(tasks).sort((a, b) => {
    const aMin = a.scheduledTime ? timeToMinutes(a.scheduledTime) : 0;
    const bMin = b.scheduledTime ? timeToMinutes(b.scheduledTime) : 0;
    return aMin - bMin;
  });

  const laneMap = new Map<number, { lane: number; totalLanes: number }>();
  const laneEnds: number[] = [];
  // Mémorise les intervalles pour le calcul de chevauchement local
  const intervals: { id: number; start: number; end: number; lane: number }[] = [];

  for (const task of sorted) {
    const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
    const dur = task.estimatedDuration || 30;
    const endMin = startMin + dur;

    let placed = false;
    let assignedLane = 0;

    // Cherche une lane libre (dans la limite MAX_VISUAL_LANES)
    for (let l = 0; l < Math.min(laneEnds.length, MAX_VISUAL_LANES); l++) {
      if (laneEnds[l] <= startMin) {
        laneEnds[l] = endMin;
        assignedLane = l;
        placed = true;
        break;
      }
    }

    if (!placed) {
      if (laneEnds.length < MAX_VISUAL_LANES) {
        // Nouvelle lane (sous le plafond)
        assignedLane = laneEnds.length;
        laneEnds.push(endMin);
      } else {
        // Plafond atteint : recycle la lane qui se libère le plus tôt
        let earliest = 0;
        for (let l = 1; l < laneEnds.length; l++) {
          if (laneEnds[l] < laneEnds[earliest]) earliest = l;
        }
        assignedLane = earliest;
        laneEnds[earliest] = endMin;
      }
    }

    laneMap.set(task.id, { lane: assignedLane, totalLanes: 0 });
    intervals.push({ id: task.id, start: startMin, end: endMin, lane: assignedLane });
  }

  // 2e passe : totalLanes locaux = max concurrent dans le groupe de chevauchement
  for (const task of sorted) {
    const info   = laneMap.get(task.id)!;
    const itvl   = intervals.find(i => i.id === task.id)!;
    let maxLane  = 0;
    for (const other of intervals) {
      if (other.start < itvl.end && other.end > itvl.start) {
        maxLane = Math.max(maxLane, other.lane);
      }
    }
    laneMap.set(task.id, { lane: info.lane, totalLanes: Math.min(maxLane + 1, MAX_VISUAL_LANES) });
  }

  return laneMap;
}

// ── DayAvailabilityBadge ────────────────────────────────────────────────────

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
    { key: 'full',       label: 'Journée complète', symbol: '·'  },
    { key: 'half-am',    label: 'Demi-journée AM',   symbol: '◑'  },
    { key: 'half-pm',    label: 'Demi-journée PM',   symbol: '◐'  },
    { key: 'deep-work',  label: 'Focus total',       symbol: '◆'  },
    { key: 'travel',     label: 'Déplacement',       symbol: '→'  },
    { key: 'off',        label: 'Jour off',          symbol: '○'  },
  ];

  const BADGE_STYLES: Record<string, string> = {
    full:       'bg-naya-olive-06 text-naya-olive-35 border border-naya-olive-10',
    'half-am':  'bg-[rgba(125,143,168,0.15)] text-[#354963] border border-[rgba(125,143,168,0.35)]',
    'half-pm':  'bg-[rgba(125,143,168,0.15)] text-[#354963] border border-[rgba(125,143,168,0.35)]',
    'deep-work':'bg-naya-olive-10 text-naya-olive border border-naya-olive-18',
    travel:     'bg-[rgba(212,201,122,0.20)] text-[#5a4f0d] border border-[rgba(212,201,122,0.40)]',
    off:        'bg-[rgba(158,126,135,0.20)] text-[#5c3d45] border border-[rgba(158,126,135,0.40)]',
  };

  const currentOpt = OPTIONS.find(o => o.key === current) || OPTIONS[0];

  if (current === 'full') return null; // ne pas afficher si journée normale

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`font-display uppercase tracking-xwide text-[8px] px-1.5 py-0.5 rounded-pill transition-colors cursor-pointer ${BADGE_STYLES[current] || BADGE_STYLES.full}`}
        title="Type de journée"
      >
        {currentOpt.symbol} {currentOpt.label.split(' ')[0]}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute top-6 left-0 z-20 border border-naya-olive-18 rounded-lg shadow-lift p-1 min-w-[160px]"
            style={{ background: 'var(--card)' }}
          >
            {OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => { onSelect(date, opt.key); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-sm transition-colors text-left cursor-pointer font-display uppercase tracking-xwide text-[9px] ${
                  current === opt.key
                    ? 'bg-naya-olive-10 text-naya-olive'
                    : 'text-naya-olive-55 hover:bg-naya-olive-06'
                }`}
              >
                <span className="text-[10px]">{opt.symbol}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── TaskBlock ───────────────────────────────────────────────────────────────

interface TaskBlockProps {
  task: Task;
  lane: number;
  totalLanes: number;
  columnWidth: number;
  isBlocked: boolean;
  onTaskClick: (t: Task) => void;
  onToggle: (id: number) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onResize: (taskId: number, newDurationMin: number) => void;
  onMilestoneConfirm?: (milestoneId: number) => void;
  fullWidth?: boolean; // vue Jour : la tâche prend 100 % de la colonne (on ignore les lanes)
}

function TaskBlock({
  task, lane, totalLanes, columnWidth, isBlocked, onTaskClick, onToggle, onDragStart, onResize, onMilestoneConfirm, fullWidth,
}: TaskBlockProps) {
  const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
  const duration = Math.max(task.estimatedDuration || 30, 15);
  const top    = minutesToGridPx(startMin);
  const height = Math.max(duration * PX_PER_MINUTE, 28);

  // Vue Jour (fullWidth) : chaque tâche occupe la PLEINE largeur de la colonne — on ignore le
  // calcul de lanes (chevauchement). Deux tâches qui se chevauchent se superposent visuellement,
  // c'est accepté. Ailleurs (semaine), on garde le placement côte-à-côte par lanes.
  const laneWidth = fullWidth
    ? columnWidth - 6
    : (totalLanes > 0 ? (columnWidth - 6) / totalLanes : columnWidth - 6);
  const left = fullWidth ? 3 : (3 + lane * laneWidth);

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

  const showDuration = height >= 50;
  const showGroup    = height >= 66;

  const isGcalEvent    = (task as any).source === 'gcal';
  const isMilestone    = !isGcalEvent && (task.type === 'milestone' || task._virtual || task.id < 0);
  const mStatus        = (task as any).milestoneStatus || 'active';
  const milestoneStyle = isMilestone ? (MILESTONE_PALETTE[mStatus] || MILESTONE_PALETTE.locked) : null;

  const palette = isGcalEvent
    ? GCAL_PALETTE
    : isMilestone
      ? milestoneStyle!
      : isBlocked
        ? BLOCKED_PALETTE
        : getNayaTaskPalette(task);

  const isLockedMilestone  = isMilestone && mStatus === 'locked';
  const isActiveMilestone  = isMilestone && (mStatus === 'active' || mStatus === 'unlocked');

  // Symboles énergie (sans emoji, caractères typographiques)
  const ENERGY_SYMBOL: Record<string, string> = {
    deep_work: '◆', creative: '◇', admin: '—', social: '◯', logistics: '▷', execution: '▶',
  };
  const energySymbol = task.taskEnergyType ? ENERGY_SYMBOL[task.taskEnergyType] : '';

  return (
    <div
      draggable={!isMilestone && !isGcalEvent}
      onDragStart={(isMilestone || isGcalEvent) ? undefined : (e) => onDragStart(e, task)}
      className={`absolute overflow-hidden select-none transition-shadow hover:shadow-lift ${
        isMilestone || isGcalEvent ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${task.completed ? 'opacity-35' : isLockedMilestone ? 'opacity-45' : isBlocked ? 'opacity-50' : ''}`}
      style={{
        top,
        height,
        left,
        width: laneWidth - 2,
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        borderLeft: (isMilestone || isGcalEvent)
          ? `2.5px solid ${palette.border}`
          : (task as any).milestoneId != null
            ? `2.5px solid ${milestoneAccent((task as any).milestoneId)}`
            : `1px solid ${palette.border}`,
        borderRadius: 4,
        zIndex: isMilestone ? 15 : 10,
      }}
      onClick={() => {
        if (isGcalEvent) return;
        onTaskClick(task);
      }}
    >
      <div className="px-1.5 pt-1 pb-1 h-full flex flex-col gap-0.5 relative">
        <div className="flex items-start gap-1">
          {isMilestone ? (
            <span className="flex-shrink-0 text-[10px] mt-px font-mono" style={{ color: palette.text }}>
              {mStatus === 'completed' ? '✓' : mStatus === 'locked' ? '○' : '◈'}
            </span>
          ) : isGcalEvent ? null : (
            <div
              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
              className="flex-shrink-0 w-2.5 h-2.5 rounded-xs border mt-0.5 cursor-pointer transition-colors"
              style={{
                borderColor: task.completed ? palette.text : palette.border,
                backgroundColor: task.completed ? palette.border : 'transparent',
                opacity: 0.8,
              }}
            />
          )}
          <p
            className={`text-[10px] leading-tight flex-1 font-medium ${task.completed ? 'line-through opacity-50' : ''}`}
            style={{ color: palette.text }}
          >
            {!isMilestone && !isGcalEvent && energySymbol && (
              <span className="mr-0.5 text-[9px] opacity-60">{energySymbol} </span>
            )}
            {task.title}
          </p>
        </div>
        {showDuration && task.estimatedDuration && !isMilestone && (
          <p className="text-[9px] pl-3.5 opacity-50 font-mono" style={{ color: palette.text }}>
            {task.estimatedDuration}min
          </p>
        )}
        {showGroup && task.workflowGroup && (
          <p className="text-[9px] pl-3.5 opacity-40 truncate font-display uppercase tracking-xwide text-[8px]" style={{ color: palette.text }}>
            {task.workflowGroup}
          </p>
        )}
        {isBlocked && !isMilestone && (
          <span className="absolute right-1 top-1 text-[9px] opacity-40" style={{ color: palette.text }}>○</span>
        )}
        {isActiveMilestone && height >= 38 && (
          <p className="text-[8px] opacity-60 mt-0.5 font-display uppercase tracking-xwide" style={{ color: palette.text }}>
            Confirmer →
          </p>
        )}
        {isLockedMilestone && height >= 38 && (
          <p className="text-[8px] opacity-40 mt-0.5" style={{ color: palette.text }}>
            En attente
          </p>
        )}
      </div>
      {!isMilestone && !isGcalEvent && (
        <div
          className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={handleResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-4 h-px rounded-full" style={{ backgroundColor: palette.text, opacity: 0.3 }} />
        </div>
      )}
    </div>
  );
}

// ── TimeGrid ────────────────────────────────────────────────────────────────

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
      if (taskId < 0) return null;
      const res = await apiRequest("PATCH", `/api/tasks/${taskId}`, body);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Failed to update task" }));
        throw new Error(errorData.message || "Failed to update task");
      }
      return res.json();
    },
    // Mise à jour OPTIMISTE : la tâche bouge instantanément dans la grille (plus de
    // "retour à la place puis réapparition" — on n'attend plus l'aller-retour serveur).
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: rangeQueryKey });
      const previous = queryClient.getQueryData<Task[]>(rangeQueryKey);
      if (previous) {
        queryClient.setQueryData<Task[]>(rangeQueryKey, previous.map((t) =>
          t.id === payload.taskId
            ? {
                ...t,
                ...(payload.scheduledDate !== undefined ? { scheduledDate: payload.scheduledDate } : {}),
                ...(payload.scheduledTime !== undefined ? { scheduledTime: payload.scheduledTime } : {}),
                ...(payload.scheduledEndTime !== undefined ? { scheduledEndTime: payload.scheduledEndTime } : {}),
                ...(payload.estimatedDuration !== undefined ? { estimatedDuration: payload.estimatedDuration } : {}),
              }
            : t
        ));
      }
      return { previous };
    },
    onError: (error: any, _payload, context: any) => {
      // Rollback : on remet l'état précédent si le serveur refuse.
      if (context?.previous) queryClient.setQueryData(rangeQueryKey, context.previous);
      const msg = error?.message || "Erreur lors de la mise à jour.";
      toast({ title: "Erreur", description: msg, variant: "destructive" });
    },
    onSettled: () => {
      // Réconciliation avec le serveur (silencieuse — l'optimiste correspond déjà).
      queryClient.invalidateQueries({ queryKey: rangeQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
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

  const draggingTask    = useRef<Task | null>(null);
  const dragOriginDate  = useRef<string | null>(null);
  const dragOffsetMin   = useRef<number>(0);

  function handleDragStart(e: React.DragEvent, task: Task) {
    draggingTask.current   = task;
    dragOriginDate.current = task.scheduledDate || null;
    const startMin = task.scheduledTime ? timeToMinutes(task.scheduledTime) : GRID_START_HOUR * 60;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffsetMin.current = Math.round((e.clientY - rect.top) / PX_PER_MINUTE);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent, targetDate: string, gridRef: HTMLDivElement | null) {
    e.preventDefault();
    let task = draggingTask.current;
    if (!task) {
      // Drag provenant d'ailleurs (panneau latéral des tâches non planifiées) → retrouver par id.
      const id = Number(e.dataTransfer.getData('text/plain'));
      task = tasks.find((t) => t.id === id) || null;
      dragOffsetMin.current = 0; // pas d'offset de saisie connu pour un drag externe
    }
    if (!task || !gridRef) return;

    const relY = e.clientY - gridRef.getBoundingClientRect().top;
    const rawMin = pxToMinutes(relY) - dragOffsetMin.current;
    const snapped = snapToQuarter(Math.max(GRID_START_HOUR * 60, Math.min(rawMin, (GRID_END_HOUR - 0.25) * 60)));
    const newTime    = minutesToHHMM(snapped);
    const newEndTime = minutesToHHMM(snapped + (task.estimatedDuration || 30));

    updateTaskMutation.mutate({ taskId: task.id, scheduledDate: targetDate, scheduledTime: newTime, scheduledEndTime: newEndTime });
    draggingTask.current = null;
  }

  const gridRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function handleResize(taskId: number, newDurationMin: number) {
    updateTaskMutation.mutate({ taskId, estimatedDuration: newDurationMin });
  }

  const totalGridHeight = TOTAL_HOURS * PX_PER_HOUR;

  // Hachures zone hors-travail — olive très transparent
  const hatchStyle = 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(43,45,28,0.04) 4px, rgba(43,45,28,0.04) 8px)';
  const breakHatchStyle = 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(43,45,28,0.05) 4px, rgba(43,45,28,0.05) 8px)';

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* En-têtes colonnes */}
      <div className="flex flex-shrink-0 border-b border-naya-olive-10" style={{ paddingLeft: 48 }}>
        {dates.map(date => {
          const d        = new Date(date + 'T00:00:00');
          const isToday  = date === today;
          const isPast   = date < today;
          const dayNum   = d.getDate();
          const weekday  = d.toLocaleDateString('fr-FR', { weekday: 'short' });
          const count    = (tasksByDate[date] || []).length;
          const avail    = availByDate[date];

          return (
            <div key={date} className="flex-1 flex flex-col items-center pb-2.5 pt-2 gap-1" style={{ minWidth: 0 }}>
              {/* Jour de semaine */}
              <span className={`font-display uppercase tracking-xwide text-[9px] ${
                isToday ? 'text-naya-olive' : isPast ? 'text-naya-olive-18' : 'text-naya-olive-35'
              }`}>
                {weekday}
              </span>
              {/* Numéro du jour */}
              <div className="flex items-center gap-1.5">
                {isToday ? (
                  <div
                    className="w-8 h-8 flex items-center justify-center"
                    style={{ background: '#2B2D1C', borderRadius: 4 }}
                  >
                    <span className="font-display text-sm font-light text-naya-cream leading-none">
                      {dayNum}
                    </span>
                  </div>
                ) : (
                  <span className={`text-xl font-light leading-none ${
                    isPast ? 'text-naya-olive-18' : 'text-naya-olive-70'
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
              {/* Compteur tâches */}
              {count > 0 && (
                <span className={`font-display uppercase tracking-xwide text-[8px] px-1.5 py-0.5 rounded-pill ${
                  isToday
                    ? 'bg-naya-olive-10 text-naya-olive'
                    : 'bg-naya-olive-06 text-naya-olive-35'
                }`}>
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bande tâches non-planifiées + jalons */}
      {dates.some(d => (tasksByDate[d] || []).some(t => !t.scheduledTime)) && (
        <div className="flex flex-shrink-0 border-b border-naya-olive-10 bg-naya-olive-10/40">
          <div className="flex-shrink-0 flex items-center justify-end pr-1.5" style={{ width: 48 }} title="Tâches à planifier — glisse-les sur la grille">
            <span className="text-[8px] font-display uppercase tracking-xwide text-naya-olive-35 text-right leading-[1.1]">À<br />planifier</span>
          </div>
          {dates.map(date => {
            const unscheduled = (tasksByDate[date] || []).filter(t => !t.scheduledTime);
            return (
              <div key={date} className="flex-1 border-l border-naya-olive-10 min-w-0 px-1 py-1">
                {unscheduled.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    {unscheduled.map(task => {
                      const isGcal   = (task as any).source === 'gcal';
                      const isMTask  = !isGcal && (task.type === 'milestone' || task._virtual || task.id < 0);
                      const mStatus  = (task as any).milestoneStatus || 'active';
                      const pal      = isMTask
                        ? (MILESTONE_PALETTE[mStatus] || MILESTONE_PALETTE.locked)
                        : isGcal
                          ? GCAL_PALETTE
                          : getNayaTaskPalette(task);

                      const milestoneSymbol = mStatus === 'locked' ? '○' : mStatus === 'completed' ? '✓' : '◈';
                      const mAccent = milestoneAccent((task as any).milestoneId);
                      const prog = (task as any).milestoneProgress as { done: number; total: number } | undefined;
                      const undated = (task as any).milestoneUndated;
                      const linkedAccent = !isMTask && !isGcal && (task as any).milestoneId != null
                        ? milestoneAccent((task as any).milestoneId)
                        : null;

                      return (
                        <div
                          key={isGcal ? `gcal-${task.scheduledDate}-${task.scheduledTime}-${task.title}` : task.id}
                          draggable={!isMTask && !isGcal}
                          onDragStart={(isMTask || isGcal) ? undefined : (e) => handleDragStart(e, task)}
                          className={`flex items-center gap-1 py-0.5 px-1.5 rounded transition-opacity ${
                            isMTask ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                          } ${task.completed ? 'opacity-40' : 'hover:opacity-80'}`}
                          style={{
                            backgroundColor: pal.bg,
                            border: `1px solid ${pal.border}`,
                            borderLeft: isMTask
                              ? `3px ${undated ? 'dashed' : 'solid'} ${mAccent}`
                              : linkedAccent
                                ? `3px solid ${linkedAccent}`
                                : `1px solid ${pal.border}`,
                            borderRadius: 4,
                          }}
                          onClick={() => onTaskClick(task)}
                        >
                          {isMTask ? (
                            <span className="flex-shrink-0 text-[10px] font-mono leading-none" style={{ color: mAccent }}>{milestoneSymbol}</span>
                          ) : (
                            <div
                              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
                              className="flex-shrink-0 w-2 h-2 rounded-xs border cursor-pointer"
                              style={{ borderColor: pal.border, backgroundColor: task.completed ? pal.border : 'transparent' }}
                            />
                          )}
                          <p className="text-[10px] font-medium truncate flex-1 leading-tight" style={{ color: pal.text }}>
                            {task.title}
                          </p>
                          {isMTask && prog && prog.total > 0 && (
                            <span className="text-[9px] font-mono flex-shrink-0 leading-none" style={{ color: pal.text, opacity: 0.55 }}>
                              {prog.done}/{prog.total}
                            </span>
                          )}
                          {isMTask && undated && (
                            <span className="text-[8px] font-display uppercase tracking-xwide flex-shrink-0 leading-none" style={{ color: mAccent }}>
                              à dater
                            </span>
                          )}
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

      {/* Grille scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex" style={{ height: totalGridHeight }}>

          {/* Labels d'heure */}
          <div className="flex-shrink-0 w-12 relative" style={{ height: totalGridHeight }}>
            {HOUR_LABELS.map((label, i) => (
              <div
                key={i}
                className="absolute right-2 text-[9px] text-naya-olive-35 font-mono whitespace-nowrap"
                style={{ top: i * PX_PER_HOUR - 6, userSelect: 'none' }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Colonnes jours */}
          {dates.map(date => {
            const avail          = availByDate[date];
            const dayType        = avail?.dayType || 'full';
            const workStart      = timeToMinutes(avail?.workStart || defaultWorkStart);
            const workEnd        = timeToMinutes(avail?.workEnd || defaultWorkEnd);
            const breaks: { start: string; end: string }[] = (avail?.breaks as any) || [];
            const dayTasks       = tasksByDate[date] || [];
            const scheduledTasks = dayTasks.filter(t => t.scheduledTime != null);
            // Filet d'affichage : on re-séquence EN MÉMOIRE (décalage des heures qui se
            // chevauchent) et on positionne les cartes sur ces heures dédupliquées, pour ne
            // JAMAIS superposer deux tâches — même si les données serveur sont transitoirement
            // en conflit. Le vrai correctif reste côté serveur (fixOverlappingTasks).
            const displayTasks   = deduplicateOverlaps(scheduledTasks);
            // Vue Jour (une seule colonne) : AUCUN calcul de largeur par chevauchement (lanes).
            // Chaque tâche prend la pleine largeur ; deux tâches qui se chevauchent se superposent
            // visuellement, c'est accepté. Vue semaine : placement côte-à-côte par lanes conservé.
            const singleDay      = dates.length === 1;
            const laneMap        = singleDay ? null : assignLanes(displayTasks);
            const isOff          = dayType === 'off';
            const isHalfAm       = dayType === 'half-am';
            const isHalfPm       = dayType === 'half-pm';
            const isPast         = date < today;
            const isToday        = date === today;

            const effectiveStart = isHalfPm ? Math.max(workStart, 12 * 60) : workStart;
            const effectiveEnd   = isHalfAm ? Math.min(workEnd, 13 * 60) : workEnd;

            return (
              <div
                key={date}
                className={`flex-1 relative border-l border-naya-olive-10 ${isPast ? 'opacity-55' : ''} ${isToday ? 'bg-naya-olive-06/30' : ''}`}
                style={{ height: totalGridHeight }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, date, gridRefs.current[date])}
                ref={(el) => { gridRefs.current[date] = el; }}
              >
                {/* Lignes d'heure */}
                {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-naya-olive-10"
                    style={{ top: i * PX_PER_HOUR }}
                  />
                ))}
                {/* Demi-heures */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`h${i}`}
                    className="absolute left-0 right-0 border-t border-naya-olive-06"
                    style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Zone de travail (fond légèrement plus clair) */}
                {!isOff && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: minutesToGridPx(effectiveStart),
                      height: Math.max(0, (effectiveEnd - effectiveStart)) * PX_PER_MINUTE,
                      background: 'var(--card)',
                    }}
                  />
                )}

                {/* Zone hors-travail (hachures olive) */}
                {!isOff && effectiveStart > GRID_START_HOUR * 60 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{ top: 0, height: minutesToGridPx(effectiveStart), backgroundImage: hatchStyle }}
                  />
                )}
                {!isOff && effectiveEnd < GRID_END_HOUR * 60 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: minutesToGridPx(effectiveEnd),
                      height: (GRID_END_HOUR * 60 - effectiveEnd) * PX_PER_MINUTE,
                      backgroundImage: hatchStyle,
                    }}
                  />
                )}

                {/* Jour off */}
                {isOff && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ backgroundImage: hatchStyle }}
                  >
                    <span
                      className="font-display uppercase tracking-xwide text-[9px] text-naya-olive-18 select-none"
                      style={{ transform: 'rotate(-30deg)' }}
                    >
                      Jour off
                    </span>
                  </div>
                )}

                {/* Pauses */}
                {breaks.map((brk, bi) => {
                  const bStart = timeToMinutes(brk.start);
                  const bEnd   = timeToMinutes(brk.end);
                  return (
                    <div
                      key={bi}
                      className="absolute left-0 right-0 z-5"
                      style={{
                        top: minutesToGridPx(bStart),
                        height: (bEnd - bStart) * PX_PER_MINUTE,
                        backgroundImage: breakHatchStyle,
                        borderTop: '1px dashed rgba(43,45,28,0.12)',
                        borderBottom: '1px dashed rgba(43,45,28,0.12)',
                      }}
                    />
                  );
                })}

                {/* Indicateur heure actuelle — olive */}
                {date === today && (() => {
                  const now    = new Date();
                  const nowMin = now.getHours() * 60 + now.getMinutes();
                  if (nowMin < GRID_START_HOUR * 60 || nowMin > GRID_END_HOUR * 60) return null;
                  return (
                    <div
                      className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
                      style={{ top: minutesToGridPx(nowMin) }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-naya-olive flex-shrink-0 -ml-0.5" />
                      <div className="flex-1 h-px bg-naya-olive-55" />
                    </div>
                  );
                })()}

                {/* Blocs de tâches planifiées */}
                {displayTasks.map(task => {
                  const { lane, totalLanes: tl } = laneMap?.get(task.id) || { lane: 0, totalLanes: 1 };
                  const isBlocked = dependencies[task.id] !== undefined;
                  return (
                    <TaskBlock
                      key={(task as any).source === 'gcal'
                        ? `gcal-${task.scheduledDate}-${task.scheduledTime}-${task.title}`
                        : task.id}
                      task={task}
                      lane={lane}
                      totalLanes={tl || 1}
                      columnWidth={gridRefs.current[date]?.clientWidth || 120}
                      fullWidth={singleDay}
                      isBlocked={isBlocked}
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
