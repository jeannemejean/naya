// Barre des actions groupées du calendrier : sur les posts cochés, décaler de n jours ou
// mettre à une date, dupliquer vers des marques, mettre à la corbeille. Les posts publiés ou
// en train de partir ne sont jamais déplacés ni supprimés : le serveur les signale.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Loader2, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Reponse { action: string; traites: number[]; ignores: Array<{ id: number; raison: string }>; crees?: unknown[] }

export default function ActionsGroupees({ ids, projets, onFini }: {
  ids: number[];
  projets: Array<{ id: number; name: string }>;
  onFini: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [jours, setJours] = useState("1");
  const [date, setDate] = useState("");
  const [cibles, setCibles] = useState<number[]>([]);

  const agir = useMutation({
    mutationFn: async (corps: Record<string, unknown>) =>
      (await apiRequest("POST", "/api/content/actions-groupees", { ids, ...corps })).json() as Promise<Reponse>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      const raisons = Array.from(new Set(r.ignores.map((i) => t(`gestionPost.groupe.raison.${i.raison}`, { defaultValue: i.raison }))));
      toast({
        title: r.action === "dupliquer"
          ? t("gestionPost.dupliquer.toast", { count: r.crees?.length ?? 0 })
          : t("gestionPost.groupe.resultat", { count: r.traites.length }),
        description: r.ignores.length ? t("gestionPost.groupe.ignores", { count: r.ignores.length, raisons: raisons.join(", ") }) : undefined,
      });
      setCibles([]);
      onFini();
    },
    onError: () => toast({ title: t("gestionPost.groupe.erreur"), variant: "destructive" }),
  });

  // Validation client (lot 8) : les posts des marques sans validation sont laissés (raison donnée).
  const envoyerValidation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/validation/envoyer", { ids })).json() as Promise<{ traites: number[]; ignores: Array<{ id: number; raison: string }> }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      const raisons = Array.from(new Set(r.ignores.map((i) => t(`validationClient.groupe.raison.${i.raison}`, { defaultValue: i.raison }))));
      toast({
        title: t("validationClient.groupe.resultat", { count: r.traites.length }),
        description: r.ignores.length ? t("validationClient.groupe.ignores", { count: r.ignores.length, raisons: raisons.join(", ") }) : undefined,
      });
      onFini();
    },
    onError: () => toast({ title: t("gestionPost.groupe.erreur"), variant: "destructive" }),
  });

  const n = Number(jours);
  const joursValides = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 366;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-naya-olive-18 bg-white" data-testid="actions-groupees">
      <span className="text-sm text-foreground">{t("gestionPost.groupe.selectionnes", { count: ids.length })}</span>
      {agir.isPending && <Loader2 className="h-4 w-4 animate-spin" />}

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={agir.isPending}><CalendarClock className="h-3.5 w-3.5 mr-1" />{t("gestionPost.groupe.deplacer")}</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-naya-olive-55">{t("gestionPost.groupe.decaler")}</p>
            <div className="flex items-center gap-2">
              <Input type="number" value={jours} onChange={(e) => setJours(e.target.value)} className="w-20" aria-label={t("gestionPost.groupe.jours")} />
              <span className="text-sm">{t("gestionPost.groupe.jours")}</span>
              <Button size="sm" disabled={!joursValides || agir.isPending} onClick={() => agir.mutate({ action: "deplacer", jours: n })}>{t("gestionPost.groupe.appliquer")}</Button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-naya-olive-55">{t("gestionPost.groupe.fixerDate")}</p>
            <div className="flex items-center gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("gestionPost.groupe.fixerDate")} />
              <Button size="sm" disabled={!date || agir.isPending} onClick={() => agir.mutate({ action: "deplacer", date })}>{t("gestionPost.groupe.appliquer")}</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={agir.isPending}><Copy className="h-3.5 w-3.5 mr-1" />{t("gestionPost.onglets.dupliquer")}</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2">
          <p className="text-xs text-naya-olive-55">{t("gestionPost.dupliquer.aide")}</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {projets.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={cibles.includes(p.id)} onCheckedChange={() => setCibles((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))} />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
          <Button size="sm" disabled={cibles.length === 0 || agir.isPending} onClick={() => agir.mutate({ action: "dupliquer", projectIds: cibles })}>
            {t("gestionPost.dupliquer.bouton", { count: cibles.length })}
          </Button>
        </PopoverContent>
      </Popover>

      <Button size="sm" variant="outline" disabled={agir.isPending || envoyerValidation.isPending} onClick={() => envoyerValidation.mutate()} data-testid="groupe-envoyer-validation">
        <Send className="h-3.5 w-3.5 mr-1" />{t("validationClient.groupe.envoyer")}
      </Button>

      <Button size="sm" variant="outline" disabled={agir.isPending} className="text-[#5c3d45] border-[rgba(158,126,135,0.35)]"
        onClick={() => { if (window.confirm(t("gestionPost.groupe.confirmerCorbeille", { count: ids.length }))) agir.mutate({ action: "supprimer" }); }}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />{t("gestionPost.groupe.supprimer")}
      </Button>

      <Button size="sm" variant="ghost" onClick={onFini} className="ml-auto" aria-label={t("gestionPost.groupe.deselectionner")} title={t("gestionPost.groupe.deselectionner")}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
