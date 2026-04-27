import { Clock, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModernTaskCardProps {
  task: {
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
    scheduledDate?: string;
    commentsCount?: number;
    attachmentsCount?: number;
  };
  onClick?: () => void;
  onToggle?: (id: number) => void;
}

const priorityLabel: Record<string, string> = {
  high:   "Priorité haute",
  medium: "Priorité normale",
  low:    "Priorité basse",
};

export function ModernTaskCard({ task, onClick, onToggle }: ModernTaskCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer transition-colors duration-120",
        task.completed && "opacity-50"
      )}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '12px 14px',
        boxShadow: '0 1px 2px rgba(43, 45, 28, 0.06)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      {/* Indicateur projet — trait gauche vertical */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: task.projectColor || 'var(--accent)',
          opacity: task.completed ? 0.4 : 0.7,
        }}
      />

      <div style={{ paddingLeft: 8 }}>
        {/* Titre */}
        <div className="flex items-start gap-3">
          {/* Checkbox minimal */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle?.(task.id); }}
            style={{
              flexShrink: 0,
              marginTop: 2,
              width: 14,
              height: 14,
              border: task.completed
                ? 'none'
                : '1px solid var(--border)',
              background: task.completed ? '#2B2D1C' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '2px',
            }}
          >
            {task.completed && (
              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                <path d="M1 3L3 5L7 1" stroke="#F7F4EC" strokeWidth="1.2" strokeLinecap="square" />
              </svg>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <p
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.8125rem',
                fontWeight: task.completed ? 300 : 400,
                color: task.completed ? 'var(--muted-foreground)' : 'var(--foreground)',
                lineHeight: 1.45,
                textDecoration: task.completed ? 'line-through' : 'none',
                margin: 0,
              }}
            >
              {task.title}
            </p>

            {task.description && (
              <p
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.6875rem',
                  fontWeight: 300,
                  color: 'var(--muted-foreground)',
                  marginTop: 4,
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {task.description}
              </p>
            )}
          </div>
        </div>

        {/* Méta — heure + durée + tags */}
        <div
          className="flex items-center flex-wrap"
          style={{ marginTop: 10, gap: 12 }}
        >
          {task.scheduledTime && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.625rem',
                fontWeight: 300,
                letterSpacing: '0.04em',
                color: 'var(--muted-foreground)',
              }}
            >
              <Clock style={{ width: 10, height: 10, strokeWidth: 1.5 }} />
              {task.scheduledTime}
            </span>
          )}

          {task.estimatedDuration && (
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.625rem',
                fontWeight: 300,
                letterSpacing: '0.04em',
                color: 'var(--muted-foreground)',
              }}
            >
              {task.estimatedDuration} min
            </span>
          )}

          {task.priority && task.priority === 'high' && (
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.5625rem',
                fontWeight: 400,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                padding: '1px 5px',
                opacity: 0.85,
              }}
            >
              urgent
            </span>
          )}

          {task.category && (
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.5625rem',
                fontWeight: 300,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground)',
                border: '1px solid var(--border)',
                padding: '1px 5px',
              }}
            >
              {task.category}
            </span>
          )}

          {/* Date si différente d'aujourd'hui */}
          {task.scheduledDate && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.75rem',
                fontWeight: 400,
                color: 'var(--muted-foreground)',
              }}
            >
              {new Date(task.scheduledDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
