// « Ce que Naya apprend de toi » : les règles d'écriture tirées des corrections (proposées,
// jamais appliquées sans accord), les messages collés qui ont marché, et un rappel quand la
// bibliothèque de preuves est trop maigre pour prospecter avec du concret.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ROLES_TOUCHE, useAddExampleMessage, useExampleMessages, useLearnedRules, usePatchLearnedRule, useProofs,
  type RoleTouche,
} from "./useEcriture";

export default function ApprentissagePanel({ projectId }: { projectId: number | null | undefined }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: regles = [] } = useLearnedRules(projectId);
  const { data: exemples = [] } = useExampleMessages(projectId);
  const { data: preuves } = useProofs(projectId);
  const patch = usePatchLearnedRule(projectId ?? 0);
  const ajouter = useAddExampleMessage(projectId ?? 0);
  const [role, setRole] = useState<RoleTouche>("premier_message");
  const [texte, setTexte] = useState("");

  if (!projectId) return null;
  const nbPreuves = (preuves ?? []).filter((p) => p.status === "validated").length;
  const erreur = () => toast({ title: t("ecriture.apprentissage.erreur"), variant: "destructive" });
  const visibles = regles.filter((r) => r.statut !== "refusee");

  return (
    <Card className="p-4 space-y-4">
      {preuves && nbPreuves < 2 && (
        <p className="text-xs rounded-md border border-naya-sulphur/40 bg-naya-sulphur/10 px-3 py-2 text-foreground">
          {t("ecriture.apprentissage.preuvesManquantes")}
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("ecriture.apprentissage.titre")}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t("ecriture.apprentissage.intro")}</p>
      </div>

      {visibles.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("ecriture.apprentissage.aucuneRegle")}</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-md border border-naya-olive-18 px-3 py-2">
              <div className="min-w-0 space-y-1">
                <Badge variant={r.statut === "acceptee" ? "salvia" : "sulphur"}>
                  {r.statut === "acceptee" ? t("ecriture.apprentissage.acceptee") : t("ecriture.apprentissage.proposee")}
                </Badge>
                <p className="text-xs text-foreground">{r.texte}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {r.statut !== "acceptee" && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={patch.isPending}
                    onClick={() => patch.mutate({ id: r.id, statut: "acceptee" }, { onError: erreur })}>
                    <Check className="w-3 h-3" />{t("ecriture.apprentissage.accepter")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={patch.isPending}
                  onClick={() => patch.mutate({ id: r.id, statut: "refusee" }, { onError: erreur })}>
                  <X className="w-3 h-3" />{t("ecriture.apprentissage.refuser")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-naya-olive-18 pt-3">
        <h4 className="text-xs font-semibold text-foreground">{t("ecriture.apprentissage.exemplesTitre")}</h4>
        <p className="text-xs text-muted-foreground">{t("ecriture.apprentissage.exemplesIntro")}</p>
        {exemples.length > 0 && (
          <ul className="space-y-1.5">
            {exemples.slice(0, 5).map((e) => (
              <li key={e.id} className="text-xs text-foreground/80 rounded-md bg-naya-olive-06 px-3 py-2 whitespace-pre-wrap">
                <span className="text-muted-foreground">{t(`ecriture.messages.roles.${e.role}`)} · </span>{e.final}
              </li>
            ))}
          </ul>
        )}
        <Select value={role} onValueChange={(v) => setRole(v as RoleTouche)}>
          <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder={t("ecriture.apprentissage.role")} /></SelectTrigger>
          <SelectContent>
            {ROLES_TOUCHE.map((r) => <SelectItem key={r} value={r}>{t(`ecriture.messages.roles.${r}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Textarea rows={4} className="text-sm" placeholder={t("ecriture.apprentissage.coller")} value={texte} onChange={(e) => setTexte(e.target.value)} />
        <Button size="sm" className="h-8 text-xs" disabled={!texte.trim() || ajouter.isPending}
          onClick={() => ajouter.mutate({ role, body: texte }, {
            onSuccess: () => { setTexte(""); toast({ title: t("ecriture.apprentissage.exempleAjoute") }); },
            onError: erreur,
          })}>
          {ajouter.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}{t("ecriture.apprentissage.ajouterExemple")}
        </Button>
      </div>
    </Card>
  );
}
