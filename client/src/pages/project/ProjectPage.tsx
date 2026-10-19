// Page d'un projet : TOUT ce qui le concerne, en onglets — Vue d'ensemble, Fondations, Veille,
// Mesure, et Client pour un projet client (connexions, rapports). L'onglet est dans l'URL
// (?onglet=…) ; le nom du projet est un menu pour passer à un autre projet sans changer d'onglet.
// Spec : docs/superpowers/specs/2026-10-13-simplification-projet-design.md
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Briefcase, ChevronDown, Compass, Gauge, LayoutGrid, Radar, Users } from "lucide-react";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { useProject } from "@/lib/project-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useProjectDetail, useProjectMilestones } from "./useProjectPage";
import ProjectSummaryBar from "./ProjectSummaryBar";
import ProjectContextEditor from "./ProjectContextEditor";
import MilestoneRoadmap from "./MilestoneRoadmap";
import ConversionsPanel from "./ConversionsPanel";
import BrandLinksPanel from "./BrandLinksPanel";
import LivrablesPanel from "./LivrablesPanel";
import PreuvesPanel from "./PreuvesPanel";
import ConnexionsClientPanel from "./ConnexionsClientPanel";
import RapportsClientPanel from "./RapportsClientPanel";
import { FondationsProjet } from "@/pages/fondations";
import { VeilleProjet } from "@/pages/veille";
import { MesureProjet } from "@/pages/mesure";
import { lienOnglet, ongletDe, ongletPourAutreProjet, type Onglet } from "./onglets";

interface ProjectPageProps {
  id: number;
  onSearchClick?: () => void;
}

interface ProjetListe { id: number; name: string; color?: string | null; projectKind?: string | null }

const ICONES: Record<Onglet, typeof Compass> = { ensemble: LayoutGrid, fondations: Compass, veille: Radar, mesure: Gauge, client: Users };

export default function ProjectPage({ id, onSearchClick }: ProjectPageProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const recherche = useSearch();
  const { setActiveProjectId } = useProject();
  const { data: project, isLoading } = useProjectDetail(id);
  const { data: milestones } = useProjectMilestones(id);
  const { data: projets = [] } = useQuery<ProjetListe[]>({ queryKey: ["/api/projects?limit=200"] });

  const estClient = project?.projectKind === "client";
  const onglet = ongletDe(recherche, estClient);
  const onglets: Onglet[] = estClient ? ["ensemble", "fondations", "veille", "mesure", "client"] : ["ensemble", "fondations", "veille", "mesure"];
  const changerOnglet = (o: string) => navigate(lienOnglet(id, o as Onglet), { replace: true });
  // Changer de projet ici en fait aussi le projet actif (comme la barre latérale).
  const changerProjet = (p: ProjetListe) => {
    setActiveProjectId(p.id);
    navigate(lienOnglet(p.id, ongletPourAutreProjet(onglet, p.projectKind === "client")));
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      {/* UN seul composant d'onglets pour l'en-tête et le contenu : chaque onglet est relié à
          son panneau (lecteurs d'écran, clavier). */}
      <Tabs value={onglet} onValueChange={changerOnglet} className="flex-1 flex flex-col overflow-hidden">
        <OngletsEspace />
        <header className="bg-card border-b border-border px-6 pt-4 flex-shrink-0">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-4 h-4" />
            {t("projet.tousLesProjets")}
          </Link>

          {isLoading ? (
            <div className="space-y-2 pb-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : !project ? (
            <p className="text-sm text-muted-foreground pb-4">
              {t("projet.introuvable")}{" "}
              <Link href="/projects" className="text-primary hover:underline">{t("projet.tousLesProjets")}</Link>
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: project.color || "var(--primary)" }} />
                {/* Le nom est le sélecteur : on change de projet sans quitter l'onglet. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex items-center gap-1.5 rounded-md px-1 -mx-1 text-2xl font-bold tracking-tight text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("projet.changerDeProjet")}
                  >
                    {project.name}
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    {projets.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => changerProjet(p)} className={p.id === id ? "font-semibold" : ""}>
                        <span className="w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: p.color || "var(--primary)" }} />
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {estClient && (
                  <Badge variant="salvia" className="gap-1">
                    <Briefcase className="w-3 h-3" />
                    {t("projet.client")}
                  </Badge>
                )}
              </div>

              <div className="mt-3">
                <TabsList className="bg-transparent p-0 h-auto gap-1 border-0">
                  {onglets.map((o) => {
                    const Icone = ICONES[o];
                    return (
                      <TabsTrigger
                        key={o}
                        value={o}
                        className="gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-2.5 pt-1 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                      >
                        <Icone className="w-4 h-4" />
                        {t(`projet.onglets.${o}`)}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </>
          )}
        </header>

        {project && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
              <TabsContent value="ensemble" className="mt-0 space-y-6">
                <section>
                  <h2 className="text-sm font-semibold text-foreground mb-2">{t("projet.resume")}</h2>
                  <ProjectSummaryBar project={project} goals={project.goals} strategyProfile={project.strategyProfile} milestones={milestones} projectId={id} />
                </section>
                <section>
                  <ProjectContextEditor project={project} strategyProfile={project.strategyProfile} />
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-foreground mb-2">{t("projet.feuilleDeRoute")}</h2>
                  <MilestoneRoadmap project={project} />
                </section>
                <section><PreuvesPanel projectId={id} /></section>
                <section><ConversionsPanel projectId={id} /></section>
                <section><BrandLinksPanel projectId={id} /></section>
                <section><LivrablesPanel projectId={id} /></section>
              </TabsContent>
              {/* key : un autre projet repart de zéro (remplissage automatique compris). */}
              <TabsContent value="fondations" className="mt-0"><FondationsProjet key={id} projectId={id} /></TabsContent>
              <TabsContent value="veille" className="mt-0"><VeilleProjet key={id} projectId={id} /></TabsContent>
              <TabsContent value="mesure" className="mt-0"><MesureProjet key={id} projectId={id} /></TabsContent>
              {estClient && (
                <TabsContent value="client" className="mt-0 space-y-6 max-w-5xl mx-auto">
                  <ConnexionsClientPanel projectId={id} />
                  <RapportsClientPanel projectId={id} />
                </TabsContent>
              )}
          </main>
        )}
      </Tabs>
    </div>
  );
}
