// La prochaine étape, en pilule de surface carte au bas de la photo. Jamais une tâche dont le
// créneau est passé (logique.ts) : en cours, à venir, ou sans heure.
import { useTranslation } from "react-i18next";
import type { MomentEtape, TacheAccueil } from "./logique";

export function PiluleEtape({ etape, restantes, onCommencer }: {
  etape: { tache: TacheAccueil; moment: MomentEtape } | null;
  /** Tâches passées non cochées, quand il ne reste plus rien à venir. */
  restantes: number;
  onCommencer: (t: TacheAccueil) => void;
}) {
  const { t } = useTranslation();

  if (!etape) {
    return (
      <div className="inline-flex min-h-[56px] max-w-[560px] items-center rounded-carte bg-card px-6 py-3 text-[16px] font-semibold leading-snug text-foreground shadow-cocon sm:rounded-full">
        {restantes > 0 ? t("accueil.etape.finieAvecReste", { count: restantes }) : t("accueil.etape.faite")}
      </div>
    );
  }

  const { tache, moment } = etape;
  const duree = tache.estimatedDuration ? t("accueil.etape.duree", { duree: tache.estimatedDuration }) : null;
  const libelle = moment === "maintenant"
    ? t("accueil.etape.maintenant")
    : moment === "ensuite" && tache.scheduledTime
      ? t("accueil.etape.aHeure", { heure: tache.scheduledTime })
      : t("accueil.etape.libelle");

  return (
    // Sous 640 px, le bouton passe sous le titre : le titre garde toute la largeur.
    // key : la suivante glisse à sa place quand l'étape change (200 ms, coupé sous reduced-motion).
    <div
      key={tache.id}
      className="flex w-full max-w-[600px] flex-col items-start gap-3 rounded-carte bg-card px-5 py-4 shadow-cocon animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none sm:flex-row sm:items-center sm:rounded-full sm:py-3 sm:pl-6 sm:pr-3"
    >
      <div className="w-full min-w-0 sm:flex-1">
        <p className="text-[13px] text-muted-foreground">{duree ? `${libelle} · ${duree}` : libelle}</p>
        <p className="truncate text-[17px] font-semibold text-foreground" title={tache.title}>{tache.title}</p>
      </div>
      <button
        type="button"
        onClick={() => onCommencer(tache)}
        className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-[16px] font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t(moment === "maintenant" ? "accueil.etape.continuer" : "accueil.etape.commencer")}
      </button>
    </div>
  );
}

export default PiluleEtape;
