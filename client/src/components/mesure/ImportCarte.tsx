// Import du registre : un CSV ou un copier-coller depuis un tableur. Aperçu d'abord, rien
// n'est écrit avant la confirmation ; les mois importés remplacent ceux déjà saisis.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formater, libelleMois } from "./types";

type Apercu = { lignes: Array<{ mois: string; valeur: { ca: number | null; nouveauxClients: number | null; commandes: number | null; depenses: Record<string, number> } }>; erreurs: Array<{ ligne: number; message: string }>; inconnues: string[] };

export default function ImportCarte({ projectId, onFini }: { projectId: number; onFini: (importe: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [texte, setTexte] = useState("");
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const envoyer = useMutation({
    mutationFn: (confirmer: boolean) => apiRequest("POST", `/api/mesure/${projectId}/import`, { texte, confirmer }).then((r) => r.json()),
    onSuccess: (r: any, confirmer) => {
      if (!confirmer) { setApercu(r); return; }
      toast({ title: t("mesure.import.ok", { count: r.ecrits }) });
      onFini(true);
    },
    onError: () => toast({ title: t("mesure.erreurs.import"), variant: "destructive" }),
  });
  const lireFichier = async (f: File | undefined) => {
    if (!f) return;
    setTexte(await f.text());
    setApercu(null);
  };
  const somme = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("mesure.import.titre")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("mesure.import.aide")}</p>
        <p className="text-[11px] font-mono text-muted-foreground mt-1">{t("mesure.import.exemple")}</p>
      </div>
      <Textarea className="text-xs font-mono min-h-[110px]" value={texte} placeholder={t("mesure.import.coller")}
        onChange={(e) => { setTexte(e.target.value); setApercu(null); }} />
      <div className="flex gap-2 flex-wrap items-center">
        <label className="inline-flex items-center gap-1 text-xs text-naya-salvia cursor-pointer">
          <Upload className="w-3.5 h-3.5" />{t("mesure.import.fichier")}
          <input type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => lireFichier(e.target.files?.[0])} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onFini(false)}>{t("mesure.actions.annuler")}</Button>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!texte.trim() || envoyer.isPending} onClick={() => envoyer.mutate(false)}>
            {t("mesure.import.apercu")}
          </Button>
        </div>
      </div>
      {apercu && (
        <div className="space-y-2 text-xs">
          {apercu.lignes.length > 0 && (
            <ul className="space-y-0.5">
              {apercu.lignes.map((l) => (
                <li key={l.mois} className="flex gap-3 text-foreground">
                  <span className="w-32">{libelleMois(l.mois, i18n.language)}</span>
                  <span>{t("mesure.import.ligne", {
                    ca: formater(l.valeur.ca, "euros", i18n.language) ?? "—",
                    clients: l.valeur.nouveauxClients ?? "—",
                    commandes: l.valeur.commandes ?? "—",
                    depense: Object.keys(l.valeur.depenses).length ? formater(somme(l.valeur.depenses), "euros", i18n.language) : "—",
                  })}</span>
                </li>
              ))}
            </ul>
          )}
          {apercu.erreurs.map((e) => (
            <p key={e.ligne} className="text-naya-mauve">{t("mesure.import.erreurLigne", { ligne: e.ligne, message: t(`mesure.import.erreurs.${e.message}`, { defaultValue: e.message }) })}</p>
          ))}
          {apercu.inconnues.length > 0 && <p className="text-muted-foreground">{t("mesure.import.inconnues", { colonnes: apercu.inconnues.join(", ") })}</p>}
          <Button type="button" size="sm" className="h-8 text-xs gap-1" disabled={!apercu.lignes.length || envoyer.isPending} onClick={() => envoyer.mutate(true)}>
            {envoyer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t("mesure.import.confirmer", { count: apercu.lignes.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}
