// Envois aux marques d'un projet (séance de redémarrage) : à qui on a présenté quoi, quand relancer.
// Créés depuis le chat ; ici on suit le statut et la date de relance.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { STATUTS_ENVOI } from "@shared/envois";
import type { Envoi } from "@shared/schema";

const dateCourte = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export default function EnvoisPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = `/api/envois?projectId=${projectId}`;
  const { data: envois = [] } = useQuery<Envoi[]>({ queryKey: [cle], throwOnError: false });
  const maj = useMutation({
    mutationFn: async ({ id, champs }: { id: number; champs: Record<string, unknown> }) =>
      (await apiRequest("PATCH", `/api/envois/${id}`, champs)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: [cle] }),
    onError: () => toast({ title: t("envois.erreur"), variant: "destructive" }),
  });

  if (envois.length === 0) return null;

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <p className="text-xs font-medium text-foreground">{t("envois.titre")}</p>
      <ul className="space-y-2">
        {envois.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs text-naya-olive-70">
            <Send className="w-3 h-3 text-naya-olive-55 flex-shrink-0" />
            <span className="flex-1 min-w-0 truncate">
              <strong className="font-medium text-foreground">{e.marque}</strong>
              {" · "}{e.objet}
              {" · "}{t("envois.envoyeLe", { date: dateCourte(e.envoyeLe) })}
            </span>
            <select
              aria-label={t("envois.titre")}
              value={e.statut}
              disabled={maj.isPending}
              onChange={(ev) => maj.mutate({ id: e.id, champs: { statut: ev.target.value } })}
              className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
            >
              {STATUTS_ENVOI.map((s) => <option key={s} value={s}>{t(`envois.statuts.${s}`)}</option>)}
            </select>
            <input
              type="date"
              aria-label={t("envois.changerRelance")}
              title={e.prochaineRelance ? t("envois.relanceLe", { date: dateCourte(e.prochaineRelance) }) : t("envois.sansRelance")}
              value={e.prochaineRelance ?? ""}
              disabled={maj.isPending}
              onChange={(ev) => maj.mutate({ id: e.id, champs: { prochaineRelance: ev.target.value || null } })}
              className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
