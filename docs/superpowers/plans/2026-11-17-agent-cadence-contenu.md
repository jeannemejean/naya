# Naya ajuste le contenu et les campagnes — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'agent Naya peut proposer de supprimer des posts, de repenser une campagne avec une consigne et de retenir le rythme d'une marque ; ce rythme borne ensuite la génération de campagne et la cadence de présence.

**Architecture:** trois outils « à valider » de plus dans `server/services/agent/outils/a-valider.ts`, sur le cadre existant `outilAValider` (aperçu + empreinte, exécution à la validation). Le rythme d'une marque est une préférence `suivre` de la mémoire (`memory_entries`, fil `cap`, par projet) au texte préfixé, lisible par le code via `postsParSemaine` (déjà dans `fil/presence.ts`). Pas de migration.

**Tech Stack:** TypeScript, Express, Drizzle/Neon, vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-agent-cadence-contenu-design.md`

## Global Constraints

- `npx tsc --noEmit` à zéro erreur ; `npx vitest run` vert.
- Aucune migration (tout tient dans `memory_entries` et `content` existants).
- Un post supprimable par l'agent : non publié, pas en cours de publication (`estPublieOuEnCours` de `server/services/refus-post/pur.ts` faux), `autoPost === false`.
- Le bouton « Repenser » garde son comportement ; seul l'outil de l'agent refuse une campagne qui a un post non publié avec `autoPost = true`.
- Textes visibles en français, sans jargon interne (règle de `REGLES_AGENT`).
- `shared/consentement.ts` et `mobile/lib/consentement.ts` restent des copies conformes.
- Pas de déploiement (push sur `main`) sans l'accord de Jeanne : un push redémarre Naya et tue Repenser en cours.

## Review Focus

- Un post publié, programmé en auto ou modifié entre l'aperçu et la validation : la proposition expire, rien n'est supprimé (Task 3).
- Tous les posts d'une semaine supprimés : l'atelier et la validation de cette semaine sont archivés, pas laissés vides dans le planning (Task 3).
- Repenser déjà en cours au moment du « oui » : la ligne d'échec le dit, rien n'est lancé deux fois (Task 4).
- Rythme absurde (0, négatif, 50 par semaine) : refusé à l'aperçu (Task 1 borne, Task 5 refuse).
- Naya écrit « campagne repensée » alors qu'elle n'a que proposé : corrigé par la garde (Task 6).

---

### Task 1: le rythme d'une marque (`server/services/campagne/rythme.ts`)

**Files:**
- Create: `server/services/campagne/rythme.ts`
- Test: `server/services/campagne/rythme.test.ts`

**Interfaces:**
- Consumes: `postsParSemaine(texte)` de `server/services/fil/presence.ts` ; `memoryEntries`, `db` ; `preferencesDeLaMarque` n'est PAS utilisé ici (plafond de 8, tri par salience).
- Produces:
  - `export const PREFIXE_RYTHME = "Rythme de publication dans Naya : "`
  - `export const RYTHME_MIN = 0.25; export const RYTHME_MAX = 14;`
  - `export function texteRythme(parSemaine: number, precision?: string): string` — ex. `texteRythme(1, "les news JMD sortent chaque jour hors Naya (Metricool)")` → `"Rythme de publication dans Naya : 1 post par semaine. les news JMD sortent chaque jour hors Naya (Metricool)"` ; nombre écrit avec `toLocaleString("fr-FR")` (0,5 → « 0,5 »), « posts » au-delà de 1.
  - `export function rythmeValide(n: unknown): n is number` — fini, `RYTHME_MIN ≤ n ≤ RYTHME_MAX`.
  - `export function lireRythme(texte: string): number | null` — `null` si le texte ne commence pas par le préfixe, sinon `postsParSemaine` sur la partie avant le premier point.
  - `export async function rythmeDeLaMarque(userId: string, projectId: number): Promise<{ id: number; texte: string; parSemaine: number } | null>` — la ligne `memory_entries` la plus récente : `userId`, `projectId`, `fil = "cap"`, `entryType = "préférence"`, `supersededAt IS NULL`, `content LIKE PREFIXE_RYTHME || '%'`.
  - `export async function ecrireRythme(userId: string, projectId: number, texte: string): Promise<void>` — dans une transaction : `supersededAt = now()` sur les rythmes actifs de ce projet, puis insertion (`fil "cap"`, `entryType "préférence"`, `salience 1`, embedding best-effort comme `refus-post/deps.ts` `ecrireSouvenir`). `sensDe` la lit donc en `suivre`, et `preferencesDeLaMarque` la passe aux générations (salience 1 = en tête).

- [ ] **Step 1: tests purs** — `texteRythme(1)` = `"Rythme de publication dans Naya : 1 post par semaine."` ; `texteRythme(3, "x")` contient `"3 posts par semaine. x"` ; `lireRythme(texteRythme(0.5))` = 0.5 ; `lireRythme(texteRythme(3, "2 reels et 1 carrousel par semaine"))` = 3 (la précision ne compte pas) ; `lireRythme("Ton direct")` = null ; `rythmeValide(0)`, `rythmeValide(-1)`, `rythmeValide(50)`, `rythmeValide(NaN)` faux, `rythmeValide(1)` vrai.
- [ ] **Step 2:** `npx vitest run server/services/campagne/rythme.test.ts` → FAIL (module absent).
- [ ] **Step 3:** implémenter le module.
- [ ] **Step 4:** même commande → PASS.
- [ ] **Step 5:** commit `feat(rythme): le rythme de publication d'une marque, préférence lisible par le code`.

