// Rapports d'un projet CLIENT (mode agence, spec 2026-10-13-rapports-client-design.md) : Naya
// prépare le rapport du mois, l'utilisatrice le relit et le corrige, puis le publie. Le client
// l'ouvre par un lien privé, sans compte ; le lien se coupe à tout moment. Rien ne part seul.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import RoutineCard from "@/components/routines/RoutineCard";

const SECTIONS = ["synthese", "realise", "resultats", "prochainesEtapes"] as const;
type Sections = Record<(typeof SECTIONS)[number], string>;
interface Rapport { mois: string; statut: "brouillon" | "publie"; sections: Sections; partageActif: boolean; lien: string | null; publieLe: string | null }
interface Donnees { rapports: Rapport[]; routine: any }

/** Le mois écoulé, à Paris (YYYY-MM). */
function moisEcoule(): string {
  const [a, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export default function RapportsClientPanel({ projectId }: { projectId: number }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = `/api/rapports/${projectId}`;
  const { data, isLoading } = useQuery<Donnees>({ queryKey: [cle] });
  const rafraichir = () => qc.invalidateQueries({ queryKey: [cle] });
  const [mois, setMois] = useState(moisEcoule());
  const [ouvert, setOuvert] = useState<string | null>(null);
  const libelle = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(i18n.language, { month: "long", year: "numeric" });

  const erreur = (e: any) => {
    const code = String(e?.message || "").match(/"message":"([a-z_]+)"/)?.[1];
    toast({ title: t(`rapports.erreurs.${code ?? "inconnue"}`, { defaultValue: t("rapports.erreurs.inconnue") }), variant: "destructive" });
  };
  const preparer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/preparer`, { mois }),
    onSuccess: () => { toast({ title: t("rapports.prepare") }); rafraichir(); setOuvert(mois); },
    onError: erreur,
  });
  const action = useMutation({
    mutationFn: ({ m, a }: { m: string; a: string }) =>
      a === "supprimer" ? apiRequest("DELETE", `${cle}/${m}`) : apiRequest("POST", `${cle}/${m}/${a}`),
    onSuccess: rafraichir,
    onError: erreur,
  });
  const copier = async (lien: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}${lien}`).catch(() => {});
    toast({ title: t("rapports.lienCopie") });
  };

  const rapportOuvert = data?.rapports.find((r) => r.mois === ouvert) ?? null;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-naya-salvia" />
          {t("rapports.titre")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{t("rapports.description")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">{t("rapports.mois")}</Label>
          <Input type="month" value={mois} max={moisEcoule()} onChange={(e) => setMois(e.target.value)} className="h-8 text-sm w-44" />
        </div>
        <Button size="sm" disabled={preparer.isPending || !mois} onClick={() => preparer.mutate()}>
          {preparer.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
          {t("rapports.preparer")}
        </Button>
      </div>

      {isLoading || !data ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : data.rapports.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t("rapports.aucun")}</p>
      ) : (
        <ul className="space-y-2">
          {data.rapports.map((r) => (
            <li key={r.mois} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <span className="text-sm font-medium capitalize min-w-36">{libelle(r.mois)}</span>
              <Badge variant="outline" className="text-[10px]">
                {r.statut === "publie" ? (r.partageActif ? t("rapports.statut.partage") : t("rapports.statut.coupe")) : t("rapports.statut.brouillon")}
              </Badge>
              <div className="flex flex-wrap gap-1 ml-auto">
                <Button size="sm" variant="ghost" onClick={() => setOuvert(r.mois)}>{t("rapports.ouvrir")}</Button>
                {r.statut === "brouillon" ? (
                  <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "publier" })}>{t("rapports.publier")}</Button>
                ) : (
                  <>
                    {r.partageActif && r.lien && <Button size="sm" variant="outline" onClick={() => copier(r.lien!)}>{t("rapports.copier")}</Button>}
                    {r.partageActif
                      ? <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "couper" })}>{t("rapports.couper")}</Button>
                      : <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "publier" })}>{t("rapports.repartager")}</Button>}
                    <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "nouveau-lien" })}>{t("rapports.nouveauLien")}</Button>
                    <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "depublier" })}>{t("rapports.brouillon")}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ m: r.mois, a: "supprimer" })}>{t("rapports.supprimer")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RoutineCard
        id={`rapport-client-${projectId}`}
        donnees={data?.routine ?? null}
        url={`${cle}/routine`}
        onChange={rafraichir}
        textes={{ titre: t("rapports.routine.titre"), intro: t("rapports.routine.intro"), lance: t("rapports.routine.lance"), erreur: t("rapports.routine.erreur") }}
      />

      <Dialog open={!!rapportOuvert} onOpenChange={(o) => !o && setOuvert(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {rapportOuvert && (
            <EditeurRapport
              key={rapportOuvert.mois}
              rapport={rapportOuvert}
              titre={libelle(rapportOuvert.mois)}
              url={`${cle}/${rapportOuvert.mois}`}
              onSaved={rafraichir}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EditeurRapport({ rapport, titre, url, onSaved }: { rapport: Rapport; titre: string; url: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [textes, setTextes] = useState<Sections>({ ...rapport.sections });
  const publie = rapport.statut === "publie";
  const enregistrer = useMutation({
    mutationFn: () => apiRequest("PATCH", url, { sections: textes }),
    onSuccess: () => { toast({ title: t("rapports.enregistre") }); onSaved(); },
    onError: () => toast({ title: t("rapports.erreurs.inconnue"), variant: "destructive" }),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle className="capitalize">{titre}</DialogTitle>
      </DialogHeader>
      {publie && <p className="text-xs text-muted-foreground">{t("rapports.publieLectureSeule")}</p>}
      <div className="space-y-3">
        {SECTIONS.map((k) => (
          <div key={k}>
            <Label className="text-xs">{t(`rapports.sections.${k}`)}</Label>
            <Textarea
              value={textes[k] ?? ""}
              disabled={publie}
              maxLength={2000}
              rows={4}
              onChange={(e) => setTextes((s) => ({ ...s, [k]: e.target.value }))}
              className="text-sm"
            />
          </div>
        ))}
      </div>
      {!publie && (
        <Button size="sm" disabled={enregistrer.isPending} onClick={() => enregistrer.mutate()}>{t("rapports.enregistrer")}</Button>
      )}
    </>
  );
}
