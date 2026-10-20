// L'accueil « Aujourd'hui » (spec refonte cocon, section 3) : la photo et le mot du matin,
// la prochaine étape, les capsules, la note pour Naya et le fil de la journée.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { HeroSaison } from "@/components/cocon/HeroSaison";
import QuickCapture from "@/components/quick-capture";
import TaskWorkspace from "@/components/task-workspace";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useAutoRebalance } from "@/hooks/use-auto-rebalance";
import { useProject } from "@/lib/project-context";
import { apiRequest } from "@/lib/queryClient";
import { formatLocalDate } from "@/lib/dateUtils";
import { lienInterneDeTache } from "@/lib/lien-tache";
import { CLE_MUTATION_COCHAGE, cocherDansLeCache, derniereCocheEnVol } from "@/lib/cochage-optimiste";
import { basculerEvenementAgenda, estEvenementAgenda } from "@/lib/agenda-api";
import { estTacheDeProduction } from "@shared/livrables";
import type { Project, Task } from "@shared/schema";
import { prochaineEtape, type TacheAccueil } from "./logique";
import { MotDuMatin } from "./MotDuMatin";
import { PiluleEtape } from "./PiluleEtape";
import { Capsules } from "./Capsules";
import { FilDuJour } from "./FilDuJour";

type TacheJour = TacheAccueil & { source?: string | null; type?: string | null; projectId?: number | null };

function semaineDe(d: Date): { lundi: string; dimanche: string } {
  const lundi = new Date(d);
  lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  return { lundi: formatLocalDate(lundi), dimanche: formatLocalDate(dimanche) };
}