### Task 2: le rythme borne la génération et la présence

**Files:**
- Modify: `server/services/campagne/placement.ts` (`placerPostsCampagne`)
- Modify: `server/services/campagne/repenser.ts` (`RepenserDeps`, appel de `placerPostsCampagne`)
- Modify: `server/routes.ts` (les deux appels de `placerPostsCampagne` vers les lignes 10712 et 10771, et `depsRepenser` vers 10340)
- Modify: `server/services/fil/presence.ts`, `server/services/fil/presence-deps.ts`
- Test: `server/services/campagne/placement.test.ts` (existant, ou créer `placement-plafond.test.ts`), `server/services/fil/presence.test.ts`

**Interfaces:**
- Consumes: `rythmeDeLaMarque` (Task 1).
- Produces:
  - `placerPostsCampagne(deps, { …, plafondParSemaine?: number | null })` : quand défini, chaque semaine du plan garde au plus `Math.max(1, Math.round(plafondParSemaine))` pièces, choisies réparties dans la semaine (indices `Math.floor(i * n / k)`) ; absent = comportement actuel.
  - `RepenserDeps.plafondParSemaine?: (userId: string, projectId: number | null) => Promise<number | null>` ; repenser le passe à `placerPostsCampagne`.
  - `DepsPresence.rythme?: (userId: string, projectId: number | null) => Promise<number | null>` ; `proposerSeul` calcule `n` avec `seuilPresenceJours(texteRythme(r), …)` quand `r` existe, sinon comme aujourd'hui avec `contentBandwidth`. Le rythme est lu pour `projetVisibilite` (le projet déjà utilisé).

- [ ] **Step 1: tests** — plan de 5 pièces en « Week 1 », `plafondParSemaine: 1` → 1 post créé pour cette semaine ; `plafondParSemaine: 2` → 2 posts, pas le même jour ; sans plafond → 5. Présence : deps avec `rythme` → 1 et `contentBandwidth` « quotidien » : aucun post proposé quand le dernier publié date de 5 jours (seuil 7) ; sans `rythme` : comportement actuel (seuil 2, propose).
- [ ] **Step 2:** lancer ces tests → FAIL.
- [ ] **Step 3:** implémenter ; dans `routes.ts`, les deux appels et `depsRepenser` lisent `campaign.projectId ? (await rythmeDeLaMarque(userId, campaign.projectId))?.parSemaine ?? null : null` ; `presence-deps.ts` branche `rythme` sur `rythmeDeLaMarque`.
- [ ] **Step 4:** tests ciblés puis `npx tsc --noEmit` → PASS / 0.
- [ ] **Step 5:** commit `feat(rythme): la génération de campagne et la présence suivent le rythme de la marque`.

