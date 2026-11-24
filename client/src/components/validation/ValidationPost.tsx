// Validation client d'un post (lot 8) : statut, « Envoyer en validation », « Enregistrer sans
// validation » et ce que les relecteurs en ont dit. Dans la fenêtre du post du calendrier et
// dans l'éditeur de l'atelier. Le badge sert aussi aux tuiles du calendrier.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Clock, Loader2, Send, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export type StatutValidation = "a_valider" | "validee" | "refusee";
interface Decision { id: number; relecteur: string; decision: "validee" | "refusee" | "commentaire"; commentaire: string | null; le: string }
interface EtatValidation { actif: boolean; regle: "un" | "tous" | null; statut: StatutValidation | null; demandeLe: string | null; decisions: Decision[] }

const STYLES: Record<StatutValidation, string> = {
  a_valider: "bg-amber-50 text-amber-800 border-amber-200",
  validee: "bg-emerald-50 text-emerald-800 border-emerald-200",
  refusee: "bg-rose-50 text-rose-800 border-rose-200",
};
const ICONES = { a_valider: Clock, validee: CheckCircle2, refusee: XCircle };

/** Petit badge du statut de validation (tuiles du calendrier, listes). */
export function BadgeValidation({ statut, compact = false }: { statut: string | null | undefined; compact?: boolean }) {
  const { t } = useTranslation();
  if (statut !== "a_valider" && statut !== "validee" && statut !== "refusee") return null;
  const Icone = ICONES[statut];
  const libelle = t(`validationClient.statut.${statut}`);
  return (
    <span className={`inline-flex items-center gap-0.5 rounded border px-1 text-[10px] leading-4 ${STYLES[statut]}`} title={libelle} aria-label={libelle}
      data-testid={`badge-validation-${statut}`}>
      <Icone className="h-2.5 w-2.5" />{compact ? null : libelle}
    </span>
  );
}

/** Avant de valider ou programmer un post pas encore validé par le client : prévenir, sans bloquer. */
export function confirmerMalgreValidation(statut: string | null | undefined, message: string): boolean {
  if (statut !== "a_valider" && statut !== "refusee") return true;
  return window.confirm(message);
}

export function useEtatValidation(postId: number | null | undefined) {
  return useQuery<EtatValidation>({
    queryKey: ["/api/validation/posts", postId],
    queryFn: async () => (await apiRequest("GET", `/api/validation/posts/${postId}`)).json(),
    enabled: !!postId,
    throwOnError: false,
  });
}

export default function ValidationPost({ postId }: { postId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useEtatValidation(postId);

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: ["/api/validation/posts", postId] });
    qc.invalidateQueries({ queryKey: ["/api/content"] });
    qc.invalidateQueries({ queryKey: ["/api/content", postId, "historique"] });
  };
  const envoyer = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/validation/envoyer", { ids: [postId] })).json() as Promise<{ traites: number[] }>,
    onSuccess: (r) => {
      rafraichir();
      toast({ title: r.traites.length ? t("validationClient.post.envoye") : t("validationClient.post.inactif") });
    },
    onError: () => toast({ title: t("validationClient.erreur"), variant: "destructive" }),
  });
  const retirer = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/validation/posts/${postId}`)).json(),
    onSuccess: rafraichir,
    onError: () => toast({ title: t("validationClient.erreur"), variant: "destructive" }),
  });

  if (isLoading || !data) return null;
  if (!data.actif && !data.statut) {
    return <p className="text-[11px] text-naya-olive-35" data-testid="validation-post-inactif">{t("validationClient.post.inactif")}</p>;
  }
  const occupe = envoyer.isPending || retirer.isPending;

  return (
    <div className="border border-naya-olive-18 rounded-lg p-3 space-y-2" data-testid="validation-post">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-naya-olive-55" />
        <span className="text-sm font-medium">{t("validationClient.titre")}</span>
        <BadgeValidation statut={data.statut} />
        {occupe && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <div className="ml-auto flex gap-2">
          {data.actif && (
            <Button size="sm" variant="outline" type="button" disabled={occupe} onClick={() => envoyer.mutate()} data-testid="bouton-envoyer-validation">
              <Send className="h-3.5 w-3.5 mr-1" />{data.statut ? t("validationClient.post.renvoyer") : t("validationClient.post.envoyer")}
            </Button>
          )}
          {data.statut && (
            <Button size="sm" variant="ghost" type="button" disabled={occupe}
              onClick={() => { if (window.confirm(t("validationClient.post.retirerConfirmer"))) retirer.mutate(); }}>
              {t("validationClient.post.retirer")}
            </Button>
          )}
        </div>
      </div>
      {(data.statut === "a_valider" || data.statut === "refusee") && (
        <p className="text-[11px] text-naya-olive-55">{t("validationClient.post.bloque")} {t("validationClient.post.relance")}</p>
      )}
      {data.decisions.length > 0 && (
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {data.decisions.map((d) => (
            <li key={d.id} className="text-xs bg-naya-olive-06 rounded p-2">
              <span className="font-medium">{t(`validationClient.decision.${d.decision}`, { nom: d.relecteur })}</span>
              <span className="text-[10px] text-naya-olive-35 ml-2">{format(new Date(d.le), "dd/MM/yyyy HH:mm")}</span>
              {d.commentaire && <p className="whitespace-pre-wrap break-words mt-0.5">{d.commentaire}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
