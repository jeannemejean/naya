// Bloc « Publication » de la fenêtre d'un post : programmer pour que Naya publie seule à
// l'heure prévue, ou annuler. Ce qui empêche de programmer est dit en clair, recalculé sur
// le texte et la date en cours d'édition (règles partagées : @shared/programmation).
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Loader2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  problemesProgrammation, type CompteSocial, type GenreMedia, type ProblemeProgrammation,
} from "@shared/programmation";

interface EtatProgrammation {
  programme: boolean;
  etat: string;
  derniereErreur: string | null;
  publieLe: string | null;
  scheduledFor: string | null;
  plateforme: string;
  compte: CompteSocial | null;
  medias: GenreMedia[];
  format: string;
  nbVisuels: number;
  problemes: ProblemeProgrammation[];
}

const NOMS: Record<string, string> = { instagram: "Instagram", linkedin: "LinkedIn", facebook: "Facebook", tiktok: "TikTok", twitter: "X", pinterest: "Pinterest" };
const nomPlateforme = (p: string) => NOMS[p] ?? (p ? p[0].toUpperCase() + p.slice(1) : p);
const CODES_CONNUS = new Set(["plateforme_non_supportee", "compte_absent", "compte_expire", "media_required"]);

export const cleProgrammation = (postId: number) => ["/api/content", postId, "programmation"];

export default function ProgrammationPost({
  postId, body, title, scheduledFor, onComptes,
}: {
  postId: number;
  body: string;
  title: string;
  scheduledFor?: Date;
  onComptes: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: etat, isLoading } = useQuery<EtatProgrammation>({
    queryKey: cleProgrammation(postId),
    queryFn: async () => (await apiRequest("GET", `/api/content/${postId}/programmation`)).json(),
  });

  const apres = (e: EtatProgrammation) => {
    qc.setQueryData(cleProgrammation(postId), e);
    qc.invalidateQueries({ queryKey: ["/api/content"] });
  };
  const programmer = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/${postId}/programmation`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, title, scheduledFor: scheduledFor ? scheduledFor.toISOString() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422) return data as EtatProgrammation;
      if (!res.ok) throw new Error(data?.message || "programmation_failed");
      return data as EtatProgrammation;
    },
    onSuccess: (e) => {
      apres(e);
      if (e.programme && e.problemes.length === 0) toast({ title: t("programmation.programmeToast"), description: quand(e.scheduledFor) ?? undefined });
    },
    onError: () => toast({ title: t("common.error"), description: t("programmation.erreur"), variant: "destructive" }),
  });
  const annuler = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/content/${postId}/programmation`)).json(),
    onSuccess: (e: EtatProgrammation) => { apres(e); toast({ title: t("programmation.annuleToast") }); },
    onError: () => toast({ title: t("common.error"), description: t("programmation.erreur"), variant: "destructive" }),
  });

  function quand(d: string | Date | null | undefined): string | null {
    if (!d) return null;
    return new Date(d).toLocaleString(i18n.language, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }

  if (isLoading || !etat) {
    return <div className="rounded-lg border border-naya-olive-18 p-3 text-xs text-naya-olive-55"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /></div>;
  }

  const plateforme = nomPlateforme(etat.plateforme);
  const compte = etat.compte?.accountName ? `${plateforme} · ${etat.compte.accountName}` : plateforme;
  const format = etat.format === "carousel"
    ? t("programmation.format.carousel", { count: etat.nbVisuels })
    : t(`programmation.format.${etat.format}`, { defaultValue: etat.format });
  // Recalculé sur ce qui est à l'écran (texte et date pas encore enregistrés compris).
  const problemes = problemesProgrammation({
    post: { body, platform: etat.plateforme, scheduledFor: scheduledFor ?? null, postStatus: etat.etat, publishedAt: etat.publieLe },
    medias: etat.medias, compte: etat.compte, maintenant: new Date(),
  });
  const libelleProbleme = (p: ProblemeProgrammation) => t(`programmation.probleme.${p}`, { plateforme });
  const versComptes = (p: ProblemeProgrammation) => p === "compte_absent" || p === "compte_expire";

  let contenu: JSX.Element;
  if (etat.etat === "posted" || etat.publieLe) {
    contenu = (
      <p className="flex items-center gap-2 text-sm text-naya-olive-70">
        <CheckCircle2 className="h-4 w-4 text-naya-olive" />
        {t("programmation.publie", { date: quand(etat.publieLe) ?? "", compte })}
      </p>
    );
  } else if (["posting", "uploading", "processing"].includes(etat.etat)) {
    contenu = (
      <p className="flex items-center gap-2 text-sm text-naya-olive-70">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("programmation.enCours", { compte })}
      </p>
    );
  } else if (etat.programme && etat.etat === "pending") {
    contenu = (
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-naya-olive">
            <CalendarCheck className="h-4 w-4" />
            {t("programmation.programme", { date: quand(etat.scheduledFor) ?? "" })}
          </p>
          <p className="text-xs text-naya-olive-55 mt-0.5 ml-6">{compte} — {format}</p>
          {problemes.filter(p => p !== "date_passee").length > 0 && (
            <ul className="mt-2 ml-6 space-y-0.5">
              {problemes.filter(p => p !== "date_passee").map(p => <li key={p} className="text-xs text-[#5c3d45]">{libelleProbleme(p)}</li>)}
            </ul>
          )}
        </div>
        <Button size="sm" variant="ghost" className="gap-1.5 text-naya-olive-55" onClick={() => annuler.mutate()} disabled={annuler.isPending}>
          <X className="h-3.5 w-3.5" />
          {t("programmation.annuler")}
        </Button>
      </div>
    );
  } else {
    const echec = etat.etat === "failed";
    const raison = etat.derniereErreur
      ? (CODES_CONNUS.has(etat.derniereErreur)
          ? t(`programmation.probleme.${etat.derniereErreur === "media_required" ? "visuel_requis" : etat.derniereErreur}`, { plateforme })
          : etat.derniereErreur)
      : null;
    contenu = (
      <div className="space-y-2">
        {echec && (
          <p className="flex items-start gap-2 text-sm text-[#5c3d45]">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{t("programmation.echec")}{raison ? ` ${raison}` : ""}</span>
          </p>
        )}
        {problemes.length > 0 ? (
          <ul className="space-y-1">
            {problemes.map(p => (
              <li key={p} className="text-xs text-naya-olive-70 flex items-center gap-2 flex-wrap">
                <span>• {libelleProbleme(p)}</span>
                {versComptes(p) && (
                  <button type="button" onClick={onComptes} className="underline text-naya-olive hover:opacity-80">
                    {t("programmation.ouvrirComptes")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-naya-olive-55">
            {t("programmation.pret", { date: quand(scheduledFor) ?? "", compte, format })}
          </p>
        )}
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => programmer.mutate()}
          disabled={problemes.length > 0 || programmer.isPending}
        >
          {programmer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />}
          {t(echec ? "programmation.reprogrammer" : "programmation.programmer")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-naya-olive-35">{t("programmation.titre")}</p>
      {contenu}
    </div>
  );
}
