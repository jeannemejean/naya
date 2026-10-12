// Carte « Sourcing automatique » d'une campagne : chaque matin, Naya cherche de nouveaux
// prospects selon l'objectif de la campagne (Bright Data) et en prépare quelques-uns à
// valider. Rien ne part sans validation.
import { useTranslation } from "react-i18next";
import { Loader2, Play } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type RoutineDTO = {
  routine: { id: number; actif: boolean; prochainPassage: string | null; dernierPassage: string | null; derniereErreur: string | null };
  derniersPassages: Array<{ id: number; debut: string; statut: "ok" | "rien_a_faire" | "erreur"; resume: string }>;
};

export default function SourcingAutoCard({ campaignId }: { campaignId: number }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const url = `/api/prospection/campaigns/${campaignId}/routine`;
  const { data } = useQuery<RoutineDTO>({ queryKey: [url] });
  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: [url] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
  };
  const basculer = useMutation({
    mutationFn: (actif: boolean) => apiRequest("PATCH", url, { actif }).then((r) => r.json()),
    onSuccess: rafraichir,
  });
  const lancer = useMutation<{ statut: string; resume: string }, Error, void>({
    mutationFn: () => apiRequest("POST", `${url}/run`).then((r) => r.json()),
    onSuccess: (r) => { rafraichir(); toast({ title: t("ecriture.sourcing.lance"), description: r.resume, variant: r.statut === "erreur" ? "destructive" : undefined }); },
    onError: () => toast({ title: t("ecriture.sourcing.erreur"), variant: "destructive" }),
  });

  if (!data) return null;
  const { routine, derniersPassages } = data;
  const dernier = derniersPassages[0];
  const date = (d: string | null) => (d ? new Date(d).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t("ecriture.sourcing.titre")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{t("ecriture.sourcing.intro")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="sourcing-auto" checked={routine.actif} disabled={basculer.isPending} onCheckedChange={(v) => basculer.mutate(v)} />
            <label htmlFor="sourcing-auto" className="text-xs text-foreground">
              {routine.actif ? t("ecriture.sourcing.actif") : t("ecriture.sourcing.pause")}
            </label>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={lancer.isPending} onClick={() => lancer.mutate()}>
            {lancer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {t("ecriture.sourcing.lancer")}
          </Button>
        </div>
      </div>
      {dernier && (
        <p className="text-xs text-foreground/80">
          <span className="text-muted-foreground">{t("ecriture.sourcing.dernier", { date: date(dernier.debut) })} </span>
          {dernier.resume}
        </p>
      )}
      {routine.derniereErreur && (
        <p className="text-xs text-naya-mauve">{routine.derniereErreur}</p>
      )}
      {routine.actif && routine.prochainPassage && (
        <p className="text-[11px] text-muted-foreground">{t("ecriture.sourcing.prochain", { date: date(routine.prochainPassage) })}</p>
      )}
    </Card>
  );
}
