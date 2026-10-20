// Ton archétype et le persona cible du projet : déplacé tel quel de l'ancien dashboard vers
// l'onglet Fondations du projet.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/lib/project-context";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Brain, User, Users, Plus } from "lucide-react";
import type { PersonaAnalysisResult, TargetPersona } from "@shared/schema";

const PERSONA_ICONS: Record<string, string> = {
  Strategist:           "◆",
  Builder:              "▶",
  "Creative Marketer":  "◇",
  "Analytical Thinker": "—",
};

// projectId : le projet AFFICHÉ (page projet), qui peut différer du projet actif quand on arrive
// par un lien direct ; sans lui, on retombe sur le projet actif comme sur l'ancien dashboard.
export default function PersonaCard({ projectId }: { projectId?: number | null } = {}) {
  const { t } = useTranslation();
  const { activeProjectId: projetActif } = useProject();
  const activeProjectId = projectId ?? projetActif;
  const [addPersonaOpen, setAddPersonaOpen] = useState(false);
  const [personaDescription, setPersonaDescription] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: personaResult } = useQuery<PersonaAnalysisResult | null>({
    queryKey: ["/api/persona/my-persona"],
  });

  const { data: targetPersonas = [] } = useQuery<TargetPersona[]>({
    queryKey: ["/api/persona/target-personas", activeProjectId],
    queryFn: () => {
      const url = activeProjectId
        ? `/api/persona/target-personas?projectId=${activeProjectId}`
        : "/api/persona/target-personas";
      return fetch(url, { credentials: "include" }).then(r => r.json());
    },
  });

  const analyzeTargetMutation = useMutation({
    mutationFn: (data: { description: string; projectId?: number }) =>
      apiRequest("POST", "/api/persona/analyze-target", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/persona/target-personas"] });
      setAddPersonaOpen(false);
      setPersonaDescription("");
      toast({ title: "Persona cible analysé" });
    },
    onError: () => toast({ title: "Erreur lors de l'analyse", variant: "destructive" }),
  });

  const analysisResult = personaResult?.analysisResult as any;
  const personaName = analysisResult?.personaName as string | undefined;
  const outputStyle = analysisResult?.outputStyleGuidelines as string | undefined;
  const primaryTarget = targetPersonas[0] as TargetPersona | undefined;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Brain style={{ width: 13, height: 13, strokeWidth: 1.5 }} className="text-naya-olive-55" />
            <span className="font-display text-[11px] text-naya-olive-70">
              {t("dashboard.operatingProfile")}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {personaName ? (
            <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
              <div className="flex items-center gap-1.5 mb-1">
                <User style={{ width: 11, height: 11, strokeWidth: 1.5 }} className="text-naya-olive-55" />
                <span className="font-display text-[9px] text-naya-olive-55">
                  Ton archétype
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">
                {PERSONA_ICONS[personaName] || "◈"} {personaName}
              </p>
              {outputStyle && (
                <p className="text-xs text-naya-olive-55 mt-1 line-clamp-2">{outputStyle}</p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
              <p className="text-xs text-naya-olive-55">
                Complète l'onboarding pour détecter ton archétype.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Users style={{ width: 11, height: 11, strokeWidth: 1.5 }} className="text-naya-olive-55" />
                <span className="font-display text-[9px] text-naya-olive-55">
                  {activeProjectId ? "Persona cible" : "Mes personas"}
                </span>
              </div>
              {activeProjectId && (
                <button
                  onClick={() => setAddPersonaOpen(true)}
                  className="text-[10px] text-naya-olive-55 hover:text-naya-olive transition-colors flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus style={{ width: 10, height: 10 }} /> Ajouter
                </button>
              )}
            </div>

            {primaryTarget ? (
              <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10">
                <p className="text-sm font-medium text-foreground">{primaryTarget.name}</p>
                {primaryTarget.jobTitle && (
                  <p className="text-xs text-naya-olive-55">
                    {primaryTarget.jobTitle}{primaryTarget.industry ? ` · ${primaryTarget.industry}` : ""}
                  </p>
                )}
                {primaryTarget.decisionTriggers && primaryTarget.decisionTriggers.length > 0 && (
                  <div className="mt-2">
                    <p className="font-display text-[9px] text-naya-olive-55 mb-1">
                      Déclencheur de décision
                    </p>
                    <p className="text-xs text-naya-olive-70">{primaryTarget.decisionTriggers[0]}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-naya-olive-06 rounded-lg border border-naya-olive-10 text-center">
                <p className="text-xs text-naya-olive-55">
                  {activeProjectId ? "Aucun persona cible." : "Sélectionne un projet pour voir son persona."}
                </p>
                {activeProjectId && (
                  <button
                    onClick={() => setAddPersonaOpen(true)}
                    className="text-xs text-naya-olive hover:underline mt-1 cursor-pointer"
                  >
                    Décrire ton audience idéale
                  </button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={addPersonaOpen} onOpenChange={setAddPersonaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Décris ton persona cible</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-naya-olive-55">
            Décris la personne précise que tu cherches à atteindre — son rôle, son secteur, ses défis et ses aspirations. Naya va l'analyser en profil structuré.
          </p>
          <Textarea
            value={personaDescription}
            onChange={e => setPersonaDescription(e.target.value)}
            placeholder="Ex : Directrice marketing dans une PME B2B, 35 ans, cherche à démontrer le ROI de son budget contenu..."
            rows={5}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setAddPersonaOpen(false)}>Annuler</Button>
            <Button
              onClick={() => analyzeTargetMutation.mutate({
                description: personaDescription,
                ...(activeProjectId ? { projectId: activeProjectId } : {}),
              })}
              disabled={!personaDescription.trim() || analyzeTargetMutation.isPending}
            >
              {analyzeTargetMutation.isPending ? "Analyse…" : "Analyser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
