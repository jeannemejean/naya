import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { translateError } from "@/lib/api-error";
import { normalizeLanguage, DEFAULT_LANGUAGE, type Language } from "@shared/language";

/**
 * Unique chemin d'écriture de la langue : bascule l'interface ET enregistre sur le compte.
 * Tout sélecteur de langue d'un écran authentifié DOIT passer par ce hook.
 */
export function useLanguageToggle() {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const current = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;

  const enregistrer = useMutation({
    // Bascules rapprochées sérialisées : deux clics ne doivent jamais laisser deux
    // PATCH concurrents s'appliquer dans le désordre.
    scope: { id: "language" },
    mutationFn: (lang: Language) =>
      apiRequest("PATCH", "/api/preferences", { language: lang }).then((r) => r.json()),
    onSuccess: (_data, lang) => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      // /api/auth/user porte aussi la langue : useLanguageSync doit continuer de la
      // trouver à jour. On écrit directement dans le cache plutôt que d'invalider —
      // /api/auth/user est en `retry: false` sous un throwOnError global, et un simple
      // refetch raté enverrait toute l'application dans l'ErrorBoundary pour un clic
      // sur un bouton de langue.
      queryClient.setQueryData(["/api/auth/user"], (old: any) =>
        old ? { ...old, language: lang } : old,
      );
    },
    onMutate: (_lang) => ({ previous: current }),
    onError: (error: unknown, _lang, context) => {
      // Le PATCH a échoué : le compte garde l'ancienne langue, l'interface doit la
      // reprendre elle aussi plutôt que de rester dans un état incohérent jusqu'au
      // prochain rechargement.
      if (context?.previous) {
        void i18n.changeLanguage(context.previous);
      }
      toast({
        title: t("common.error"),
        description: translateError(t, error, "language_save_failed"),
        variant: "destructive",
      });
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
