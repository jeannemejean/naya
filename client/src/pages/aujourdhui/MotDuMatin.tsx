// Le mot du matin : le `greeting` du brief du jour. Jamais vide : la phrase de secours
// tient la place pendant le chargement, en cas d'erreur ou de brief sans mot.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatLocalDate } from "@/lib/dateUtils";
import type { MatinFil } from "@shared/fil";

export type Brief = { date?: string; content?: { greeting?: string } | null; fil?: MatinFil } | null;

export const CLE_BRIEF = ["/api/tasks/daily-brief"];
const CLE = CLE_BRIEF;
// Le `fil` du matin (fil conducteur, sous interrupteur) : lu par BlocMatinFil. Même préfixe que
// le brief, donc rafraîchi avec lui.
export const CLE_FIL_MATIN = ["/api/tasks/daily-brief", "fil"];

// Date (locale) du dernier POST tenté, au niveau du module : revenir sur « / » le même jour ne
// relance pas la génération (un appel IA), même si le brief est revenu vide (pause, onboarding).
let postTenteLe: string | null = null;

export function MotDuMatin({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isSuccess } = useQuery<Brief>({ queryKey: CLE, retry: false, throwOnError: false });
  useEffect(() => {
    const aujourdhui = formatLocalDate(new Date());
    if (!isSuccess || data?.content || postTenteLe === aujourdhui) return;
    postTenteLe = aujourdhui;
    apiRequest("POST", "/api/tasks/daily-brief", {})
      .then((r) => r.json())
      .then((reponse: Brief) => {
        // Le fil d'abord : BlocMatinFil s'active quand le brief a un texte, il trouve alors son
        // fil déjà là et ne refait pas de POST.
        if (reponse?.fil) qc.setQueryData(CLE_FIL_MATIN, reponse.fil);
        // Onboarding absent, planification en pause : pas de contenu, la phrase de secours reste.
        if (reponse?.content) qc.setQueryData(CLE, reponse);
      })
      .catch(() => {});
  }, [isSuccess, data, qc]);

  const mot = data?.content?.greeting?.trim() || t("accueil.motSecours");
  // 3 lignes : le serveur demande 140 caractères au plus (brief-saison.ts), ça tient sans « … ».
  return (
    <p className={cn("line-clamp-3 max-w-[42ch] text-[16px] leading-[1.6]", className)}>{mot}</p>
  );
}

export default MotDuMatin;
