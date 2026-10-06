import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { refuserTacheApi } from "@/lib/refus-api";

// Logique partagée du refus d'une tâche (panneau de tâche et bulle du planning).
export function useRefuserTache(onSuccess?: () => void) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (v: { taskId: number; reason: string; freeText?: string }) =>
      refuserTacheApi(v.taskId, v.reason, v.freeText),
    onSuccess: (data) => {
      toast({
        title: data.remplacement
          ? t("taskFeedback.replacedBy", { title: data.remplacement.title })
          : t("taskFeedback.refusedNoReplacement"),
      });
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/tasks"),
      });
      onSuccess?.();
    },
    onError: () => {
      toast({ title: t("taskFeedback.refuseFailed"), variant: "destructive" });
    },
  });

  return mutation;
}
