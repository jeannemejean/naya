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
  | { type: "set_energy"; level: string }
  | { type: "create_milestone_chain"; projectId: number; milestones: any[] }
  | { type: "confirm_milestone"; milestoneId: number }
  | { type: "show_project_roadmap"; projectId: number };

// ─── Action executor ─────────────────────────────────────────────────────────

function useActionExecutor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

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
            projectId: action.projectId,
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

        case "reschedule_task": {
          await apiRequest("PATCH", `/api/tasks/${action.taskId}`, {
            scheduledDate: action.newDate,
            scheduledTime: action.newTime,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          toast({ title: "📅 Tâche replanifiée" });
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
          await apiRequest("POST", `/api/projects/${action.projectId}/milestone-chain`, {
            milestones: action.milestones,
          });
          queryClient.invalidateQueries({ queryKey: [`/api/projects/${action.projectId}/milestones`] });
          toast({ title: "🗺 Chaîne de jalons créée", description: `${action.milestones.length} jalons` });
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

// ─── Composant principal ─────────────────────────────────────────────────────

export default function NayaCompanion() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeProject } = useProject();
  const executeAction = useActionExecutor();
  const { t } = useTranslation();

  // Charger l'historique au premier ouverture
  const { data: history } = useQuery<any[]>({
    queryKey: ["/api/companion/history"],
    enabled: open && messages.length === 0,
  });

  useEffect(() => {
    if (history && messages.length === 0) {
      setMessages(history.map(m => ({ role: m.role as "user" | "assistant", content: m.content, actions: m.actions })));
    }
  }, [history]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const now = new Date();
      return apiRequest<{ message: string; actions?: CompanionAction[]; suggestions?: string[] }>(
        "POST",
        "/api/companion/chat",
        {
          message,
          context: {
            currentDate: now.toISOString().slice(0, 10),
            currentTime: now.toTimeString().slice(0, 5),
            platform: "web",
            activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
          },
          conversationHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }
      );
    },
    onSuccess: async (data) => {
      setMessages(prev => {
        const withoutLoading = prev.filter(m => !m.isLoading);
        return [...withoutLoading, { role: "assistant", content: data.message, actions: data.actions }];
      });
      // Exécuter les actions
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

  return (
    <>
      {/* Bouton flottant */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30 flex items-center justify-center transition-all duration-200 hover:scale-105"
          aria-label="Ouvrir Naya"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* Panneau de chat */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-h-[600px] flex flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-semibold text-sm">{t('companion.title')}</span>
              {activeProject && (
                <Badge variant="secondary" className="bg-indigo-500 text-white text-xs border-0 h-4 px-1.5">
                  {activeProject.name}
                </Badge>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-indigo-200 hover:text-white transition-colors"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 max-h-[440px]">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Sparkles className="h-8 w-8 text-indigo-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500 dark:text-gray-400 font-medium">Comment puis-je t'aider ?</p>
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Crée des tâches, planifie, réfléchis ensemble.</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white rounded-bl-sm"
                  }`}
                >
                  {msg.isLoading ? (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-gray-700 space-y-1">
                      {msg.actions.map((a, j) => (
                        <div key={j} className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
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

          {/* Input */}
          <div className="border-t border-slate-200 dark:border-gray-700 p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('companion.placeholder')}
                className="resize-none min-h-[40px] max-h-[120px] text-sm py-2 px-3 rounded-xl border-slate-200 dark:border-gray-700 focus-visible:ring-indigo-500"
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-9 w-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
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
