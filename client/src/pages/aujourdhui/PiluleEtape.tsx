// La prochaine étape, en pilule de surface carte au bas de la photo.
import { useTranslation } from "react-i18next";
import type { TacheAccueil } from "./logique";

export function PiluleEtape({ etape, onCommencer }: {
  etape: TacheAccueil | null;
  onCommencer: (t: TacheAccueil) => void;
}) {
  const { t } = useTranslation();

  if (!etape) {
    return (
      <div className="inline-flex min-h-[56px] items-center rounded-full bg-card px-6 text-[16px] font-semibold text-foreground shadow-cocon">
        {t("accueil.etape.faite")}
      </div>
    );
  }

  const libelle = etape.estimatedDuration
    ? t("accueil.etape.libelleDuree", { duree: etape.estimatedDuration })
    : t("accueil.etape.libelle");

  return (
    // Sous 640 px, le bouton passe sous le titre : le titre garde toute la largeur.
    // key : la suivante glisse à sa place quand l'étape change (200 ms, coupé sous reduced-motion).
    <div
      key={etape.id}
      className="flex w-full max-w-[560px] flex-col items-start gap-3 rounded-carte bg-card px-5 py-4 shadow-cocon animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none sm:flex-row sm:items-center sm:rounded-full sm:py-3 sm:pl-6 sm:pr-3"
    >
      <div className="w-full min-w-0 sm:flex-1">
        <p className="text-[13px] text-muted-foreground">{libelle}</p>
        <p className="truncate text-[17px] font-semibold text-foreground" title={etape.title}>{etape.title}</p>
      </div>
      <button
        type="button"
        onClick={() => onCommencer(etape)}
        className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-[16px] font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t("accueil.etape.commencer")}
      </button>
    </div>
  );
}

export default PiluleEtape;
