import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { normalizeLanguage, DEFAULT_LANGUAGE, type Language } from "@shared/language";

/**
 * Unique chemin d'écriture de la langue : bascule l'interface ET enregistre sur le compte.
 * Tout sélecteur de langue d'un écran authentifié DOIT passer par ce hook.
 */
export function useLanguageToggle() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const current = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;

  const enregistrer = useMutation({
    mutationFn: (lang: Language) =>
      apiRequest("PATCH", "/api/preferences", { language: lang }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      // /api/auth/user porte aussi la langue : sans cette invalidation, useLanguageSync
      // rebasculerait l'interface sur l'ancienne valeur au prochain rafraîchissement.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const appliquer = (lang: Language) => {
    void i18n.changeLanguage(lang);
    enregistrer.mutate(lang);
  };

  return {
    current,
    toggle: () => appliquer(current === "fr" ? "en" : "fr"),
  };
}
