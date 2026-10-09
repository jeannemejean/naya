// Visuels d'un post dans la fenêtre du calendrier de contenu : on les remet dans l'ordre
// de publication par glisser-déposer (ou avec les flèches, au clavier et sur mobile).
// L'ordre s'affiche tout de suite ; le serveur suit, et l'on revient en arrière s'il refuse.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { deplacer, estVideo, type MediaDuPost } from "@/pages/content-calendar-medias";

export default function VisuelsDuPost({
  postId, medias, modifiable, onOrdre,
}: {
  postId: number;
  medias: MediaDuPost[];
  modifiable: boolean;
  onOrdre: (mediaIds: number[]) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ordre, setOrdre] = useState(medias);
  const [glisse, setGlisse] = useState<number | null>(null);
  const [survol, setSurvol] = useState<number | null>(null);
  const cle = medias.map((m) => m.id).join(",");
  useEffect(() => setOrdre(medias), [postId, cle]); // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("PUT", `/api/content/${postId}/medias/ordre`, { mediaIds: ids });
      return (await res.json()) as { mediaIds: number[] };
    },
    onSuccess: (r) => {
      onOrdre(r.mediaIds);
      qc.invalidateQueries({ queryKey: ["/api/content"] });
    },
    onError: () => {
      setOrdre(medias);
      toast({ title: t("common.error"), description: t("contentCalendar.ordreVisuelsErreur"), variant: "destructive" });
    },
  });

  const deplacerVers = (de: number, vers: number) => {
    const suivant = deplacer(ordre, de, vers);
    if (suivant === ordre) return;
    setOrdre(suivant);
    enregistrer.mutate(suivant.map((m) => m.id));
  };

  if (ordre.length === 0) return null;
  return (
    <div>
      <Label>{t("contentCalendar.visuelsDuPost", { count: ordre.length })}</Label>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {ordre.map((m, i) => (
          <div
            key={m.id}
            draggable={modifiable}
            onDragStart={(e) => { setGlisse(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(m.id)); }}
            onDragOver={(e) => { if (glisse == null) return; e.preventDefault(); setSurvol(i); }}
            onDragLeave={() => setSurvol((s) => (s === i ? null : s))}
            onDrop={(e) => { e.preventDefault(); if (glisse != null) deplacerVers(glisse, i); setGlisse(null); setSurvol(null); }}
            onDragEnd={() => { setGlisse(null); setSurvol(null); }}
            className={`group relative aspect-square rounded-md overflow-hidden border bg-naya-olive-06 transition-all ${
              modifiable ? "cursor-grab active:cursor-grabbing" : ""
            } ${glisse === i ? "opacity-40" : ""} ${survol === i && glisse !== i ? "border-naya-olive ring-2 ring-naya-olive" : "border-naya-olive-18"}`}
          >
            {estVideo(m)
              ? <video src={m.url} className="w-full h-full object-cover pointer-events-none" muted />
              : <img src={m.url} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />}
            <span className="absolute top-1 left-1 text-[10px] font-medium px-1.5 rounded bg-white/90 text-naya-olive-70">{i + 1}</span>
            {modifiable && (
              <>
                <GripVertical className="absolute top-1 right-1 h-3.5 w-3.5 text-white drop-shadow [@media(hover:hover)]:opacity-0 group-hover:opacity-100" />
                <div className="absolute bottom-1 inset-x-1 flex justify-between [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => deplacerVers(i, i - 1)}
                    disabled={i === 0}
                    aria-label={t("contentCalendar.visuelAvant")}
                    className="h-6 w-6 rounded bg-white/90 flex items-center justify-center disabled:invisible"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 text-naya-olive-70" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deplacerVers(i, i + 1)}
                    disabled={i === ordre.length - 1}
                    aria-label={t("contentCalendar.visuelApres")}
                    className="h-6 w-6 rounded bg-white/90 flex items-center justify-center disabled:invisible"
                  >
                    <ChevronRight className="h-3.5 w-3.5 text-naya-olive-70" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-naya-olive-55 mt-1">
        {t(modifiable ? "contentCalendar.visuelsDuPostAide" : "contentCalendar.visuelsDuPostVerrouille")}
      </p>
    </div>
  );
}
