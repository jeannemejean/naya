// Les motivations d'achat et leur ligne de matrice créative (angle, accroches, preuves,
// objections, formats). La `cle` de chaque motivation est conservée à l'édition : renommer
// une motivation ne casse pas l'étiquette des contenus déjà classés.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SectionCarte, { PiedEdition, useEnvoiSection } from "./SectionCarte";
import { depuisLignes, versLignes, type Motivation, type Statut } from "./types";

const MAX = 5;
type Props = {
  projectId: number; motivations: Motivation[]; statut: Statut; formats: string[];
  onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean; verrouille: boolean;
};
type Edition = Omit<Motivation, "accroches" | "preuves" | "objections"> & { accroches: string; preuves: string; objections: string };

const versEdition = (m: Motivation): Edition => ({ ...m, accroches: versLignes(m.accroches), preuves: versLignes(m.preuves), objections: versLignes(m.objections) });
const depuisEdition = (m: Edition) => ({ ...m, accroches: depuisLignes(m.accroches), preuves: depuisLignes(m.preuves), objections: depuisLignes(m.objections) });
const nouvelle = (): Edition => ({ cle: "", nom: "", description: "", angle: "", accroches: "", preuves: "", objections: "", formats: [] });

export default function MotivationsCarte({ projectId, motivations, statut, formats, onChange, onReproposer, reproposeEnCours, verrouille }: Props) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState<Edition[] | null>(null);
  const envoi = useEnvoiSection(projectId, "motivations", onChange, () => setBrouillon(null));
  const maj = (i: number, p: Partial<Edition>) => setBrouillon((b) => b && b.map((m, j) => (j === i ? { ...m, ...p } : m)));

  return (
    <SectionCarte projectId={projectId} section="motivations" statut={statut} enEdition={!!brouillon}
      onModifier={() => setBrouillon(motivations.length ? motivations.map(versEdition) : [nouvelle()])}
      onChange={onChange} onReproposer={onReproposer} reproposeEnCours={reproposeEnCours} verrouille={verrouille}>
      {brouillon ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); envoi.mutate({ valeur: brouillon.map(depuisEdition) }); }}>
          {brouillon.map((m, i) => (
            <div key={i} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex gap-2">
                <Input className="h-8 text-xs" value={m.nom} placeholder={t("fondations.motivations.nom")} onChange={(e) => maj(i, { nom: e.target.value })} />
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label={t("fondations.actions.retirer")}
                  onClick={() => setBrouillon((b) => b && b.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Input className="h-8 text-xs" value={m.angle} placeholder={t("fondations.motivations.angle")} onChange={(e) => maj(i, { angle: e.target.value })} />
              <Textarea className="text-xs min-h-[50px]" value={m.description} placeholder={t("fondations.motivations.description")} onChange={(e) => maj(i, { description: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-3">
                {(["accroches", "preuves", "objections"] as const).map((champ) => (
                  <Textarea key={champ} className="text-xs min-h-[70px]" value={m[champ]}
                    placeholder={t(`fondations.motivations.${champ}`) + " — " + t("fondations.motivations.unParLigne")}
                    onChange={(e) => maj(i, { [champ]: e.target.value } as Partial<Edition>)} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {formats.map((f) => {
                  const actif = m.formats.includes(f);
                  return (
                    <button key={f} type="button"
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${actif ? "border-naya-salvia text-naya-salvia" : "border-border text-muted-foreground"}`}
                      onClick={() => maj(i, { formats: actif ? m.formats.filter((x) => x !== f) : [...m.formats, f] })}>
                      {t(`fondations.formats.${f}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {brouillon.length < MAX && (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setBrouillon((b) => [...(b || []), nouvelle()])}>
              <Plus className="w-3.5 h-3.5" />{t("fondations.motivations.ajouter")}
            </Button>
          )}
          <PiedEdition enCours={envoi.isPending} onAnnuler={() => setBrouillon(null)} desactive={!brouillon.some((m) => m.nom.trim())} />
        </form>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {motivations.map((m) => (
            <div key={m.cle} className="rounded-md border border-border p-3 space-y-1.5 text-xs">
              <p className="text-sm font-medium text-foreground">{m.nom}</p>
              {m.angle && <p className="text-foreground">{m.angle}</p>}
              {m.description && <p className="text-muted-foreground">{m.description}</p>}
              {(["accroches", "preuves", "objections"] as const).map((champ) => m[champ]?.length > 0 && (
                <div key={champ}>
                  <p className="text-[11px] font-medium text-muted-foreground">{t(`fondations.motivations.${champ}`)}</p>
                  <ul className="list-disc pl-4 text-foreground">{m[champ].map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ))}
              {m.formats.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {m.formats.map((f) => <span key={f} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{t(`fondations.formats.${f}`)}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCarte>
  );
}
