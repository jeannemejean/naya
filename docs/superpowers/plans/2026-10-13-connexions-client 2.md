# Connexions par client — plan d'implémentation

> Exécution : inline (superpowers:executing-plans), TDD à chaque tâche, relecture indépendante de la branche à la fin. Jeanne a demandé d'aller au bout sans validation intermédiaire.

**Objectif :** un projet client publie et prospecte uniquement avec ses propres connexions (comptes sociaux, expéditeur e-mail, compte LinkedIn) ; tout le reste se comporte comme aujourd'hui.

**Spec :** `docs/superpowers/specs/2026-10-13-connexions-client-design.md`

## Contraintes globales

- Aucun texte en dur dans le JSX (cliquet `jsx-guard`) ; clés FR et EN (`connexions.*`) toujours ensemble.
- `npx tsc --noEmit` à zéro erreur ; suite complète verte avant fusion.
- Migration générée par `drizzle-kit generate`, relue, appliquée sur dev uniquement. Additive.
- Aucun test n'appelle un vrai fournisseur (SendGrid, Unipile, réseaux).
- Le comportement du périmètre de l'utilisatrice (projet perso ou aucun projet) ne change pas.

## Review Focus

1. Un post ou une campagne de projet client ne part jamais avec une connexion de l'utilisatrice, même quand le client n'en a aucune (vérifié au point d'envoi, pas seulement dans l'écran).
2. Un compte lié à un post mais hors périmètre n'est jamais remplacé silencieusement par un autre.
3. La signature, l'expéditeur et le compte LinkedIn de l'aperçu sont ceux de l'envoi (cache de message réutilisé).
4. Le budget et la restriction LinkedIn d'un client n'entament pas ceux de l'utilisatrice, et inversement.
5. Toutes les routes par projet : projet d'une autre → 404 ; clé SendGrid jamais renvoyée ; `state` OAuth falsifié → refus.

## Fichiers

- `shared/schema.ts` : `social_accounts.projectId`, `linkedin_send_attempts.projectId`, table `connexions_projet`.
- `migrations/0027_*.sql`.
- `server/storage.ts` : périmètre sur `getSocialAccounts`/`getSocialAccountByPlatform`, `deleteSocialAccount` qui détache les posts, `getConnexionProjet`, `upsertConnexionProjet`, `recordLinkedInSendAttempt`/`getLinkedInAttemptTimestampsSince` par périmètre, `deleteProject`, plan de remise à zéro.
- `server/services/connexions/portee.ts` (pur), `resolution.ts`.
- `shared/programmation.ts` : `compteDuPost` sans remplacement.
- `server/services/social-oauth.ts`, `server/services/social-publisher.ts`, `server/routes-programmation.ts`, `server/routes.ts` (OAuth, listes, déconnexion, publication, croisée, aperçu, campagnes, Unipile).
- `server/services/prospection-sender.ts`, `server/services/linkedin-sync.ts`, `server/services/prospection-pipeline.ts`.
- `server/routes-connexions.ts` (+ enregistrement).
- Client : `client/src/pages/project/ConnexionsClientPanel.tsx`, `ProjectPage.tsx`, `SocialComposer.tsx`, `outreach/dialogs/CampaignForm.tsx`, locales.

## Tâches

### Tâche 1 — Schéma, migration, stockage
Colonnes et table ; migration relue ; méthodes de stockage avec périmètre (paramètre `projectId` facultatif, `null` par défaut = comportement actuel) ; détachement des posts avant suppression d'un compte ; `deleteProject` ; plan de remise à zéro. Tests : plan de reset.

### Tâche 2 — Résolution pure
TDD `portee.ts` : `porteeDe`, `dansPortee`, `choisirCompte`, `identiteEnvoi`. `compteDuPost` : compte lié introuvable → null.

### Tâche 3 — Réseaux sociaux
OAuth avec projet (vérification du `state`, rangement dans le périmètre, redirection) ; listes et statut par périmètre ; déconnexion ; publisher, publication manuelle, publication immédiate, programmation, croisée. Tests : publisher (client sans compte → `compte_absent`), callback (`state` falsifié), croisée hors périmètre.

### Tâche 4 — Prospection
`identiteCampagne` ; envoi e-mail et LinkedIn par périmètre ; signature ; historique et restriction par périmètre ; synchro LinkedIn ; aperçu et pipeline ; campagne avec projet (création vérifiée, changement refusé si séquences en cours) ; Unipile nommé par projet. Tests : sender (campagne client, client sans adresse, campagne perso inchangée), linkedin-sync.

### Tâche 5 — Routes par projet
`routes-connexions.ts` selon la spec. Tests de routes (404, 409, clé jamais renvoyée, nom Unipile du projet).

### Tâche 6 — Interface
Carte Connexions du client, sélecteur de projet de campagne, composeur par projet, locales. Tests de locales et cliquet verts.

### Tâche 7 — Vérification, relecture, fusion
Suite complète + `tsc` + build, migration dev, relecture indépendante (agent), corrections Critical/Important avec tests, fusion locale dans `main`.