export default function Aujourdhui({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, naviguer] = useLocation();
  const { user } = useAuth();
  const { activeProjectId } = useProject();
  const { triggerAutoRebalance } = useAutoRebalance();
  const [workspaceTask, setWorkspaceTask] = useState<TacheJour | null>(null);
  const [focusLivrables, setFocusLivrables] = useState(false);
  // Le panneau s'ouvre sans déclencheur Radix : on rend le focus à ce qui l'a ouvert (clavier).
  const declencheur = useRef<HTMLElement | null>(null);

  const maintenant = new Date();
  const today = formatLocalDate(maintenant);
  const { lundi, dimanche } = semaineDe(maintenant);
  const dateDuJour = new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(maintenant);

  // Même clé et même adresse que todays-tasks.tsx : cache et cochage optimiste partagés.
  const tasksQueryKey = activeProjectId
    ? ["/api/tasks/range", { start: today, end: today, projectId: activeProjectId }]
    : ["/api/tasks/range", { start: today, end: today }];
  const tasksUrl = activeProjectId
    ? `/api/tasks/range?start=${today}&end=${today}&projectId=${activeProjectId}`
    : `/api/tasks/range?start=${today}&end=${today}`;
  const { data: tasks, isLoading, isError } = useQuery<TacheJour[]>({
    queryKey: tasksQueryKey,
    queryFn: async () => {
      const res = await fetch(tasksUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
    refetchInterval: 2 * 60 * 1000,
    throwOnError: false, // le fil montre son propre état d'erreur, l'accueil reste debout
  });
  // Les jalons virtuels (injectés pour la vue planning) ne sont pas des tâches.
  const taches = (tasks ?? []).filter((x) => x.type !== "milestone" && x.source !== "milestone");
  // Un événement d'agenda ne se « commence » pas dans Naya.
  const etape = prochaineEtape(taches.filter((x) => !estEvenementAgenda({ source: x.source ?? undefined })));

  const { data: enRetard } = useQuery<unknown[]>({
    queryKey: [`/api/tasks/overdue?clientToday=${today}`],
    retry: false,
    throwOnError: false,
  });

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"], throwOnError: false });

  // Cochage depuis le panneau de la tâche : même chemin instantané que todays-tasks.tsx.
  const toggleTaskMutation = useMutation({
    mutationKey: CLE_MUTATION_COCHAGE,
    mutationFn: async (taskId: number) => {
      const res = await apiRequest("POST", `/api/tasks/${taskId}/toggle`);
      return res.json();
    },
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
  const agendaMutation = useMutation({
    mutationFn: (task: Task) => basculerEvenementAgenda(task as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
      qc.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: () => toast({ title: t("common.error"), description: t("todaysTasks.failedUpdateTask"), variant: "destructive" }),
  });

  const estOuvrable = (tache: TacheAccueil) =>
    !!lienInterneDeTache(tache) || !estEvenementAgenda({ source: (tache as TacheJour).source ?? undefined });

  // Règle de « Commencer » et du clic sur le fil : le lien interne de la tâche s'il existe
  // (relances de prospection, atelier…), sinon le panneau de la tâche (dépôt direct pour
  // une tâche de production non faite, comme dans todays-tasks.tsx).
  const ouvrir = (tache: TacheAccueil) => {
    const lien = lienInterneDeTache(tache);
    if (lien) { naviguer(lien); return; }
    if (!estOuvrable(tache)) return;
    declencheur.current = document.activeElement as HTMLElement | null;
    setFocusLivrables(estTacheDeProduction(tache.title) && !tache.completed);
    setWorkspaceTask(tache as TacheJour);
  };
  const fermer = () => {
    setFocusLivrables(false);
    setWorkspaceTask(null);
    // Après l'animation de fermeture, sinon Radix remet le focus sur le corps de page.
    const el = declencheur.current;
    setTimeout(() => { if (el?.isConnected) el.focus(); }, 350);
  };

  const prenom = user?.firstName?.trim();
  const etatFil = isLoading ? "chargement" : isError ? "erreur" : "pret";

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <OngletsEspace />
        <main className="mx-auto w-full max-w-[1200px] space-y-6 px-4 pb-10 pt-2 sm:px-6">
          <HeroSaison>
            {/* Texte à gauche, sur le voile ; les reflets d'été sont à droite. */}
            <div className="flex min-h-[300px] flex-col px-5 py-6 text-primary-foreground sm:px-8 sm:py-8 md:min-h-[340px]">
              <p className="text-[13px] first-letter:uppercase">{dateDuJour}</p>
              <h1 className="titre-accueil mt-2 break-words !text-primary-foreground">
                {prenom ? t("accueil.bonjour", { prenom }) : t("accueil.bonjourSansPrenom")}
              </h1>
              <MotDuMatin className="mt-3" />
              {/* Rien tant que les tâches chargent ou si elles échouent ; aucune tâche : rien non plus. */}
              {etatFil === "pret" && taches.length > 0 && (
                <div className="mt-auto pt-6">
                  <PiluleEtape etape={etape} onCommencer={ouvrir} />
                </div>
              )}
            </div>
          </HeroSaison>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-4">
              <Capsules aujourdhui={today} lundi={lundi} dimanche={dimanche} activeProjectId={activeProjectId} />
              <QuickCapture variante="pilule" />
            </div>
            <div className="min-w-0">
              <FilDuJour
                taches={taches}
                etat={etatFil}
                enCoursId={etape?.id ?? null}
                enAttente={Array.isArray(enRetard) ? enRetard.length : 0}
                estOuvrable={estOuvrable}
                onOuvrir={ouvrir}
              />
            </div>
          </div>
        </main>
      </div>

      <TaskWorkspace
        task={workspaceTask as unknown as Task | null}
        project={workspaceTask?.projectId ? (projects.find((p) => p.id === workspaceTask.projectId) ?? null) : null}
        open={!!workspaceTask}
        onClose={fermer}
        focusLivrables={focusLivrables}
        onFaitHorsNaya={() => {
          if (workspaceTask) toggleTaskMutation.mutate(workspaceTask.id);
          fermer();
        }}
        onBasculer={(tache) => estEvenementAgenda(tache as any) ? agendaMutation.mutate(tache) : toggleTaskMutation.mutate(tache.id)}
      />
    </div>
  );
}
