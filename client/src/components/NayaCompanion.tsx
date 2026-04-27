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
  const [pendingLoaded, setPendingLoaded] = useState(false);
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

  const { data: pendingData } = useQuery<{ messages: Array<{ id: number; message: string }>; unreadCount: number }>({
    queryKey: ['/api/companion/pending'],
    queryFn: async () => {
      const r = await fetch('/api/companion/pending', { credentials: 'include' });
      return r.json();
    },
    refetchInterval: 60 * 1000,
  });

  useEffect(() => {
    if (!open || pendingLoaded) return;
    setPendingLoaded(true);

    const pending = pendingData?.messages ?? [];
    const historyMsgs = history
      ? history.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content, actions: m.actions }))
      : [];

    if (pending.length > 0 || historyMsgs.length > 0) {
      const pendingMsgs: Message[] = pending.map((pm) => ({
        role: 'assistant' as const,
        content: pm.message,
      }));
      setMessages([...pendingMsgs, ...historyMsgs]);

      pending.forEach((pm) => {
        fetch(`/api/companion/pending/${pm.id}/read`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {});
      });
    }
  }, [open, history, pendingData, pendingLoaded]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('naya:open-companion', handler);
    return () => window.removeEventListener('naya:open-companion', handler);
  }, [setOpen]);

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
    unreadCount: pendingData?.unreadCount ?? 0,
  };
}

// ─── Messages panel (shared between modes) ───────────────────────────────────

function MessagesPanel({ messages, messagesEndRef }: { messages: Message[]; messagesEndRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div
      className="flex-1 overflow-y-auto min-h-0"
      style={{
        maxHeight: 400,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--background)',
      }}
    >
      {messages.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 32, paddingBottom: 32 }}>
          <p
            style={{
              fontFamily: '"Unbounded", system-ui, sans-serif',
              fontSize: '1rem',
              color: 'var(--muted-foreground)',
              marginBottom: 6,
            }}
          >
            Comment puis-je t'aider ?
          </p>
          <p
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.625rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 300,
              color: 'var(--muted-foreground)',
              opacity: 0.6,
            }}
          >
            Crée des tâches · Planifie · Réfléchis
          </p>
        </div>
      )}

      {messages.map((msg, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}
        >
          <div
            style={{
              maxWidth: '82%',
              padding: '10px 13px',
              background: msg.role === "user"
                ? 'var(--primary)'
                : 'var(--card)',
              color: msg.role === "user"
                ? 'var(--primary-foreground)'
                : 'var(--foreground)',
              border: msg.role === "user"
                ? 'none'
                : '1px solid var(--border)',
              borderRadius: msg.role === "user" ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
            }}
          >
            {msg.isLoading ? (
              <span
                style={{
                  fontFamily: '"Unbounded", system-ui, sans-serif',
                  fontSize: '0.9rem',
                  color: 'var(--muted-foreground)',
                  letterSpacing: '0.1em',
                }}
              >
                · · ·
              </span>
            ) : (
              <p
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {msg.content}
              </p>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                {msg.actions.map((a, j) => (
                  <div
                    key={j}
                    style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: '0.5625rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: 300,
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span style={{ opacity: 0.6 }}>◆</span>
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
  const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown, unreadCount } = useCompanionChat();
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
        onClick={openAndFocus}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          paddingLeft: 12,
          paddingRight: 8,
          border: `1px solid ${open ? 'var(--primary)' : 'var(--border)'}`,
          background: 'var(--muted)',
          borderRadius: 20,
          cursor: 'text',
          width: open ? 300 : 240,
          transition: 'width 200ms ease, border-color 150ms ease',
          boxShadow: open ? '0 0 0 3px rgba(139,127,168,0.12)' : 'none',
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <span
            style={{
              fontFamily: '"Unbounded", system-ui, sans-serif',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: open ? 'var(--accent)' : 'var(--muted-foreground)',
              lineHeight: 1,
            }}
          >
            N
          </span>
          {!open && unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 8,
                height: 8,
                background: 'var(--accent)',
              }}
            />
          )}
        </div>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Parle à Naya…"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.75rem',
            fontWeight: 300,
            color: 'var(--foreground)',
            minWidth: 0,
          }}
          disabled={chatMutation.isPending}
        />
        {input.trim() && (
          <button
            onClick={e => { e.stopPropagation(); handleSend(); }}
            disabled={chatMutation.isPending}
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {chatMutation.isPending
              ? <Loader2 style={{ width: 10, height: 10, color: 'var(--primary-foreground)' }} className="animate-spin" />
              : <Send style={{ width: 10, height: 10, color: 'var(--primary-foreground)' }} />
            }
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div
          className="fixed top-14 right-4 z-50 flex flex-col overflow-hidden"
          style={{
            width: 380,
            maxHeight: 560,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--primary)' }}
          >
            <div className="flex items-center gap-2">
              <span
                style={{
                  fontFamily: '"Unbounded", system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  color: 'var(--primary-foreground)',
                }}
              >
                Naya
              </span>
              {activeProject && (
                <span
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '0.5625rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 300,
                    color: 'var(--primary-foreground)',
                    opacity: 0.6,
                    border: '1px solid var(--primary-foreground)',
                    padding: '1px 5px',
                  }}
                >
                  {activeProject.name}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--primary-foreground)',
                opacity: 0.7,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronDown style={{ width: 14, height: 14 }} />
            </button>
          </div>

          <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} />

          {/* Input dans le panel */}
          <div style={{ borderTop: '1px solid var(--border)', padding: 10 }}>
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('companion.placeholder')}
                className="resize-none min-h-[38px] max-h-[100px] text-sm py-2 px-3"
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="h-9 w-9 flex-shrink-0"
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
  const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown, unreadCount } = useCompanionChat();
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      {/* Bouton flottant Naya */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="relative">
            <button
              onClick={() => setOpen(true)}
              style={{
                width: 52,
                height: 52,
                background: 'var(--primary)',
                border: '1px solid rgba(139,127,168,0.4)',
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--accent)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--primary)')}
              aria-label="Ouvrir Naya"
            >
              <span
                style={{
                  fontFamily: '"Unbounded", system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: '1.375rem',
                  color: 'var(--primary-foreground)',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                N
              </span>
            </button>
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 16,
                  height: 16,
                  background: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.5rem',
                  fontWeight: 400,
                  color: 'var(--primary-foreground)',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Panneau de chat */}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden"
          style={{
            width: 380,
            maxHeight: 600,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom: '1px solid var(--border)',
              background: 'var(--primary)',
            }}
          >
            <div className="flex items-center gap-3">
              <span
                style={{
                  fontFamily: '"Unbounded", system-ui, sans-serif',
                  fontWeight: 600,
                  fontSize: '1rem',
                  color: 'var(--primary-foreground)',
                  letterSpacing: '-0.01em',
                }}
              >
                {t('companion.title')}
              </span>
              {activeProject && (
                <span
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '0.5625rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontWeight: 300,
                    color: 'var(--primary-foreground)',
                    opacity: 0.6,
                    border: '1px solid var(--primary-foreground)',
                    padding: '1px 6px',
                  }}
                >
                  {activeProject.name}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                color: 'var(--primary-foreground)',
                opacity: 0.7,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronDown style={{ width: 16, height: 16 }} />
            </button>
          </div>

          <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} />

          {/* Input */}
          <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('companion.placeholder')}
                className="resize-none min-h-[40px] max-h-[120px] text-sm py-2 px-3"
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
