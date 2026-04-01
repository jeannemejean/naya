import { Clock, MessageSquare, Paperclip, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

const priorityColors = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const categoryColors = {
  trust: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  conversion: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  engagement: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  planning: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
  visibility: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

export function ModernTaskCard({ task, onClick, onToggle }: ModernTaskCardProps) {
  const priorityColor = task.priority ? priorityColors[task.priority as keyof typeof priorityColors] : priorityColors.medium;
  const categoryColor = task.category ? categoryColors[task.category as keyof typeof categoryColors] : categoryColors.planning;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-200 dark:border-gray-800",
        "hover:shadow-lg hover:border-purple-200 dark:hover:border-purple-800 transition-all duration-200 cursor-pointer",
        task.completed && "opacity-60"
      )}
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: task.projectColor || "#8b5cf6",
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <Checkbox
          checked={task.completed}
          onCheckedChange={() => onToggle?.(task.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
        />

        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "font-semibold text-gray-900 dark:text-white mb-1.5 text-base leading-snug",
            task.completed && "line-through text-gray-500"
          )}>
            {task.title}
          </h3>

          {task.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
              {task.description}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-3">
            {task.priority && (
              <Badge className={cn("text-xs font-medium border-0", priorityColor)}>
                {task.priority === 'high' ? 'High Priority' : task.priority === 'medium' ? 'Medium Priority' : 'Low Priority'}
              </Badge>
            )}
            {task.category && (
              <Badge className={cn("text-xs font-medium border-0", categoryColor)}>
                {task.category}
              </Badge>
            )}
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            {task.scheduledTime && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>{task.scheduledTime}</span>
              </div>
            )}
            {task.estimatedDuration && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{task.estimatedDuration}min</span>
              </div>
            )}
            {task.commentsCount ? (
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{task.commentsCount}</span>
              </div>
            ) : null}
            {task.attachmentsCount ? (
              <div className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                <span>{task.attachmentsCount}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Project Icon */}
        {task.projectIcon && (
          <div className="text-2xl opacity-50 group-hover:opacity-100 transition-opacity">
            {task.projectIcon}
          </div>
        )}
      </div>

      {/* Scheduled Date Badge (if different from today) */}
      {task.scheduledDate && (
        <div className="absolute top-3 right-3">
          <Badge variant="outline" className="text-xs bg-white dark:bg-gray-900">
            {new Date(task.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Badge>
        </div>
      )}
    </div>
  );
}
