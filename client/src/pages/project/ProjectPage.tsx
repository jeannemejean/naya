// Page projet — Sidebar + header (nom + badge client + retour) + sections (Résumé, Où en est
// ce projet ?, Feuille de route). Shell uniquement : le contenu réel des sections arrive aux
// Tasks 6-7. Pattern calqué sur client/src/pages/outreach/CampaignWorkspace.tsx.
import { Link } from "wouter";
import { ArrowLeft, Briefcase, ListChecks, Target, Dna } from "lucide-react";
import Sidebar from "@/components/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useProjectDetail, useProjectMilestones } from "./useProjectPage";
import ProjectSummaryBar from "./ProjectSummaryBar";
import ProjectContextEditor from "./ProjectContextEditor";
import MilestoneRoadmap from "./MilestoneRoadmap";

interface ProjectPageProps {
  id: number;
  onSearchClick?: () => void;
}

export default function ProjectPage({ id, onSearchClick }: ProjectPageProps) {
  const { data: project, isLoading } = useProjectDetail(id);
  const { data: milestones } = useProjectMilestones(id);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-border px-6 py-4 flex-shrink-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Link>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : !project ? (
            <p className="text-sm text-muted-foreground">
              Projet introuvable.{" "}
              <Link href="/" className="text-primary hover:underline">
                Retour au dashboard
              </Link>
            </p>
          ) : (
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: project.color || "var(--primary)" }}
              />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
              {project.projectKind === "client" && (
                <Badge variant="salvia" className="gap-1">
                  <Briefcase className="w-3 h-3" />
                  Client
                </Badge>
              )}
            </div>
          )}
        </header>

        {project && (
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
            <section>
              <h2 className="text-sm font-semibold text-foreground mb-2">Résumé</h2>
              <ProjectSummaryBar
                project={project}
                goals={project.goals}
                strategyProfile={project.strategyProfile}
                milestones={milestones}
                projectId={id}
              />
            </section>

            <section>
              <ProjectContextEditor project={project} strategyProfile={project.strategyProfile} />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-foreground mb-2">
                Feuille de route (ce qui est fait / à faire)
              </h2>
              <MilestoneRoadmap project={project} />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-foreground mb-2">Accès rapides</h2>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/projects"
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border bg-white hover:bg-naya-olive-06 text-foreground transition-colors"
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  Tâches
                </Link>
                <Link
                  href="/projects"
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border bg-white hover:bg-naya-olive-06 text-foreground transition-colors"
                >
                  <Target className="w-3.5 h-3.5" />
                  Objectifs
                </Link>
                <Link
                  href="/projects"
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border bg-white hover:bg-naya-olive-06 text-foreground transition-colors"
                >
                  <Dna className="w-3.5 h-3.5" />
                  ADN de marque
                </Link>
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
