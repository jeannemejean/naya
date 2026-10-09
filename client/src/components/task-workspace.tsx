import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Clock, Trash2, CalendarClock, ExternalLink, ThumbsDown, Pencil } from "lucide-react";
import TaskEditDialog from "@/components/task-edit-dialog";
import TaskFeedbackModal from "@/components/task-feedback-modal";
import { estEvenementAgenda } from "@/lib/agenda-api";
import { useRefuserTache } from "@/hooks/useRefuserTache";
import { Link } from "wouter";
import { lienInterneDeTache } from "@/lib/lien-tache";
import { useTranslation } from "react-i18next";
import LivrablesSection from "@/components/livrables/LivrablesSection";
import type { Task, Project, TaskWorkspaceEntry } from "@shared/schema";

interface TaskWorkspaceProps {
 task: Task | null;
 project: Project | null;
 open: boolean;
 onClose: () => void;
 onDeleted?: () => void;
 focusLivrables?: boolean;
 onFaitHorsNaya?: () => void;
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


export default function TaskWorkspace({ task, project, open, onClose, onDeleted, focusLivrables = false, onFaitHorsNaya }: TaskWorkspaceProps) {
 const { t } = useTranslation();
 const queryClient = useQueryClient();
 const { toast } = useToast();

 const [refusOuvert, setRefusOuvert] = useState(false);
 const [editionOuverte, setEditionOuverte] = useState(false);
 // Titre modifié depuis ce panneau : la tâche reçue en prop est une copie figée du parent.
 const [titreEdite, setTitreEdite] = useState<{ id: number; title: string; description?: string | null } | null>(null);
 const titreAffiche = titreEdite && task && titreEdite.id === task.id ? titreEdite.title : task?.title;
 const refuserMutation = useRefuserTache(() => { setRefusOuvert(false); onClose(); });
 const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
 const [showReschedule, setShowReschedule] = useState(false);
 const [rescheduleDate, setRescheduleDate] = useState("");
 const [rescheduleTime, setRescheduleTime] = useState("");

 const deleteMutation = useMutation({
 mutationFn: async () => {
 const res = await apiRequest("DELETE", `/api/tasks/${task!.id}`);
 if (!res.ok) throw new Error("Failed to delete task");
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
 queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
 toast({ title: "Tâche supprimée" });
 onDeleted?.();
 onClose();
 },
 onError: () => {
 toast({ title: "Erreur", description: "Impossible de supprimer la tâche.", variant: "destructive" });
 },
 });

 const rescheduleMutation = useMutation({
 mutationFn: async () => {
 const body: Record<string, string> = { scheduledDate: rescheduleDate };
 if (rescheduleTime) {
 body.scheduledTime = rescheduleTime;
 const [h, m] = rescheduleTime.split(":").map(Number);
 const endMin = h * 60 + m + (task?.estimatedDuration || 30);
 body.scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
 }
 const res = await apiRequest("PATCH", `/api/tasks/${task!.id}`, body);
 if (!res.ok) throw new Error("Failed to reschedule task");
 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
 queryClient.invalidateQueries({ queryKey: ['/api/tasks/range'] });
 toast({ title: "Tâche reprogrammée" });
 setShowReschedule(false);
 onClose();
 },
 onError: () => {
 toast({ title: "Erreur", description: "Impossible de reprogrammer la tâche.", variant: "destructive" });
 },
 });

 // Reset action states when task changes
 useEffect(() => {
 setShowDeleteConfirm(false);
 setShowReschedule(false);
 setRescheduleDate(task?.scheduledDate || "");
 setRescheduleTime(task?.scheduledTime || "");
 }, [task?.id]);

 // Une seule zone de rendu : « Ce que tu as produit » (LivrablesSection). L'ancien
 // éditeur à onglets (Stratégie / Écrire / Planifier…) doublait cette zone et créait un
 // second brouillon dans le calendrier, à côté du post de la tâche. Ses notes déjà
 // enregistrées restent lisibles plus bas.
 const ICONES_NOTES: Record<string, string> = { strategy: "◆", writing: "—", planning: "▷", reflection: "◯", research: "◇" };
 const [expandedEntry, setExpandedEntry] = useState<number | null>(null);

 const { data: entries = [] } = useQuery<TaskWorkspaceEntry[]>({
 queryKey: ['/api/tasks', task?.id, 'workspace'],
 queryFn: async () => {
 if (!task) return [];
 const res = await fetch(`/api/tasks/${task.id}/workspace`, { credentials: 'include' });
 return res.json();
 },
 enabled: !!task && open,
 });

 // Quand on arrive pour déposer un livrable, on amène la section à l'écran.
 useEffect(() => {
 if (open && focusLivrables) {
 document.getElementById("livrables-section")?.scrollIntoView({ block: "start" });
 }
 }, [open, focusLivrables]);

 return (
 <>
 <Sheet
 open={open}
 onOpenChange={(v) => { if (!v) onClose(); }}
 >
 <SheetContent side="right" className="w-full sm:max-w-[580px] flex flex-col p-0 overflow-hidden">
 <SheetHeader className="px-5 pt-5 pb-3 border-b border-naya-olive-18 flex-shrink-0">
 <div className="flex items-start gap-3">
 <div className="flex-1 min-w-0">
 <SheetTitle className="text-base text-foreground leading-snug">
 {titreAffiche ?? t('taskWorkspace.defaultTitle')}
 </SheetTitle>
 {project && (
 <div className="flex items-center gap-1.5 mt-1">
 <span
 className="inline-block w-2 h-2 rounded-full flex-shrink-0"
 style={{ backgroundColor: project.color || '#6366f1' }}
 />
 <span className="text-xs text-naya-cream0 ">{project.name}</span>
 </div>
 )}
 </div>
 {/* Actions rapides */}
 <div className="flex items-center gap-1 flex-shrink-0">
 {task && !estEvenementAgenda(task as any) && (
 <button
 onClick={() => setEditionOuverte(true)}
 aria-label={t('taskEdit.edit')}
 title={t('taskEdit.edit')}
 className="p-1.5 rounded-md text-naya-olive-35 hover:text-[#354963] hover:bg-naya-olive-06 transition-colors"
 >
 <Pencil className="h-4 w-4" />
 </button>
 )}
 {!estEvenementAgenda((task ?? {}) as any) && !(task as any)?.completed && (
 <button
 onClick={() => setRefusOuvert(true)}
 disabled={refuserMutation.isPending}
 aria-label={t('taskFeedback.refuse')}
 title={t('taskFeedback.refuse')}
 className="p-1.5 rounded-md text-naya-olive-35 hover:text-[#5c3d45] hover:bg-[rgba(158,126,135,0.12)] transition-colors disabled:opacity-50"
 >
 <ThumbsDown className="h-4 w-4" />
 </button>
 )}
 <button
 onClick={() => { setShowReschedule(v => !v); setShowDeleteConfirm(false); }}
 className="p-1.5 rounded-md text-naya-olive-35 hover:text-[#354963] hover:bg-naya-olive-06 transition-colors"
 title="Reprogrammer"
 >
 <CalendarClock className="h-4 w-4" />
 </button>
 <button
 onClick={() => { setShowDeleteConfirm(v => !v); setShowReschedule(false); }}
 className="p-1.5 rounded-md text-naya-olive-35 hover:text-[#5c3d45] hover:bg-[rgba(158,126,135,0.12)] transition-colors"
 title="Supprimer"
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </div>

 {/* Reprogrammer */}
 {showReschedule && (
 <div className="mt-3 p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-18 space-y-2">
 <p className="text-xs font-medium text-[#354963] ">Reprogrammer</p>
 <div className="flex gap-2">
 <input
 type="date"
 value={rescheduleDate}
 onChange={e => setRescheduleDate(e.target.value)}
 className="flex-1 text-xs px-2 py-1.5 rounded-md border border-naya-olive-18 bg-white text-naya-olive-70 "
 />
 <input
 type="time"
 value={rescheduleTime}
 onChange={e => setRescheduleTime(e.target.value)}
 className="w-24 text-xs px-2 py-1.5 rounded-md border border-naya-olive-18 bg-white text-naya-olive-70 "
 />
 </div>
 <div className="flex gap-2 justify-end">
 <button onClick={() => setShowReschedule(false)} className="text-xs text-naya-cream0 hover:text-naya-olive-70 px-2 py-1">Annuler</button>
 <button
 onClick={() => rescheduleMutation.mutate()}
 disabled={!rescheduleDate || rescheduleMutation.isPending}
 className="text-xs px-3 py-1 bg-naya-olive text-white rounded-md hover:bg-naya-olive disabled:opacity-50 transition-colors"
 >
 {rescheduleMutation.isPending ? "..." : "Confirmer"}
 </button>
 </div>
 </div>
 )}

 {/* Confirmation suppression */}
 {showDeleteConfirm && (
 <div className="mt-3 p-3 bg-[rgba(158,126,135,0.12)] rounded-lg border border-[rgba(158,126,135,0.35)] ">
 <p className="text-xs text-[#5c3d45] mb-2">Supprimer cette tâche définitivement ?</p>
 <div className="flex gap-2 justify-end">
 <button onClick={() => setShowDeleteConfirm(false)} className="text-xs text-naya-cream0 hover:text-naya-olive-70 px-2 py-1">Annuler</button>
 <button
 onClick={() => deleteMutation.mutate()}
 disabled={deleteMutation.isPending}
 className="text-xs px-3 py-1 bg-naya-mauve text-white rounded-md hover:bg-naya-mauve disabled:opacity-50 transition-colors"
 >
 {deleteMutation.isPending ? "..." : "Supprimer"}
 </button>
 </div>
 </div>
 )}
 </SheetHeader>

 <div className="flex-1 flex flex-col overflow-hidden">
 {lienInterneDeTache(task as any) && (
 <div className="px-5 pt-3">
 <Link
 href={lienInterneDeTache(task as any)!}
 onClick={onClose}
 className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-naya-olive-10 text-[#354963] hover:bg-naya-olive-18 transition-colors"
 >
 <ExternalLink className="h-3 w-3" />
 {t('taskWorkspace.openAction')}
 </Link>
 </div>
 )}
 {task?.source === 'campaign' && (
 <div className="flex items-center gap-2 px-5 pt-3 flex-wrap">
 <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(212,201,122,0.20)] text-[#5a4f0d] flex items-center gap-1">
 ◆ {t('taskWorkspace.fromCampaign')}
 </span>
 {(task as any).campaignId && (
 <Link
 href={`/content-calendar?campaignId=${(task as any).campaignId}`}
 className="text-[10px] px-2 py-0.5 rounded-full bg-naya-olive-10 text-[#354963] flex items-center gap-1 hover:bg-naya-olive-18 transition-colors cursor-pointer"
 >
 <ExternalLink className="h-2.5 w-2.5" />
 Voir le post dans le content calendar
 </Link>
 )}
 </div>
 )}
 {task?.description?.trim() && (
 <div className="px-5 pt-3">
 <div className="bg-naya-olive-06 rounded-lg px-3 py-2.5 border border-naya-olive-18 ">
 <p className="text-[10px] uppercase tracking-wider text-naya-olive-35 mb-1">
 {t('taskWorkspace.taskBrief')}
 </p>
 <p className="text-xs text-naya-olive-70 leading-relaxed">
 {task.description}
 </p>
 </div>
 </div>
 )}
 {task && (
 <div id="livrables-section" className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
 <LivrablesSection taskId={task.id} focus={focusLivrables} onFaitHorsNaya={onFaitHorsNaya} />
 </div>
 )}

 {entries.length > 0 && (
 <div className="flex-shrink-0 border-t border-naya-olive-18 max-h-60 overflow-y-auto">
 <div className="px-5 py-2.5">
 <p className="text-xs text-naya-cream0 uppercase tracking-wide mb-2">
 {t('taskWorkspace.previousNotes')}
 </p>
 <div className="space-y-1.5">
 {entries.map(entry => {
  const isExpanded = expandedEntry === entry.id;
 return (
 <div
 key={entry.id}
 className="border border-naya-olive-18 rounded-lg overflow-hidden"
 >
 <button
 onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
 className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-naya-olive-06 :bg-naya-olive/50 transition-colors"
 >
 <span className="text-xs">{ICONES_NOTES[entry.type] ?? '—'}</span>
 <span className="flex-1 text-xs text-naya-olive-70 truncate">
 {entry.title || entry.content.slice(0, 50) || t('taskWorkspace.untitledNote')}
 </span>
 <span className="text-[10px] text-naya-olive-35 flex items-center gap-0.5 flex-shrink-0">
 <Clock className="h-2.5 w-2.5" />
 {formatRelative(entry.createdAt)}
 </span>
 {isExpanded
 ? <ChevronDown className="h-3 w-3 text-naya-olive-35" />
 : <ChevronRight className="h-3 w-3 text-naya-olive-35" />}
 </button>
 {isExpanded && (
 <div className="px-3 pb-2.5 pt-1 bg-naya-olive-06 border-t border-naya-olive-10 ">
 <p className="text-xs text-naya-olive-55 whitespace-pre-wrap leading-relaxed">
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
 )}
 </div>
 </SheetContent>
 </Sheet>
 <TaskFeedbackModal
 mode="refuser"
 task={task}
 open={refusOuvert}
 onClose={() => setRefusOuvert(false)}
 onConfirm={(_type, reason, freeText) => {
 if (!task) return;
 refuserMutation.mutate({ taskId: task.id, reason, freeText });
 }}
 isPending={refuserMutation.isPending}
 />
 <TaskEditDialog
 task={task ? (titreEdite && titreEdite.id === task.id ? { ...task, ...titreEdite } : task) : null}
 open={editionOuverte}
 onClose={() => setEditionOuverte(false)}
 onSaved={(saved) => setTitreEdite({ id: saved.id, title: saved.title, description: saved.description ?? null })}
 />
 </>
 );
}
