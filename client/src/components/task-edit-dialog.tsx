import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Bornes alignées sur le serveur (server/services/taches/edition.ts).
const TITRE_MAX = 200;
const DESCRIPTION_MAX = 5000;

interface TacheEditable {
  id: number;
  title: string;
  description?: string | null;
}

interface TaskEditDialogProps {
  task: TacheEditable | null;
  open: boolean;
  onClose: () => void;
  /** Appelé avec la tâche renvoyée par le serveur, pour les vues qui gardent une copie locale. */
  onSaved?: (task: { id: number; title: string; description?: string | null }) => void;
}

// « Modifier » une tâche : reformuler son titre et sa description.
export default function TaskEditDialog({ task, open, onClose, onSaved }: TaskEditDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Pré-remplissage à l'ouverture seulement : une saisie en cours n'est pas écrasée par un refetch.
  useEffect(() => {
    if (open && task) {
      setTitle(task.title ?? "");
      setDescription(task.description ?? "");
    }
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/tasks/${task!.id}`, {
        title: title.trim(),
        description: description.trim() ? description : null,
      });
      return res.json();
    },
    onSuccess: (saved) => {
      onSaved?.(saved);
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/tasks"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/schedule-preview"] });
      toast({ title: t("taskEdit.saved") });
      onClose();
    },
    onError: () => {
      toast({ title: t("taskEdit.failed"), variant: "destructive" });
    },
  });

  const titreValide = title.trim().length > 0 && title.trim().length <= TITRE_MAX;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t("taskEdit.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (titreValide && !mutation.isPending) mutation.mutate();
          }}
        >
          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t("taskEdit.titleLabel")}</p>
            <Input
              value={title}
              maxLength={TITRE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t("taskEdit.descriptionLabel")}</p>
            <Textarea
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("taskEdit.descriptionPlaceholder")}
              rows={5}
              className="text-sm resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="flex-1">
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!titreValide || mutation.isPending} className="flex-1">
              {mutation.isPending ? t("common.loading") : t("taskEdit.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
