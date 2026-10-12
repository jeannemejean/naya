// Carte d'une routine planifiée : actif ou en pause, « Lancer maintenant », dernier et
// prochain passage. Générique : le sourcing d'une campagne et les quatre veilles l'utilisent.
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export type RoutineDTO = {
  routine: { id: number; actif: boolean; prochainPassage: string | null; dernierPassage: string | null; derniereErreur: string | null };
  derniersPassages: Array<{ id: number; debut: string; statut: "ok" | "rien_a_faire" | "erreur"; resume: string }>;
};

export type TextesRoutine = { titre: string; intro: string; lance: string; erreur: string };

export default function RoutineCard({
  id, donnees, url, textes, onChange, avertissement,
}: {
  id: string;
  /** null : la routine n'existe pas encore (affichée en pause). */
  donnees: RoutineDTO | null;
  /** Base des routes : PATCH `url` (actif) et POST `url/run`. */
  url: string;
  textes: TextesRoutine;
  onChange: () => void;
  avertissement?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const basculer = useMutation({
    mutationFn: (actif: boolean) => apiRequest("PATCH", url, { actif }).then((r) => r.json()),
    onSuccess: onChange,
  });
  const lancer = useMutation<{ statut: string; resume: string }, Error, void>({
    mutationFn: () => apiRequest("POST", `${url}/run`).then((r) => r.json()),
    onSuccess: (r) => { onChange(); toast({ title: textes.lance, description: r.resume, variant: r.statut === "erreur" ? "destructive" : undefined }); },
    onError: () => toast({ title: textes.erreur, variant: "destructive" }),
  });

  const routine = donnees?.routine ?? null;
  const actif = !!routine?.actif;
  const dernier = donnees?.derniersPassages?.[0];
  const date = (d: string | null) => (d ? new Date(d).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{textes.titre}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{textes.intro}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id={id} checked={actif} disabled={basculer.isPending} onCheckedChange={(v) => basculer.mutate(v)} />
            <label htmlFor={id} className="text-xs text-foreground">
              {actif ? t("routines.actif") : t("routines.pause")}
            </label>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={lancer.isPending} onClick={() => lancer.mutate()}>
            {lancer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {t("routines.lancer")}
          </Button>
        </div>
      </div>
      {avertissement}
      {dernier && (
        <p className="text-xs text-foreground/80">
          <span className="text-muted-foreground">{t("routines.dernier", { date: date(dernier.debut) })} </span>
          {dernier.resume}
        </p>
      )}
      {routine?.derniereErreur && (
        <p className="text-xs text-naya-mauve">{routine.derniereErreur}</p>
      )}
      {actif && routine?.prochainPassage && (
        <p className="text-[11px] text-muted-foreground">{t("routines.prochain", { date: date(routine.prochainPassage) })}</p>
      )}
    </Card>
  );
}
