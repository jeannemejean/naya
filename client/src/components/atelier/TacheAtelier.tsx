// Dans la fiche d'une tâche : l'atelier de la semaine (« Atelier contenu », « Valider la
// semaine ») s'ouvre d'un bouton ; une vidéo montée se valide depuis sa tâche « Monter ».
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { TYPE_ATELIER, TYPE_VALIDATION } from "@shared/atelier";
import { cleAtelier, valider, type DonneesAtelier } from "@/pages/atelier/api";
import { progression } from "@/pages/atelier/navigation";

type TacheLegere = { id: number; title: string; taskType?: string | null; actionData?: unknown; contentId?: number | null; completed?: boolean };

export const estTacheAtelier = (t: TacheLegere | null | undefined) => t?.taskType === TYPE_ATELIER || t?.taskType === TYPE_VALIDATION;

export function TacheAtelier({ task, onClose }: { task: TacheLegere; onClose: () => void }) {
  const { t } = useTranslation();
  const semaine = String((task.actionData as any)?.semaine ?? "");
  const { data } = useQuery<DonneesAtelier>({ queryKey: cleAtelier(semaine), enabled: /^\d{4}-\d{2}-\d{2}$/.test(semaine) });
  const { faits, total } = progression(data?.posts ?? []);
  return (
    <div className="px-5 pt-4 space-y-3">
      <p className="text-sm text-foreground leading-relaxed">{t("atelier.tache.intro")}</p>
      {data && total > 0 && <p className="text-xs text-muted-foreground">{t("atelier.tache.resume", { valides: faits, posts: total })}</p>}
      <Button asChild className="w-full">
        <Link href={`/atelier?semaine=${semaine}`} onClick={onClose}>
          <PenLine className="w-4 h-4 mr-1.5" />{t("atelier.tache.ouvrir")}
        </Link>
      </Button>
    </div>
  );
}

/** Tâche « Monter — … » d'une vidéo : la valider (et la programmer) une fois la vidéo déposée. */
export function ValiderVideo({ task }: { task: TacheLegere }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [enCours, setEnCours] = useState(false);
  if (!task.contentId || !(task.title ?? "").startsWith("Monter — ")) return null;
  const lancer = async () => {
    setEnCours(true);
    try {
      const r = await valider(task.contentId!);
      if (r.statut === "manques") {
        toast({ title: t("atelier.manquesTitre"), description: r.manques.map((m) => t(`atelier.manques.${m}`)).join(" "), variant: "destructive" });
      } else {
        toast({ title: r.statut === "programme" ? t("atelier.programmeCourt") : t("atelier.aPublierCourt") });
        void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/atelier/") });
      }
    } catch (e: any) {
      toast({ title: t(`atelier.erreurs.${e?.message}`, { defaultValue: t("atelier.erreurs.inconnue") }), variant: "destructive" });
    } finally { setEnCours(false); }
  };
  return (
    <div className="px-5 pt-3">
      <Button size="sm" variant="outline" onClick={lancer} disabled={enCours}>
        {enCours ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
        {t("atelier.validerProgrammer")}
      </Button>
    </div>
  );
}
