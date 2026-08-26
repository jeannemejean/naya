// Liste CLOSE des codes d'erreur que le serveur émet et que l'interface affiche.
// Règle : l'interface n'affiche jamais un texte venu du serveur, seulement `errors.<code>`.
// Tout code ajouté ici DOIT recevoir sa traduction dans fr.ts ET en.ts — le test
// client/src/locales/locales.test.ts échoue sinon.

export const ERROR_CODES = [
  // authentification
  "missing_credentials",
  "email_already_registered",
  "invalid_credentials",
  "register_failed",
  "login_failed",
  // préférences du compte
  "language_save_failed",
  // comptes sociaux (câblés en tâche 7)
  "social_not_configured",
  "social_connect_failed",
  // publication de contenu (câblée en tâche 7)
  "content_not_found",
  "content_already_published",
  "social_account_not_connected",
  "social_token_expired",
  "content_publish_failed",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorParams = Record<string, string | number>;
