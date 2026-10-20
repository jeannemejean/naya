// Choix du projet actif, dans l'en-tête de l'espace Projets. Logique reprise telle quelle
// de l'ancienne barre latérale : « Tous les projets » remet à zéro, un projet devient actif
// et ouvre sa page, « Gérer les projets » mène à la liste.
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Layers, Settings, Star } from "lucide-react";
import { useProject } from "@/lib/project-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@shared/schema";

export default function SelecteurProjet() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { activeProjectId, setActiveProjectId, isAllProjects } = useProject();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects?limit=200"],
  });

  const actif = projects.find((p) => p.id === activeProjectId);
  const libelle = actif ? actif.name : t("sidebar.allProjects");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-11 max-w-[240px] shrink-0 items-center gap-2 rounded-full bg-card px-4 text-[16px] font-semibold text-foreground shadow-cocon transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        // Le nom visible reste dans le nom accessible (« Projet actif : Naya »).
        aria-label={`${t("navigation.projetActif")} : ${libelle}`}
      >
        {actif ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: actif.color || "var(--primary)" }} />
        ) : (
          <Layers className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        )}
        <span className="truncate">{libelle}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="text-[13px] font-semibold text-muted-foreground">
          {t("sidebar.projects")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => setActiveProjectId(null)}
          className={isAllProjects ? "bg-muted" : undefined}
        >
          <Layers className="mr-2 h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("sidebar.allProjects")}
        </DropdownMenuItem>

        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => {
              setActiveProjectId(project.id);
              navigate(`/projects/${project.id}`);
            }}
            className={activeProjectId === project.id ? "bg-muted" : undefined}
          >
            <span
              className="mr-2.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: project.color || "var(--accent)" }}
            />
            <span className="flex-1 truncate">{project.name}</span>
            {project.isPrimary && (
              <Star className="h-3 w-3 shrink-0 fill-current text-muted-foreground" aria-label={t("navigation.projetPrincipal")} />
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/projects")}>
          <Settings className="mr-2 h-4 w-4" strokeWidth={1.75} />
          {t("sidebar.manageProjects")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
