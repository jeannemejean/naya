// Le mot du matin : le `greeting` du brief du jour. Jamais vide : la phrase de secours
// tient la place pendant le chargement, en cas d'erreur ou de brief sans mot.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type Brief = { date?: string; content?: { greeting?: string } | null } | null;

const CLE = ["/api/tasks/daily-brief"];

export function MotDuMatin({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isSuccess } = useQuery<Brief>({ queryKey: CLE, retry: false, throwOnError: false });
  // Un seul POST par montage : la génération coûte un appel IA.
  const demande = useRef(false);

  useEffect(() => {
    if (!isSuccess || data?.content || demande.current) return;
    demande.current = true;
    apiRequest("POST", "/api/tasks/daily-brief", {})
      .then((r) => r.json())
      .then((reponse: Brief) => {
        // Onboarding absent, planification en pause : pas de contenu, la phrase de secours reste.
        if (reponse?.content) qc.setQueryData(CLE, reponse);
      })
      .catch(() => {});
  }, [isSuccess, data, qc]);

  const mot = data?.content?.greeting?.trim() || t("accueil.motSecours");
  return (
    <p className={cn("line-clamp-2 max-w-[42ch] text-[16px] leading-[1.6]", className)}>{mot}</p>
  );
}

export default MotDuMatin;
