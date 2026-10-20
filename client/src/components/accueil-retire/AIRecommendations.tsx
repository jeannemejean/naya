// Recommandations du projet : déplacé tel quel de l'ancien dashboard vers la vue d'ensemble du projet.
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowRight, Sparkles } from "lucide-react";
import type { Project } from "@shared/schema";

export default function AIRecommendations({ projectId }: { projectId: number | null }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects?limit=200"] });

  const singleProjectQuery = useQuery<any>({
    queryKey: ["/api/projects", projectId, "recommendations"],
    // .json() : sans lui, la requête rangeait l'objet Response et la carte restait toujours vide.
    queryFn: () => apiRequest("POST", `/api/projects/${projectId}/recommendations`, {}).then(r => r.json()),
    enabled: !!projectId,
    staleTime: 300000,
  });

  const allProjectsRecs = useQuery<any>({
    queryKey: ["/api/projects", "all", "recommendations"],
    queryFn: async () => {
      const active = projects.filter(p => p.projectStatus === "active").slice(0, 3);
      const results = await Promise.allSettled(
        active.map(p => apiRequest("POST", `/api/projects/${p.id}/recommendations`, {}).then(r => r.json()))
      );
      const merged: any[] = [];
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value?.recommendations) {
          merged.push(...r.value.recommendations.slice(0, 1).map((rec: any) => ({
            ...rec,
            projectName: r.value.projectName,
          })));
        }
      });
      return { recommendations: merged };
    },
    enabled: !projectId && projects.length > 0,
    staleTime: 300000,
  });

  const query = projectId ? singleProjectQuery : allProjectsRecs;
  const recs = query.data?.recommendations || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
          <span className="font-display text-[11px] text-naya-olive-70">
            {t("dashboard.aiRecommendations")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-14 bg-naya-olive-06 rounded animate-pulse" />
            ))}
          </div>
        ) : recs.length === 0 ? (
          <p className="text-sm text-naya-olive-55 text-center py-4">
            {projects.length === 0 ? t("dashboard.createProjectForRecs") : t("dashboard.noRecommendationsNow")}
          </p>
        ) : (
          <div className="space-y-2">
            {recs.map((rec: any, i: number) => (
              <div key={i} className="p-3 bg-naya-olive-06 rounded-lg">
                <p className="text-xs font-medium text-foreground">{rec.title}</p>
                {rec.projectName && !projectId && (
                  <p className="text-[10px] text-naya-olive-55 mt-0.5">{rec.projectName}</p>
                )}
                <p className="text-xs text-naya-olive-55 mt-1 line-clamp-2">{rec.description}</p>
                {rec.action && (
                  <p className="text-xs text-naya-olive font-medium mt-1.5 flex items-center gap-1">
                    <ArrowRight style={{ width: 10, height: 10 }} />
                    {rec.action}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
