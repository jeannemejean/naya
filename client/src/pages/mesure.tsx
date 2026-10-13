// Page « Mesure » d'un projet (dossier Acquisition 360, mesure au stade démarrage) : le
// registre mensuel (CA, nouveaux clients, dépenses par canal), les indicateurs que Naya en
// calcule (MER, CAC nouveaux clients…), l'import et le bilan mensuel en routine.
import RedirectionOnglet from "@/pages/project/RedirectionOnglet";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { useProject } from "@/lib/project-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import RoutineCard from "@/components/routines/RoutineCard";
import IndicateursCarte from "@/components/mesure/IndicateursCarte";
import FormulaireMois from "@/components/mesure/FormulaireMois";
import ImportCarte from "@/components/mesure/ImportCarte";
import PhraseMesure from "@/components/mesure/PhraseMesure";
import { GENRE, formater, libelleMois, type DonneesMesure, type Indicateur, type Mois } from "@/components/mesure/types";

interface MesureProps { onSearchClick?: () => void }

/** Ancienne adresse : renvoie vers l'onglet « mesure » de la page projet. */
export default function PageMesure(_props: { onSearchClick?: () => void }) {
  return <RedirectionOnglet onglet="mesure" />;
}

const COLONNES: Indicateur[] = ["ca", "nouveaux_clients", "depense_totale", "mer", "cac"];

export function MesureProjet({ projectId }: { projectId: number }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const cle = `/api/mesure/${projectId}`;
  const { data, isLoading } = useQuery<DonneesMesure>({ queryKey: [cle] });
  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: [cle] });
    queryClient.invalidateQueries({ queryKey: [`/api/fondations/${projectId}`] });
  };
  const [edition, setEdition] = useState<Mois | "nouveau" | null>(null);
  const [importer, setImporter] = useState(false);
  const supprimer = useMutation({
    mutationFn: (mois: string) => apiRequest("DELETE", `${cle}/mois/${mois}`),
    onSuccess: rafraichir,
    onError: () => toast({ title: t("mesure.erreurs.generique"), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  const fini = (change: boolean) => { setEdition(null); setImporter(false); if (change) rafraichir(); };
  const bilans = data.mois.filter((m) => m.bilan);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Le geste principal : dire ses chiffres en une phrase. Le formulaire détaillé et
          l'import restent plus bas pour corriger un chiffre ou reprendre un historique. */}
      <PhraseMesure projectId={projectId} onEnregistre={rafraichir} />

      {data.mois[0] ? <IndicateursCarte mois={data.mois[0]} /> : (
        <Card className="p-4 text-sm text-muted-foreground">{t("mesure.vide")}</Card>
      )}

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{t("mesure.registre.titre")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t("mesure.registre.intro")}</p>
          </div>
          {!edition && !importer && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setImporter(true)}><Upload className="w-4 h-4" />{t("mesure.actions.importer")}</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEdition("nouveau")}><Plus className="w-4 h-4" />{t("mesure.actions.saisieDetaillee")}</Button>
            </div>
          )}
        </div>
        {edition && <FormulaireMois key={edition === "nouveau" ? "nouveau" : edition.mois} projectId={projectId}
          initial={edition === "nouveau" ? null : edition} canaux={data.catalogues.canaux} onFini={fini} />}
        {importer && <ImportCarte projectId={projectId} onFini={fini} />}
        {data.mois.length > 0 && (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="font-medium px-3 py-2">{t("mesure.registre.mois")}</th>
                  {COLONNES.map((c) => <th key={c} className="font-medium px-3 py-2 text-right">{t(`mesure.indicateurs.${c}.court`)}</th>)}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.mois.map((m) => (
                  <tr key={m.mois} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{libelleMois(m.mois, i18n.language)}</td>
                    {COLONNES.map((c) => (
                      <td key={c} className="px-3 py-2 text-right tabular-nums">
                        {formater(m.indicateurs[c], GENRE[c], i18n.language) ?? <span className="text-muted-foreground">{t("mesure.registre.vide")}</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t("mesure.actions.modifier")} onClick={() => { setImporter(false); setEdition(m); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t("mesure.actions.supprimer")} disabled={supprimer.isPending} onClick={() => supprimer.mutate(m.mois)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-[11px] text-muted-foreground max-w-3xl">{t("mesure.limites")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t("mesure.bilan.titre")}</h2>
        <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_1fr]">
          <RoutineCard
            id="mesure-bilan"
            donnees={data.routine}
            url={`${cle}/routine`}
            onChange={rafraichir}
            textes={{ titre: t("mesure.bilan.routine"), intro: t("mesure.bilan.intro"), lance: t("mesure.bilan.lance"), erreur: t("mesure.bilan.erreur") }}
          />
          <Card className="p-4 space-y-3">
            {bilans.length === 0
              ? <p className="text-xs text-muted-foreground italic">{t("mesure.bilan.aucun")}</p>
              : bilans.slice(0, 6).map((m) => (
                <div key={m.mois} className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">{libelleMois(m.mois, i18n.language)}</p>
                  <p className="text-xs text-foreground whitespace-pre-line">{m.bilan}</p>
                </div>
              ))}
          </Card>
        </div>
      </section>
    </div>
  );
}
