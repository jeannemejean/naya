// Aperçu de la grille Instagram d'une marque (lot 4, inspiré de Metricool) : 3 colonnes, les
// prochains posts du fil en tête (comme Instagram les empilera), puis les publiés depuis Naya.
// Brouillon ou non validé : pâle ; à venir : petit badge de date. Un clic ouvre le post.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clapperboard, Copy as IconeCarrousel, ImageOff, Loader2 } from "lucide-react";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { tuilePale, type TuileInstagram } from "@shared/apercu-instagram";

interface Apercu { compte: { id: number; accountName: string | null } | null; tuiles: TuileInstagram[] }

/**
 * `marques` (groupe de marques, lot 9) : la grille reste celle d'UNE marque (un compte
 * Instagram) ; on choisit laquelle parmi les marques du groupe.
 */
export default function ApercuInstagram({ projectId: projetInitial, marques, onOuvrir }: {
  projectId: number | null; marques?: Array<{ id: number; name: string }>; onOuvrir: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [choix, setChoix] = useState<number | null>(() =>
    marques && marques.length > 0 ? (marques.some((m) => m.id === projetInitial) ? projetInitial : marques[0].id) : projetInitial);
  const projectId = marques ? choix : projetInitial;
  const { data, isLoading, isError } = useQuery<Apercu>({
    queryKey: ["/api/content", "apercu-instagram", projectId],
    queryFn: async () => (await apiRequest("GET", `/api/content/apercu-instagram${projectId ? `?projectId=${projectId}` : ""}`)).json(),
  });
  const tuiles = data?.tuiles ?? [];

  return (
    <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("apercuInstagram.titre")}</DialogTitle>
      </DialogHeader>
      {marques && marques.length > 0 && (
        <Select value={projectId != null ? String(projectId) : undefined} onValueChange={(v) => setChoix(Number(v))}>
          <SelectTrigger className="h-8 text-sm" aria-label={t("groupesMarques.apercuMarque")} data-testid="apercu-marque"><SelectValue /></SelectTrigger>
          <SelectContent>
            {marques.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-naya-olive-55">
        {data?.compte?.accountName ? t("apercuInstagram.compte", { nom: data.compte.accountName }) : t("apercuInstagram.sansCompte")}
      </p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : isError ? (
        <p className="text-sm text-destructive py-6 text-center">{t("apercuInstagram.erreur")}</p>
      ) : tuiles.length === 0 ? (
        <p className="text-sm text-naya-olive-35 py-6 text-center">{t("apercuInstagram.vide")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5" data-testid="grille-instagram">
          {tuiles.map((x) => {
            const image = x.thumbnailUrl;
            const date = x.etat === "publie" ? null : x.scheduledFor;
            return (
              <button key={x.id} type="button" onClick={() => onOuvrir(x.id)} data-testid={`tuile-${x.id}`}
                className={`relative aspect-square overflow-hidden bg-naya-olive-06 focus:outline-none focus-visible:ring-2 focus-visible:ring-naya-olive-55 ${tuilePale(x) ? "opacity-40" : ""}`}
                title={tuilePale(x) ? t("apercuInstagram.nonValide") : x.etat === "publie" ? t("apercuInstagram.publie") : t("apercuInstagram.aVenir")}>
                {image ? (
                  <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-naya-olive-55">
                    {x.kind === "video" ? <Clapperboard className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />}
                  </span>
                )}
                {x.kind === "carrousel" && <IconeCarrousel className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" aria-label={t("apercuInstagram.carrousel")} />}
                {x.kind === "video" && image && <Clapperboard className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" aria-label={t("apercuInstagram.video")} />}
                {date && (
                  <span className={`absolute left-1 bottom-1 rounded px-1 text-[9px] leading-4 ${x.programme ? "bg-naya-olive text-naya-cream" : "bg-white/85 text-naya-olive-70"}`}>
                    {format(new Date(date), "dd/MM HH:mm")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-naya-olive-35">{t("apercuInstagram.legende")}</p>
    </DialogContent>
  );
}
