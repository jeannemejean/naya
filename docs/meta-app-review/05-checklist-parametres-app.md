# 05 — Paramètres de l'app (developers.facebook.com)

À vérifier un par un dans le dashboard de l'app, avant de repasser en mode Live :

- [ ] Icône de l'app **1024×1024** — non trouvée dans `brand-kit/assets` lors de la revue du repo. À produire au format exact avant soumission.
- [ ] Privacy Policy URL : `https://hellonaya.app/privacy` — existe dans le code (`client/src/pages/privacy.tsx`), vérifier qu'elle est bien déployée et accessible publiquement sans connexion.
- [ ] Data Deletion Request URL : `https://hellonaya.app/api/meta/data-deletion` — la route existe dans `server/routes.ts`, mais teste-la en prod (pas seulement en dev) avant de la déclarer à Meta.
- [ ] Deauthorize Callback URL : `https://hellonaya.app/api/meta/deauthorize` — même vérification en prod.
- [ ] Catégorie de l'app : choisir une catégorie cohérente avec "outil de productivité/marketing pour entrepreneurs", pas une catégorie générique.
- [ ] Email business de contact : réutiliser `naya.ai.app@gmail.com` (déjà affiché dans `privacy.tsx`) pour rester cohérent.
- [ ] App en mode **Live**, pas "In Development" — sinon rejet automatique pour app "incomplète".
- [ ] L'app doit être accessible publiquement sans VPN ni whitelist au moment du test Meta. Le `.env` a un `WAITLIST_MODE` — le désactiver pour la review, ou donner un accès direct garanti au compte de test.
