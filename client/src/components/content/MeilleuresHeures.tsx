// Meilleures heures pour publier (lot 7, inspiré de Metricool) : la grille jour × heure d'un
// réseau pour une marque (server/routes-meilleures-heures.ts), sa source (générique ou vos
// données), et les 3 meilleurs créneaux des 7 prochains jours, cliquables pour fixer la date.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import {
  meilleursCreneaux, reseauMeilleuresHeures, RESEAUX_MEILLEURES_HEURES,
  type Matrice, type SourceMeilleuresHeures as Source,
} from "@shared/meilleures-heures";

interface Grille { reseau: string; matrice: Matrice; source: Source; n: number }

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
const NOMS_RESEAUX: Record<string, string> = { instagram: "Instagram", linkedin: "LinkedIn", facebook: "Facebook", tiktok: "TikTok" };

/**
 * La grille d'une marque (null = marque des Réglages) pour un réseau ; rien si le réseau n'a pas
 * de grille. `groupeId` (groupe de marques, lot 9) : les mesures de toutes ses marques ensemble.
 */
export function useMeilleuresHeures(projectId: number | null | undefined, reseau: string | null | undefined, groupeId: number | null = null) {
  const r = reseauMeilleuresHeures(reseau);
  const portee = groupeId != null ? `&groupeId=${groupeId}` : projectId ? `&projectId=${projectId}` : "";
  return useQuery<Grille>({
    queryKey: ["/api/meilleures-heures", groupeId != null ? `groupe-${groupeId}` : projectId ?? null, r],
    enabled: !!r,
    staleTime: 10 * 60_000,
    queryFn: async () => (await apiRequest("GET", `/api/meilleures-heures?reseau=${r}${portee}`)).json(),
  });
}

/** « générique » ou « vos données (N posts) ». */
export function SourceMeilleuresHeures({ source, n }: { source: Source; n: number }) {
  const { t } = useTranslation();
  const libelle = source === "generique" ? t("meilleuresHeures.generique")
    : source === "mixte" ? t("meilleuresHeures.mixte", { count: n }) : t("meilleuresHeures.donnees", { count: n });
  return (
    <span className="inline-flex rounded-full bg-naya-olive-06 px-2 py-0.5 text-[10px] text-naya-olive-55"
      title={source === "generique" ? t("meilleuresHeures.generiqueAide") : t("meilleuresHeures.donneesAide")} data-testid="source-meilleures-heures">
      {libelle}
    </span>
  );
}

/** La carte de chaleur : 7 lignes (lundi → dimanche) × 24 heures. */
export function GrilleMeilleuresHeures({ matrice }: { matrice: Matrice }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1" role="img" aria-label={t("meilleuresHeures.grille")} data-testid="grille-meilleures-heures">
      <div className="grid gap-px" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[8px] leading-3 text-naya-olive-35">{h % 6 === 0 ? h : ""}</span>
        ))}
        {matrice.map((ligne, j) => (
          <div key={j} className="contents">
            <span className="pr-1 text-right text-[9px] leading-4 text-naya-olive-55">{t(`meilleuresHeures.jours.${JOURS[j]}`)}</span>
            {ligne.map((v, h) => (
              <span key={h} className="h-4 rounded-[2px] bg-naya-olive" style={{ opacity: 0.06 + 0.94 * v }}
                title={t("meilleuresHeures.cellule", { jour: t(`meilleuresHeures.jours.${JOURS[j]}`), heure: h, note: Math.round(v * 100) })} />
            ))}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-naya-olive-35">{t("meilleuresHeures.legende")}</p>
    </div>
  );
}

/**
 * Les 3 meilleurs créneaux des 7 prochains jours pour ce réseau (un par jour), cliquables ; la
 * grille complète se déplie. Rien pour un réseau sans grille.
 */
export function MeilleursCreneaux({ projectId, reseau, onChoisir, disabled = false }: {
  projectId: number | null | undefined;
  reseau: string | null | undefined;
  onChoisir: (instant: Date) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useMeilleuresHeures(projectId, reseau);
  const [grille, setGrille] = useState(false);
  // Calculés une fois par grille reçue : « maintenant » est l'heure de l'appareil.
  const creneaux = useMemo(() => (data ? meilleursCreneaux(data.matrice, new Date()) : []), [data]);
  if (!reseauMeilleuresHeures(reseau)) return null;
  if (isLoading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-naya-olive-35" />;
  if (!data) return null;
  return (
    <div className="space-y-1.5" data-testid="meilleurs-creneaux">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-naya-olive-70">
          <Clock className="h-3 w-3" />{t("meilleuresHeures.suggestions")}
        </span>
        <SourceMeilleuresHeures source={data.source} n={data.n} />
        <button type="button" className="ml-auto text-[11px] text-naya-olive-55 underline-offset-2 hover:underline" onClick={() => setGrille((g) => !g)} aria-expanded={grille}>
          {grille ? t("meilleuresHeures.masquerGrille") : t("meilleuresHeures.afficherGrille")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {creneaux.map((c) => {
          const quand = c.instant.toLocaleString(i18n.language, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <Button key={c.instant.toISOString()} type="button" size="sm" variant="outline" className="h-7 text-xs capitalize" disabled={disabled}
              aria-label={t("meilleuresHeures.appliquer", { quand })} onClick={() => onChoisir(c.instant)}>
              {quand}
            </Button>
          );
        })}
      </div>
      {grille && <GrilleMeilleuresHeures matrice={data.matrice} />}
    </div>
  );
}

/** Le panneau du calendrier : un réseau au choix, sa grille, sa source et ses meilleurs créneaux. */
export function PanneauMeilleuresHeures({ projectId, groupeId = null }: { projectId: number | null; groupeId?: number | null }) {
  const { t, i18n } = useTranslation();
  const [reseau, setReseau] = useState<string>("instagram");
  const { data, isLoading, isError } = useMeilleuresHeures(projectId, reseau, groupeId);
  const creneaux = useMemo(() => (data ? meilleursCreneaux(data.matrice, new Date()) : []), [data]);
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("meilleuresHeures.titre")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={reseau} onValueChange={setReseau}>
          <SelectTrigger className="h-8 w-40 text-sm" aria-label={t("meilleuresHeures.reseau")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {RESEAUX_MEILLEURES_HEURES.map((r) => <SelectItem key={r} value={r}>{NOMS_RESEAUX[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        {data && <SourceMeilleuresHeures source={data.source} n={data.n} />}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : isError || !data ? (
        <p className="text-sm text-destructive py-6 text-center">{t("meilleuresHeures.erreur")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-naya-olive-55">{data.source === "generique" ? t("meilleuresHeures.generiqueAide") : t("meilleuresHeures.donneesAide")}</p>
          <GrilleMeilleuresHeures matrice={data.matrice} />
          <div className="space-y-1">
            <p className="text-xs font-medium text-naya-olive-70">{t("meilleuresHeures.suggestions")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {creneaux.map((c) => (
                <li key={c.instant.toISOString()} className="rounded-md border border-naya-olive-18 px-2 py-1 text-xs capitalize text-naya-olive-70">
                  {c.instant.toLocaleString(i18n.language, { weekday: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </DialogContent>
  );
}
