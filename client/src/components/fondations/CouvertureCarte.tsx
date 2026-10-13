// La couverture des angles : combien de contenus travaillent chaque motivation, combien sont
// publiés, et la réception moyenne quand elle a été mesurée. La routine d'étiquetage classe
// les nouveaux contenus chaque matin ; l'utilisatrice corrige une étiquette en un clic.
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import RoutineCard from "@/components/routines/RoutineCard";
import type { DonneesFondations, Motivation } from "./types";

const CHAMP_SELECT = "h-7 rounded-md border border-input bg-background px-1.5 text-[11px] max-w-[11rem]";
const AUCUN = "aucun";

type Props = { projectId: number; donnees: DonneesFondations; motivationsValidees: boolean; onChange: () => void };

export default function CouvertureCarte({ projectId, donnees, motivationsValidees, onChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { couverture, contenus, catalogues } = donnees;
  const motivations: Motivation[] = donnees.fondations.motivations;
  const corriger = useMutation({
    mutationFn: (p: { id: number; angle: string; formatCreatif: string | null }) =>
      apiRequest("PATCH", `/api/fondations/contenus/${p.id}`, { angle: p.angle, formatCreatif: p.formatCreatif }),
    onSuccess: onChange,
    onError: () => toast({ title: t("fondations.erreurs.generique"), variant: "destructive" }),
  });
  const nomAngle = (cle: string | null) =>
    !cle ? t("fondations.couverture.pasEtiquete") : cle === AUCUN ? t("fondations.couverture.angleAucun") : motivations.find((m) => m.cle === cle)?.nom || cle;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("fondations.couverture.titre")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t("fondations.couverture.intro")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_1fr]">
        <RoutineCard
          id="fondations-etiquetage"
          donnees={donnees.routine}
          url={`/api/fondations/${projectId}/routine`}
          onChange={onChange}
          textes={{
            titre: t("fondations.routine.titre"), intro: t("fondations.routine.intro"),
            lance: t("fondations.routine.lance"), erreur: t("fondations.routine.erreur"),
          }}
          avertissement={!motivationsValidees ? <p className="text-[11px] text-naya-mauve">{t("fondations.routine.attente")}</p> : undefined}
        />
        <Card className="p-4 space-y-3">
          {couverture.lignes.length === 0
            ? <p className="text-xs text-muted-foreground italic">{t("fondations.couverture.vide")}</p>
            : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="font-medium py-1">{t("fondations.couverture.motivation")}</th>
                    <th className="font-medium py-1 text-right">{t("fondations.couverture.contenus")}</th>
                    <th className="font-medium py-1 text-right">{t("fondations.couverture.publies")}</th>
                    <th className="font-medium py-1 text-right">{t("fondations.couverture.score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {couverture.lignes.map((l) => (
                    <tr key={l.cle} className="border-t border-border">
                      <td className="py-1.5 text-foreground">
                        {l.nom}
                        {l.retiree && <span className="ml-1 text-[10px] text-muted-foreground">{t("fondations.couverture.retiree")}</span>}
                        {!l.retiree && l.contenus === 0 && <span className="ml-1 text-[10px] text-naya-mauve">{t("fondations.couverture.jamais")}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{l.contenus}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.publies}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{l.score == null ? t("fondations.couverture.sansMesure") : l.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <p className="text-[11px] text-muted-foreground">
            {t("fondations.couverture.horsMotivations", { count: couverture.horsMotivations })}
            {" · "}
            {t("fondations.couverture.nonEtiquetes", { count: couverture.nonEtiquetes })}
          </p>
        </Card>
      </div>

      {contenus.length > 0 && motivations.length > 0 && (
        <Card className="p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("fondations.couverture.derniers")}</h3>
          <ul className="space-y-1.5">
            {contenus.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="min-w-0 flex-1 truncate text-foreground" title={c.title}>{c.title}</span>
                <select className={CHAMP_SELECT} value={c.angle || ""} aria-label={t("fondations.couverture.motivation")}
                  onChange={(e) => e.target.value && corriger.mutate({ id: c.id, angle: e.target.value, formatCreatif: c.formatCreatif })}>
                  {!c.angle && <option value="">{nomAngle(null)}</option>}
                  {motivations.map((m) => <option key={m.cle} value={m.cle}>{m.nom}</option>)}
                  {c.angle && c.angle !== AUCUN && !motivations.some((m) => m.cle === c.angle) && <option value={c.angle}>{nomAngle(c.angle)}</option>}
                  <option value={AUCUN}>{nomAngle(AUCUN)}</option>
                </select>
                <select className={CHAMP_SELECT} value={c.formatCreatif || ""} aria-label={t("fondations.couverture.format")} disabled={!c.angle}
                  onChange={(e) => c.angle && corriger.mutate({ id: c.id, angle: c.angle, formatCreatif: e.target.value || null })}>
                  <option value="">{t("fondations.couverture.formatAucun")}</option>
                  {catalogues.formats.map((f) => <option key={f} value={f}>{t(`fondations.formats.${f}`)}</option>)}
                </select>
                <span className="text-[10px] text-muted-foreground w-12 text-right">
                  {c.etiquetage ? t(c.etiquetage === "utilisatrice" ? "fondations.couverture.parToi" : "fondations.couverture.parNaya") : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
