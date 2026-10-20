// Cocher et ouvrir une tâche, à l'identique sur Aujourd'hui et Semaine : cochage instantané
// (cache optimiste partagé), dépôt demandé pour une tâche de production, lien interne suivi
// (relances, atelier), événement d'agenda coché dans Naya seulement.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import TaskWorkspace from "@/components/task-workspace";
import { useToast } from "@/hooks/use-toast";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";
import { useCocherAvecLivrable } from "@/hooks/useCocherAvecLivrable";
import { apiRequest } from "@/lib/queryClient";
import { lienInterneDeTache } from "@/lib/lien-tache";
import { CLE_MUTATION_COCHAGE, cocherDansLeCache, derniereCocheEnVol } from "@/lib/cochage-optimiste";
import { basculerEvenementAgenda, estEvenementAgenda } from "@/lib/agenda-api";
import { estTacheDeProduction } from "@shared/livrables";
import type { Project, Task } from "@shared/schema";
import type { TacheAccueil } from "./logique";

export type TacheJour = TacheAccueil & { source?: string | null; type?: string | null; scheduledDate?: string | null };

/** Ni les jalons virtuels du planning ni leurs anciennes tâches ne sont des tâches du fil. */
export const sansJalons = <T extends { type?: string | null; source?: string | null }>(ts: T[]) =>
  ts.filter((x) => x.type !== "milestone" && x.source !== "milestone");

export const estAgenda = (t: TacheJour) => estEvenementAgenda({ source: t.source ?? undefined });

export function useActionsTaches() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, naviguer] = useLocation();
  const { triggerAutoRebalance } = useAutoRebalance();
  const [ouverte, setOuverte] = useState<TacheJour | null>(null);
  const [focusLivrables, setFocusLivrables] = useState(false);
  // Le panneau s'ouvre sans déclencheur Radix : on rend le focus à ce qui l'a ouvert (clavier).
  const declencheur = useRef<HTMLElement | null>(null);
  const { data: projets = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"], throwOnError: false });

  const toggle = useMutation({
    mutationKey: CLE_MUTATION_COCHAGE,
    mutationFn: async (taskId: number) => (await apiRequest("POST", `/api/tasks/${taskId}/toggle`)).json(),
    onMutate: async (taskId: number) => ({ annuler: await cocherDansLeCache(qc, taskId) }),
    onSuccess: () => triggerAutoRebalance(),
    onSettled: () => {
      if (!derniereCocheEnVol(qc)) return;
      qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/schedule-preview"] });
    },
    onError: (_e, _id, ctx) => {
      ctx?.annuler();
      toast({ title: t("common.error"), description: t("todaysTasks.failedUpdateTask"), variant: "destructive" });
    },
  });
  const agenda = useMutation({
    mutationFn: (task: TacheJour) => basculerEvenementAgenda(task as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: () => toast({ title: t("common.error"), description: t("todaysTasks.failedUpdateTask"), variant: "destructive" }),
  });

  const memoriserDeclencheur = () => { declencheur.current = document.activeElement as HTMLElement | null; };
  const cocherAvecLivrable = useCocherAvecLivrable({
    cocher: (id) => toggle.mutate(id),
    ouvrirDepot: (task) => { memoriserDeclencheur(); setFocusLivrables(true); setOuverte(task as TacheJour); },
  });

  /** Cocher (ou décocher) depuis le rond de la ligne. */
  const cocher = (tache: TacheJour) => {
    if (estAgenda(tache)) agenda.mutate(tache);
    else if (tache.completed) toggle.mutate(tache.id);
    else void cocherAvecLivrable(tache as any);
  };

  const estOuvrable = (tache: TacheJour) => !!lienInterneDeTache(tache) || !estAgenda(tache);

  /** Ouvrir : le lien interne s'il existe, sinon le panneau de la tâche. */
  const ouvrir = (tache: TacheJour) => {
    const lien = lienInterneDeTache(tache);
    if (lien) { naviguer(lien); return; }
    if (!estOuvrable(tache)) return;
    memoriserDeclencheur();
    setFocusLivrables(estTacheDeProduction(tache.title) && !tache.completed);
    setOuverte(tache);
  };

  const fermer = () => {
    setFocusLivrables(false);
    setOuverte(null);
    // Après l'animation de fermeture, sinon Radix remet le focus sur le corps de page.
    const el = declencheur.current;
    setTimeout(() => { if (el?.isConnected) el.focus(); }, 350);
  };

  const panneau = (
    <TaskWorkspace
      task={ouverte as unknown as Task | null}
      project={ouverte?.projectId ? (projets.find((p) => p.id === ouverte.projectId) ?? null) : null}
      open={!!ouverte}
      onClose={fermer}
      focusLivrables={focusLivrables}
      onFaitHorsNaya={() => {
        if (ouverte) toggle.mutate(ouverte.id);
        fermer();
      }}
      onBasculer={(tache) => (estEvenementAgenda(tache as any) ? agenda.mutate(tache as any) : toggle.mutate(tache.id))}
    />
  );

  return { cocher, ouvrir, estOuvrable, projets, panneau };
}
