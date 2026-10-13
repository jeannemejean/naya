// Carte d'une section des fondations : statut, Modifier / Valider / Revenir en proposition,
// « Reproposer cette section ». L'enregistrement passe par PUT /sections/:section.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { corpsErreur, type Section, type Statut } from "./types";

const COULEUR: Record<Statut, string> = {
  vide: "text-muted-foreground",
  propose: "text-naya-mauve border-naya-mauve/40",
  valide: "text-naya-salvia border-naya-salvia/40",
};

/** Envoi d'une section (valeur et/ou statut), avec un message d'erreur lisible. */
export function useEnvoiSection(projectId: number, section: Section, onChange: () => void, apres?: () => void) {
  const { t } = useTranslation();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (corps: { valeur?: unknown; statut?: "propose" | "valide" }) =>
      apiRequest("PUT", `/api/fondations/${projectId}/sections/${section}`, corps).then((r) => r.json()),
    onSuccess: () => { onChange(); apres?.(); },
    onError: (e) => {
      const m = corpsErreur(e).message;
      toast({ title: t(m === "section_vide" ? "fondations.erreurs.sectionVide" : "fondations.erreurs.invalide"), variant: "destructive" });
    },
  });
}

export default function SectionCarte({
  projectId, section, statut, enEdition, onModifier, onChange, onReproposer, reproposeEnCours, children,
}: {
  projectId: number; section: Section; statut: Statut; enEdition: boolean;
  onModifier: () => void; onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const envoi = useEnvoiSection(projectId, section, onChange);
  return (
    <Card className="p-4 space-y-3" id={`fondations-${section}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t(`fondations.${section}.titre`)}</h2>
            <Badge variant="outline" className={`text-[10px] ${COULEUR[statut]}`}>{t(`fondations.statuts.${statut}`)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t(`fondations.${section}.intro`)}</p>
        </div>
        {!enEdition && (
          <div className="flex gap-1.5 flex-wrap">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={reproposeEnCours} onClick={onReproposer}>
              {reproposeEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t("fondations.actions.reproposer")}
            </Button>
            {statut !== "vide" && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onModifier}>
                <Pencil className="w-3.5 h-3.5" />{t("fondations.actions.modifier")}
              </Button>
            )}
            {statut === "propose" && (
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={envoi.isPending} onClick={() => envoi.mutate({ statut: "valide" })}>
                <Check className="w-3.5 h-3.5" />{t("fondations.actions.valider")}
              </Button>
            )}
            {statut === "valide" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={envoi.isPending} onClick={() => envoi.mutate({ statut: "propose" })}>
                <RotateCcw className="w-3.5 h-3.5" />{t("fondations.actions.revenir")}
              </Button>
            )}
          </div>
        )}
      </div>
      {statut === "vide" && !enEdition
        ? <p className="text-xs text-muted-foreground italic">{t(`fondations.${section}.vide`)}</p>
        : children}
    </Card>
  );
}

/** Pied d'un formulaire d'édition : Enregistrer / Annuler. */
export function PiedEdition({ enCours, onAnnuler, desactive }: { enCours: boolean; onAnnuler: () => void; desactive?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 justify-end pt-1">
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={onAnnuler}>{t("fondations.actions.annuler")}</Button>
      <Button type="submit" size="sm" className="h-8 text-xs gap-1" disabled={enCours || desactive}>
        {enCours && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t("fondations.actions.enregistrer")}
      </Button>
    </div>
  );
}
