// Réseaux sociaux d'un projet perso (« marques », comme Metricool) : chaque projet peut connecter
// ses propres comptes. Un réseau sans compte propre utilise celui des Réglages (affiché « hérité »).
// Les projets clients ont leurs connexions dans l'onglet Client (jamais de repli).
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const RESEAUX = [
  { id: "instagram", nom: "Instagram" },
  { id: "linkedin", nom: "LinkedIn" },
  { id: "tiktok", nom: "TikTok" },
] as const;

interface Statut { connected: boolean; etat: string; accountName?: string; configured: boolean; herite?: boolean }

export default function ReseauxProjetPanel({ projectId, nomProjet }: { projectId: number; nomProjet: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = `/api/social/status?projectId=${projectId}`;
  const { data, isLoading } = useQuery<Record<string, Statut>>({ queryKey: [cle], throwOnError: false });
  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: [cle] });
    qc.invalidateQueries({ queryKey: [`/api/social/accounts?projectId=${projectId}`] });
  };

  // Retour d'OAuth : ?social=…&status=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get("social");
    const st = params.get("status");
    if (!social || !st) return;
    if (st === "connected") toast({ title: t("reseauxProjet.connecte", { reseau: social, projet: nomProjet }) });
    else {
      const raison = params.get("reason");
      toast({
        title: t("connexions.reseaux.echec"),
        description: raison ? t(`reseauxProjet.raisons.${raison}`, { defaultValue: t(`connexions.reseaux.raisons.${raison}`, { defaultValue: raison }) }) : undefined,
        variant: "destructive",
      });
    }
    const url = new URL(window.location.href);
    ["social", "status", "reason"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
    rafraichir();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const erreur = () => toast({ title: t("connexions.erreur"), variant: "destructive" });
  const connecter = useMutation({
    mutationFn: async (reseau: string) => {
      const res = await fetch(`/api/social/oauth/${reseau}/url?projectId=${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      window.location.href = (await res.json()).url;
    },
    onError: erreur,
  });
  const deconnecter = useMutation({
    mutationFn: async (reseau: string) => {
      const res = await fetch(`/api/social/disconnect/${reseau}?projectId=${projectId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
    },
    onSuccess: rafraichir,
    onError: erreur,
  });

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><Share2 className="w-4 h-4" />{t("reseauxProjet.titre", { projet: nomProjet })}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("reseauxProjet.regle")}</p>
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <ul className="divide-y divide-border">
          {RESEAUX.map((r) => {
            const s = data?.[r.id];
            const propre = !!s?.accountName && !s.herite;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.nom}</p>
                  <p className="text-xs text-muted-foreground">
                    {!s?.configured ? t("connexions.reseaux.nonConfigure")
                      : propre ? (s!.etat === "expiree" ? t("connexions.reseaux.expire") : t("connexions.reseaux.compte", { compte: s!.accountName }))
                      : s?.herite ? t("reseauxProjet.herite", { compte: s.accountName })
                      : t("connexions.reseaux.absent")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s?.herite && <Badge variant="outline" className="text-[11px]">{t("reseauxProjet.badgeHerite")}</Badge>}
                  {s?.configured && (
                    <Button size="sm" variant={propre ? "outline" : "default"} disabled={connecter.isPending} onClick={() => connecter.mutate(r.id)}>
                      {propre ? t("reseauxProjet.reconnecter") : t("reseauxProjet.connecterPropre")}
                    </Button>
                  )}
                  {propre && (
                    <Button size="sm" variant="ghost" disabled={deconnecter.isPending} onClick={() => deconnecter.mutate(r.id)}>
                      {t("connexions.deconnecter")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">{t("reseauxProjet.astuce")}</p>
    </Card>
  );
}
