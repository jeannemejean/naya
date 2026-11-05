import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/fetchJson";
import { useProject } from "@/lib/project-context";
import { Send, Loader2, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import type { ActionFaite, PropositionVue, ReponseAgent } from "@shared/agent";
import { ActionsFaites } from "@/components/companion/ActionsFaites";
import { Propositions, type SuiviProposition } from "@/components/companion/Propositions";
import { LigneRecherches } from "@/components/companion/LigneRecherches";
import { doitInvalider, messageDepuisHistorique, propositionsAAjuster, raisonDeErreur } from "@/components/companion/companion-logique";

// ─── Types ────────────────────────────────────────────────────────────────────

// L'agent agit côté serveur (POST /api/companion/chat) : le panneau affiche ce qu'il a
// cherché, ce qu'il a fait (avec « Annuler ») et ce qu'il propose (« Valider » / « Annuler »).
// Il n'exécute plus rien lui-même.
interface Message {
 role: "user" | "assistant";
 content: string;
 faites?: ActionFaite[];
 propositions?: PropositionVue[];
 recherches?: string[];
 isLoading?: boolean;
 /** Écran à ouvrir (messages des routines : « Bilan prêt » → onglet Mesure du projet). */
 lien?: string | null;
}

const RAISONS_PROPOSITION = ["expiree", "deja_traitee", "introuvable"] as const;

// ─── Shared hook: chat state + mutation ──────────────────────────────────────

function useCompanionChat() {
 const queryClient = useQueryClient();
 const [open, setOpen] = useState(false);
 const [input, setInput] = useState("");
 const [messages, setMessages] = useState<Message[]>([]);
 const [pendingLoaded, setPendingLoaded] = useState(false);
 const { activeProjectId } = useProject();
 const { data: projects = [] } = useQuery<any[]>({ queryKey: ['/api/projects?limit=200'] });
 const activeProject = projects.find((p: any) => p.id === activeProjectId) ?? null;
 const today = new Date().toISOString().slice(0, 10);
 const { data: todayTasks = [] } = useQuery<any[]>({ queryKey: ['/api/tasks', today], queryFn: () => fetchJson(`/api/tasks?date=${today}`) });
 const [suiviPropositions, setSuiviPropositions] = useState<Record<number, SuiviProposition | undefined>>({});
 const invaliderDonnees = () => queryClient.invalidateQueries({ predicate: (q) => doitInvalider(q.queryKey) });

 const { data: history } = useQuery<any[]>({
 queryKey: ["/api/companion/history"],
 enabled: open && messages.length === 0,
 });

 const { data: pendingData } = useQuery<{ messages: Array<{ id: number; message: string; lien?: string | null }>; unreadCount: number }>({
 queryKey: ['/api/companion/pending'],
 queryFn: () => fetchJson('/api/companion/pending'),
 refetchInterval: 60 * 1000,
 });

 useEffect(() => {
 if (!open || pendingLoaded) return;
 setPendingLoaded(true);

 const pending = pendingData?.messages ?? [];
 const historyMsgs = history
 ? history.map((m: any): Message => messageDepuisHistorique(m))
 : [];

 if (pending.length > 0 || historyMsgs.length > 0) {
 const pendingMsgs: Message[] = pending.map((pm) => ({
 role: 'assistant' as const,
 content: pm.message,
 lien: pm.lien ?? null,
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
 const handler = async (e: Event) => {
   setOpen(true);
   const detail = (e as CustomEvent).detail;

   // Ce handler faisait `setInput(detail.message)` : il deposait une PAROLE DE NAYA dans le
   // champ de saisie de l'utilisatrice, a la place de son propre texte. Les paroles de Naya
   // passent desormais par les messages en attente, cote serveur — comme toutes les autres.
   //
   // `reloadPending` demande de relire ces messages. L'ORDRE est essentiel : on relit AVANT
   // de rouvrir le verrou `pendingLoaded`. Dans l'autre sens, l'effet d'ouverture
   // s'executerait sur les donnees en cache, refermerait le verrou, et le message tout juste
   // depose serait perdu jusqu'au prochain rechargement complet.
   if (detail?.reloadPending) {
     await queryClient.refetchQueries({ queryKey: ['/api/companion/pending'] }).catch(() => {});
     setPendingLoaded(false);
   }
 };
 window.addEventListener('naya:open-companion', handler);
 return () => window.removeEventListener('naya:open-companion', handler);
 }, [setOpen, queryClient]);

 const chatMutation = useMutation({
 mutationFn: async (message: string): Promise<ReponseAgent> => {
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
 onSuccess: (data) => {
 const faites = Array.isArray(data.faites) ? data.faites : [];
 setMessages(prev => {
 const withoutLoading = prev.filter(m => !m.isLoading);
 return [...withoutLoading, {
 role: "assistant",
 content: data.message,
 faites,
 propositions: Array.isArray(data.propositions) ? data.propositions : [],
 recherches: Array.isArray(data.recherches) ? data.recherches : [],
 }];
 });
 // L'agent a déjà agi côté serveur : on rafraîchit ce qu'il a pu toucher.
 if (faites.length > 0) invaliderDonnees();
 },
 onError: (err: any) => {
 const limit = String(err?.message || err).includes("ai_monthly_limit_reached");
 setMessages(prev => {
 const withoutLoading = prev.filter(m => !m.isLoading);
 return [...withoutLoading, { role: "assistant", content: limit
 ? "Tu as atteint ta limite d'utilisation de l'IA pour ce mois-ci. Je serai de nouveau disponible le mois prochain."
 : "Une erreur est survenue. Réessaie dans un instant." }];
 });
 },
 });

 const validerProposition = async (id: number) => {
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "envoi" } }));
 try {
 const res = await apiRequest("POST", `/api/agent/propositions/${id}/valider`);
 const r: { reussis?: string[]; echecs?: string[] } = await res.json();
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "validee", reussis: r.reussis ?? [], echecs: r.echecs ?? [] } }));
 invaliderDonnees();
 } catch (err) {
 const raison = raisonDeErreur(err, RAISONS_PROPOSITION);
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "erreur", cle: `companion.proposition.${raison ?? "erreur"}` } }));
 }
 };

 const annulerProposition = async (id: number) => {
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "envoi" } }));
 try {
 await apiRequest("POST", `/api/agent/propositions/${id}/annuler`);
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "annulee" } }));
 } catch (err) {
 const raison = raisonDeErreur(err, RAISONS_PROPOSITION);
 setSuiviPropositions(s => ({ ...s, [id]: { statut: "erreur", cle: `companion.proposition.${raison ?? "erreur"}` } }));
 }
 };

 const handleSend = () => {
 const msg = input.trim();
 if (!msg || chatMutation.isPending) return;
 setInput("");
 // « Ajuster » : un nouveau message met de côté les propositions encore en attente.
 const aMettreDeCote = propositionsAAjuster(messages, Object.fromEntries(
 Object.entries(suiviPropositions).map(([k, v]) => [k, v?.statut]),
 ), new Date());
 if (aMettreDeCote.length > 0) {
 setSuiviPropositions(s => {
 const suite = { ...s };
 for (const id of aMettreDeCote) suite[id] = { statut: "ajustee" };
 return suite;
 });
 for (const id of aMettreDeCote) {
 apiRequest("POST", `/api/agent/propositions/${id}/annuler`).catch(() => {});
 }
 }
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
 suiviPropositions,
 validerProposition,
 annulerProposition,
 handleSend,
 handleKeyDown,
 unreadCount: pendingData?.unreadCount ?? 0,
 };
}