### Task 3: outil `supprimer_posts`

**Files:**
- Modify: `server/services/agent/outils/a-valider.ts` (nouvel outil, ajouté à `OUTILS_A_VALIDER`)
- Modify: `server/services/agent/propositions.ts` (`LECTEURS.content`)
- Create: `server/services/atelier/reajuster.ts`
- Test: `server/services/agent/outils/a-valider.test.ts`, `server/services/atelier/reajuster.test.ts`

**Interfaces:**
- Consumes: `storage.getContentById(id, userId)`, `storage.deleteContent(id)` (emporte déjà les tâches de production non faites), `estPublieOuEnCours`, `placerAteliers` (`server/services/atelier/placement.ts`), `storage.getPostsEntre`, `storage.getTachesAtelier(userId, lundi)`, `storage.updateTask`.
- Produces:
  - outil `supprimer_posts`, args `{ postIds: number[] }` (1 à 100, dédoublonnés). Description : « Propose de supprimer des posts non publiés (brouillons de l'atelier). Rien n'est fait avant que l'utilisatrice valide. »
  - Aperçu : pour chaque id, post de l'utilisatrice sinon `erreur("introuvable")` ; publié/en cours → `erreur("« <titre> » est déjà publié")` ; `autoPost` vrai → `erreur("« <titre> » est programmé pour partir seul : il ne se supprime pas d'ici")`. Changement : `{ libelle: "« <titre> » (<projet ou campagne>)", avant: jourCourt(scheduledFor) ou "sans date", apres: null }`. Résumé : `Supprimer N post(s)`. Empreinte : `{ table: "content", id, champs: { title, scheduledFor (ISO ou null), publishedAt (null), postStatus, autoPost } }`.
  - `LECTEURS.content(userId, id)` : `storage.getContentById(id, userId)` normalisé (`scheduledFor` en ISO) pour que `memeValeur` compare comme à l'aperçu.
  - Exécution : revérifie chaque post (mêmes trois règles), `deleteContent`, ligne `« <titre> » supprimé` ; puis `reajusterAteliers(userId, lundis)` une fois, best-effort (journalisé, n'ajoute pas d'échec).
  - `export async function reajusterAteliers(deps: ReajusterDeps, userId: string, lundis: string[], aujourdhui: string): Promise<void>` : pour chaque semaine, posts restants du lundi au lundi suivant ; s'il en reste, `placerAteliers` les redimensionne ; sinon, `archivedAt = now` sur les tâches non faites de `getTachesAtelier(userId, lundi)` (archiver, jamais supprimer — règle de `atelier/placement.ts`).

- [ ] **Step 1: tests** — aperçu refusé pour un post d'une autre utilisatrice, publié, `autoPost: true` ; aperçu de 2 brouillons : résumé « Supprimer 2 posts », 2 changements `apres: null` ; validation après qu'un post est passé `autoPost: true` → `expiree` et `deleteContent` jamais appelé ; `reajusterAteliers` : semaine sans post restant → les 2 tâches d'atelier non faites archivées, la tâche faite intacte ; semaine avec 1 post restant → `placerAteliers` appelé avec ce post.
- [ ] **Step 2:** lancer → FAIL.
- [ ] **Step 3:** implémenter.
- [ ] **Step 4:** tests ciblés + `npx tsc --noEmit`.
- [ ] **Step 5:** commit `feat(agent): proposer de supprimer des posts de l'atelier`.

### Task 4: outil `repenser_campagne`

**Files:**
- Modify: `server/services/agent/outils/a-valider.ts`
- Modify: `server/services/agent/propositions.ts` (`LECTEURS.campaigns`)
- Modify: `server/services/campagne/repenser.ts` (branchement des deps pour l'agent)
- Modify: `server/routes.ts` (appeler `brancherRepenser(depsRepenser)` juste après la définition de `depsRepenser`)
- Test: `server/services/agent/outils/a-valider.test.ts`

**Interfaces:**
- Consumes: `lancerRepenser`, `repenserEnCours`, `statutRepensable`, `normaliserConsigne`, `CONSIGNE_MAX`, `DejaEnCours`, `StatutIncompatible`, `CampagneIntrouvable` (repenser.ts) ; `storage.getCampaign(id, userId)` ; `storage.getContent(userId, n, undefined, campaignId)`.
- Produces:
  - dans `repenser.ts` : `export function brancherRepenser(d: RepenserDeps): void` et `export function depsRepenserBranchees(): RepenserDeps | null`.
  - outil `repenser_campagne`, args `{ campagneId: number; consigne: string }` (consigne obligatoire, 1 à `CONSIGNE_MAX` caractères). Description : « Propose de repenser une campagne comme le bouton Repenser : stratégie et plan de posts réécrits avec la consigne, posts non publiés et tâches non faites de la campagne remplacés. Rien n'est fait avant validation. »
  - Aperçu : campagne introuvable / statut non repensable / déjà en cours → erreur lisible ; un post non publié avec `autoPost` → `erreur("« <titre> » est programmé pour partir seul : Repenser le supprimerait")`. Changements : `{ libelle: "Campagne « <nom> »", avant: "<N> posts à venir", apres: "plan réécrit : <consigne>" }`. Résumé : `Repenser « <nom> »`. Empreinte : `{ table: "campaigns", id, champs: { status, updatedAt (ISO) } }`.
  - Exécution : `depsRepenserBranchees()` absent → échec « Repenser n'est pas disponible pour le moment » ; sinon `await lancerRepenser(deps, userId, id, { consigne })` sans attendre `termine` ; réussite : `Repenser « <nom> » est lancé : le nouveau plan arrive dans quelques minutes, dans la campagne` ; `DejaEnCours` → échec `« <nom> » est déjà en train d'être repensée`. Pas d'`actionId` (non annulable).

- [ ] **Step 1: tests** — aperçu refusé si un post `autoPost` non publié ; aperçu valide : 1 changement, résumé exact ; exécution avec deps branchées factices : `lancerRepenser` reçoit la consigne ; deps renvoyant `DejaEnCours` → ligne d'échec, pas d'exception.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implémenter.
- [ ] **Step 4:** tests + tsc.
- [ ] **Step 5:** commit `feat(agent): proposer de repenser une campagne avec une consigne`.

### Task 5: outil `retenir_rythme`

**Files:**
- Modify: `server/services/agent/outils/a-valider.ts`, `server/services/agent/propositions.ts` (`LECTEURS.rythme_projet`)
- Test: `server/services/agent/outils/a-valider.test.ts`

**Interfaces:**
- Consumes: Task 1 (`texteRythme`, `rythmeValide`, `rythmeDeLaMarque`, `ecrireRythme`).
- Produces: outil `retenir_rythme`, args `{ projetId: number; postsParSemaine: number; precision?: string (≤ 300) }`. Description : « Propose de retenir le rythme de publication d'une marque dans Naya (posts par semaine, et ce qui sort ailleurs, comme des news automatisées). Il s'appliquera aux campagnes, à Repenser et à la présence. »
  - Aperçu : projet à elle sinon `introuvable` ; `!rythmeValide` → `erreur("un rythme entre 0,25 et 14 posts par semaine")`. Changement : `{ libelle: "Rythme de « <projet> »", avant: actuel?.texte sans préfixe ou null, apres: nouveau texte sans préfixe }`. Empreinte : `{ table: "rythme_projet", id: projetId, champs: { texte: actuel?.texte ?? null } }`.
  - `LECTEURS.rythme_projet(userId, id)` : `{ texte: (await rythmeDeLaMarque(userId, id))?.texte ?? null }` si le projet est à elle.
  - Exécution : `ecrireRythme` ; ligne `Rythme de « <projet> » retenu : <n> post(s) par semaine`.

- [ ] **Step 1: tests** — 0 et 50 refusés ; aperçu montre l'ancien et le nouveau ; un rythme écrit entre aperçu et validation → `expiree`.
- [ ] **Step 2:** FAIL. **Step 3:** implémenter. **Step 4:** tests + tsc.
- [ ] **Step 5:** commit `feat(agent): retenir le rythme de publication d'une marque`.

### Task 6: ce que l'agent voit et comment il s'y prend

**Files:**
- Modify: `server/services/agent/outils/lecture.ts` (`consulter_contenus`)
- Modify: `server/services/agent/consignes.ts` (`REGLES_AGENT`)
- Modify: `shared/consentement.ts` et `mobile/lib/consentement.ts` (copie conforme)
- Test: `server/services/agent/outils/lecture.test.ts`, `shared/consentement.test.ts`, `server/services/agent/consignes.test.ts`

**Interfaces:**
- Produces:
  - chaque contenu de `consulter_contenus` porte en plus `campagneId`, `format` (`postFormat`), `auto` (`autoPost`) ; chaque campagne porte `projetId` et `rythme` (texte du canal principal `channels[0].frequency` s'il existe) ; la réponse porte `rythmes: { projetId, texte }[]` (rythmes retenus des projets présents).
  - Nouveau paragraphe de `REGLES_AGENT` (texte exact) :
    ```
    - Contenu et campagnes : quand elle trouve qu'il y a trop (ou pas assez) de posts, raisonne d'abord en campagnes : relie les posts à leur campagne (consulter_contenus) et tiens compte de ce qui sort hors de Naya (news automatisées…), puis dis ce que ça change pour chaque campagne. Avant de modifier, propose de regarder les campagnes ensemble et pose au plus trois questions courtes en tout. Ensuite, une proposition : supprimer des brouillons en gardant des posts répartis sur les semaines (supprimer_posts), ou réorienter une campagne (repenser_campagne, avec une consigne tirée de la conversation) ; et retiens le rythme convenu pour chaque marque (retenir_rythme), sans quoi l'atelier se remplira de nouveau.
    ```
  - `PARTICIPES` de `shared/consentement.ts` gagne `repensée?s?` ; la liste `j'ai …` gagne `repensé` ; les deux fichiers restent identiques sous l'en-tête.

- [ ] **Step 1: tests** — `affirmeUneActionFaite("La campagne est repensée.")` et `("J'ai repensé la campagne JMD.")` vrais ; `("Je te propose de repenser la campagne.")` faux ; `consulter_contenus` rend `campagneId`, `auto`, `rythmes` ; `REGLES_AGENT` contient `supprimer_posts`, `repenser_campagne`, `retenir_rythme`.
- [ ] **Step 2:** FAIL. **Step 3:** implémenter (`diff shared/consentement.ts mobile/lib/consentement.ts` ne montre que l'en-tête).
- [ ] **Step 4:** tests + tsc.
- [ ] **Step 5:** commit dans `mobile/` puis dans le dépôt principal `feat(agent): raisonner en campagnes avant de toucher au contenu`.

### Task 7: vérification complète

- [ ] **Step 1:** `npx vitest run` → tous verts ; `npx tsc --noEmit` → 0 ; `cd mobile && npx tsc --noEmit` → seulement les 7 erreurs de routes typées déjà connues (`/prospection`, `/conversation`).
- [ ] **Step 2:** démarrage local sans tâches de fond (`NAYA_SANS_TACHES_DE_FOND=1`), conversation : « il y a trop de posts JMD, les news sortent tous les jours » → l'agent pose ses questions, puis une carte ; vérifier la carte, ne pas valider sur la base de prod.
- [ ] **Step 3:** demander à Jeanne l'accord de déployer (rien en cours de fond) ; push `main` ; build iOS si le mobile a changé (`reference_bureau_icloud`).
