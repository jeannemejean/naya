// Carte d'une section des fondations : statut, Modifier / Valider / Revenir en proposition,
// « Reproposer cette section ». L'enregistrement passe par PUT /sections/:section.
import { useState, type ReactNode } from "react";
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
  projectId, section, statut, enEdition, onModifier, onAnnuler, onChange, onReproposer, reproposeEnCours, verrouille, children,
}: {
  projectId: number; section: Section; statut: Statut; enEdition: boolean;
  onModifier: () => void; onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean;
  /** Échap ferme l'édition sans enregistrer. */
  onAnnuler?: () => void;
  /** Une proposition de Naya est en cours : on ne valide ni ne modifie pendant qu'elle écrit. */
  verrouille: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const envoi = useEnvoiSection(projectId, section, onChange);
  // Reproposer une section validée la remplace : un second clic confirme.
  const [confirmer, setConfirmer] = useState(false);
  const reproposer = () => {
    if (statut === "valide" && !confirmer) { setConfirmer(true); return; }
    setConfirmer(false);
    onReproposer();
  };
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
            <Button size="sm" variant={confirmer ? "destructive" : "ghost"} className="h-7 gap-1 text-xs" disabled={verrouille} onClick={reproposer}
              onBlur={() => setConfirmer(false)}>
              {reproposeEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t(confirmer ? "fondations.actions.confirmerReproposer" : "fondations.actions.reproposer")}
            </Button>
            {statut === "propose" && (
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={verrouille || envoi.isPending} onClick={() => envoi.mutate({ statut: "valide" })}>
                <Check className="w-3.5 h-3.5" />{t("fondations.actions.valider")}
              </Button>
            )}
            {statut === "valide" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={verrouille || envoi.isPending} onClick={() => envoi.mutate({ statut: "propose" })}>
                <RotateCcw className="w-3.5 h-3.5" />{t("fondations.actions.revenir")}
              </Button>
            )}
          </div>
        )}
      </div>
      {enEdition ? (
        <div onKeyDown={(e) => { if (e.key === "Escape" && onAnnuler) { e.preventDefault(); onAnnuler(); } }}>{children}</div>
      ) : statut === "vide" ? (
        // Partie vide : jamais un bloc inerte — on écrit soi-même, ou on laisse Naya proposer.
        <div className="rounded-md border border-dashed border-border p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-xs text-muted-foreground flex-1">{t(`fondations.${section}.vide`)}</p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="h-8 gap-1 text-xs" disabled={verrouille} onClick={onModifier}>
              <Pencil className="w-3.5 h-3.5" />{t("fondations.actions.ecrire")}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={verrouille} onClick={onReproposer}>
              <Sparkles className="w-3.5 h-3.5" />{t("fondations.actions.laisserNaya")}
            </Button>
          </div>
        </div>
      ) : (
        // Contenu rempli : cliquer dessus (ou Entrée) ouvre l'édition. Les champs et liens à
        // l'intérieur gardent leur propre comportement.
        <div
          role="button"
          tabIndex={verrouille ? -1 : 0}
          aria-label={t("fondations.actions.cliquerPourModifier")}
          aria-disabled={verrouille}
          onClick={(e) => {
            if (verrouille || (e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
            onModifier();
          }}
          onKeyDown={(e) => {
            if (verrouille || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            onModifier();
          }}
          className={`group relative rounded-md -m-2 p-2 transition-colors ${verrouille ? "" : "cursor-text hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}`}
        >
          {!verrouille && (
            <span className="pointer-events-none absolute right-2 top-2 hidden items-center gap-1 text-[10px] text-muted-foreground group-hover:flex group-focus-visible:flex">
              <Pencil className="w-3 h-3" />{t("fondations.actions.cliquerPourModifier")}
            </span>
          )}
          {children}
        </div>
      )}
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
