import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";

interface ScheduleTask {
  id: number;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedDuration: number | null;
  taskEnergyType: string | null;
  priority: number;
  projectId: number | null;
  completed: boolean;
  projectName: string | null;
  projectColor: string | null;
}

interface GoalDeadline {
  id: number;
  title: string;
  dueDate: string;
  projectName?: string;
  projectColor?: string;
}

interface SchedulePreviewData {
  tasksByDate: Record<string, ScheduleTask[]>;
  availabilityMap: Record<string, string>;
  approachingDeadlines: GoalDeadline[];
  projectMap: Record<string, { name: string; color: string }>;
}

const ENERGY_BADGES: Record<string, { emoji: string; labelKey: string }> = {
  deep_work: { emoji: "🧠", labelKey: "Deep work" },
  creative: { emoji: "🎨", labelKey: "Creative" },
  admin: { emoji: "📋", labelKey: "Admin" },
  social: { emoji: "💬", labelKey: "Social" },
  logistics: { emoji: "📦", labelKey: "Logistics" },
  execution: { emoji: "⚡", labelKey: "Execution" },
};

const DAY_TYPE_BADGES: Record<string, string> = {
  off: "Off",
  "half-am": "½ AM",
  "half-pm": "½ PM",
  travel: "Travel",
  "deep-work": "Deep",
};

function formatTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${ampm}`;
}

function getDaysUntil(dateStr: string): number {
  const due = new Date(dateStr);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getNext7Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function formatDayLabel(dateStr: string, t: (key: string) => string): { day: string; date: string; isToday: boolean; isTomorrow: boolean } {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const isToday = dateStr === today.toISOString().split("T")[0];
  const isTomorrow = dateStr === tomorrow.toISOString().split("T")[0];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    day: isToday ? t('common.today') : isTomorrow ? t('schedulePreview.tomorrow') : dayNames[d.getDay()],
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    isToday,
    isTomorrow,
  };
}

function TomorrowTab({ data }: { data: SchedulePreviewData }) {
  const { t } = useTranslation();
  const tomorrowDate = getTomorrowDate();
  const tomorrowTasks = data.tasksByDate[tomorrowDate] || [];
  const scheduled = tomorrowTasks
    .filter((t) => t.scheduledTime && !t.completed)
    .sort((a, b) => (a.scheduledTime || "").localeCompare(b.scheduledTime || ""));
  const unscheduled = tomorrowTasks.filter((t) => !t.scheduledTime && !t.completed);
  const totalMinutes = tomorrowTasks
    .filter((t) => !t.completed)
    .reduce((sum, t) => sum + (t.estimatedDuration || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  const isEmpty = scheduled.length === 0 && unscheduled.length === 0;
  const taskCount = scheduled.length + unscheduled.length;

  return (
    <div className="space-y-3">
      {isEmpty ? (
        <div className="text-center py-4">
          <p className="text-sm text-slate-500 dark:text-gray-400">{t('schedulePreview.nothingScheduled')}</p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{t('schedulePreview.planAhead')}</p>
        </div>
      ) : (
        <>
          {scheduled.length > 0 && (
            <div className="space-y-1.5">
              {scheduled.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}

          {unscheduled.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                {t('schedulePreview.unscheduled')}
              </p>
              <div className="space-y-1.5">
                {unscheduled.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
              <Clock className="h-3 w-3" />
              <span>{t('schedulePreview.estimated', { hours: totalHours })}</span>
            </div>
            <span className="text-[10px] text-slate-400 dark:text-gray-500">
              {taskCount} {taskCount !== 1 ? t('schedulePreview.tasks') : t('schedulePreview.task')}
            </span>
          </div>
        </>
      )}

      {data.approachingDeadlines.length > 0 && (
        <div className="pt-2 border-t border-slate-200 dark:border-gray-700">
          <p className="text-[10px] text-amber-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <AlertCircle className="h-2.5 w-2.5" />
            {t('schedulePreview.approachingDeadlines')}
          </p>
          <div className="space-y-1.5">
            {data.approachingDeadlines.map((goal) => {
              const days = getDaysUntil(goal.dueDate);
              return (
                <div key={goal.id} className="flex items-start gap-2 text-xs">
                  <span className="text-amber-500 flex-shrink-0 mt-0.5">⚡</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-slate-700 dark:text-gray-200 line-clamp-1">{goal.title}</span>
                    <span className="text-amber-500 text-[10px] ml-1">
                      {days <= 0 ? t('schedulePreview.deadlineToday') : days === 1 ? t('schedulePreview.deadlineTomorrow') : t('schedulePreview.deadlineInDays', { count: days })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: ScheduleTask }) {
  const energy = task.taskEnergyType ? ENERGY_BADGES[task.taskEnergyType] : null;
  return (
    <div className="flex items-center gap-2 text-xs group">
      <div
        className="w-1 h-8 rounded-full flex-shrink-0"
        style={{ backgroundColor: task.projectColor || "#94a3b8" }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {task.scheduledTime && (
            <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono flex-shrink-0">
              {formatTime(task.scheduledTime)}
            </span>
          )}
          <span className={`line-clamp-1 ${task.completed ? "line-through text-slate-400" : "text-slate-700 dark:text-gray-200"}`}>
            {task.title}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {energy && (
          <span className="text-[10px]" title={energy.labelKey}>
            {energy.emoji}
          </span>
        )}
        {task.estimatedDuration && (
          <span className="text-[10px] text-slate-400 dark:text-gray-500 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
            {task.estimatedDuration}m
          </span>
        )}
      </div>
    </div>
  );
}

function WeekTab({ data }: { data: SchedulePreviewData }) {
  const { t } = useTranslation();
  const days = getNext7Days();

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
      {days.map((dateStr) => {
        const label = formatDayLabel(dateStr, t);
        const dayTasks = (data.tasksByDate[dateStr] || []).filter((t) => !t.completed);
        const totalMinutes = dayTasks.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0);
        const totalHours = (totalMinutes / 60).toFixed(1);
        const dayType = data.availabilityMap[dateStr] || "full";
        const badge = DAY_TYPE_BADGES[dayType];

        const projectBreakdown: Record<string, { color: string; count: number }> = {};
        for (const t of dayTasks) {
          const key = t.projectId?.toString() || "none";
          if (!projectBreakdown[key]) {
            projectBreakdown[key] = { color: t.projectColor || "#94a3b8", count: 0 };
          }
          projectBreakdown[key].count++;
        }
        const segments = Object.values(projectBreakdown);
        const totalCount = dayTasks.length;

        return (
          <div
            key={dateStr}
            className={`flex-1 min-w-[4rem] rounded-lg p-2 text-center border transition-colors ${
              label.isToday
                ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800"
                : "bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700"
            }`}
          >
            <p className={`text-[10px] ${label.isToday ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-gray-400"}`}>
              {label.day}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-gray-500">{label.date}</p>

            {badge && (
              <span className="inline-block mt-1 text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1 py-0.5 rounded">
                {badge}
              </span>
            )}

            <div className="mt-2 h-8 flex flex-col gap-px rounded overflow-hidden">
              {totalCount > 0 ? (
                segments.map((seg, i) => (
                  <div
                    key={i}
                    className="w-full rounded-sm"
                    style={{
                      backgroundColor: seg.color,
                      opacity: 0.7,
                      flexGrow: seg.count,
                    }}
                  />
                ))
              ) : (
                <div className="w-full h-full bg-slate-200 dark:bg-gray-700 rounded-sm opacity-30" />
              )}
            </div>

            <p className="text-xs text-slate-700 dark:text-gray-200 mt-1.5">
              {totalCount}
            </p>
            <p className="text-[9px] text-slate-400 dark:text-gray-500">
              {totalCount === 1 ? t('schedulePreview.task') : t('schedulePreview.tasks')}
            </p>
            {totalMinutes > 0 && (
              <p className="text-[9px] text-slate-400 dark:text-gray-500">{totalHours}h</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SchedulePreview() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"tomorrow" | "week">("tomorrow");

  const { data, isLoading } = useQuery<SchedulePreviewData>({
    queryKey: ["/api/dashboard/schedule-preview"],
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 border border-slate-200 dark:border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck2 className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm text-slate-700 dark:text-gray-200">{t('schedulePreview.whatsAhead')}</h3>
        </div>
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-gray-800 dark:to-gray-900 rounded-xl p-5 border border-slate-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarCheck2 className="h-4 w-4 text-slate-500 dark:text-gray-400" />
          <h3 className="text-sm text-slate-900 dark:text-white">{t('schedulePreview.whatsAhead')}</h3>
        </div>
        <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-gray-700/60 rounded-md p-0.5">
          <button
            onClick={() => setTab("tomorrow")}
            className={`text-[10px] px-2.5 py-1 rounded transition-colors ${
              tab === "tomorrow"
                ? "bg-white dark:bg-gray-600 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
            }`}
          >
            {t('schedulePreview.tomorrow')}
          </button>
          <button
            onClick={() => setTab("week")}
            className={`text-[10px] px-2.5 py-1 rounded transition-colors ${
              tab === "week"
                ? "bg-white dark:bg-gray-600 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
            }`}
          >
            {t('schedulePreview.thisWeek')}
          </button>
        </div>
      </div>

      {data && tab === "tomorrow" && <TomorrowTab data={data} />}
      {data && tab === "week" && <WeekTab data={data} />}

      <div className="mt-3 pt-2 border-t border-slate-200 dark:border-gray-700">
        <Link href="/planning" className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors">
          {t('schedulePreview.openPlanner')}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
