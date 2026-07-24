import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface PlanningRestartButtonProps {
  /** Classes du bouton déclencheur (le style diffère entre le Dashboard et la page Planning). */
  className?: string;
  /** Contenu du bouton (icône + libellé). */
  children: ReactNode;
  title?: string;
}

/**
 * Bouton « Redémarrer la planification » + sa confirmation.
 *
 * Partagé entre la page Planning et le Dashboard pour que les deux aient
 * exactement le même comportement (même endpoint, même texte, même confirmation).
 */
export function PlanningRestartButton({ className, children, title }: PlanningRestartButtonProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const restartMutation = useMutation({
    mutationFn: async () => {
      const restarted = await apiRequest("POST", "/api/planning/restart").then((r) => r.json());

      // Le planificateur automatique ne passe qu'à 06:00 UTC : sans cet appel,
      // l'utilisateur se retrouve avec un planning VIDE jusqu'au lendemain matin.
      // On régénère donc tout de suite, via le même chemin que « Générer mon plan ».
      const now = new Date();
      const clientToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const clientTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      try {
        await apiRequest("POST", "/api/tasks/generate-daily", {
          projectId: null, // tous les projets, pas seulement l'actif
          clientToday,
          clientTime,
        }).then((r) => r.json());
        return { ...restarted, regenerated: true };
      } catch {
        // Les tâches sont supprimées : on ne fait PAS échouer le redémarrage,
        // on signale juste que la régénération n'a pas abouti.
        return { ...restarted, regenerated: false };
      }
    },
    onSuccess: (data: any) => {
      // Le redémarrage supprime toutes les tâches futures et en recrée : à peu
      // près tout l'écran devient obsolète, on invalide donc largement.
      queryClient.invalidateQueries();
      toast(
        data.regenerated
          ? {
              title: t("planning.restartedTitle"),
              description: t("planning.restartedDesc", {
                count: data.tasksDeleted,
                rescheduled: data.tasksRescheduled ?? 0,
              }),
            }
          : {
              title: t("planning.restartedTitle"),
              description: t("planning.restartedNoPlanDesc", {
                count: data.tasksDeleted,
                rescheduled: data.tasksRescheduled ?? 0,
              }),
              variant: "destructive" as const,
            },
      );
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={restartMutation.isPending}
        className={className}
        title={title ?? t("planning.restart")}
      >
        {children}
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display uppercase tracking-xwide text-[11px]">
              {t("planning.restartConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-naya-olive-55">
              {t("planning.restartConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-display uppercase tracking-xwide text-[9px]">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); restartMutation.mutate(); }}
              className="font-display uppercase tracking-xwide text-[9px] bg-naya-olive text-naya-cream hover:opacity-90"
            >
              {t("planning.restartConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
