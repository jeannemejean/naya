import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { resolveLanguage } from "@shared/language";

/**
 * Aligne la langue de l'interface sur celle du compte dès que /api/auth/user répond.
 * Le compte fait autorité : il gagne toujours contre le cache du navigateur.
 * À monter UNE SEULE FOIS, à la racine de l'application.
 */
export function useLanguageSync(): void {
  const { i18n } = useTranslation();
  const { language } = useAuth();

  useEffect(() => {
    if (!language) return; // pas encore connecté, ou réponse pas encore arrivée
    const cible = resolveLanguage({ account: language });
    if (cible !== i18n.language) {
      void i18n.changeLanguage(cible);
    }
  }, [language, i18n]);

  // Garde l'attribut lang du document ET le titre de l'onglet alignés sur la langue
  // active de i18next, y compris pour un visiteur non connecté qui bascule la langue
  // sur la landing. Ne dépend que de `i18n` (référence stable) — jamais de
  // `i18n.language` — pour éviter toute boucle de rendu ; on s'abonne une fois à
  // l'événement "languageChanged" et on nettoie l'écouteur au démontage.
  // On utilise `i18n.t` directement (pas un `t` capturé) pour ne jamais résoudre
  // le titre avec une langue périmée dans cet écouteur.
  useEffect(() => {
    const appliquer = (langue: string) => {
      document.documentElement.lang = langue;
      document.title = i18n.t("app.documentTitle");
    };
    appliquer(i18n.language);
    i18n.on("languageChanged", appliquer);
    return () => {
      i18n.off("languageChanged", appliquer);
    };
  }, [i18n]);
}
