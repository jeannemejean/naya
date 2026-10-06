import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { refuserPostApi } from "@/lib/refus-post-api";

// Logique du refus d'un post du calendrier.
export function useRefuserPost(onSuccess?: (postId: number) => void) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (v: { postId: number; reason: string; freeText?: string; remplacer: boolean }) =>
      refuserPostApi(v.postId, v.reason, v.freeText, v.remplacer),
    onSuccess: (data, v) => {
      const title = data.remplacement
        ? t("refusPost.replacedBy", { title: data.remplacement.title })
        : v.remplacer && data.raison === "generation_failed"
          ? t("refusPost.noReplacement")
          : t("refusPost.refused");
      toast({ title });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && (k.startsWith("/api/content") || k.startsWith("/api/campaigns"));
        },
      });
      onSuccess?.(v.postId);
    },
    onError: (err: unknown) => {
      // 404 : le post n'existe plus (carte périmée) ; on rafraîchit le calendrier.
      if (err instanceof Error && /^404\b/.test(err.message)) {
        queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey[0];
            return typeof k === "string" && k.startsWith("/api/content");
          },
        });
      }
      const dejaPublie = err instanceof Error && /^409\b/.test(err.message);
      toast({
        title: t(dejaPublie ? "refusPost.alreadyPublished" : "refusPost.failed"),
        variant: "destructive",
      });
    },
  });
}
