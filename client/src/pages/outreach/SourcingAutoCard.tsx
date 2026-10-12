// Carte « Sourcing automatique » d'une campagne : chaque matin, Naya cherche de nouveaux
// prospects selon l'objectif de la campagne (Bright Data) et en prépare quelques-uns à
// valider. Rien ne part sans validation.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import RoutineCard, { type RoutineDTO } from "@/components/routines/RoutineCard";

export default function SourcingAutoCard({ campaignId }: { campaignId: number }) {
  const { t } = useTranslation();
  const url = `/api/prospection/campaigns/${campaignId}/routine`;
  const { data } = useQuery<RoutineDTO>({ queryKey: [url] });
  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: [url] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
  };
  if (!data) return null;
  return (
    <RoutineCard
      id="sourcing-auto"
      donnees={data}
      url={url}
      onChange={rafraichir}
      textes={{
        titre: t("ecriture.sourcing.titre"), intro: t("ecriture.sourcing.intro"),
        lance: t("ecriture.sourcing.lance"), erreur: t("ecriture.sourcing.erreur"),
      }}
    />
  );
}
