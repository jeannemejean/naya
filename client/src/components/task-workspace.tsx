import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Task, Project, TaskWorkspaceEntry } from "@shared/schema";

interface TaskWorkspaceProps {
  task: Task | null;
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

function formatRelative(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TaskWorkspace({ task, project, open, onClose }: TaskWorkspaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const WORKSPACE_TYPES = [
    { id: "strategy", label: t('taskWorkspace.strategy'), icon: "💡", placeholder: t('taskWorkspace.strategyPlaceholder') },
    { id: "writing", label: t('taskWorkspace.write'), icon: "✍️", placeholder: t('taskWorkspace.writePlaceholder') },
    { id: "planning", label: t('taskWorkspace.plan'), icon: "📋", placeholder: t('taskWorkspace.planPlaceholder') },
    { id: "reflection", label: t('taskWorkspace.reflect'), icon: "💬", placeholder: t('taskWorkspace.reflectPlaceholder') },
    { id: "research", label: t('taskWorkspace.research'), icon: "🔍", placeholder: t('taskWorkspace.researchPlaceholder') },
  ];

  const [activeType, setActiveType] = useState("strategy");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [currentEntryId, setCurrentEntryId] = useState<number | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedRef = useRef(false);

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TaskWorkspaceEntry[]>({
    queryKey: ['/api/tasks', task?.id, 'workspace'],
    queryFn: async () => {
      if (!task) return [];
      const res = await fetch(`/api/tasks/${task.id}/workspace`, { credentials: 'include' });
      return res.json();
    },
    enabled: !!task && open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { type: string; title: string; content: string }) => {
      const res = await apiRequest("POST", `/api/tasks/${task!.id}/workspace`, {
        projectId: task?.projectId ?? null,
        type: data.type,
        intent: data.type,
        title: data.title || null,
        source: "task",
        content: data.content,
      });
      return res.json();
    },
    onSuccess: (entry: TaskWorkspaceEntry) => {
      setCurrentEntryId(entry.id);
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ['/api/tasks', task?.id, 'workspace'] });
    },
    onError: () => {
      setSaveState("idle");
      toast({ title: t('taskWorkspace.error'), description: t('taskWorkspace.failedToSave'), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { content: string; title: string }) => {
      const res = await apiRequest("PATCH", `/api/tasks/workspace/${currentEntryId}`, data);
      return res.json();
    },
    onSuccess: () => {
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ['/api/tasks', task?.id, 'workspace'] });
    },
    onError: () => {
      setSaveState("idle");
      toast({ title: t('taskWorkspace.error'), description: t('taskWorkspace.failedToSave'), variant: "destructive" });
    },
  });

  const triggerSave = useCallback((c: string, t: string, type: string) => {
    if (!c.trim()) return;
    setSaveState("saving");
    if (currentEntryId) {
      updateMutation.mutate({ content: c, title: t });
    } else {
      createMutation.mutate({ type, title: t, content: c });
    }
  }, [currentEntryId, createMutation, updateMutation]);

  const handleChange = useCallback((newContent: string, newTitle: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    hasUnsavedRef.current = true;
    debounceRef.current = setTimeout(() => {
      triggerSave(newContent, newTitle, activeType);
    }, 800);
  }, [activeType, triggerSave]);

  useEffect(() => {
    if (!open) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setTitle("");
      setContent("");
      setCurrentEntryId(null);
      setSaveState("idle");
      hasUnsavedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    setTitle("");
    setContent("");
    setCurrentEntryId(null);
    setSaveState("idle");
    hasUnsavedRef.current = false;
  }, [activeType]);

  const activeTypeConfig = WORKSPACE_TYPES.find(t => t.id === activeType) ?? WORKSPACE_TYPES[0];

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[580px] flex flex-col p-0 overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-slate-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base text-slate-900 dark:text-white leading-snug">
                {task?.title ?? t('taskWorkspace.defaultTitle')}
              </SheetTitle>
              {project && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: project.color || '#6366f1' }}
                  />
                  <span className="text-xs text-slate-500 dark:text-gray-400">{project.name}</span>
                </div>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {task?.source === 'campaign' && (
            <div className="flex items-center gap-1.5 px-5 pt-3">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                🚀 {t('taskWorkspace.fromCampaign')}
              </span>
            </div>
          )}
          {task?.description?.trim() && (
            <div className="px-5 pt-3">
              <div className="bg-slate-50 dark:bg-gray-800/60 rounded-lg px-3 py-2.5 border border-slate-200 dark:border-gray-700">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">
                  {t('taskWorkspace.taskBrief')}
                </p>
                <p className="text-xs text-slate-700 dark:text-gray-300 leading-relaxed">
                  {task.description}
                </p>
              </div>
            </div>
          )}
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="flex gap-1 flex-wrap">
              {WORKSPACE_TYPES.map(wt => (
                <button
                  key={wt.id}
                  onClick={() => setActiveType(wt.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all ${
                    activeType === wt.id
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  <span>{wt.icon}</span>
                  {wt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col px-5 pt-3 pb-3 min-h-0">
            <Input
              placeholder={t('taskWorkspace.optionalTitle')}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                handleChange(content, e.target.value);
              }}
              className="mb-2 text-sm h-8 border-slate-200 dark:border-gray-700 flex-shrink-0"
            />
            <div className="relative flex-1 min-h-0">
              <Textarea
                placeholder={activeTypeConfig.placeholder}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  handleChange(e.target.value, title);
                }}
                className="h-full resize-none text-sm border-slate-200 dark:border-gray-700 focus:ring-1 focus:ring-slate-300"
                style={{ minHeight: '180px' }}
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 dark:text-gray-500 flex items-center gap-1">
                {saveState === "saving" && <><Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('taskWorkspace.saving')}</>}
                {saveState === "saved" && <><Check className="h-2.5 w-2.5 text-green-500" /> {t('taskWorkspace.saved')}</>}
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-slate-200 dark:border-gray-700 max-h-60 overflow-y-auto">
            <div className="px-5 py-2.5">
              <p className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                {t('taskWorkspace.previousNotes')}
              </p>
              {entriesLoading && (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                </div>
              )}
              {!entriesLoading && entries.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-gray-500 italic">
                  {t('taskWorkspace.noSavedNotes')}
                </p>
              )}
              <div className="space-y-1.5">
                {entries.map(entry => {
                  const typeConfig = WORKSPACE_TYPES.find(t => t.id === entry.type);
                  const isExpanded = expandedEntry === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className="border border-slate-200 dark:border-gray-700 rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <span className="text-xs">{typeConfig?.icon ?? '📝'}</span>
                        <span className="flex-1 text-xs text-slate-700 dark:text-gray-300 truncate">
                          {entry.title || entry.content.slice(0, 50) || t('taskWorkspace.untitledNote')}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-gray-500 flex items-center gap-0.5 flex-shrink-0">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelative(entry.createdAt)}
                        </span>
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3 text-slate-400" />
                          : <ChevronRight className="h-3 w-3 text-slate-400" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-2.5 pt-1 bg-slate-50 dark:bg-gray-800/30 border-t border-slate-100 dark:border-gray-700">
                          <p className="text-xs text-slate-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {entry.content}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
