// Le plan d'acquisition : le stade de maturité et, pour chaque brique du système 360, si elle
// s'applique maintenant, plus tard ou pas du tout à CE business, avec la raison et la
// première action. Le plan ne lance rien : il renvoie vers la page où l'on active la brique.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import SectionCarte, { PiedEdition, useEnvoiSection } from "./SectionCarte";
import type { Catalogues, Plan, Statut } from "./types";

type Props = { projectId: number; plan: Plan | null; statut: Statut; catalogues: Catalogues; onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean; verrouille: boolean };
const MOTEURS = ["creation", "captation", "socle"] as const;
const CHAMP_SELECT = "h-8 rounded-md border border-input bg-background px-2 text-xs";
const COULEUR: Record<string, string> = {
  maintenant: "text-naya-salvia border-naya-salvia/40", plus_tard: "text-naya-mauve border-naya-mauve/40", sans_objet: "text-muted-foreground",
};

export default function PlanCarte({ projectId, plan, statut, catalogues, onChange, onReproposer, reproposeEnCours, verrouille }: Props) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState<Plan | null>(null);
  const envoi = useEnvoiSection(projectId, "plan", onChange, () => setBrouillon(null));
  const brique = (p: Plan, cle: string) => p.briques.find((b) => b.cle === cle);
  const majBrique = (cle: string, champ: "statut" | "raison" | "action", v: string) => setBrouillon((p) => {
    if (!p) return p;
    const existante = brique(p, cle);
    if (champ === "statut" && !v) return { ...p, briques: p.briques.filter((b) => b.cle !== cle) };
    if (!existante) return { ...p, briques: [...p.briques, { cle, statut: champ === "statut" ? v : "plus_tard", raison: champ === "raison" ? v : "", action: champ === "action" ? v : "" }] };
    return { ...p, briques: p.briques.map((b) => (b.cle === cle ? { ...b, [champ]: v } : b)) };
  });

  return (
    <SectionCarte projectId={projectId} section="plan" statut={statut} enEdition={!!brouillon}
      onModifier={() => setBrouillon(plan || { maturite: "demarrage", resume: "", briques: [] })}
      onChange={onChange} onReproposer={onReproposer} reproposeEnCours={reproposeEnCours} verrouille={verrouille}>
      {brouillon ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); envoi.mutate({ valeur: brouillon }); }}>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-xs text-muted-foreground">{t("fondations.plan.maturite")}</span>
            <select className={CHAMP_SELECT} value={brouillon.maturite} onChange={(e) => setBrouillon({ ...brouillon, maturite: e.target.value })}>
              {catalogues.maturites.map((m) => <option key={m} value={m}>{t(`fondations.plan.maturites.${m}`)}</option>)}
            </select>
          </div>
          <Textarea className="text-xs min-h-[50px]" value={brouillon.resume} placeholder={t("fondations.plan.resume")} onChange={(e) => setBrouillon({ ...brouillon, resume: e.target.value })} />
          {MOTEURS.map((moteur) => (
            <div key={moteur} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`fondations.plan.moteurs.${moteur}`)}</p>
              {catalogues.briques.filter((b) => b.moteur === moteur).map((b) => {
                const v = brique(brouillon, b.cle);
                return (
                  <div key={b.cle} className="grid gap-1.5 sm:grid-cols-[12rem_9rem_1fr_1fr] items-center">
                    <span className="text-xs text-foreground">{t(`fondations.plan.briques.${b.cle}`)}</span>
                    <select className={CHAMP_SELECT} value={v?.statut || ""} aria-label={t("fondations.plan.statut")} onChange={(e) => majBrique(b.cle, "statut", e.target.value)}>
                      <option value="">{t("fondations.plan.nonRenseigne")}</option>
                      {catalogues.statutsBrique.map((s) => <option key={s} value={s}>{t(`fondations.plan.statuts.${s}`)}</option>)}
                    </select>
                    <Input className="h-8 text-xs" disabled={!v} value={v?.raison || ""} placeholder={t("fondations.plan.raison")} onChange={(e) => majBrique(b.cle, "raison", e.target.value)} />
                    <Input className="h-8 text-xs" disabled={!v} value={v?.action || ""} placeholder={t("fondations.plan.action")} onChange={(e) => majBrique(b.cle, "action", e.target.value)} />
                  </div>
                );
              })}
            </div>
          ))}
          <PiedEdition enCours={envoi.isPending} onAnnuler={() => setBrouillon(null)} desactive={!brouillon.briques.length} />
        </form>
      ) : plan && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{t(`fondations.plan.maturites.${plan.maturite}`)}</Badge>
            {plan.resume && <p className="text-foreground">{plan.resume}</p>}
          </div>
          {MOTEURS.map((moteur) => {
            const briques = catalogues.briques.filter((b) => b.moteur === moteur)
              .map((b) => ({ ...b, choix: plan.briques.find((x) => x.cle === b.cle) }))
              .filter((b) => b.choix);
            if (!briques.length) return null;
            return (
              <div key={moteur} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`fondations.plan.moteurs.${moteur}`)}</p>
                {briques.map(({ cle, page, choix }) => (
                  <div key={cle} className="rounded-md border border-border px-3 py-2 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{t(`fondations.plan.briques.${cle}`)}</span>
                      <Badge variant="outline" className={`text-[10px] ${COULEUR[choix!.statut] || ""}`}>{t(`fondations.plan.statuts.${choix!.statut}`)}</Badge>
                      {page && choix!.statut !== "sans_objet" && (
                        <Link href={page} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-naya-salvia hover:underline">
                          {t("fondations.plan.ouvrir")}<ArrowUpRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                    {choix!.raison && <p className="text-muted-foreground">{choix!.raison}</p>}
                    {choix!.action && <p className="text-foreground"><span className="font-medium">{t("fondations.plan.premiereAction")}</span> {choix!.action}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </SectionCarte>
  );
}
