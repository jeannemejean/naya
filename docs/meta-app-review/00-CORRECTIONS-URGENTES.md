# 00 — À corriger avant toute soumission

Ce dossier remplace la partie "permissions" de `META_COMPLIANCE.md` (juin 2026), qui décrit un flux OAuth différent de celui réellement implémenté. Détail des écarts trouvés en lisant le code le 08/09/2026.

## 1. META_COMPLIANCE.md liste les mauvaises permissions

Le doc existant demande : `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list`, `pages_manage_posts`. C'est le flux **Instagram API with Facebook Login** (nécessite une Page Facebook liée).

Le code réel (`server/services/social-oauth.ts`, lignes 22-35) utilise le flux **Instagram API with Instagram Login** : app Instagram dédiée (`IG_APP_ID`/`IG_APP_SECRET`), consentement sur `instagram.com`, jetons échangés sur `api.instagram.com` puis `graph.instagram.com`. Les scopes réellement demandés : `instagram_business_basic` et `instagram_business_content_publish`. Ce flux ne nécessite **pas** de Page Facebook — confirmé par la doc Meta actuelle.

Conséquence directe : si tu soumets à Meta la liste de META_COMPLIANCE.md, tu demandes des scopes que ton app n'affiche jamais dans son écran de consentement réel et n'utilise dans aucun appel API. C'est le motif de rejet n°1 que ce même document identifie. Utilise uniquement la liste de `01-permissions-et-justifications.md`.

## 2. Le texte de l'app promet une fonctionnalité qui n'existe pas

`client/src/pages/settings.tsx`, ligne 121 : *"Publie sur Instagram et Facebook, gère tes campagnes."*

Il n'existe aucun flux OAuth Facebook dans le code : pas de `getFacebookAuthUrl`, et `isPlatformConfigured` ne liste que `'instagram' | 'linkedin' | 'twitter' | 'tiktok'`. Le seul code touchant Facebook est mort : `POST /api/social/connect/:platform` et `/api/social/post` attendent un `accessToken` envoyé à la main dans le body — aucun bouton ni écran ne les appelle.

Un reviewer qui lit cette phrase et cherche la fonctionnalité Facebook ne la trouvera pas. Corrige le texte avant le screencast, ou retire ce code mort du repo pour ne laisser aucune trace d'une promesse non tenue.

## 3. Secrets et migration en prod — à vérifier avant de filmer quoi que ce soit

- `TOKEN_ENCRYPTION_KEY` doit être définie sur Railway (prod), pas seulement en local — sinon les tokens ne sont jamais chiffrés en prod, ce qui contredirait ce que tu déclareras dans le Data Use Checkup de Meta.
- `IG_APP_ID`/`IG_APP_SECRET` en prod doivent être ceux de la vraie app Instagram utilisée pour la review (pas les valeurs de la branche Neon de dev que pointe le `.env` local).
- La colonne `platform_user_id` (nécessaire au callback de suppression de données) n'a été appliquée qu'en dev selon META_COMPLIANCE.md — à migrer en prod (`npm run db:migrate`) avant soumission, sinon la suppression de données ne fonctionnera pas pour un vrai utilisateur.

## 4. Ce qui reste valable dans META_COMPLIANCE.md

Les sections sur la vérification d'entreprise, la preuve d'usage réel, les paramètres d'app et les Platform Terms restent correctes — elles ne dépendent pas du choix de flux OAuth. Versions actionnables dans `04` et `05` de ce dossier.