// ─── Messages panel (shared between modes) ───────────────────────────────────

function MessagesPanel({ messages, messagesEndRef, suivi, onValider, onAnnuler }: {
 messages: Message[];
 messagesEndRef: React.RefObject<HTMLDivElement>;
 suivi: Record<number, SuiviProposition | undefined>;
 onValider: (id: number) => void;
 onAnnuler: (id: number) => void;
}) {
 const { t } = useTranslation();
 const [, navigate] = useLocation();
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
 fontFamily: '"Montserrat", system-ui, sans-serif',
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
 letterSpacing: '0.02em',
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
 borderRadius: msg.role === "user" ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
 }}
 >
 {msg.isLoading ? (
 <span
 style={{
 fontFamily: '"Montserrat", system-ui, sans-serif',
 fontSize: '0.9rem',
 color: 'var(--muted-foreground)',
 letterSpacing: '0.02em',
 }}
 >
 {t('companion.cherche')}
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
 {msg.lien && msg.lien.startsWith('/') && (
 <button
 type="button"
 onClick={() => navigate(msg.lien!)}
 className="mt-2 text-xs underline underline-offset-2 text-foreground hover:opacity-80"
 >
 {t('companion.ouvrir')}
 </button>
 )}
 {!msg.isLoading && msg.role === "assistant" && (
 <>
 <LigneRecherches recherches={msg.recherches ?? []} />
 <ActionsFaites faites={msg.faites ?? []} />
 <Propositions
 propositions={msg.propositions ?? []}
 suivi={suivi}
 onValider={onValider}
 onAnnuler={onAnnuler}
 />
 </>
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
 const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown, unreadCount, suiviPropositions, validerProposition, annulerProposition } = useCompanionChat();
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
 boxShadow: open ? '0 0 0 3px rgba(43,45,28,0.10)' : 'none',
 }}
 >
 <div style={{ position: 'relative', flexShrink: 0 }}>
 <span
 style={{
 fontFamily: '"Montserrat", system-ui, sans-serif',
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
 boxShadow: '0 24px 60px -36px rgba(43,45,28,0.40), 0 4px 16px rgba(43,45,28,0.12)',
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
 fontFamily: '"Montserrat", system-ui, sans-serif',
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
 letterSpacing: '0.02em',
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

 <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} suivi={suiviPropositions} onValider={validerProposition} onAnnuler={annulerProposition} />

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
 const { open, setOpen, input, setInput, messages, activeProject, chatMutation, handleSend, handleKeyDown, unreadCount, suiviPropositions, validerProposition, annulerProposition } = useCompanionChat();
 const { t } = useTranslation();
 const messagesEndRef = useRef<HTMLDivElement>(null);
 const textareaRef = useRef<HTMLTextAreaElement>(null);

 useEffect(() => {
 messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
 }, [messages]);

 return (
 <>
 {/* Bouton flottant Naya — sous 768 px, remonté au-dessus de la pilule de navigation du bas */}
 {!open && (
 <div className="fixed bottom-[88px] md:bottom-6 right-6 z-50">
 <div className="relative">
 <button
 onClick={() => setOpen(true)}
 style={{
 width: 52,
 height: 52,
 background: 'var(--primary)',
 border: '1px solid rgba(43,45,28,0.18)',
 borderRadius: 14,
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 cursor: 'pointer',
 transition: 'all 150ms ease',
 boxShadow: '0 8px 28px rgba(43,45,28,0.16)',
 }}
 onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--accent)')}
 onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--primary)')}
 aria-label="Ouvrir Naya"
 >
 <span
 style={{
 fontFamily: '"Montserrat", system-ui, sans-serif',
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
 boxShadow: '0 24px 60px -36px rgba(43,45,28,0.40), 0 4px 16px rgba(43,45,28,0.12)',
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
 fontFamily: '"Montserrat", system-ui, sans-serif',
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
 letterSpacing: '0.02em',
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

 <MessagesPanel messages={messages} messagesEndRef={messagesEndRef} suivi={suiviPropositions} onValider={validerProposition} onAnnuler={annulerProposition} />

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
 className="h-9 w-9 rounded-lg flex-shrink-0"
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
