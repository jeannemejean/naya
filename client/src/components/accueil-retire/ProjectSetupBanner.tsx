// Invitation à affiner le premier projet créé à l'onboarding : déplacé tel quel de l'ancien
// dashboard vers le Planning.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { Project } from "@shared/schema";
import { Link } from "wouter";

export default function ProjectSetupBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("naya_project_banner_dismissed") === "1"
  );
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });

  if (dismissed || projects.length === 0) return null;
  const hasEditedProject = projects.some(p => p.description && p.description.length > 0);
  if (hasEditedProject) return null;

  return (
    <div className="bg-naya-olive-06 border border-naya-olive-18 rounded-lg p-4 mb-4 flex items-center justify-between">
      <div>
        <p className="font-display text-[11px] text-foreground mb-1">
          Premier projet créé depuis l'onboarding
        </p>
        <p className="text-xs text-naya-olive-55">
          Affine-le pour que Naya puisse te donner de meilleures recommandations.
        </p>
      </div>
      <div className="flex items-center gap-2 ml-4">
        <Link href="/projects">
          <Button size="sm" variant="secondary">
            Voir le projet
          </Button>
        </Link>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem("naya_project_banner_dismissed", "1");
          }}
          className="p-1 text-naya-olive-35 hover:text-naya-olive-55 cursor-pointer transition-colors"
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  );
}
