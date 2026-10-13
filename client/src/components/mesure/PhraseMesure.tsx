// « Dis-moi tes chiffres » : la façon la plus simple de remplir la Mesure. Une phrase, Naya
// montre ce qu'elle a compris, on enregistre. Seuls les chiffres dits sont écrits (rien n'est
// effacé) ; un chiffre qu'elle n'a pas compris reste absent.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MessageSquareText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formater, libelleMois } from "./types";

type Apercu = { mois: string; champs: Record<string, unknown> };
const CHAMPS_EUROS = new Set(["ca", "caNouveaux", "coutsVariables"]);

const codeErreur = (e: unknown) => {
  const brut = String((e as any)?.message || "");
  return { code: brut.match(/"message":"([a-z_]+)"/)?.[1], raison: brut.match(/"raison":"([^"]+)"/)?.[1] };
};

export default function PhraseMesure({ projectId, onEnregistre }: { projectId: number; onEnregistre: () => void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [texte, setTexte] = useState("");
  const [apercu, setApercu] = useState<Apercu | null>(null);

  const comprendre = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mesure/${projectId}/phrase`, { texte }).then((r) => r.json() as Promise<Apercu>),
    onSuccess: setApercu,
    onError: (e) => {
      const { code, raison } = codeErreur(e);
      toast({ title: t(`mesure.phrase.erreurs.${code ?? "inconnue"}`, { defaultValue: t("mesure.phrase.erreurs.inconnue") }), description: raison, variant: "destructive" });
    },
  });
  const enregistrer = useMutation({
    mutationFn: (a: Apercu) => apiRequest("POST", `/api/mesure/${projectId}/mois/${a.mois}/completer`, a.champs),
    onSuccess: (_r, a) => {
      toast({ title: t("mesure.phrase.enregistre", { mois: libelleMois(a.mois, i18n.language) }) });
      setApercu(null); setTexte(""); onEnregistre();
    },
    onError: (e) => toast({ title: t(`mesure.erreurs.${codeErreur(e).code ?? "generique"}`, { defaultValue: t("mesure.erreurs.generique") }), variant: "destructive" }),
  });

  const lignes = apercu ? [
    ...Object.entries(apercu.champs).filter(([k]) => k !== "depenses").map(([k, v]) => ({
      libelle: t(`mesure.formulaire.${k}`),
      valeur: formater(Number(v), CHAMPS_EUROS.has(k) ? "euros" : "nombre", i18n.language),
    })),
    ...Object.entries((apercu.champs.depenses as Record<string, number>) ?? {}).map(([canal, v]) => ({
      libelle: `${t("mesure.phrase.depense")} · ${t(`mesure.canaux.${canal}`)}`,
      valeur: formater(v, "euros", i18n.language),
    })),
  ] : [];

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-naya-salvia" />{t("mesure.phrase.titre")}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("mesure.phrase.aide")}</p>
      </div>
      {!apercu ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (texte.trim()) comprendre.mutate(); }}>
          <Textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && texte.trim()) { e.preventDefault(); comprendre.mutate(); } }}
            placeholder={t("mesure.phrase.exemple")}
            maxLength={1000}
            rows={2}
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!texte.trim() || comprendre.isPending}>
              {comprendre.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}{t("mesure.phrase.comprendre")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">{t("mesure.phrase.compris", { mois: libelleMois(apercu.mois, i18n.language) })}</p>
          <ul className="text-sm space-y-1">
            {lignes.map((l) => (
              <li key={l.libelle} className="flex justify-between gap-4 border-b border-border/60 pb-1">
                <span className="text-muted-foreground">{l.libelle}</span><span className="tabular-nums font-medium">{l.valeur}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">{t("mesure.phrase.rienEfface")}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setApercu(null)}>{t("mesure.phrase.corriger")}</Button>
            <Button size="sm" disabled={enregistrer.isPending} onClick={() => enregistrer.mutate(apercu)}>
              {enregistrer.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}{t("mesure.actions.enregistrer")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
