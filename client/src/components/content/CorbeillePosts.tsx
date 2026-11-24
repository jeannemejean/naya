// Corbeille du calendrier : les posts supprimés depuis 30 jours, à restaurer (ils reviennent
// déprogrammés) ou à supprimer définitivement.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CORBEILLE_JOURS } from "@shared/gestion-posts";
import type { Content } from "@shared/schema";

export const CLE_CORBEILLE = ["/api/content", "corbeille"];

export default function CorbeillePosts() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: posts = [], isLoading } = useQuery<Content[]>({
    queryKey: CLE_CORBEILLE,
    queryFn: async () => (await apiRequest("GET", "/api/content/corbeille")).json(),
  });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ["/api/content"] });

  const restaurer = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/content/${id}/restaurer`)).json(),
    onSuccess: () => { rafraichir(); toast({ title: t("gestionPost.corbeille.restaureToast") }); },
    onError: () => toast({ title: t("gestionPost.corbeille.erreur"), variant: "destructive" }),
  });
  const effacer = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/content/${id}/definitif`)).json(),
    onSuccess: () => { rafraichir(); toast({ title: t("gestionPost.corbeille.supprimeToast") }); },
    onError: () => toast({ title: t("gestionPost.corbeille.erreur"), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("gestionPost.corbeille.titre")}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-naya-olive-55">{t("gestionPost.corbeille.aide", { jours: CORBEILLE_JOURS })}</p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : posts.length === 0 ? (
        <p className="text-sm text-naya-olive-35 py-6 text-center">{t("gestionPost.corbeille.vide")}</p>
      ) : (
        <ul className="divide-y divide-naya-olive-18">
          {posts.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-3" data-testid={`corbeille-${p.id}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{p.title}</p>
                <p className="text-xs text-naya-olive-35">
                  {p.platform} · {t("gestionPost.corbeille.supprimeLe", { date: (p as any).supprimeLe ? format(new Date((p as any).supprimeLe), "dd/MM/yyyy HH:mm") : "" })}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={restaurer.isPending} onClick={() => restaurer.mutate(p.id)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />{t("gestionPost.corbeille.restaurer")}
              </Button>
              <Button size="sm" variant="outline" disabled={effacer.isPending}
                className="text-[#5c3d45] border-[rgba(158,126,135,0.35)]"
                onClick={() => { if (window.confirm(t("gestionPost.corbeille.confirmer"))) effacer.mutate(p.id); }}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />{t("gestionPost.corbeille.supprimerDefinitivement")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
