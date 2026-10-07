# Repenser une campagne existante avec le savoir de Naya — conception

**Date :** 7 octobre 2026

> Demande : « si je demande de régénérer les campagnes, est-ce qu'il va s'inspirer des documents que j'ai envoyés pour être plus précis ? » Réponse constatée : non. On construit un vrai « Repenser la campagne ».
> Choix validés : **garder le cadre, refaire le reste** ; **refaire les tâches pas commencées**.

## Constat

- `POST /api/campaigns/:id/regenerate-content` n'appelle pas l'IA : il recrée les posts depuis le `contentPlan` enregistré, et `storage.deleteAllCampaignContent` **supprime aussi les posts publiés**.
- `POST /api/campaigns/:id/redeploy` supprime les tâches non faites et replanifie depuis `generatedTasks` (pas d'IA), à partir d'aujourd'hui.
- Le savoir déposé (`savoirPourCampagne`) et les préférences de marque (`resolvePreferences`) n'entrent que dans `/generate/strategy` et `/generate/content`, **pas** dans `/generate/tasks` (`generateCampaignTasks`).
- Le placement des tâches (phases → dates de publication → sous-tâches à rebours, jours travaillés, 3 tâches/jour) et des posts (semaine → date) est recopié dans `launch`, `regenerate-content` et `redeploy`.
- Aides réutilisables : `contenuEstPublie`, `tacheEstFaite`, `trierContenus`, `trierTaches` (`server/services/campaign-reject/rejeter.ts`).

## Ce qu'on construit

### 1. « Repenser la campagne »
- **Aperçu** `GET /api/campaigns/:id/repenser-apercu` → `{ postsRemplaces, postsConserves, tachesRemplacees, tachesConservees }` (comptes réels, propriété vérifiée, 404 sinon).
- **Action** `POST /api/campaigns/:id/repenser` corps `{ consigne?: string }` (≤ 1000 caractères, trimée).
  - Statuts admis : `draft`, `active`, `paused` (sinon 409 `statut_incompatible`).
  - **Génération d'abord, hors transaction** : stratégie → plan de contenu → tâches, avec l'objectif, la durée et la marque de la campagne, le savoir (`savoirPourCampagne`), les préférences (`resolvePreferences`), l'articulation existante, et la consigne (section « CE QUI DOIT CHANGER » si fournie).
  - **Cadre conservé** : `name`, `objective`, `duration`, `projectId`, `startDate`, `endDate`, articulation. Le nom renvoyé par le modèle est ignoré.
  - **Échec d'une étape** → 502 `generation_echouee`, **rien n'est modifié**.
  - **Succès, en une transaction** :
    - campagne : `coreMessage`, `targetAudience`, `audienceSegment`, `campaignType`, `insights`, `phases`, `messagingFramework`, `channels`, `kpis`, `contentPlan`, `generatedTasks` remplacés ;
    - posts non publiés de la campagne supprimés ; **posts publiés conservés, toujours rattachés** ;
    - tâches non faites de la campagne supprimées ; **tâches terminées conservées, toujours rattachées**.
  - **Campagne `active` ou `paused`** : après la transaction, nouveaux posts et nouvelles tâches placés par la fonction de placement commune, sur la fenêtre `[max(aujourd'hui Paris, startDate) ; endDate]`, `autoPost: false`, puis `fixOverlappingTasks`. Statut inchangé.
  - **Campagne `draft`** : seul le plan change ; le lancement placera posts et tâches.
  - Réponse `{ postsCrees, tachesCreees, postsSupprimes, tachesSupprimees }`.
  - Deux repenser simultanés sur la même campagne → le second reçoit 409 `deja_en_cours` (verrou en mémoire par campagne).
- **Les tâches lisent aussi le savoir et les préférences** : `generateCampaignTasks` reçoit `savoir` et `preferences` (même section de prompt que la stratégie), pour la création comme pour repenser.

### 2. Interface
- Bouton **« Repenser la campagne »** dans le détail d'une campagne (draft, active, paused).
- Fenêtre : comptes de l'aperçu, champ facultatif « Qu'est-ce qui doit changer ? », boutons Annuler / Repenser.
- Pendant la génération : écran d'attente (comme l'assistant de création).
- Résultat : toast avec les comptes ; invalidation des campagnes, contenus, tâches.
- Textes via `t()` FR + EN.

### 3. Au passage
- **« Régénérer le calendrier » ne supprime plus les posts publiés** : seuls les posts non publiés sont supprimés et recréés.
- **Placement commun** : `server/services/campagne/placement.ts` exporte une fonction de placement des tâches et une des posts, utilisées par `launch`, `regenerate-content`, `redeploy` et repenser. Comportement de `launch` et `redeploy` inchangé (tests de non-régression sur des fixtures).
- Le bouton « Régénérer » d'un post (déjà fait, commit `08b431f`) part avec ce lot.

## Ce qu'on ne construit pas
- Pas de changement de nom, d'objectif, de dates ni de durée par repenser.
- Pas de liens de dépendance entre tâches de campagne (l'ordre reste porté par les dates, comme au lancement).
- Pas d'historique ni d'annulation de la version précédente.

## Erreurs
- Génération : délai de 240 s par étape ; tout échec → campagne intacte, message « Naya n'a pas pu repenser la campagne. Rien n'a été modifié. ».
- Échec de la transaction → rien n'est modifié. Échec du placement après la transaction → plan et suppressions conservés, 500 `placement_echoue` ; l'utilisateur peut relancer « Redéployer ».

## Tests
- Aperçu : comptes publiés/non publiés, faites/non faites ; 404 autre utilisateur.
- Repenser : savoir, préférences et consigne transmis aux trois générateurs ; nom et dates conservés ; échec d'étape → aucune écriture ; publiés et terminées conservés et rattachés ; draft → aucun placement ; active → placement dans la fenêtre, `autoPost: false` ; statut `completed` → 409 ; second appel concurrent → 409.
- Placement commun : mêmes dates que l'ancien code sur des fixtures (`launch`, `redeploy`).
- `regenerate-content` : un post publié n'est plus supprimé.
- Aucun test contre la production.
