// L'offre d'entrée : ce qui fait passer un inconnu à l'achat avec un risque perçu faible.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import SectionCarte, { PiedEdition, useEnvoiSection } from "./SectionCarte";
import type { Offre, Statut } from "./types";

type Props = { projectId: number; offre: Offre | null; statut: Statut; onChange: () => void; onReproposer: () => void; reproposeEnCours: boolean };

export default function OffreCarte({ projectId, offre, statut, onChange, onReproposer, reproposeEnCours }: Props) {
  const { t } = useTranslation();
  const [brouillon, setBrouillon] = useState<Offre | null>(null);
  const envoi = useEnvoiSection(projectId, "offre", onChange, () => setBrouillon(null));
  const vide: Offre = { nom: "", description: "", pourquoi: "", existe: false };
  const maj = (p: Partial<Offre>) => setBrouillon((b) => ({ ...(b || vide), ...p }));

  return (
    <SectionCarte projectId={projectId} section="offre" statut={statut} enEdition={!!brouillon}
      onModifier={() => setBrouillon(offre || vide)} onChange={onChange} onReproposer={onReproposer} reproposeEnCours={reproposeEnCours}>
      {brouillon ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); envoi.mutate({ valeur: brouillon }); }}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input className="h-8 text-xs sm:col-span-2" value={brouillon.nom} placeholder={t("fondations.offre.nom")} onChange={(e) => maj({ nom: e.target.value })} />
            <Input className="h-8 text-xs" value={brouillon.prix || ""} placeholder={t("fondations.offre.prix")} onChange={(e) => maj({ prix: e.target.value })} />
          </div>
          <Textarea className="text-xs min-h-[60px]" value={brouillon.description} placeholder={t("fondations.offre.description")} onChange={(e) => maj({ description: e.target.value })} />
          <Textarea className="text-xs min-h-[60px]" value={brouillon.pourquoi} placeholder={t("fondations.offre.pourquoi")} onChange={(e) => maj({ pourquoi: e.target.value })} />
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={brouillon.existe} onChange={(e) => maj({ existe: e.target.checked })} />
            {t("fondations.offre.existe")}
          </label>
          <PiedEdition enCours={envoi.isPending} onAnnuler={() => setBrouillon(null)} desactive={!brouillon.nom.trim()} />
        </form>
      ) : offre && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{offre.nom}</span>
            {offre.prix && <span className="text-muted-foreground">{offre.prix}</span>}
            <Badge variant="outline" className="text-[10px]">{t(offre.existe ? "fondations.offre.dejaLa" : "fondations.offre.aCreer")}</Badge>
          </div>
          {offre.description && <p className="text-foreground">{offre.description}</p>}
          {offre.pourquoi && <p className="text-muted-foreground"><span className="font-medium">{t("fondations.offre.pourquoiCourt")}</span> {offre.pourquoi}</p>}
        </div>
      )}
    </SectionCarte>
  );
}
