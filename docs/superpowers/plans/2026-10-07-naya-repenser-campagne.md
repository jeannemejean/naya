# Repenser la campagne — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repenser une campagne existante (stratégie, plan, posts non publiés, tâches non faites) avec le savoir déposé, les préférences de marque et une consigne, sans toucher au cadre ni à ce qui est publié/fait.

**Architecture:** extraction du placement (tâches + posts) recopié dans `launch` / `regenerate-content` / `redeploy` vers `server/services/campagne/placement.ts` ; savoir + préférences transmis à `generateCampaignTasks` ; service `server/services/campagne/repenser.ts` (dépendances injectées) + routes aperçu/action ; fenêtre côté client dans `client/src/pages/campaigns.tsx`.

**Tech Stack:** Express + Drizzle (Neon Postgres), Vitest, React + TanStack Query + react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-07-naya-repenser-campagne-design.md`

## Global Constraints

- Statuts admis pour repenser : `draft`, `active`, `paused` ; sinon 409 `statut_incompatible`. Campagne d'un autre utilisateur / absente → 404.
- `consigne` : string facultative, trimée, ≤ 1000 caractères (sinon 400 `consigne_trop_longue`) ; injectée sous l'intitulé `CE QUI DOIT CHANGER` dans les trois prompts (stratégie, contenu, tâches).
- Cadre conservé : `name`, `objective`, `duration`, `projectId`, `startDate`, `endDate`, `articuleAvecCampaignId`, `articulationIndependante`, `status`. Nom renvoyé par le modèle ignoré.
- Champs remplacés : `coreMessage`, `targetAudience`, `audienceSegment`, `campaignType`, `insights`, `phases`, `messagingFramework`, `channels`, `kpis`, `contentPlan`, `generatedTasks`.
- Publié = `contenuEstPublie` ; fait = `tacheEstFaite` (`server/services/campaign-reject/rejeter.ts`). Publiés et faits **restent rattachés** (`campaignId` inchangé).
- Génération entière **avant** toute écriture ; échec → 502 `generation_echouee`, zéro écriture. Écritures de remplacement + suppressions dans **une** `db.transaction`, scopées `userId` + `campaignId`.
- `active`/`paused` : placement sur `[max(aujourd'hui Europe/Paris, startDate) ; endDate]`, tous les posts créés avec `autoPost: false`, puis `storage.fixOverlappingTasks`. `draft` : aucun placement.
- Verrou en mémoire par campagne : second appel concurrent → 409 `deja_en_cours` ; verrou relâché dans un `finally`.
- Réponse `{ postsCrees, tachesCreees, postsSupprimes, tachesSupprimees }`.
- `regenerate-content` ne supprime plus les posts publiés.
- UI via `t()` FR + EN, gardes i18n vertes. Tests `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test` ; `npx tsc --noEmit` à zéro ; `npx vite build` OK. Commits en français + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Jamais de push**, aucune vraie base, aucun sous-agent.

## Review Focus

- **Campagne active dont la date de fin est passée** : fenêtre vide → aucune tâche/post placé, réponse cohérente (0 créés), pas d'erreur. → test Task 3.
- **Campagne sans `startDate`/`endDate` (brouillon ancien)** : repenser ne plante pas ; brouillon → pas de placement. → test Task 3.
- **Post « en cours de publication »** (`postStatus` `posting`/`claimed`) : ne doit pas être supprimé. Utiliser `estPublieOuEnCours` (`server/services/refus-post/pur.ts`) en plus de `contenuEstPublie`. → test Task 3 et Task 1 (`regenerate-content`).
- **Consigne vide ou faite d'espaces** : traitée comme absente (pas de section vide dans le prompt). → test Task 3.
- **Le modèle renvoie un plan de contenu vide** : traité comme un échec de génération (502, zéro écriture). → test Task 3.

---

### Task 1 : Placement commun + « Régénérer le calendrier » garde les publiés

**Files:** Create `server/services/campagne/placement.ts` + `placement.test.ts` ; Modify `server/routes.ts` (`/api/campaigns/:id/launch` ~10737, `/api/campaigns/:id/regenerate-content` ~11061, `/api/campaigns/:id/redeploy` ~11427) ; Modify `server/storage.ts` si besoin (suppression des seuls posts non publiés d'une campagne).

**Interfaces — Produces:**
- `placerTachesCampagne(deps, { userId, campaign, debut: Date, fin: Date }): Promise<{ creees: number }>` — reprend EXACTEMENT l'algorithme de placement de `launch` (phases → `computePhaseRanges` → `assignPublicationDates` → `decomposeContentTask` → jours travaillés, indisponibilités, 3 tâches/jour, contrôle de créneaux) et crée les tâches (`source: 'campaign'`, `campaignId`).
- `placerPostsCampagne(deps, { userId, campaign, debut: Date }): Promise<{ crees: number }>` — reprend le placement des posts de `launch` (groupement par semaine → `scheduledFor`), `autoPost: false`.
- `deps` = fonctions de `storage` utilisées (injectables pour les tests).

- [ ] Lire les trois routes ; identifier les blocs dupliqués ; écrire des tests de caractérisation sur l'ancien comportement (fixtures : campagne 2 phases, 4 tâches générées, 6 posts, jours travaillés lun-ven, un jour indisponible) qui capturent dates et nombre de tâches/posts créés.
- [ ] Extraire vers `placement.ts` sans changer le comportement ; brancher `launch`, `regenerate-content`, `redeploy` dessus ; les tests de caractérisation restent verts.
- [ ] `regenerate-content` : ne supprimer que les posts **non** publiés et non en cours (`contenuEstPublie` / `estPublieOuEnCours`) ; réponse `deleted` = nombre réellement supprimé. Test : un post publié survit.
- [ ] tsc, suite ; commit.

### Task 2 : Les tâches de campagne lisent le savoir et les préférences

**Files:** Modify `server/services/openai.ts` (`generateCampaignTasks` ~1345, `CampaignGenerationRequest` ~1101 a déjà `preferences?`/`savoir?`) ; Modify `server/routes.ts` (`/api/campaigns/generate/tasks` ~10530 : passer `savoir` via `savoirPourCampagne(userId, pid, { objective, name: strategy.name })` et `preferences` via `resolvePreferences(userId, pid)`). Ajout du champ optionnel `consigne?: string` à `CampaignGenerationRequest`, injecté sous `CE QUI DOIT CHANGER` dans `generateCampaignStrategy`, `generateCampaignContent`, `generateCampaignTasks` quand non vide.

- [ ] Tests (mock de l'appel modèle, voir les tests existants de `generateCampaignStrategy` pour le savoir) : prompt de tâches contient la section savoir et les préférences quand fournis ; absent sinon ; `consigne` non vide → section `CE QUI DOIT CHANGER` dans les trois prompts ; vide/espaces → absente.
- [ ] Route `/generate/tasks` : échec de récupération du savoir → génération quand même.
- [ ] commit.

### Task 3 : Service et routes « repenser »

**Files:** Create `server/services/campagne/repenser.ts` + `repenser.test.ts` ; Modify `server/routes.ts` (nouvelles routes `GET /api/campaigns/:id/repenser-apercu`, `POST /api/campaigns/:id/repenser`, à côté de `reject-preview` ~10252) ; test routes `server/routes.repenser.test.ts` (harnais de `server/routes.task-lock.test.ts`).

**Interfaces — Consumes:** `placerTachesCampagne`, `placerPostsCampagne` (Task 1) ; `consigne` dans `CampaignGenerationRequest` (Task 2) ; `trierContenus`, `trierTaches`, `contenuEstPublie`, `tacheEstFaite` ; `estPublieOuEnCours`.
**Produces:** `apercuRepenser(deps, userId, campaignId)` → `{ postsRemplaces, postsConserves, tachesRemplacees, tachesConservees }` ; `repenserCampagne(deps, userId, campaignId, { consigne? })` → `{ postsCrees, tachesCreees, postsSupprimes, tachesSupprimees }` ; erreurs typées `CampagneIntrouvable` (réutiliser), `StatutIncompatible`, `GenerationEchouee`, `DejaEnCours`, `PlacementEchoue`.

- [ ] `deps` : `getCampaign`, contenus/tâches de la campagne, `genererStrategie`/`genererContenu`/`genererTaches` (wrappers des fonctions d'`openai.ts` avec savoir, préférences, articulation, brandDna — reprendre la préparation de `/generate/strategy`/`/content`/`/tasks`, en factorisant si possible), `transaction(fn)`, placement, `fixOverlappingTasks`, `aujourdhuiParis` (`server/services/repack-from.ts`).
- [ ] Ordre : verrou → contrôles (404/409) → génération (3 étapes, 240 s chacune) → validation (plan de contenu non vide) → transaction (update campagne, suppression non publiés non en cours, suppression tâches non faites) → si `active`/`paused` : placement sur la fenêtre → `fixOverlappingTasks` → relâche du verrou (`finally`).
- [ ] Tests unitaires (fakes) : tous les points « Tests » de la spec + les 5 lignes de Review Focus.
- [ ] Routes : propriété, mapping des erreurs (404, 409 `statut_incompatible`, 409 `deja_en_cours`, 400 `consigne_trop_longue`, 502 `generation_echouee`, 500 `placement_echoue`) ; tests de routes.
- [ ] tsc, suite ; commit.

### Task 4 : Interface « Repenser la campagne »

**Files:** Modify `client/src/pages/campaigns.tsx` (bouton dans le détail, près du bouton rejeter ~1520, visible si statut `draft`/`active`/`paused`) ; Create `client/src/components/repenser-campagne-dialog.tsx` ; Modify `client/src/locales/fr.ts`, `en.ts` (section `campaigns.repenser`).

- [ ] Ouverture → `GET …/repenser-apercu` → affiche les quatre comptes ; champ « Qu'est-ce qui doit changer ? » (facultatif, 1000 caractères max, compteur) ; Annuler / Repenser.
- [ ] Envoi → `apiRequest("POST", …/repenser, { consigne }, { timeoutMs: 800000 })` ; écran d'attente (réutiliser l'overlay `genStep` de l'assistant si possible, sinon un état de chargement dans la fenêtre avec texte « Naya repense ta campagne… ») ; boutons désactivés.
- [ ] Succès : toast « Campagne repensée » + comptes ; invalidation `['/api/campaigns']`, `['/api/content']`, `['/api/tasks']` (et clés de détail utilisées dans la page). Erreurs : `generation_echouee` → « Naya n'a pas pu repenser la campagne. Rien n'a été modifié. » ; `deja_en_cours` → « Naya est déjà en train de repenser cette campagne. » ; autres → message générique.
- [ ] Gardes i18n, tsc, build, suite ; commit.
