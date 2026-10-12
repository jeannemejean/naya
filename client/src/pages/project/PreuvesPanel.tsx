// Bibliothèque de preuves du projet : les réalisations réelles où la prospection puise.
// Les propositions de Naya restent « proposées » tant que l'utilisatrice ne les valide pas ;
// une preuve non citable ne laisse jamais apparaître le nom du client dans un message.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Check, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ProjectProof } from "@shared/schema";
import { useCreateProof, usePatchProof, useProofs, useSuggestProofs } from "../outreach/useEcriture";

const formVide = () => ({ clientLabel: "", citable: false, whatWasDone: "", result: "", url: "", tags: "" });

export default function PreuvesPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: preuves = [] } = useProofs(projectId);
  const creer = useCreateProof(projectId);
  const patcher = usePatchProof(projectId);
  const suggerer = useSuggestProofs(projectId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(formVide());

  const visibles = preuves.filter((p) => p.status !== "archived");

  const enregistrer = () => {
    creer.mutate({
      clientLabel: form.clientLabel, citable: form.citable, whatWasDone: form.whatWasDone,
      result: form.result || null, url: form.url || null,
      tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean),
    }, {
      onSuccess: () => { setOpen(false); setForm(formVide()); toast({ title: t("ecriture.preuves.enregistree") }); },
      onError: () => toast({ title: t("ecriture.preuves.erreur"), variant: "destructive" }),
    });
  };

  const lancerSuggestion = () => {
    suggerer.mutate(undefined, {
      onSuccess: (r) => toast({ title: r.creees > 0 ? t("ecriture.preuves.suggestionOk", { count: r.creees }) : t("ecriture.preuves.suggestionVide") }),
      onError: () => toast({ title: t("ecriture.preuves.suggestionEchec"), variant: "destructive" }),
    });
  };

  const statut = (p: ProjectProof) =>
    p.status === "validated" ? t("ecriture.preuves.validee") : p.status === "proposed" ? t("ecriture.preuves.proposee") : t("ecriture.preuves.archivee");

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t("ecriture.preuves.titre")}</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">{t("ecriture.preuves.intro")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={suggerer.isPending} onClick={lancerSuggestion}>
            {suggerer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggerer.isPending ? t("ecriture.preuves.suggestion") : t("ecriture.preuves.suggerer")}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />{t("ecriture.preuves.ajouter")}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>{t("ecriture.preuves.ajouter")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">{t("ecriture.preuves.client")}</Label>
                  <Input value={form.clientLabel} onChange={(e) => setForm({ ...form, clientLabel: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground mt-1">{t("ecriture.preuves.clientAide")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.citable} onCheckedChange={(v) => setForm({ ...form, citable: v })} id="preuve-citable" />
                  <Label htmlFor="preuve-citable" className="text-xs">{t("ecriture.preuves.citable")}</Label>
                </div>
                <div>
                  <Label className="text-xs">{t("ecriture.preuves.fait")}</Label>
                  <Textarea rows={2} value={form.whatWasDone} onChange={(e) => setForm({ ...form, whatWasDone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t("ecriture.preuves.resultat")}</Label>
                  <Input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t("ecriture.preuves.lien")}</Label>
                  <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">{t("ecriture.preuves.sujets")}</Label>
                  <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                </div>
                <Button className="w-full" disabled={!form.clientLabel.trim() || !form.whatWasDone.trim() || creer.isPending} onClick={enregistrer}>
                  {t("common.save")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ecriture.preuves.vide")}</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((p) => (
            <li key={p.id} className="rounded-lg border border-naya-olive-18 p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{p.clientLabel}</span>
                  <Badge variant={p.status === "validated" ? "salvia" : "sulphur"}>{statut(p)}</Badge>
                  {!p.citable && <span className="text-[11px] text-muted-foreground">{t("ecriture.preuves.nonCitable")}</span>}
                </div>
                <p className="text-xs text-foreground/80">{p.whatWasDone}</p>
                {p.result && <p className="text-xs text-muted-foreground">{p.result}</p>}
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground break-all">{p.url}</a>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {p.status === "proposed" && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => patcher.mutate({ id: p.id, status: "validated" })}>
                    <Check className="w-3 h-3" />{t("ecriture.preuves.valider")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" aria-label={t("ecriture.preuves.archiver")} onClick={() => patcher.mutate({ id: p.id, status: "archived" })}>
                  <Archive className="w-3 h-3" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
