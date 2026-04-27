import { useState } from "react";
import { Plus, Sparkles, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModernTaskCard } from "./modern-task-card";
import { TaskDetailPanel } from "./task-detail-panel";
import { useTranslation } from "react-i18next";

interface Task {
  id: number;
  title: string;
  description?: string;
  priority?: string;
  scheduledTime?: string;
  estimatedDuration?: number;
  category?: string;
  completed?: boolean;
  projectColor?: string;
  projectIcon?: string;
  projectName?: string;
  scheduledDate?: string;
  status?: "todo" | "in_progress" | "completed";
}

interface ModernDashboardLayoutProps {
  tasks: Task[];
  onTaskToggle?: (id: number) => void;
  onGeneratePlan?: () => void;
  isGenerating?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
}

const COLUMNS = [
  { key: "todo",        label: "À faire",    filter: (t: Task) => !t.completed && t.status !== "in_progress" },
  { key: "in_progress", label: "En cours",   filter: (t: Task) => !t.completed && t.status === "in_progress" },
  { key: "completed",   label: "Terminé",    filter: (t: Task) => !!t.completed },
] as const;

export function ModernDashboardLayout({
  tasks,
  onTaskToggle,
  onGeneratePlan,
  isGenerating,
  headerTitle,
  headerSubtitle,
}: ModernDashboardLayoutProps) {
  const { t } = useTranslation();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filter = (taskList: Task[]) => {
    if (!searchQuery) return taskList;
    return taskList.filter((t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--background)' }}>

      {/* Header */}
      <div
        className="px-8 py-5 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}
      >
        <div>
          {headerTitle && (
            <h1
              style={{
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontWeight: 500,
                fontSize: '1.75rem',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
                color: 'var(--foreground)',
                margin: 0,
              }}
            >
              {headerTitle}
            </h1>
          )}
          {headerSubtitle && (
            <p
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.6875rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 300,
                color: 'var(--muted-foreground)',
                marginTop: 4,
              }}
            >
              {headerSubtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Recherche */}
          <div className="relative">
            <Search
              style={{
                position: 'absolute', left: 10, top: '50%',
                transform: 'translateY(-50%)', width: 13, height: 13,
                color: 'var(--muted-foreground)', strokeWidth: 1.5
              }}
            />
            <input
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: 30,
                paddingRight: 12,
                paddingTop: 6,
                paddingBottom: 6,
                background: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '0.75rem',
                fontWeight: 300,
                color: 'var(--foreground)',
                width: 220,
                outline: 'none',
              }}
            />
          </div>

          {/* Générer le plan */}
          {onGeneratePlan && (
            <button
              onClick={onGeneratePlan}
              disabled={isGenerating}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 16px',
                background: isGenerating ? 'var(--muted)' : 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: 'none',
                borderRadius: 4,
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '0.8125rem',
                letterSpacing: '-0.01em',
                fontWeight: 500,
                cursor: isGenerating ? 'wait' : 'pointer',
                opacity: isGenerating ? 0.7 : 1,
              }}
            >
              {isGenerating ? 'Génération...' : 'Générer le plan'}
            </button>
          )}
        </div>
      </div>

      {/* Colonnes kanban */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex overflow-x-auto" style={{ padding: '0' }}>
          {COLUMNS.map((col, colIdx) => {
            const colTasks = filter(tasks.filter(col.filter));
            return (
              <div
                key={col.key}
                className="flex-shrink-0 flex flex-col"
                style={{
                  width: '33.333%',
                  minWidth: 320,
                  borderRight: colIdx < COLUMNS.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                {/* En-tête colonne */}
                <div
                  className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '0.625rem',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        fontWeight: 400,
                        color: 'var(--muted-foreground)',
                      }}
                    >
                      {col.label}
                    </span>
                    <span
                      style={{
                        fontFamily: '"Montserrat", system-ui, sans-serif',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--muted-foreground)',
                      }}
                    >
                      {colTasks.length}
                    </span>
                  </div>
                  {col.key === 'todo' && (
                    <button
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 24, height: 24,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--muted-foreground)',
                        cursor: 'pointer',
                        borderRadius: 4,
                      }}
                    >
                      <Plus style={{ width: 12, height: 12, strokeWidth: 1.5 }} />
                    </button>
                  )}
                </div>

                {/* Liste de tâches */}
                <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {colTasks.map((task) => (
                      <ModernTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                        onToggle={onTaskToggle}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div
                        className="flex items-center justify-center"
                        style={{
                          height: 80,
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontSize: '0.6875rem',
                          letterSpacing: '0.06em',
                          color: 'var(--muted-foreground)',
                          opacity: 0.5,
                        }}
                      >
                        —
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Panel détail tâche */}
      <TaskDetailPanel
        task={selectedTask}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}
