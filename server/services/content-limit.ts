// Plafond de `limit` pour GET /api/content. Extrait de routes.ts (où c'était une
// constante LOCALE à la route, donc invisible depuis un test) pour pouvoir être vérifié
// contre son miroir client — `client/src/pages/content-calendar-limit.ts`,
// `LIMITE_CONTENUS_PAGE` — par une égalité affirmée dans
// `server/content-duplicated-constants.test.ts`.
//
// Cette paire est la DANGEREUSE des constantes dupliquées de ce chantier : la page
// demande `limit=LIMITE_CONTENUS_PAGE` (200) INCONDITIONNELLEMENT (content-calendar.tsx).
// Si cette valeur-ci baisse sans que personne ne touche au client, GET /api/content rend
// 400 ("limit invalide") à CHAQUE chargement, et le calendrier entier cesse d'afficher
// quoi que ce soit — sans qu'aucun test de routes.ts (qui ne connaît que des mocks) ne le
// voie. Avant cette extraction, rien ne liait les deux valeurs ; maintenant, un test les
// importe toutes les deux et affirme leur égalité.
export const LIMITE_CONTENUS_MAX = 200;
