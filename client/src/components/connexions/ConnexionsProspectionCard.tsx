// Réglages de l'utilisatrice : ses propres connexions de prospection (LinkedIn et Gmail via
// Unipile). Les clients du mode agence ont les leurs, dans la page du projet.
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import LigneUnipile, { type EtatUnipile } from "./LigneUnipile";

export default function ConnexionsProspectionCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cleLi = "/api/prospection/linkedin/status";
  const cleGm = "/api/prospection/gmail/status";
  const li = useQuery<EtatUnipile>({ queryKey: [cleLi] });
  const gm = useQuery<EtatUnipile>({ queryKey: [cleGm] });
  const rafraichir = () => { qc.invalidateQueries({ queryKey: [cleLi] }); qc.invalidateQueries({ queryKey: [cleGm] }); };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Plug className="h-4 w-4" /> {t("connexions.prospection.titre")}</CardTitle>
        <CardDescription>{t("connexions.prospection.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {li.data && (
          <LigneUnipile
            kind="linkedin" etat={li.data} onChange={rafraichir}
            routes={{
              lien: "/api/prospection/linkedin/connect-link", sync: "/api/prospection/linkedin/sync",
              lever: "/api/prospection/linkedin/clear-restriction",
            }}
            aide={t("connexions.prospection.linkedinAide")} connecte={t("connexions.prospection.linkedinConnecte")}
          />
        )}
        {gm.data && (
          <LigneUnipile
            kind="gmail" etat={gm.data} onChange={rafraichir}
            routes={{ lien: "/api/prospection/gmail/connect-link", sync: "/api/prospection/gmail/sync", retirer: "/api/prospection/gmail" }}
            aide={t("connexions.prospection.gmailAide")} connecte={t("connexions.prospection.gmailConnecte")}
          />
        )}
      </CardContent>
    </Card>
  );
}
