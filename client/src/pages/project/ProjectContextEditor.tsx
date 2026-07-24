// Éditeur de contexte projet (Task 7) — la note libre que Naya ne peut pas deviner + le stade
// stratégique du projet. La note est envoyée à Naya via le bouton « Envoyer à Naya » : elle est
// enregistrée puis analysée, et Naya peut proposer un rituel récurrent à valider (Task 12).
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSaveStage, useAnalyzeNote, useCreateRitual, type ProjectDetail, type NoteAnalysis, type RitualProposal } from "./useProjectPage";
import RitualList from "./RitualList";
import { formatDays } from "./ritual-format";
import type { ProjectStrategyProfile } from "@shared/schema";

interface ProjectContextEditorProps {
  project: ProjectDetail;
  strategyProfile: ProjectStrategyProfile | null;
}

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "ideation", label: "Idéation" },
  { value: "early", label: "Lancement" },
  { value: "growth", label: "Croissance" },
  { value: "mature", label: "Mature" },
];

export default function ProjectContextEditor({ project, strategyProfile }: ProjectContextEditorProps) {
  const { toast } = useToast();
  const analyze = useAnalyzeNote(project.id);
  const createRitual = useCreateRitual(project.id);
  const saveStage = useSaveStage(project.id);

  const [noteDraft, setNoteDraft] = useState(project.statusNote ?? "");
  const [analysis, setAnalysis] = useState<NoteAnalysis | null>(null);

  // Resynchronise le brouillon si on navigue vers un autre projet (le composant est réutilisé
  // avec un nouvel id sans forcément être démonté).
  useEffect(() => {
    setNoteDraft(project.statusNote ?? "");
    setAnalysis(null);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unchanged = noteDraft.trim() === (project.statusNote ?? "").trim();

  const handleSend = () => {
    setAnalysis(null);
    analyze.mutate(noteDraft, {
      onSuccess: (result) => setAnalysis(result),
      onError: (err: any) => {
        const msg = String(err?.message ?? "");
        toast({
          title: "Naya n'a pas pu lire ton message",
          description: msg.includes("429")
            ? "Limite d'utilisation de l'IA atteinte pour ce mois-ci. Ta note est bien enregistrée."
            : "Ta note est enregistrée, mais l'analyse a échoué. Réessaie.",
          variant: "destructive",
        });
      },
    });
  };

  const handleApply = (proposal: RitualProposal) => {
    createRitual.mutate(proposal, {
      onSuccess: () => {
        toast({
          title: "Rituel ajouté à ton planning",
          description: `${proposal.title} — ${formatDays(proposal.days)}, ${proposal.startTime}.`,
        });
        setAnalysis(null);
      },
      onError: () => toast({ title: "Impossible d'ajouter le rituel", variant: "destructive" }),
    });
  };

  const handleStageChange = (value: string) => {
    saveStage.mutate(value, {
      onSuccess: () => {
        toast({ title: "Stade mis à jour", description: `Le projet est maintenant en « ${STAGE_OPTIONS.find((s) => s.value === value)?.label} ».` });
      },
      onError: () => {
        toast({
          title: "Erreur",
          description: "Impossible de mettre à jour le stade. Réessaie.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div>
        <label htmlFor="project-status-note" className="text-sm font-medium text-foreground">
          Où en est ce projet ? (dis tout à Naya)
        </label>
        <p className="text-xs text-naya-olive-55 mt-1 mb-2">
          Naya connaît déjà ce que tu fais dans l'app. Note ici ce qu'elle ne peut pas deviner : un
          événement externe, une décision, un blocage, ce que tu as fait hors Naya.
        </p>
        <Textarea
          id="project-status-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Ex : tous les matins je fais un brief news, ça me prend 20 min…"
          className="min-h-[100px]"
        />

        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={handleSend} disabled={analyze.isPending || !noteDraft.trim() || unchanged}>
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {analyze.isPending ? "Naya lit…" : "Envoyer à Naya"}
          </Button>
        </div>

        {analysis && (
          <div className="mt-3 rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-3 space-y-3">
            <p className="text-xs text-foreground">{analysis.understood}</p>

            {analysis.proposals.map((p, i) => (
              <div key={i} className="rounded-md border border-naya-olive-18 bg-white p-2.5 space-y-2">
                <p className="text-xs text-foreground">
                  <strong className="font-medium">{p.title}</strong>
                  {" — "}{formatDays(p.days)}, {p.startTime}, {p.durationMinutes} min
                </p>
                <p className="text-[11px] text-naya-olive-55">
                  Ce créneau sera réservé : rien ne sera planifié par-dessus.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleApply(p)} disabled={createRitual.isPending}>
                    {createRitual.isPending ? "Ajout…" : "Appliquer"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAnalysis(null)}>
                    Ignorer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RitualList projectId={project.id} />

      <div className="flex items-center gap-3 pt-1 border-t border-border">
        <label htmlFor="project-stage" className="text-sm font-medium text-foreground flex-shrink-0 pt-3">
          Stade
        </label>
        <div className="pt-3 w-48">
          <Select value={strategyProfile?.currentStage ?? undefined} onValueChange={handleStageChange}>
            <SelectTrigger id="project-stage">
              <SelectValue placeholder="Non renseigné" />
            </SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}
