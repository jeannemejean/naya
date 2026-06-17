# Conformité Meta — Publication de contenu via l'API (Naya)

> Objectif : faire approuver l'app Naya par Meta pour publier et gérer du contenu
> marketing sur **Instagram** et **Facebook** via la Graph API.
> Sources officielles (juin 2026) : voir liens en bas.

---

## 1. Les critères que Meta applique pour autoriser une app à publier

Meta autorise une app à publier du contenu **si et seulement si** ces conditions sont réunies :

### a) Les bonnes permissions, et uniquement celles-ci
Pour publier sur Instagram via **Facebook Login** (le flux utilisé par Naya), il faut :
- `instagram_basic`
- `instagram_content_publish`
- `pages_read_engagement` (dépendance obligatoire)
- `pages_show_list` (énumérer les Pages)
- `pages_manage_posts` (pour publier sur le **feed d'une Page Facebook**)

⚠️ **Demander des permissions non utilisées = motif de rejet n°1.** Chaque permission
demandée doit être réellement exercée dans l'app et démontrée.

### b) Le bon type de compte
- Compte Instagram **professionnel** (Business ou Creator).
- **Connecté à une Page Facebook**.
- Si la Page exige la *Page Publishing Authorization (PPA)*, elle doit être complétée
  côté utilisateur sinon la publication échoue.

### c) Niveau d'accès + App Review
- **Standard Access** : ne fonctionne que pour les comptes ayant un rôle sur l'app
  (toi, tes testeurs). Suffisant pour développer/tester.
- **Advanced Access** : requis dès que l'app sert **d'autres utilisateurs** que toi.
  Naya étant destinée à d'autres entrepreneurs → **Advanced Access obligatoire**, donc
  **App Review obligatoire**.
- App Review **n'est pas** requis si l'app ne sert que ton propre business.

### d) Vérification Business (pour Advanced Access)
- **Business Verification obligatoire** avant d'obtenir l'Advanced Access.
- Le compte business ne doit avoir **aucune restriction**.
- **Tech Provider / App Verification** requise si l'app utilise les données d'autres
  entreprises pour leur fournir un service (cas de Naya).
- Délai d'examen typique : ~5 jours après soumission.

### e) Une preuve d'usage réel
- Au moins **1 appel API réussi** par permission demandée, **dans les 30 jours** avant
  la soumission.
- Un **screencast** par permission montrant le parcours utilisateur de bout en bout
  (UI en anglais, sous-titres/tooltips si besoin, rôle de chaque bouton expliqué).
- **Instructions de test pas-à-pas** + identifiants de test valides et fonctionnels
  pour les reviewers Meta. Si Meta ne peut pas accéder/tester → rejet total.

### f) Paramètres d'app complets
- Icône 1024×1024
- **URL de politique de confidentialité** (exacte et reflétant l'usage réel)
- **Data Deletion callback** (ou instructions de suppression) fonctionnel
- Catégorie d'app + email business
- App **finie et publiquement accessible** (pas « en cours de développement »)
- Pas de faux comptes de test (violation des conditions)

### g) Respect des Platform Terms
- Les données plateforme servent **uniquement** la fonctionnalité activée par l'utilisateur.
- **Interdit** : vendre les données, les utiliser pour de la pub ciblée, construire des
  profils, les partager hors sous-traitants déclarés.
- Limite de débit publication Instagram : **100 posts / 24h** (rolling).

---

## 2. Ce qui a été corrigé dans le code (juin 2026)

| # | Changement | Fichier | Pourquoi |
|---|-----------|---------|----------|
| 1 | Ajout des scopes `instagram_basic` + `instagram_content_publish` | `server/services/social-oauth.ts` | Sans eux, **impossible** de publier sur Instagram. Bloquant absolu. |
| 2 | Bump Graph API `v18.0` → `v23.0` (13 occurrences) | `social-oauth.ts`, `social-integrations.ts` | v18 dépréciée (actuel : v25). Appels sur version morte = échecs = rejet. |
| 3 | Capture de l'ID utilisateur Meta à la connexion (`platformUserId`) | `social-oauth.ts`, `shared/schema.ts` | Nécessaire pour honorer la suppression de données. |
| 4 | Data deletion callback **avec vérification de signature HMAC-SHA256** + suppression réelle des comptes liés | `server/routes.ts` | L'ancien décodait sans vérifier la signature et ne supprimait rien → non conforme. |
| 5 | Ajout du **deauthorize callback** `/api/meta/deauthorize` | `server/routes.ts` | Révoque les tokens quand l'utilisateur retire l'app (attendu par Meta). |
| 6 | Méthode `deleteSocialAccountsByPlatformUserId` | `server/storage.ts` | Suppression effective par ID Meta. |
| 7 | Page publique **/data-deletion** (statut + procédure) | `client/src/pages/data-deletion.tsx` + `App.tsx` | URL de statut renvoyée à Meta + transparence utilisateur. |
| 8 | **Réécriture de la politique de confidentialité** | `client/src/pages/privacy.tsx` | L'ancienne affirmait « aucune donnée transmise à des tiers » et « page d'accueil uniquement » — **faux** dès qu'on connecte Meta et qu'on envoie du contenu à Claude/OpenAI. Rejet garanti + violation des Platform Terms. |
| 9 | **Chiffrement des jetons au repos (AES-256-GCM)** | `server/services/token-crypto.ts`, `server/storage.ts` | Les `access_token`/`refresh_token` sont chiffrés à l'écriture et déchiffrés à la lecture (transparent pour le worker et les routes). Exigé par la Data Protection Assessment. Clé : `TOKEN_ENCRYPTION_KEY`. |
| 10 | **Script de migration des jetons existants** | `server/scripts/encrypt-existing-tokens.ts` | Chiffre les jetons déjà en base (idempotent). Déjà exécuté sur la branche Neon de dev. |

### Vérifié en runtime (sur branche Neon de dev `dev-local`)
- Chiffrement : DB stocke `enc:v1:…`, `storage` renvoie le jeton déchiffré, migration idempotente. ✓
- Data deletion : `signed_request` invalide → `400 invalid_signed_request` (avant toute suppression) ; `signed_request` valide → `200` + `confirmation_code`. ✓
- Deauthorize, pages `/privacy` et `/data-deletion` : OK. ✓
- Typecheck `tsc` : 0 erreur. ✓

### URLs à configurer dans le dashboard Meta
- Privacy Policy URL : `https://hellonaya.app/privacy`
- User Data Deletion → **Data Deletion Request URL** : `https://hellonaya.app/api/meta/data-deletion`
- Deauthorize Callback URL : `https://hellonaya.app/api/meta/deauthorize`
- Valid OAuth Redirect URI : `https://hellonaya.app/api/social/oauth/instagram/callback`

---

## 3. Reste à faire (hors code — actions de Jeanne)

### Bloquants techniques avant soumission
- [x] ~~Colonne `platform_user_id`~~ → appliquée sur la branche dev. **À refaire en prod** : `npm run db:push` (additive, nullable, non destructive).
- [x] ~~Chiffrer les access tokens au repos~~ → fait (AES-256-GCM, cf. lignes 9-10 du tableau).
- [ ] **En prod (Railway)** : définir la variable `TOKEN_ENCRYPTION_KEY` (générer : `openssl rand -hex 32`).
      ⚠️ La MÊME clé doit rester stable, sinon les jetons chiffrés deviennent illisibles.
- [ ] **En prod** : lancer une fois `tsx server/scripts/encrypt-existing-tokens.ts` pour chiffrer les jetons existants.
- [ ] Vérifier que `INSTAGRAM_APP_SECRET` est bien défini en prod (sinon le data deletion
      callback rejette tout, par sécurité).
- [ ] Restaurer le `.env` local sur la prod si besoin : la sauvegarde est dans `.env.prod.bak`
      (le `.env` actuel pointe sur la branche Neon de dev `dev-local`).

### Process Meta (dans le dashboard developers.facebook.com)
- [ ] Passer l'app en mode **Live**.
- [ ] Compléter la **Business Verification** (documents légaux de l'Agence JMD).
- [ ] Lancer la **Tech Provider / App Verification**.
- [ ] Faire **1 appel API réussi** par permission (connecter un vrai compte IG pro + publier 1 post de test) dans les 30 jours.
- [ ] Enregistrer un **screencast** par permission (parcours connexion → création → publication).
- [ ] Rédiger les **instructions de test** + fournir un **compte de test fonctionnel** aux reviewers.
- [ ] Demander l'**Advanced Access** sur chaque permission, puis soumettre l'App Review.

### Recommandations
- Tester d'abord en **Standard Access** avec le compte de Jeanne (aucune review nécessaire).
- Utiliser une **branche Neon de dev** pour tester localement (le `.env` local pointe sur la prod).
- Ne demander **que** les permissions réellement utilisées (revoir si Facebook Page posting est conservé ; sinon retirer `pages_manage_posts`).

---

## Sources officielles (Meta for Developers, juin 2026)
- Content Publishing : https://developers.facebook.com/docs/instagram-platform/content-publishing/
- App Review (Instagram) : https://developers.facebook.com/docs/instagram-platform/app-review/
- Access Verification : https://developers.facebook.com/docs/development/release/access-verification/
- Permissions Reference : https://developers.facebook.com/docs/permissions/
- Common Mistakes (App Review) : https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes
- Data Deletion Callback : https://developers.facebook.com/docs/facebook-login/guides/advanced/data-deletion-callback
