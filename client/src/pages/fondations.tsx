// Page « Fondations » d'un projet (dossier Acquisition 360, étape 0) : offre d'entrée,
// motivations d'achat et matrice créative, arbre de KPI, plan d'acquisition. Naya propose,
// l'utilisatrice corrige et valide ; seules les sections validées orientent Naya.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Compass, Loader2, Sparkles } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { useProject } from "@/lib/project-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import OffreCarte from "@/components/fondations/OffreCarte";
import MotivationsCarte from "@/components/fondations/MotivationsCarte";
import KpisCarte from "@/components/fondations/KpisCarte";
import PlanCarte from "@/components/fondations/PlanCarte";
import CouvertureCarte from "@/components/fondations/CouvertureCarte";
import { corpsErreur, type DonneesFondations, type Section } from "@/components/fondations/types";

interface FondationsProps { onSearchClick?: () => void }

export default function Fondations({ onSearchClick }: FondationsProps) {
  const { t } = useTranslation();
  const { activeProjectId } = useProject();
  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Compass className="h-5 w-5 text-naya-salvia" />
            {t("fondations.titre")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">{t("fondations.description")}</p>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeProjectId == null
            ? <p className="max-w-3xl mx-auto text-sm text-muted-foreground">{t("fondations.choisirProjet")}</p>
            : <FondationsProjet projectId={activeProjectId} />}
        </main>
      </div>
    </div>
  );
}

function FondationsProjet({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const cle = `/api/fondations/${projectId}`;
  const { data, isLoading } = useQuery<DonneesFondations>({ queryKey: [cle] });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [cle] });

  const proposer = useMutation({
    mutationFn: (sections?: Section[]) =>
      apiRequest("POST", `${cle}/proposer`, sections ? { sections } : {}, { timeoutMs: 180_000 }).then((r) => r.json()),
    onSuccess: (r: { rien?: boolean }) => {
      rafraichir();
      toast({ title: t(r.rien ? "fondations.proposition.rien" : "fondations.proposition.ok") });
    },
    onError: (e) => {
      const c = corpsErreur(e);
      toast({ title: t(c.message === "proposition_vide" ? "fondations.proposition.vide" : "fondations.proposition.erreur"), description: c.raison, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  const { fondations: f, catalogues } = data;
  const statuts = Object.values(f.statuts);
  const toutVide = statuts.every((s) => s === "vide");
  const toutValide = statuts.every((s) => s === "valide");
  const enCours = (s: Section) => proposer.isPending && (proposer.variables?.includes(s) ?? true);
  const commun = (s: Section) => ({ projectId, statut: f.statuts[s], onChange: rafraichir, onReproposer: () => proposer.mutate([s]), reproposeEnCours: enCours(s) });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground max-w-2xl">{t("fondations.intro")}</p>
        {!toutValide && (
          <Button size="sm" className="gap-1.5" disabled={proposer.isPending} onClick={() => proposer.mutate(undefined)}>
            {proposer.isPending && !proposer.variables ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {t(toutVide ? "fondations.proposition.bouton" : "fondations.proposition.reproposer")}
          </Button>
        )}
      </div>

      <OffreCarte {...commun("offre")} offre={f.offre} />
      <MotivationsCarte {...commun("motivations")} motivations={f.motivations} formats={catalogues.formats} />
      <KpisCarte {...commun("kpis")} kpis={f.kpis} releves={f.kpiReleves} etages={catalogues.etages} frequences={catalogues.frequences} />
      <PlanCarte {...commun("plan")} plan={f.plan} catalogues={catalogues} />
      <CouvertureCarte projectId={projectId} donnees={data} motivationsValidees={f.statuts.motivations === "valide"} onChange={rafraichir} />
    </div>
  );
}
