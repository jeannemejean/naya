import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en';
import fr from '@/locales/fr';
import { resolveLanguage } from '@shared/language';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    // Le cache local évite un clignotement avant la réponse de /api/auth/user.
    // useLanguageSync corrigera ensuite depuis le compte, qui fait autorité.
    lng: resolveLanguage({ cached: localStorage.getItem('naya_language') }),
    // Pas de repli d'une langue vers l'autre : une clé manquante doit se VOIR.
    // Sûr parce que client/src/locales/locales.test.ts garantit la symétrie des dictionnaires.
    fallbackLng: false,
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', (lng) => {
 localStorage.setItem('naya_language', lng);
});

export default i18n;
