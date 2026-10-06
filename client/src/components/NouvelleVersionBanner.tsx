import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { nouvelleVersionDisponible, scriptPrincipal } from "@/lib/nouvelle-version";

// Vérifie toutes les 5 minutes, et à chaque retour sur l'onglet, si un autre build est en
// ligne. Voir client/src/lib/nouvelle-version.ts pour le pourquoi.
const INTERVALLE_MS = 5 * 60 * 1000;

export default function NouvelleVersionBanner() {
  const { t } = useTranslation();
  const [disponible, setDisponible] = useState(false);

  useEffect(() => {
    // Le bundle chargé par CET onglet, lu une fois au montage dans le HTML d'origine.
    const courant = scriptPrincipal(document.documentElement.innerHTML);
    if (!courant) return; // mode dev : rien à comparer

    let arrete = false;
    const verifier = async () => {
      try {
        const res = await fetch("/", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok || arrete) return;
        if (nouvelleVersionDisponible(courant, await res.text())) setDisponible(true);
      } catch {
        /* réseau indisponible : on réessaiera */
      }
    };
    const surRetour = () => { if (document.visibilityState === "visible") void verifier(); };

    const minuteur = setInterval(verifier, INTERVALLE_MS);
    document.addEventListener("visibilitychange", surRetour);
    return () => {
      arrete = true;
      clearInterval(minuteur);
      document.removeEventListener("visibilitychange", surRetour);
    };
  }, []);

  if (!disponible) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-3 bg-naya-olive px-4 py-2.5 text-sm text-naya-cream"
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <span>{t("common.newVersion")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-naya-cream px-3 py-1 text-xs font-semibold text-naya-olive hover:opacity-90"
      >
        {t("common.reloadApp")}
      </button>
    </div>
  );
}
