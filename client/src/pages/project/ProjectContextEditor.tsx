// Éditeur de contexte projet (Task 7) — la note libre que Naya ne peut pas deviner + le stade
// stratégique du projet. Deux champs, deux mutations indépendantes (useSaveStatusNote,
// useSaveStatusNote, useSaveStage — Task 5), chacune avec son propre feedback.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSaveStage, useSaveStatusNote, type ProjectDetail } from "./useProjectPage";
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
  const saveNote = useSaveStatusNote(project.id);
  const saveStage = useSaveStage(project.id);

  const [noteDraft, setNoteDraft] = useState(project.statusNote ?? "");
  const [justSaved, setJustSaved] = useState(false);

  // Resynchronise le brouillon si on navigue vers un autre projet (le composant est réutilisé
  // avec un nouvel id sans forcément être démonté).
  useEffect(() => {
    setNoteDraft(project.statusNote ?? "");
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNoteBlur = () => {
    const current = project.statusNote ?? "";
    if (noteDraft === current) return; // rien à enregistrer
    saveNote.mutate(noteDraft, {
      onSuccess: () => {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      },
      onError: () => {
        toast({
          title: "Erreur",
          description: "Impossible d'enregistrer la note. Réessaie.",
          variant: "destructive",
        });
      },
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
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="project-status-note" className="text-sm font-medium text-foreground">
            Où en est ce projet ? (dis tout à Naya)
          </label>
          {(saveNote.isPending || justSaved) && (
            <span className="text-xs text-naya-olive-55 flex items-center gap-1 flex-shrink-0">
              {saveNote.isPending ? "Enregistrement…" : (
                <>
                  <Check className="w-3 h-3" />
                  Enregistré
                </>
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-naya-olive-55 mt-1 mb-2">
          Naya connaît déjà ce que tu fais dans l'app. Note ici ce qu'elle ne peut pas deviner : un
          événement externe, une décision, un blocage, ce que tu as fait hors Naya.
        </p>
        <Textarea
          id="project-status-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={handleNoteBlur}
          placeholder="Ex : le client a validé le devis hier, on attend le virement avant de lancer la prod…"
          className="min-h-[100px]"
        />
      </div>

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
