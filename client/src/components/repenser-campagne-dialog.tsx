import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/fetchJson";
import {
  type ApercuRepenser,
  type EtatRepenser,
  REPENSER_CONSIGNE_MAX,
  cleErreurEtat,
  cleErreurPost,
  delaiDepasse,
  intervalleSuivi,
  resultatAcceptable,
  doitReprendreSuivi,
  suiviPerdu,
  clePlacementApercu,
} from "@/lib/repenser-campagne";

interface Props {
  campaignId: number;
  open: boolean;
  onClose: () => void;
}

// Monté en permanence (clé = campagne) : fermer la fenêtre n'arrête ni le travail serveur ni
// le suivi — le toast final arrive même fenêtre fermée.
export default function RepenserCampagneDialog({ campaignId, open, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [consigne, setConsigne] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [suivi, setSuivi] = useState(false);
  const [abandonne, setAbandonne] = useState(false);
  const debutSuivi = useRef(0);

  const cleEtat = ["/api/campaigns", campaignId, "repenser-etat"];

  const etatQuery = useQuery<EtatRepenser>({
    queryKey: cleEtat,
    queryFn: () => fetchJson(`/api/campaigns/${campaignId}/repenser-etat`),
    enabled: open || suivi,
    staleTime: 0,
    throwOnError: false,
    refetchInterval: (q) => (suivi || open ? intervalleSuivi(q.state.data?.etat, abandonne) : false),
  });
  const etat = etatQuery.data?.etat;

  const apercuQuery = useQuery<ApercuRepenser>({
    queryKey: ["/api/campaigns", campaignId, "repenser-apercu"],
    queryFn: () => fetchJson(`/api/campaigns/${campaignId}/repenser-apercu`),
    enabled: open && !suivi && etat !== "en_cours",
    staleTime: 0,
    throwOnError: false,
  });

  // Réouverture pendant qu'un travail tourne : l'état « en cours » est repris.
  useEffect(() => {
    if (doitReprendreSuivi({ open, suivi, abandonne, etat, enVol: etatQuery.isFetching })) {
      debutSuivi.current = Date.now();
      setSuivi(true);
    }
  }, [open, suivi, abandonne, etat, etatQuery.isFetching]);

  // Un abandon (délai dépassé) ne vaut que pour cette ouverture.
  useEffect(() => {
    if (!open) setAbandonne(false);
  }, [open]);

  // Résultat du travail suivi.
  useEffect(() => {
    if (!suivi || !etatQuery.data) return;
    const d = etatQuery.data;
    // Le registre est en mémoire : un redémarrage du serveur l'efface. « aucun » pendant le
    // suivi = travail perdu → on arrête de suivre et on prévient.
    if (suiviPerdu(suivi, d.etat)) {
      setSuivi(false);
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({
        title: t("campaigns.repenser.failTitle"),
        description: t("campaigns.repenser.erreurs.interrompu"),
        variant: "destructive",
      });
      return;
    }
    if ((d.etat === "termine" || d.etat === "echec") && !resultatAcceptable(d, debutSuivi.current)) return;
    if (d.etat === "termine") {
      setSuivi(false);
      setConsigne("");
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      const r = d.resultat;
      toast({
        title: t("campaigns.repenser.successTitle"),
        description: r ? t("campaigns.repenser.successCounts", { ...r }) : undefined,
      });
      onClose();
    } else if (d.etat === "echec") {
      setSuivi(false);
      toast({
        title: t("campaigns.repenser.failTitle"),
        description: t(`campaigns.repenser.erreurs.${cleErreurEtat(d.erreur)}`),
        variant: "destructive",
      });
      // Un échec « placement » a quand même modifié la campagne.
      if (d.erreur?.code === "placement_echoue") {
        queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      }
    } else if (d.etat === "en_cours" && delaiDepasse(debutSuivi.current, Date.now())) {
      setSuivi(false);
      setAbandonne(true);
      toast({
        title: t("campaigns.repenser.failTitle"),
        description: t("campaigns.repenser.erreurs.delai"),
        variant: "destructive",
      });
    }
  }, [suivi, etatQuery.data, etatQuery.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lancer() {
    if (envoi || suivi) return;
    setEnvoi(true);
    setAbandonne(false);
    const lanceMs = Date.now();
    try {
      await apiRequest("POST", `/api/campaigns/${campaignId}/repenser`, { consigne: consigne.trim() });
      // Une lecture d'état encore en vol (peut-être un ancien « terminé ») ne doit pas
      // écraser l'état posé ci-dessous ni déclencher un faux toast de succès.
      await queryClient.cancelQueries({ queryKey: cleEtat });
      // Écrase un éventuel « terminé » ancien pour ne pas le prendre pour le résultat de ce travail.
      queryClient.setQueryData<EtatRepenser>(cleEtat, { etat: "en_cours" });
      debutSuivi.current = lanceMs;
      setSuivi(true);
    } catch (err) {
      const cle = cleErreurPost(err);
      toast({
        title: t("campaigns.repenser.failTitle"),
        description: t(`campaigns.repenser.erreurs.${cle}`),
        variant: "destructive",
      });
      if (cle === "deja_en_cours") {
        queryClient.invalidateQueries({ queryKey: cleEtat });
      }
    } finally {
      setEnvoi(false);
    }
  }

  const attente = suivi || envoi;
  const apercu = apercuQuery.data;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-repenser-campagne">
        <DialogHeader>
          <DialogTitle className="text-base">{t("campaigns.repenser.title")}</DialogTitle>
        </DialogHeader>

        {attente ? (
          <div className="py-6 flex flex-col items-center gap-3 text-center" role="status" aria-live="polite" data-testid="repenser-attente">
            <Loader2 className="h-6 w-6 animate-spin text-naya-olive-55" />
            <p className="text-sm font-medium text-foreground">{t("campaigns.repenser.waiting")}</p>
            <p className="text-xs text-naya-olive-55">{t("campaigns.repenser.waitingHint")}</p>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-naya-olive-55">{t("campaigns.repenser.intro")}</p>

            {apercuQuery.isFetching && <p className="text-sm text-naya-olive-55">{t("campaigns.repenser.previewLoading")}</p>}
            {!apercuQuery.isFetching && apercuQuery.isError && (
              <p className="text-xs text-naya-olive-55">{t("campaigns.repenser.previewError")}</p>
            )}
            {!apercuQuery.isFetching && apercu && (
              <ul className="text-sm text-foreground space-y-1" data-testid="repenser-apercu">
                <li>{t("campaigns.repenser.previewPostsReplaced", { count: apercu.postsRemplaces })}</li>
                <li>{t("campaigns.repenser.previewPostsKept", { count: apercu.postsConserves })}</li>
                <li>{t("campaigns.repenser.previewTasksReplaced", { count: apercu.tachesRemplacees })}</li>
                <li>{t("campaigns.repenser.previewTasksKept", { count: apercu.tachesConservees })}</li>
                {clePlacementApercu(apercu.placement) && (
                  <li className="text-xs text-naya-olive-55 pt-1">{t(`campaigns.repenser.${clePlacementApercu(apercu.placement)}`)}</li>
                )}
              </ul>
            )}

            <div>
              <Label htmlFor="repenser-consigne" className="text-sm font-medium text-foreground mb-1.5 block">{t("campaigns.repenser.consigneLabel")}</Label>
              <Textarea
                id="repenser-consigne"
                aria-describedby="repenser-consigne-compteur"
                value={consigne}
                onChange={(e) => setConsigne(e.target.value.slice(0, REPENSER_CONSIGNE_MAX))}
                placeholder={t("campaigns.repenser.consignePlaceholder")}
                rows={4}
                maxLength={REPENSER_CONSIGNE_MAX}
                className="text-sm resize-none border-naya-olive-35"
              />
              <p id="repenser-consigne-compteur" className="text-[10px] text-naya-olive-35 text-right mt-1">
                {consigne.length}/{REPENSER_CONSIGNE_MAX}
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
            {attente ? t("campaigns.repenser.close") : t("common.cancel")}
          </Button>
          <Button size="sm" onClick={lancer} disabled={attente} className="flex-1" data-testid="button-repenser-confirmer">
            {attente ? t("campaigns.repenser.waiting") : t("campaigns.repenser.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
