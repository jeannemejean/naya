import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useProject } from "@/lib/project-context";
import { MessageCircle, X, Send, Loader2, Sparkles, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: CompanionAction[];
  isLoading?: boolean;
}

type CompanionAction =
  | { type: "create_task"; title: string; scheduledDate?: string; projectId?: number | null }
  | { type: "create_task_list"; title: string; items: { title: string }[]; linkedDate?: string; linkedTaskId?: number }
  | { type: "create_note"; content: string; projectId?: number | null }
  | { type: "create_reminder"; title: string; datetime: string }
  | { type: "complete_task"; taskId: number }
  | { type: "reschedule_task"; taskId: number; newDate: string; newTime?: string }
  | { type: "reschedule_day"; energyLevel?: string; reason?: string }
  | { type: "set_energy"; level: string }
  | { type: "create_project"; name: string; projectType?: string; description?: string; milestones?: { title: string; description?: string }[] }
  | { type: "create_milestone_chain"; projectId: number; milestones: any[] }
  | { type: "confirm_milestone"; milestoneId: number }
  | { type: "show_project_roadmap"; projectId: number };

// ─── Action executor ─────────────────────────────────────────────────────────

function useActionExecutor(activeProject: any, projects: any[]) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Résout le projectId depuis l'action, avec fallback sur projet actif ou premier projet
  const resolveProjectId = (actionProjectId?: number | null): number | null => {
    if (actionProjectId && actionProjectId > 0) return actionProjectId;
    if (activeProject?.id) return activeProject.id;
    if (projects.length > 0) return projects[0].id;
    return null;
  };

  return async (action: CompanionAction) => {
    try {
      switch (action.type) {
        case "create_task": {
          await apiRequest("POST", "/api/tasks", {
            title: action.title,
            type: "planning",
            category: "planning",
            priority: 3,
            scheduledDate: action.scheduledDate,
            projectId: resolveProjectId(action.projectId),
            source: "companion",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: `✅ Tâche créée`, description: action.title });
          break;
        }

        case "create_task_list": {
          await apiRequest("POST", "/api/task-lists", {
            title: action.title,
            items: action.items,
            linkedDate: action.linkedDate,
            linkedTaskId: action.linkedTaskId,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/task-lists"] });
          toast({ title: `✅ Liste créée`, description: `${action.title} — ${action.items.length} éléments` });
          break;
        }

        case "create_note": {
          await apiRequest("POST", "/api/capture", {
            content: action.content,
            captureType: "text",
            projectId: action.projectId,
            source: "companion",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/capture"] });
          toast({ title: "📝 Note enregistrée" });
          break;
        }

        case "create_reminder": {
          await apiRequest("POST", "/api/tasks", {
            title: action.title,
            type: "admin",
            category: "planning",
            priority: 2,
            scheduledDate: action.datetime?.slice(0, 10),
            scheduledTime: action.datetime?.slice(11, 16),
            source: "companion",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: "⏰ Rappel créé", description: action.title });
          break;
        }

        case "complete_task": {
          await apiRequest("PATCH", `/api/tasks/${action.taskId}`, {
            completed: true,
            completedAt: new Date().toISOString(),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: "✅ Tâche complétée" });
          break;
        }

        case "reschedule_day": {
          // Replanifie toutes les tâches incomplètes d'aujourd'hui via l'auto-rebalance
          const today = new Date().toISOString().slice(0, 10);
          await apiRequest("POST", "/api/tasks/rebalance", {
            date: today,
            energyLevel: action.energyLevel || "medium",
            reason: action.reason,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: "📅 Journée réorganisée", description: action.reason || "Adapté à ton énergie du moment." });
          break;
        }

        case "reschedule_task": {
          await apiRequest("PATCH", `/api/tasks/${action.taskId}`, {
            scheduledDate: action.newDate,
            scheduledTime: action.newTime,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: "📅 Tâche replanifiée" });
          break;
        }

        case "create_project": {
          if (!action.name?.trim()) {
            toast({ title: "Erreur", description: "Nom du projet manquant", variant: "destructive" });
            break;
          }
          // 1. Créer le projet
          const projRes = await apiRequest("POST", "/api/projects", {
            name: action.name,
            type: action.projectType || "other",
            description: action.description || "",
            projectStatus: "active",
          });
          const newProject = await projRes.json();
          queryClient.invalidateQueries({ queryKey: ["/api/projects?limit=200"] });
          // 2. Si des jalons sont fournis, créer la chaîne
          if (Array.isArray(action.milestones) && action.milestones.length > 0 && newProject?.id) {
            await apiRequest("POST", `/api/projects/${newProject.id}/milestone-chain`, {
              milestones: action.milestones,
            });
            queryClient.invalidateQueries({ queryKey: [`/api/projects/${newProject.id}/milestones`] });
            toast({
              title: `📁 Projet créé : ${action.name}`,
              description: `${action.milestones.length} jalons ajoutés`,
            });
          } else {
            toast({ title: `📁 Projet créé : ${action.name}` });
          }
          break;
        }

        case "set_energy": {
          await apiRequest("PATCH", "/api/preferences", {
            currentEnergyLevel: action.level,
            energyUpdatedDate: new Date().toISOString().slice(0, 10),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
          toast({ title: `⚡ Énergie mise à jour : ${action.level}` });
          break;
        }

        case "create_milestone_chain": {
          const pid = resolveProjectId((action as any).projectId);
          const milestones = action.milestones;
          if (!pid) {
            toast({ title: "Erreur", description: "Aucun projet sélectionné pour créer les jalons", variant: "destructive" });
            break;
          }
          if (!Array.isArray(milestones) || milestones.length === 0) {
            toast({ title: "Erreur", description: "Aucun jalon dans la chaîne générée", variant: "destructive" });
            break;
          }
          await apiRequest("POST", `/api/projects/${pid}/milestone-chain`, { milestones });
          queryClient.invalidateQueries({ queryKey: [`/api/projects/${pid}/milestones`] });
          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
          toast({ title: "🗺 Chaîne de jalons créée", description: `${milestones.length} jalons` });
          break;
        }

        case "confirm_milestone": {
          await apiRequest("POST", `/api/milestones/${action.milestoneId}/confirm`);
          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
          toast({ title: "✅ Jalon confirmé" });
          break;
        }

        case "show_project_roadmap": {
          navigate("/projects");
          break;
        }
      }
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err?.message || "Action impossible",
        variant: "destructive",
      });
    }
  };
}

// ─── Shared hook: chat state + mutation ──────────────────────────────────────

function useCompanionChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const { activeProjectId } = useProject();
  const { data: projects = [] } = useQuery<any[]>({ queryKey: ['/api/projects?limit=200'] });
  const activeProject = projects.find((p: any) => p.id === activeProjectId) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayTasks = [] } = useQuery<any[]>({ queryKey: ['/api/tasks', today], queryFn: async () => { const r = await fetch(`/api/tasks?date=${today}`, { credentials: 'include' }); return r.json(); } });
  const executeAction = useActionExecutor(activeProject, projects);

  const { data: history } = useQuery<any[]>({
    queryKey: ["/api/companion/history"],
    enabled: open && messages.length === 0,
  });

  useEffect(() => {
    if (history && messages.length === 0) {
      setMessages(history.map(m => ({ role: m.role as "user" | "assistant", content: m.content, actions: m.actions })));
    }
  }, [history]);

  const chatMutation = useMutation({
    mutationFn: async (message: string): Promise<{ message: string; actions?: CompanionAction[]; suggestions?: string[] }> => {
      const now = new Date();
      const res = await apiRequest(
        "POST",
        "/api/companion/chat",
        {
          message,
          context: {
            currentDate: now.toISOString().slice(0, 10),
            currentTime: now.toTimeString().slice(0, 5),
            platform: "web",
            activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
            availableProjects: projects.slice(0, 10).map((p: any) => ({ id: p.id, name: p.name })),
            todayTasks: (todayTasks as any[]).slice(0, 10).map((t: any) => ({ id: t.id, title: t.title, completed: t.completed, scheduledTime: t.scheduledTime })),
          },
          conversationHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }
      );
      return res.json();
    },
    onSuccess: async (data) => {
      setMessages(prev => {
        const withoutLoading = prev.filter(m => !m.isLoading);
        return [...withoutLoading, { role: "assistant", content: data.message, actions: data.actions }];
      });
      if (data.actions?.length) {
        for (const action of data.actions) {
          await executeAction(action);
        }
      }
    },
    onError: () => {
      setMessages(prev => {
        const withoutLoading = prev.filter(m => !m.isLoading);
        return [...withoutLoading, { role: "assistant", content: "Une erreur est survenue. Réessaie dans un instant." }];
      });
    },
  });

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput("");
    setMessages(prev => [
      ...prev,
      { role: "user", content: msg },
      { role: "assistant", content: "", isLoading: true },
    ]);
    chatMutation.mutate(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return {
    open, setOpen,
    input, setInput,
    messages,
    activeProject,
    chatMutation,
    handleSend,
    handleKeyDown,
  };
}

// ─── Messages panel (shared between modes) ───────────────────────────────────

function MessagesPanel({ messages, messagesEndRef }: { messages: Message[]; messagesEndRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 max-h-[400px]">
      {messages.length === 0 && (
        <div className="text-center py-8">
          <Sparkles className="h-7 w-7 text-primary/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground font-medium">Comment puis-je t'aider ?</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Crée des tâches, planifie, réfléchis ensemble.</p>
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted text-foreground rounded-bl-sm"
            }`}
          >
            {msg.isLoading ? (
              <div className="flex items-center gap-1.5 py-0.5">
                <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                {msg.actions.map((a, j) => (
                  <div key={j} className="text-xs text-primary/70 flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" />
                    <ActionLabel action={a} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

// ─── Mode "header" — barre inline dans le dashboard ──────────────────────────

export function NayaCompanionBar() {
  const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown } = useCompanionChat();
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  const openAndFocus = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Barre de saisie permanente */}
      <div
        className={`flex items-center gap-2 h-9 px-3 rounded-xl border transition-all duration-200 cursor-text ${
          open
            ? "border-primary/40 bg-background ring-2 ring-primary/10 w-72"
            : "border-border/60 bg-muted/40 hover:border-border hover:bg-muted/60 w-64"
        }`}
        onClick={openAndFocus}
      >
        <Sparkles className={`h-3.5 w-3.5 flex-shrink-0 transition-colors ${open ? "text-primary" : "text-muted-foreground/50"}`} />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Dis quelque chose à Naya…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 min-w-0"
          disabled={chatMutation.isPending}
        />
        {input.trim() && (
          <button
            onClick={e => { e.stopPropagation(); handleSend(); }}
            disabled={chatMutation.isPending}
            className="flex-shrink-0 w-5 h-5 rounded-md bg-primary flex items-center justify-center"
          >
            {chatMutation.isPending
              ? <Loader2 className="h-2.5 w-2.5 animate-spin text-primary-foreground" />
              : <Send className="h-2.5 w-2.5 text-primary-foreground" />
            }
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 w-[380px] flex flex-col rounded-2xl bg-card shadow-2xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-semibold text-foreground">Naya</span>
              {activeProject && (
                <Badge variant="secondary" className="text-xs h-4 px-1.5">
                  {activeProject.name}
                </Badge>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} />

          {/* Input dans le panel aussi */}
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('companion.placeholder')}
                className="resize-none min-h-[38px] max-h-[100px] text-sm py-2 px-3 rounded-xl"
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-9 w-9 rounded-xl flex-shrink-0"
              >
                {chatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mode "floating" — bouton flottant (toutes les autres pages) ──────────────

export default function NayaCompanion() {
  const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown } = useCompanionChat();
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      {/* Bouton flottant */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 flex items-center justify-center transition-all duration-200 hover:scale-105"
          aria-label="Ouvrir Naya"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* Panneau de chat */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-h-[600px] flex flex-col rounded-2xl bg-card shadow-2xl border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-foreground">{t('companion.title')}</span>
              {activeProject && (
                <Badge variant="secondary" className="text-xs border-0 h-4 px-1.5">
                  {activeProject.name}
                </Badge>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>

          <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} />

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('companion.placeholder')}
                className="resize-none min-h-[40px] max-h-[120px] text-sm py-2 px-3 rounded-xl"
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-9 w-9 rounded-xl flex-shrink-0"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionLabel({ action }: { action: CompanionAction }) {
  switch (action.type) {
    case "create_project": return <span>Projet créé : {action.name}{action.milestones?.length ? ` · ${action.milestones.length} jalons` : ""}</span>;
    case "reschedule_day": return <span>Journée réorganisée{action.reason ? ` — ${action.reason}` : ""}</span>;
    case "create_task": return <span>Tâche créée : {action.title}</span>;
    case "create_task_list": return <span>Liste créée : {action.title}</span>;
    case "create_note": return <span>Note enregistrée</span>;
    case "create_reminder": return <span>Rappel : {action.title}</span>;
    case "complete_task": return <span>Tâche #{action.taskId} complétée</span>;
    case "reschedule_task": return <span>Tâche replanifiée au {action.newDate}</span>;
    case "set_energy": return <span>Énergie → {action.level}</span>;
    case "create_milestone_chain": return <span>{action.milestones.length} jalons créés</span>;
    case "confirm_milestone": return <span>Jalon confirmé</span>;
    case "show_project_roadmap": return <span>Ouverture roadmap</span>;
    default: return null;
  }
}
