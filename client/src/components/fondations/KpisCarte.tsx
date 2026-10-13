// L'arbre de KPI, par étage. Les valeurs sont saisies à la main (le calcul automatique
// viendra avec le branchement des sources de données).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import SectionCarte, { PiedEdition, useEnvoiSection } from "./SectionCarte";
import { GENRE, formater, libelleMois, type Indicateur } from "@/components/mesure/types";
import type { Kpi, Releve, Statut } from "./types";

const MAX = 12;
type Props = {
  projectId: number; kpis: Kpi[]; releves: Record<string, Releve[]>; kpiAuto: Record<string, Releve[]>; statut: Statut;
  etages: string[]; frequences: string[]; onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean; verrouille: boolean;
};
const CHAMP_SELECT = "h-8 rounded-md border border-input bg-background px-2 text-xs";

/** Indicateurs calculés du registre mensuel (page Mesure), dans l'ordre d'affichage. */
const SOURCES = ["mer", "cac", "ca", "nouveaux_clients", "panier_moyen", "part_ca_nouveaux", "marge_contributive", "depense_totale"];

export default function KpisCarte({ projectId, kpis, releves, kpiAuto, statut, etages, frequences, onChange, onReproposer, reproposeEnCours, verrouille }: Props) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState<Kpi[] | null>(null);
  const envoi = useEnvoiSection(projectId, "kpis", onChange, () => setBrouillon(null));
  const maj = (i: number, p: Partial<Kpi>) => setBrouillon((b) => b && b.map((k, j) => (j === i ? { ...k, ...p } : k)));
  const nouveau = (): Kpi => ({ cle: "", nom: "", etage: etages[0] || "business", definition: "", frequence: "mensuel" });

  return (
    <SectionCarte projectId={projectId} section="kpis" statut={statut} enEdition={!!brouillon}
      onModifier={() => setBrouillon(kpis.length ? kpis : [nouveau()])} onChange={onChange} onReproposer={onReproposer} reproposeEnCours={reproposeEnCours} verrouille={verrouille}>
      {brouillon ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); envoi.mutate({ valeur: brouillon }); }}>
          {brouillon.map((k, i) => (
            <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_auto_auto_8rem_auto] items-center">
              <Input className="h-8 text-xs" value={k.nom} placeholder={t("fondations.kpis.nom")} onChange={(e) => maj(i, { nom: e.target.value })} />
              <select className={CHAMP_SELECT} value={k.etage} aria-label={t("fondations.kpis.etage")} onChange={(e) => maj(i, { etage: e.target.value })}>
                {etages.map((x) => <option key={x} value={x}>{t(`fondations.kpis.etages.${x}`)}</option>)}
              </select>
              <select className={CHAMP_SELECT} value={k.frequence} aria-label={t("fondations.kpis.frequence")} onChange={(e) => maj(i, { frequence: e.target.value })}>
                {frequences.map((x) => <option key={x} value={x}>{t(`fondations.kpis.frequences.${x}`)}</option>)}
              </select>
              <Input className="h-8 text-xs" value={k.cible || ""} placeholder={t("fondations.kpis.cible")} onChange={(e) => maj(i, { cible: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label={t("fondations.actions.retirer")}
                onClick={() => setBrouillon((b) => b && b.filter((_, j) => j !== i))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <select className={`${CHAMP_SELECT} sm:col-span-2`} value={k.source || ""} aria-label={t("fondations.kpis.source")}
                onChange={(e) => maj(i, { source: e.target.value || undefined })}>
                <option value="">{t("fondations.kpis.sourceManuelle")}</option>
                {SOURCES.map((s) => <option key={s} value={s}>{t("fondations.kpis.sourceMesure", { nom: t(`mesure.indicateurs.${s}.nom`) })}</option>)}
              </select>
              <Input className="h-8 text-xs sm:col-span-3" value={k.definition} placeholder={t("fondations.kpis.definition")} onChange={(e) => maj(i, { definition: e.target.value })} />
            </div>
          ))}
          {brouillon.length < MAX && (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setBrouillon((b) => [...(b || []), nouveau()])}>
              <Plus className="w-3.5 h-3.5" />{t("fondations.kpis.ajouter")}
            </Button>
          )}
          <PiedEdition enCours={envoi.isPending} onAnnuler={() => setBrouillon(null)} desactive={!brouillon.some((k) => k.nom.trim())} />
        </form>
      ) : (
        <div className="space-y-3">
          {etages.filter((e) => kpis.some((k) => k.etage === e)).map((e) => (
            <div key={e} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`fondations.kpis.etages.${e}`)}</p>
              {kpis.filter((k) => k.etage === e).map((k) => <LigneKpi key={k.cle} projectId={projectId} kpi={k} releves={(k.source ? kpiAuto[k.cle] : releves[k.cle]) || []} onChange={onChange} />)}
            </div>
          ))}
        </div>
      )}
    </SectionCarte>
  );
}

function LigneKpi({ projectId, kpi, releves, onChange }: { projectId: number; kpi: Kpi; releves: Releve[]; onChange: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [valeur, setValeur] = useState("");
  const dernier = releves[releves.length - 1];
  const saisir = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fondations/${projectId}/kpis/${kpi.cle}/releves`, { valeur: Number(valeur.replace(",", ".")) }),
    onSuccess: () => { setValeur(""); onChange(); toast({ title: t("fondations.kpis.enregistre") }); },
    onError: () => toast({ title: t("fondations.erreurs.generique"), variant: "destructive" }),
  });
  const valide = valeur.trim() !== "" && Number.isFinite(Number(valeur.replace(",", ".")));
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {kpi.nom}
          <span className="font-normal text-muted-foreground"> · {t(`fondations.kpis.frequences.${kpi.frequence}`)}{kpi.cible ? ` · ${t("fondations.kpis.cibleCourte", { cible: kpi.cible })}` : ""}</span>
        </p>
        {kpi.definition && <p className="text-muted-foreground">{kpi.definition}</p>}
        {kpi.source && <p className="text-[10px] text-naya-salvia">{t("fondations.kpis.calcule")}</p>}
        <p className="text-muted-foreground mt-0.5">
          {dernier
            ? t("fondations.kpis.dernier", kpi.source
              // Relié au registre : valeur au format de l'indicateur, et le mois (pas une date UTC qui glisserait).
              ? { valeur: formater(dernier.valeur, GENRE[kpi.source as Indicateur] ?? "nombre", i18n.language), date: libelleMois(dernier.date.slice(0, 7), i18n.language) }
              : { valeur: dernier.valeur.toLocaleString(i18n.language), date: new Date(dernier.date).toLocaleDateString(i18n.language) })
            : t("fondations.kpis.aucunReleve")}
        </p>
      </div>
      {!kpi.source && <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (valide) saisir.mutate(); }}>
        <Input className="h-7 w-24 text-xs" inputMode="decimal" value={valeur} placeholder={t("fondations.kpis.valeur")} onChange={(e) => setValeur(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={!valide || saisir.isPending}>{t("fondations.kpis.saisir")}</Button>
      </form>}
    </div>
  );
}
