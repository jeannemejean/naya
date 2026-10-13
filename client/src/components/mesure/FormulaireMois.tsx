// Saisie d'un mois du registre. Les ventes déjà déclarées dans « Conversions » peuvent
// pré-remplir le chiffre d'affaires : proposé, jamais écrit seul.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { corpsErreur, formater, type Mois } from "./types";

type Champs = { ca: string; caNouveaux: string; nouveauxClients: string; commandes: string; coutsVariables: string; depenses: Record<string, string> };
const CHAMPS = ["ca", "caNouveaux", "nouveauxClients", "commandes", "coutsVariables"] as const;
const texte = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Le serveur juge le « mois futur » en UTC : le sélecteur est borné pareil. */
function moisMax() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function moisCourant() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function FormulaireMois({
  projectId, initial, canaux, onFini,
}: { projectId: number; initial: Mois | null; canaux: Array<{ cle: string; acquisition: boolean }>; onFini: (enregistre: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [mois, setMois] = useState(initial?.mois ?? moisCourant());
  const [c, setC] = useState<Champs>(() => ({
    ca: texte(initial?.ca), caNouveaux: texte(initial?.caNouveaux), nouveauxClients: texte(initial?.nouveauxClients),
    commandes: texte(initial?.commandes), coutsVariables: texte(initial?.coutsVariables),
    depenses: Object.fromEntries(canaux.map((k) => [k.cle, texte(initial?.depenses?.[k.cle])])),
  }));
  const [suggestion, setSuggestion] = useState<{ ventes: number; ca: number; valeursManquantes: number } | null | undefined>(undefined);

  const enregistrer = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/mesure/${projectId}/mois/${mois}`, {
      ...Object.fromEntries(CHAMPS.map((k) => [k, c[k]])),
      depenses: Object.fromEntries(Object.entries(c.depenses).filter(([, v]) => v.trim())),
    }).then((r) => r.json()),
    onSuccess: () => { toast({ title: t("mesure.formulaire.enregistre") }); onFini(true); },
    onError: (e) => {
      const m = corpsErreur(e).message || "";
      const cle = ["mois_vide", "mois_invalide", "ca_nouveaux_superieur"].includes(m) ? m : "valeur";
      toast({ title: t(`mesure.erreurs.${cle}`), variant: "destructive" });
    },
  });
  const chercher = useMutation({
    mutationFn: () => apiRequest("GET", `/api/mesure/${projectId}/suggestion?mois=${mois}`).then((r) => r.json()),
    onSuccess: (r: { suggestion: typeof suggestion }) => setSuggestion(r.suggestion),
  });

  const champ = (k: (typeof CHAMPS)[number]) => (
    <label key={k} className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{t(`mesure.formulaire.${k}`)}</span>
      <Input className="h-8 text-xs" inputMode="decimal" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </label>
  );

  return (
    <Card className="p-4">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enregistrer.mutate(); }}>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">{t("mesure.formulaire.mois")}</span>
            <Input type="month" className="h-8 text-xs w-40" max={moisMax()} value={mois} disabled={!!initial} onChange={(e) => { setMois(e.target.value); setSuggestion(undefined); }} />
          </label>
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={!mois || chercher.isPending} onClick={() => chercher.mutate()}>
            {chercher.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t("mesure.formulaire.chercherVentes")}
          </Button>
        </div>
        {suggestion === null && <p className="text-[11px] text-muted-foreground">{t("mesure.formulaire.aucuneVente")}</p>}
        {suggestion && (
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-border px-3 py-2 text-xs">
            <span className="text-foreground">
              {t("mesure.formulaire.ventesTrouvees", { count: suggestion.ventes, ca: formater(suggestion.ca, "euros", i18n.language) })}
              {suggestion.valeursManquantes > 0 && ` ${t("mesure.formulaire.valeursManquantes", { count: suggestion.valeursManquantes })}`}
            </span>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs ml-auto"
              onClick={() => setC({ ...c, ca: String(suggestion.ca), commandes: String(suggestion.ventes) })}>
              {t("mesure.formulaire.reprendre")}
            </Button>
          </div>
        )}
        <div className="grid gap-2 grid-cols-2 md:grid-cols-5">{CHAMPS.map(champ)}</div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{t("mesure.formulaire.depenses")}</p>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
            {canaux.map((k) => (
              <label key={k.cle} className="space-y-1">
                <span className="text-[11px] text-muted-foreground">
                  {t(`mesure.canaux.${k.cle}`)}{!k.acquisition && <span className="opacity-70"> · {t("mesure.formulaire.horsAcquisition")}</span>}
                </span>
                <Input className="h-8 text-xs" inputMode="decimal" value={c.depenses[k.cle] ?? ""}
                  onChange={(e) => setC({ ...c, depenses: { ...c.depenses, [k.cle]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("mesure.formulaire.aide")}</p>
        <div className="flex gap-2 justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onFini(false)}>{t("mesure.actions.annuler")}</Button>
          <Button type="submit" size="sm" className="h-8 text-xs gap-1" disabled={!mois || enregistrer.isPending}>
            {enregistrer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t("mesure.actions.enregistrer")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
