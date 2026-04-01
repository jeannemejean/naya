import { useState } from "react";
import { Plus, Sparkles, Filter, Search, MoreHorizontal, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function ModernDashboardLayout({
  tasks,
  onTaskToggle,
  onGeneratePlan,
  isGenerating,
  headerTitle = "My Events",
  headerSubtitle,
}: ModernDashboardLayoutProps) {
  const { t } = useTranslation();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const todoTasks = tasks.filter((t) => !t.completed && t.status !== "in_progress");
  const inProgressTasks = tasks.filter((t) => !t.completed && t.status === "in_progress");
  const completedTasks = tasks.filter((t) => t.completed);

  const filteredTasks = (taskList: Task[]) => {
    if (!searchQuery) return taskList;
    return taskList.filter((t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-8 py-6 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
              {headerTitle}
            </h1>
            {headerSubtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {headerSubtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl">
              <Share className="h-4 w-4" />
              Share
            </Button>
            <Button variant="outline" size="sm" className="gap-2 rounded-xl">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 rounded-xl border-gray-200 dark:border-gray-800"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-xl">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>All Tasks</DropdownMenuItem>
              <DropdownMenuItem>High Priority</DropdownMenuItem>
              <DropdownMenuItem>Due Today</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onGeneratePlan && (
            <Button
              onClick={onGeneratePlan}
              disabled={isGenerating}
              size="sm"
              className="gap-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-xl px-6"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Plan
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex gap-6 p-8 overflow-x-auto">
          {/* TODO Column */}
          <div className="flex-shrink-0 w-[380px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                  TODO
                </h2>
                <Badge variant="secondary" className="h-6 rounded-full px-2 text-xs">
                  {filteredTasks(todoTasks).length}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {filteredTasks(todoTasks).map((task) => (
                <ModernTaskCard
                  key={task.id}
                  task={task}
                  onClick={() => setSelectedTask(task)}
                  onToggle={onTaskToggle}
                />
              ))}
              {filteredTasks(todoTasks).length === 0 && (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400 dark:text-gray-500">
                  No tasks
                </div>
              )}
            </div>
          </div>

          {/* IN PROGRESS Column */}
          <div className="flex-shrink-0 w-[380px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                  IN PROGRESS
                </h2>
                <Badge variant="secondary" className="h-6 rounded-full px-2 text-xs">
                  {filteredTasks(inProgressTasks).length}
                </Badge>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {filteredTasks(inProgressTasks).map((task) => (
                <ModernTaskCard
                  key={task.id}
                  task={task}
                  onClick={() => setSelectedTask(task)}
                  onToggle={onTaskToggle}
                />
              ))}
              {filteredTasks(inProgressTasks).length === 0 && (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400 dark:text-gray-500">
                  No tasks in progress
                </div>
              )}
            </div>
          </div>

          {/* COMPLETED Column */}
          <div className="flex-shrink-0 w-[380px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                  COMPLETED
                </h2>
                <Badge variant="secondary" className="h-6 rounded-full px-2 text-xs">
                  {filteredTasks(completedTasks).length}
                </Badge>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {filteredTasks(completedTasks).map((task) => (
                <ModernTaskCard
                  key={task.id}
                  task={task}
                  onClick={() => setSelectedTask(task)}
                  onToggle={onTaskToggle}
                />
              ))}
              {filteredTasks(completedTasks).length === 0 && (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400 dark:text-gray-500">
                  No completed tasks
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task Detail Panel */}
      <TaskDetailPanel
        task={selectedTask}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}
