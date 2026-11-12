# Le fil conducteur — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque tâche de Jeanne est rattachée à une étape, donc à un objectif, avec un « pourquoi » stocké. Le matin s'ouvre sur les 2 ou 3 tâches qui comptent, sur tous les objectifs actifs. La présence sur les réseaux ne disparaît plus. Les sept points de la consolidation de 9 h 04 tournent dans Naya, ce qui permet d'arrêter la routine extérieure.

**Architecture :** les **étapes sont les jalons existants**, reliés à un objectif par une nouvelle colonne `project_milestones.goal_id` (justification ci-dessous). Un module `server/services/fil/` porte la logique pure : rattachement, priorité, avancement, objectifs oubliés, présence, mouvements, indicateurs, clôture. Il est branché sur le passage du matin (`runDailyAutoPlanner`) et sur `POST /api/tasks/daily-brief`, qui renvoie un bloc `fil` calculé sans IA, à côté du texte IA. Les propositions (étapes, rattachement des chaînes, journée allégée) réutilisent `agent_propositions` (`propositions.ts`), avec une durée de vie par outil. Tout est derrière l'interrupteur `FIL_CONDUCTEUR_USERS`, sur le modèle de `VEILLE_AO_USERS`.

**Tech Stack :** Express, Drizzle et Neon, `@anthropic-ai/sdk` via `callClaudeWithContext` (`server/services/claude.ts`), Unipile (Gmail), Google Calendar (`google-calendar.ts`), React (web), Expo (sous-module `mobile/`), vitest.

**Spec :** `docs/superpowers/specs/2026-11-10-fil-conducteur-design.md` (validée par Jeanne le 12 nov. 2026 ; elle fait foi).

### Décision : jalons réutilisés, pas de niveau dédié

- Le moteur ne lit pas l'ordre du projet pour débloquer. `checkAndUnlockMilestones` (`milestone-engine.ts:19-50`) suit `milestone_conditions.blockedByMilestoneId`. Plusieurs chaînes indépendantes dans un projet fonctionnent donc déjà : une par objectif.
- On garde les statuts (`locked`, `unlocked`, `active`, `completed`, `skipped`), la garde `jalons-verrouilles.ts`, `tasks.milestoneId`, `createMilestoneChain`, l'outil `creer_jalons` et l'écran `MilestoneRoadmap.tsx`. Un niveau dédié dupliquerait tout cela, ainsi que la règle `locked` de `CLAUDE.md`.
- Ce qu'il faut corriger : quatre lecteurs supposent « un seul jalon actif par projet » (`routes.ts` ~3391, `routes-agent.ts` ~139, `naya-context.ts` ~166, `auto-planner.ts` ~241). Ils passent par une fonction unique `etapesActives` (tâche 2).
- Une chaîne sans `goal_id` reste une chaîne de projet, comme aujourd'hui.

## Global Constraints

- `npx tsc --noEmit` à 0 erreur, à la racine et dans `mobile/`. Toute la suite vitest passe. **Aucun test sur une vraie base** : dépendances injectées ou mocks, comme `atelier/*.test.ts`.
- Interrupteur : `FIL_CONDUCTEUR_USERS` (ids séparés par des virgules), lu par `filActifPour(userId)`. Hors liste, tout le comportement actuel est strictement inchangé. Pas de génération en masse : les propositions d'étapes ne partent qu'à la création d'un objectif, quand toutes ses étapes sont franchies, ou à la demande.
- **Jamais de tâche sur un jalon `locked`.** Le rattachement ne pose jamais `milestoneId` sur un jalon `locked`.
- Plus de repli sur le premier objectif. Une tâche qu'on ne sait pas rattacher reste sans `goalId`, et le matin le signale.
- Avancement compté **à partir de `user_preferences.fil_conducteur_depuis`**. Pas de reclassement des anciennes tâches. La règle « objectif oublié » (7 jours sans tâche faite) ne se déclenche qu'à partir du **8ᵉ jour** après cette date.
- 2 ou 3 tâches clés au plus. La journée n'est pas gonflée.
- Propositions d'étapes : **3 à 6 étapes**, chacune avec une phrase « pourquoi ». Rien n'est créé avant validation. Trois gestes : Valider, Ajuster, Refaire.
- Journée allégée : **proposée, jamais appliquée d'office**. Elle garde au moins une tâche par objectif prioritaire et s'annule pendant 24 h (`annulerAction`).
- Décision du 9 oct. 2026 intacte : `filtrerTachesGenerees` retire toujours le contenu et la prospection des générateurs génériques. Les posts de présence passent par un circuit dédié vers l'atelier. **Rien n'est publié sans validation.**
- Mails en attente : fils des **14 derniers jours**. Échéance **+2 jours**, **+7 jours** pour l'administratif. Exclus : envois automatiques, newsletters, notifications, réponses de prospects (`inbox_*`). Pas de doublon, et une tâche cochée ne revient pas.
- Chantier sans mouvement : **15 jours**. Clôture du vendredi : tâches ouvertes depuis **plus de 7 jours**, et Naya ne les clôt jamais elle-même. Alerte de création : rien de programmé **sur 7 jours** pour un compte actif.
- Un indicateur dont la source est indisponible est affiché « indisponible », jamais inventé ni mis à 0. Chaque indicateur porte sa valeur précédente.
- Appels IA : `isAiBlocked` vérifié avant l'appel (sinon on n'appelle pas, et on journalise). `callClaudeWithContext` (qui injecte `buildNayaContext` et la voix, puis appelle `logInvocation` et `recordSpend`). Sortie structurée validée par zod. Jamais de « pourquoi » générique : la consigne l'interdit, et une garde pure rejette les formules creuses.
- Ne jamais lancer les tâches de fond en local sans `NAYA_SANS_TACHES_DE_FOND=1`.
- Migrations : générées avec `npx drizzle-kit generate`, relues ligne à ligne (uniquement des `ADD COLUMN` nullables et des `CREATE`, aucun `DROP`), appliquées en dev-local seulement. En prod, Jeanne les applique à la main (`MIGRATIONS.md`). **Jamais `drizzle-kit push`.** Numéros : `0040` (lot 1), `0041` (lot 3), `0042` (lot 4). Si un autre chantier prend un numéro avant, on prend le suivant libre.
- Textes d'interface dans `client/src/locales/fr.ts` et `en.ts`. Le « pourquoi » et l'étape apparaissent sur le web **et** sur le mobile.
- Pas de déploiement pendant qu'un travail de fond tourne. Chaque lot se pousse seul, migration d'abord.

## Review Focus

1. **Objectif sans aucune étape, ou dont toutes les étapes sont `locked` sauf une déjà faite.** Le rattachement pose `goalId` sans `milestoneId`, jamais un jalon `locked`, et le matin ne plante pas sur un avancement 0/0 (il affiche l'objectif seul). Test en tâche 3.
2. **Deux objectifs de visibilité actifs dans le même projet.** Une tâche de contenu sans lien explicite n'est pas rattachée au hasard : elle reste sans objectif et compte dans « non rattachées ». Test en tâche 3.
3. **Un fil Gmail où le dernier message vient d'une adresse `noreply`, d'une liste (`List-Unsubscribe`), ou d'un prospect présent dans `inbox_conversations`.** Aucune tâche. Un fil relu le lendemain ne crée pas de doublon, même si la tâche a été cochée. Test en tâche 12.
4. **Un indicateur dont l'API ne répond pas (jeton LinkedIn expiré, agenda non relié).** La valeur est `indisponible`, la valeur précédente reste affichée telle quelle, et le relevé du jour ne l'écrase pas par 0. Test en tâche 15.
5. **Validation d'une journée allégée, puis Jeanne déplace une tâche à la main, puis « Annuler ».** L'annulation de cette tâche est refusée (`modifiee`). Les autres tâches sont remises en place. Test en tâche 8.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `shared/schema.ts`, `migrations/0040_*.sql` | `project_milestones.goal_id`, `project_milestones.pourquoi`, `tasks.pourquoi`, `user_preferences.fil_conducteur_depuis` |
| `shared/fil.ts` | types partagés serveur, web et mobile (ci-dessous) |
| `server/services/fil/interrupteur.ts` | `filActifPour`, `miseEnRoute` |
| `server/services/fil/carte.ts` | `chargerCarte` : objectifs, étapes et avancement d'une utilisatrice ; `etapesActives` |
| `server/services/fil/rattachement.ts` | `choisirRattachement` (pur), `rattacherAvantCreation` |
| `server/services/fil/etapes.ts` | génération et outils de proposition d'étapes et de rattachement des chaînes |
| `server/services/fil/matin.ts`, `priorite.ts`, `oublis.ts`, `allegement.ts` | lot 2 |
| `server/services/fil/presence.ts` | lot 3 |
| `server/services/fil/mails-attente.ts`, `etat-taches-fond.ts`, `mouvements.ts`, `creation.ts`, `indicateurs.ts`, `cloture.ts` | lot 4 |
| `server/routes-fil.ts` | routes `/api/fil/*` |
| `client/src/pages/aujourdhui/{TachesCles,LigneFil,PropositionEtapes,BlocMatinFil}.tsx` | web |
| `mobile/components/fil/*` et `mobile/app/(tabs)/index.tsx` | mobile |

Types partagés (`shared/fil.ts`, à recopier dans `mobile/` si `mobile/tsconfig.json` n'atteint pas `shared/`, comme pour `shared/agent.ts`) :

```ts
export interface LienFil { objectifId: number; objectifTitre: string; etapeId: number | null; etapeTitre: string | null;
  etapeFaites: number; etapePrevues: number; cible: string | null /* « 3 nouveaux clients d'ici fin décembre » */ }
export interface TacheCle { tacheId: number; titre: string; pourquoi: string | null; lien: LienFil | null; score: number }
export interface ObjectifOublie { objectifId: number; titre: string; joursSansTache: number; reprise: { titre: string; pourquoi: string } }
export interface Indicateur { cle: string; libelle: string; valeur: number | string | null; precedente: number | string | null; indisponible?: string }
export interface MatinFil {
  tachesCles: TacheCle[];               // 0 à 3
  objectifsOublies: ObjectifOublie[];
  allegement: { propositionId: number } | null;
  nonRattachees: number;
  rienNeCloche: boolean;                // une seule phrase, pas de liste
  pannes?: { nom: string; dernierSucces: string | null }[];               // lot 4
  chantiersBloques?: { libelle: string; joursSansMouvement: number; prochainPas: string }[];
  creation?: { alertes: string[]; aValider: { libelle: string; lien: string }[] };
  indicateurs?: Indicateur[];
  cloture?: { tacheId: number; titre: string; ouverteDepuis: number }[];  // vendredi
  reconciliation?: { source: string; libelle: string; lien: string }[];   // lundi
}
```

---

## Lot 1 : objectifs → étapes → tâches

### Task 1 : migration 0040, interrupteur et mise en route

**Files :**
- Modify : `shared/schema.ts` (`projectMilestones` ~1142, `tasks` ~496, `userPreferences` ~174)
- Create : `migrations/0040_*.sql` (généré), `shared/fil.ts`, `server/services/fil/interrupteur.ts`, `interrupteur.test.ts`
- Modify : `MIGRATIONS.md`

**Interfaces :**
- Produces :
  - les colonnes `projectMilestones.goalId` (integer, FK `project_goals.id` `on delete set null`, index), `projectMilestones.pourquoi` (text), `tasks.pourquoi` (text), `userPreferences.filConducteurDepuis` (timestamp) ;
  - `filActifPour(userId: string, env?: NodeJS.ProcessEnv): boolean` ;
  - `miseEnRoute(userId: string, maintenant: Date): Promise<Date>`, qui pose `filConducteurDepuis` s'il est vide et renvoie la valeur en base.

- [ ] **Step 1 : tests.** `filActifPour("a", {FIL_CONDUCTEUR_USERS: " a, b "})` vaut `true`, et `false` pour `"c"` ou une variable vide. `miseEnRoute` appelée deux fois renvoie la date du premier appel (le stockage est mocké).
- [ ] **Step 2 :** déclarer les colonnes, `npx drizzle-kit generate`, relire le SQL : 4 `ADD COLUMN`, 1 FK, 1 index, rien d'autre. `npm run db:migrate` en dev-local.
- [ ] **Step 3 :** implémenter. Section « `0040` — à appliquer en prod à la main » dans `MIGRATIONS.md`, avec la requête de vérification (`information_schema.columns` pour les 4 colonnes). Ajouter `FIL_CONDUCTEUR_USERS` à `.env.example`.
- [ ] **Step 4 :** `npx tsc --noEmit`, vitest, commit `feat(fil): colonnes du fil conducteur (0040) et interrupteur`.

### Task 2 : la carte du fil, et les lecteurs « un seul jalon actif »

**Files :**
- Create : `server/services/fil/carte.ts`, `carte.test.ts`
- Modify : `server/storage.ts` (ajouter `getAvancementEtapes`), `server/routes.ts` ~3391, `server/routes-agent.ts` ~139, `server/services/naya-context.ts` ~166, `server/services/auto-planner.ts` ~231-247, `server/services/milestone-engine.ts` (`createMilestoneChain` accepte `goalId` et `pourquoi` par jalon)

**Interfaces :**
- Produces :
  ```ts
  interface EtapeCarte { id: number; objectifId: number | null; projetId: number; titre: string; pourquoi: string | null;
    statut: string; ordre: number; faites: number; prevues: number }
  interface ObjectifCarte { id: number; projetId: number; titre: string; successMode: string; goalType: string;
    cible: string | null; dueDate: Date | null; etapes: EtapeCarte[] /* triées par order */ }
  interface CarteFil { objectifs: ObjectifCarte[]; chainesSansObjectif: Map<number, EtapeCarte[]>; depuis: Date | null }
  chargerCarte(userId: string, depuis: Date | null): Promise<CarteFil>   // objectifs `active` de TOUS les projets
  etapesActives(etapes: EtapeCarte[] | ProjectMilestone[]): typeof etapes  // statut active|unlocked, une par chaîne
  libelleCible(o: ObjectifCarte): string | null
  ```
  - `storage.getAvancementEtapes(userId, milestoneIds: number[], depuis: Date | null): Promise<Map<number, {faites: number; prevues: number}>>`. Ne compte que les tâches de `userId`, non archivées, créées à partir de `depuis`.
  - `createMilestoneChain(projectId, userId, milestones, opts?: { goalId?: number })`, où chaque élément accepte `pourquoi?` et `etat?: "faite"|"en_cours"|"a_venir"`. `faite` donne `completed` avec `completedAt`. La première non faite devient `active`. Les suivantes sont `locked`, avec leur condition sur la précédente.

- [ ] **Step 1 : tests de `carte.test.ts`.**
  - Deux chaînes dans un projet (objectifs A et B) : `etapesActives` en renvoie deux, une par chaîne.
  - Une chaîne sans `goalId` va dans `chainesSansObjectif`.
  - Un objectif `paused` est absent.
  - `getAvancementEtapes` ignore une tâche créée avant `depuis`.
  - `createMilestoneChain` avec `[faite, en_cours, a_venir]` donne `completed`, `active` et `locked`, et une seule condition `blockedByMilestoneId` par jalon non premier.
- [ ] **Step 2 :** implémenter. Les quatre lecteurs passent par `etapesActives`. Dans `routes.ts` et `routes-agent.ts`, on garde **le premier** (comportement inchangé). Dans `naya-context.ts`, les jalons du contexte sont **groupés par objectif** (« Objectif X → étape en cours Y, suivantes verrouillées : … »). L'auto-planner garde sa règle « au moins une étape `active|unlocked` ou aucune chaîne ».
- [ ] **Step 3 :** relancer `server/services/naya-context.*.test.ts`, `jalons-*.test.ts` et `auto-planner-*.test.ts` : ils passent. Commit `feat(fil): carte objectifs-étapes, plusieurs chaînes par projet`.

### Task 3 : rattachement explicite des tâches et « pourquoi » stocké

**Files :**
- Create : `server/services/fil/rattachement.ts`, `rattachement.test.ts`
- Modify : `server/services/auto-planner.ts` (~479-482), `server/services/openai.ts` (`generateDailyTasks` : schéma de sortie), `server/services/atelier/placement.ts` (~67), `server/services/campagne/placement.ts` (~321), `server/services/prospection-verification.ts` (création de la tâche de validation), `server/services/reponses/ingestion.ts` (~471), `server/services/goal-tasks.ts`

**Interfaces :**
- Consumes : `CarteFil`, `etapesActives` (tâche 2).
- Produces :
  ```ts
  type Canal = "contenu" | "prospection" | "autre";
  interface BrouillonTache { projectId: number | null; goalId?: number | null; milestoneId?: number | null;
    contentId?: number | null; leadId?: number | null; campaignId?: number | null; taskType?: string | null; type?: string | null }
  canalDe(b: BrouillonTache): Canal
  choisirRattachement(b: BrouillonTache, carte: CarteFil): { goalId: number | null; milestoneId: number | null }   // PUR
  rattacherAvantCreation(userId: string, b: BrouillonTache, carte?: CarteFil): Promise<{ goalId: number | null; milestoneId: number | null }>
  estPourquoiCreux(p: string | null | undefined): boolean
  ```
- Règles de `choisirRattachement`, dans l'ordre :
  1. `milestoneId` explicite et non `locked` : son objectif.
  2. `goalId` explicite : l'étape active de sa chaîne, sinon `milestoneId: null`.
  3. Canal `contenu` (`contentId`, `taskType` `post_publish|canva_task`, `type` `content`, tâche d'atelier) : l'**unique** objectif actif du projet dont `successMode` ou `goalType` vaut `visibility` (à défaut `consistency`).
  4. Canal `prospection` (`leadId`, `taskType` `linkedin_message|outreach_action|email`, `prospection_validation`) : l'**unique** objectif actif du projet en `revenue`.
  5. Sinon, ou si plusieurs objectifs correspondent : `{null, null}`.
  6. Jamais une étape `locked`.
- `generateDailyTasks` renvoie désormais, par tâche, `goalIndex` (optionnel), `etapeIndex` (optionnel) et `pourquoi` (une phrase qui nomme l'étape ou l'objectif et ce que la tâche débloque).

- [ ] **Step 1 : tests de `rattachement.test.ts`.**
  - Chacune des règles 1 à 5.
  - Deux objectifs `visibility` actifs : `{null, null}` (Review Focus 2).
  - Objectif dont la seule étape non faite est `locked` : `goalId` posé, `milestoneId: null` (Review Focus 1).
  - `estPourquoiCreux("pour avancer ton objectif")` vaut `true`, et `estPourquoiCreux("Sans ce devis signé, l'étape « 1er client IN SCENA » reste bloquée")` vaut `false`. La garde : moins de 25 caractères, ou une liste fermée de formules creuses FR/EN.
  - Auto-planner, utilisatrice dans l'interrupteur : sans `goalIndex` valide, `goalId` vaut `null` (le repli `activeGoals[0]` disparaît). `pourquoi` est stocké, ou `null` s'il est creux. Hors interrupteur : comportement actuel (test de non-régression).
- [ ] **Step 2 :** implémenter. Chaque créateur listé appelle `rattacherAvantCreation` **seulement si `filActifPour`** et si la tâche n'a pas déjà un `goalId`. La carte est chargée une fois par passage, pas une fois par tâche. Le prompt de `generateDailyTasks` reçoit, par objectif, l'étape active et son « pourquoi », et demande `etapeIndex` et `pourquoi`.
- [ ] **Step 3 :** `npx vitest run server/services/atelier server/services/campagne server/services/reponses server/services/auto-planner*` : tout passe. Commit `feat(fil): rattachement explicite et pourquoi des tâches`.

### Task 4 : Naya propose les étapes, Jeanne valide (et les chaînes existantes)

**Files :**
- Create : `server/services/fil/etapes.ts`, `etapes.test.ts`, `server/routes-fil.ts`
- Modify : `server/services/agent/propositions.ts` (durée par outil, `proposerHorsConversation`), `server/services/agent/depot.ts` (`propositionsEnAttente`), `server/services/agent/registre.ts`, `server/routes.ts` (`POST /api/projects/:id/goals` ~2025 : déclencheur), `server/services/milestone-engine.ts` (`confirmMilestone` : déclencheur « chaîne terminée »), `server/routes.ts` (enregistrer `routes-fil`)

**Interfaces :**
- Consumes : `createMilestoneChain(…, {goalId})` (tâche 2), `chargerCarte`.
- Produces :
  - `outilAValider` accepte `dureeMs?: number` (défaut `DUREE_PROPOSITION_MS`, inchangé).
  - `proposerHorsConversation(userId: string, nomOutil: string, args: unknown, maintenant: Date): Promise<PropositionVue | { erreur: string }>`.
  - `depot.propositionsEnAttente(userId: string, outils: string[], maintenant: Date): Promise<AgentProposition[]>`.
  - Outils `a_valider`, durée de **7 jours** :
    - `proposer_etapes({ objectifId, etapes: {titre, pourquoi, etat: "faite"|"en_cours"|"a_venir"}[] })`. L'aperçu refuse un objectif qui a déjà une étape non faite (`{erreur: "chaine_en_cours"}`) et une liste hors 3 à 6. L'exécution appelle `createMilestoneChain(projetId, userId, etapes, {goalId})`.
    - `rattacher_chaine({ projetId, objectifId, jalonIds })`. L'empreinte porte `goal_id` de chaque jalon ; l'exécution pose `goal_id` ; les statuts ne bougent pas.
  - `genererEtapes(userId: string, objectifId: number, note?: string): Promise<{titre: string; pourquoi: string; etat: "faite"|"en_cours"|"a_venir"}[] | null>`. Appel IA, `CLAUDE_MODELS.smart` (`route("strategic_reasoning")`). Le prompt ajoute au contexte : campagnes en cours, campagnes de prospection et leur état, posts publiés sur 30 jours, dernière mesure. Validation zod. Les « pourquoi » creux sont rejetés (un seul nouvel essai).
  - `proposerEtapesPour(userId, objectifId, maintenant, note?)` = `genererEtapes` puis `proposerHorsConversation("proposer_etapes", …)`. Ne fait rien s'il existe déjà une proposition `en_attente` pour cet objectif.
  - `proposerRattachements(userId, maintenant)` : une proposition par projet qui a une chaîne sans objectif et au moins un objectif actif. Avec un seul objectif, il est choisi sans IA. Avec plusieurs, un appel rapide (`CLAUDE_MODELS.fast`) choisit l'objectif, ou s'abstient.
  - Routes (`routes-fil.ts`, toutes `isAuthenticated` et réservées à `filActifPour`, sinon 404) :
    - `GET /api/fil/propositions` : propositions `en_attente` de `proposer_etapes` et `rattacher_chaine` ;
    - `POST /api/fil/objectifs/:id/proposer-etapes` (`{note?}`), qui sert à la demande et à « Refaire » (le client annule l'ancienne avant) ;
    - `POST /api/fil/propositions/:id/ajuster` (`{etapes}`) : annule l'ancienne et en crée une nouvelle avec la liste éditée, sans IA ;
    - `POST /api/fil/rattachements` ;
    - valider et annuler passent par les routes existantes `/api/agent/propositions/:id/*`.

- [ ] **Step 1 : tests de `etapes.test.ts`** (IA et stockage mockés).
  - Une proposition `proposer_etapes` vit 7 jours : validée à J+6 elle s'exécute, à J+7 elle passe `expiree`.
  - Rien n'est créé avant validation (aucun `createMilestone` appelé par `proposerEtapesPour`).
  - Une campagne de prospection `active` dans le contexte : la sortie mockée marque « Lancer la prospection » `en_cours`, et l'exécution la crée `active`, pas `locked`.
  - 2 étapes ou 7 étapes : refus `{erreur: "nombre_etapes"}`.
  - Deuxième appel avec une proposition déjà en attente : aucun nouvel appel IA.
  - `isAiBlocked` vrai : aucun appel IA, aucune proposition.
  - `rattacher_chaine` sur un jalon d'une autre utilisatrice : `{erreur: "introuvable"}`.
  - Validation d'un rattachement : `goal_id` posé, statuts identiques.
  - Les propositions de l'agent (durée 1 h) sont inchangées : `propositions.test.ts` passe tel quel.
- [ ] **Step 2 :** implémenter. Déclencheurs, sous `filActifPour`, en tâche détachée (`void …catch(log)`) :
  - après `POST /api/projects/:id/goals` ;
  - après `confirmMilestone` quand toutes les étapes de la chaîne de l'objectif sont `completed|skipped` ;
  - `proposerRattachements` une fois, à la mise en route (`miseEnRoute` vient de poser la date).
- [ ] **Step 3 :** commit `feat(fil): propositions d'étapes et rattachement des chaînes`.

### Task 5 : écrans des propositions et de l'étape (web et mobile)

**Files :**
- Create : `client/src/pages/aujourdhui/PropositionEtapes.tsx`, `client/src/pages/aujourdhui/LigneFil.tsx`, `client/src/pages/aujourdhui/fil-logique.ts`, `fil-logique.test.ts`
- Modify : `client/src/pages/project/MilestoneRoadmap.tsx` (étapes groupées par objectif, avec bouton « Proposer des étapes »), `client/src/pages/aujourdhui/ListeTaches.tsx`, `client/src/locales/fr.ts`, `en.ts`
- Create : `mobile/components/fil/PropositionEtapes.tsx`, `mobile/components/fil/LigneFil.tsx` ; Modify : `mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/projects.tsx`
- Modify : `server/routes.ts` (`GET /api/tasks/range` et la route du jour : joindre `lien: LienFil | null` à chaque tâche quand `filActifPour`)

**Interfaces :**
- Consumes : routes de la tâche 4, `LienFil` (`shared/fil.ts`).
- Produces : `texteLien(l: LienFil, t): string`, qui donne « Étape : être visible sur LinkedIn, 3 tâches sur 7 faites. Objectif : 3 nouveaux clients d'ici fin décembre ». Sans étape : l'objectif seul. Avec `etapePrevues === 0` : pas de « 0 sur 0 ».

- [ ] **Step 1 : tests de `fil-logique.test.ts`** : les trois formes de `texteLien`, et la liste ajustée (renommer, réordonner, supprimer, ajouter) renvoyée telle quelle à `ajuster`.
- [ ] **Step 2 : implémenter.**
  - Carte de proposition : étapes et pourquoi, boutons Valider, Ajuster (édition en ligne de la liste) et Refaire (champ de note facultatif).
  - Elle s'affiche en tête de la page Aujourd'hui et sur la page projet, et aussi sur le mobile.
  - Sous chaque tâche : `pourquoi` en une ligne et `texteLien` discret.
- [ ] **Step 3 :** `npx tsc --noEmit` (racine et `mobile/`). Vérification à l'écran : `NAYA_SANS_TACHES_DE_FOND=1 npm run dev`, puis captures dans `.maquette/` avant l'envoi (mémoire « vérifier en captures »). Commit dans le sous-module puis dans le dépôt : `feat(fil): étapes et pourquoi à l'écran`.

---

## Lot 2 : le matin

### Task 6 : priorité des tâches clés

**Files :**
- Create : `server/services/fil/priorite.ts`, `priorite.test.ts`

**Interfaces :**
- Consumes : `CarteFil`, `computeGoalUrgencyScore` (`goal-urgency.ts`).
- Produces :
  ```ts
  interface EcheanceProche { tacheId?: number; etapeId?: number; date: string /* YYYY-MM-DD */ }   // jalon targetDate, AO dateLimite, relance prévue
  classerTachesCles(taches: Task[], carte: CarteFil, echeances: EcheanceProche[], energie: string | null, aujourdhui: string): TacheCle[]
  ```
- Formule (pure, documentée en tête du fichier), sur les tâches du jour non faites et non archivées :
  - `score = 40 × urgence normalisée de l'objectif (0..1)` ;
  - `+ 25` si la tâche est sur l'étape active et qu'il en reste au plus 2 pour franchir l'étape (elle débloque la suite) ;
  - `+ 25` si une échéance liée tombe dans les 2 jours ;
  - `+ 10` si `priority === 1` ;
  - énergie `low|depleted` : les `deep_work` passent derrière les autres à score égal à 10 près.
  - On garde 3 tâches au plus, dont **au plus 2 sur un même objectif** tant qu'un autre objectif a une tâche candidate. Une tâche sans objectif n'entre que si moins de 2 candidates en ont un.

- [ ] **Step 1 : tests.** Ordre attendu sur un jeu de 6 tâches et 2 objectifs. La règle « 2 au plus par objectif ». L'effet de l'énergie basse. Une journée vide donne `[]`.
- [ ] **Step 2 :** implémenter, puis commit `feat(fil): priorité des tâches clés`.

### Task 7 : objectifs oubliés et répartition sur la semaine

**Files :**
- Create : `server/services/fil/oublis.ts`, `oublis.test.ts`
- Modify : `server/services/openai.ts` (extraire `construirePromptJournee(request): string` du corps de `generateDailyTasks`, exporté et pur ; ~495-600), `server/services/auto-planner.ts` (lui passer la date et les titres déjà planifiés), `server/services/openai.test.ts` ou un nouveau `openai-prompt-journee.test.ts`

**Interfaces :**
- Produces :
  - `objectifsOublies(carte: CarteFil, derniereTacheFaite: Map<number, Date | null>, maintenant: Date): { objectifId: number; titre: string; joursSansTache: number }[]` : aucune tâche faite depuis 7 jours, et `maintenant ≥ depuis + 8 jours` ;
  - `tacheDeReprise(userId, objectifId): Promise<{ titre: string; pourquoi: string }>` : appel rapide, une tâche de 15 à 30 min sur l'étape active ;
  - `POST /api/fil/objectifs/:id/reprendre` crée cette tâche aujourd'hui (via `creerTache`, rattachée).
  - `DailyTasksRequest` gagne `date: string` et `dejaPlanifieesSemaine: string[]`.

- [ ] **Step 1 : tests.**
  - `objectifsOublies` à J+7 après `depuis` renvoie `[]` (période de grâce). À J+8, sans tâche faite, il renvoie l'objectif. Une tâche faite il y a 6 jours donne `[]`.
  - `construirePromptJournee` contient la date du jour et la consigne « tâches pour CE jour », plus « Monday-Friday » ni « THE WEEK AHEAD ». Il contient les titres de `dejaPlanifieesSemaine` sous « déjà prévues cette semaine, ne pas répéter ».
- [ ] **Step 2 :** implémenter. Ce correctif s'applique à toutes les utilisatrices (c'est un défaut, pas une fonction nouvelle). Commit `fix(planner): une journée générée pour son jour, sans doublon dans la semaine` puis `feat(fil): objectifs oubliés`.

### Task 8 : jour de moins bien, une journée allégée proposée

**Files :**
- Create : `server/services/fil/allegement.ts`, `allegement.test.ts`
- Modify : `server/services/agent/registre.ts`, `server/services/agent/propositions.ts` (`BilanExecution` gagne `actionId?: number`), `server/routes-agent.ts` (renvoyer `actionId` à la validation)

**Interfaces :**
- Consumes : `classerTachesCles`, `modifierTache` (`taches/ecrire-tache.ts`), `depot.ajouterAction`, `annulerAction`.
- Produces :
  - `planAllegement(taches: Task[], cles: TacheCle[], carte: CarteFil, joursSuivants: string[]): { garder: number[]; deplacer: { tacheId: number; vers: string }[] }` (pur). Il garde les tâches clés, plus au moins une tâche par objectif prioritaire (urgence ≥ médiane), plus les tâches à heure fixe et les rituels. Le reste va aux jours travaillés suivants, en tourniquet.
  - Outil `a_valider` `alleger_journee({ date, deplacer })`, valable jusqu'à la fin du jour. L'exécution passe par `modifierTache` et écrit **une** action de journal (lignes avant/après). Le bilan renvoie `actionId`, et l'annulation passe par la route existante `/api/agent/actions/:id/annuler`.

- [ ] **Step 1 : tests.**
  - Avec 2 objectifs prioritaires, chacun garde au moins une tâche.
  - Une tâche `schedulingMode: "fixed"` n'est jamais déplacée.
  - Rien ne bouge avant validation.
  - Validation, puis modification manuelle d'une tâche, puis annulation : cette tâche est refusée (`modifiee`), les autres sont remises (Review Focus 5).
- [ ] **Step 2 :** implémenter, puis commit `feat(fil): journée allégée proposée et annulable`.

### Task 9 : le mot du matin couvre tous les objectifs (serveur)

**Files :**
- Create : `server/services/fil/matin.ts`, `matin.test.ts`
- Modify : `server/routes.ts` (`POST /api/tasks/daily-brief` ~2541-2740)

**Interfaces :**
- Consumes : tâches 2, 3, 6, 7 et 8.
- Produces : `construireMatin(userId: string, aujourdhui: string, maintenant: Date, deps?): Promise<MatinFil>`.
  - L'allègement n'est proposé que si l'énergie du jour (mise à jour aujourd'hui) vaut `low|depleted`, et une fois par jour.
  - `rienNeCloche = tachesCles.length > 0 && objectifsOublies.length === 0 && nonRattachees === 0`, et sans signal du lot 4.

- [ ] **Step 1 : tests de `matin.test.ts`** (dépendances mockées).
  - Le matin d'une utilisatrice dont le projet filtré est A contient les tâches clés de B (le filtre de la barre latérale est ignoré).
  - L'énergie `low` crée une proposition. Rappelé, le matin ne la recrée pas.
  - Sans signal : `rienNeCloche: true`.
- [ ] **Step 2 :** dans la route, sous `filActifPour` :
  - `fil = await construireMatin(...)` est **recalculé à chaque appel**, hors du cache `dailyBriefContent` (sans IA) ;
  - le prompt IA reçoit, à la place des 3 tâches triées par `priority`, les tâches clés avec leur lien et leur pourquoi, les objectifs oubliés et la consigne « si rien ne cloche, une seule phrase » ;
  - le texte reste en cache ;
  - la réponse devient `{ ...existant, fil }`.
  Hors interrupteur : réponse identique à aujourd'hui.
- [ ] **Step 3 :** commit `feat(fil): le matin sur tous les objectifs`.

### Task 10 : le matin à l'écran (web et mobile)

**Files :**
- Create : `client/src/pages/aujourdhui/TachesCles.tsx`, `client/src/pages/aujourdhui/BlocMatinFil.tsx`
- Modify : `client/src/pages/aujourdhui/MotDuMatin.tsx`, `index.tsx`, `logique.ts` et `logique.test.ts`, locales
- Create : `mobile/components/fil/TachesCles.tsx`, `mobile/components/fil/BlocMatinFil.tsx` ; Modify : `mobile/app/(tabs)/index.tsx`

**Interfaces :**
- Consumes : `MatinFil` ; routes `/api/fil/objectifs/:id/reprendre`, `/api/agent/propositions/:id/valider|annuler`, `/api/agent/actions/:id/annuler`.
- Produces : `resumeMatin(fil: MatinFil): { phraseUnique: string | null; sections: string[] }` (`logique.ts`). Avec `rienNeCloche`, une phrase et aucune section.

- [ ] **Step 1 : tests de `resumeMatin`** : `rienNeCloche` donne une phrase et zéro section. Un objectif oublié donne la section `oublis`.
- [ ] **Step 2 : implémenter.**
  - En tête : les tâches clés en cartes, avec titre, pourquoi et `texteLien`.
  - En dessous : les objectifs oubliés (bouton « Reprendre ») et la journée allégée (« Alléger ma journée », puis « Annuler » pendant 24 h).
  - Le nombre de tâches non rattachées, en une ligne.
  - Même rendu sur le mobile.
- [ ] **Step 3 :** `tsc` (racine et mobile), captures `.maquette/`, commit `feat(fil): le matin à l'écran`.

---

## Lot 3 : présence sur les réseaux

### Task 11 : cadence de présence et posts proposés à l'atelier

**Files :**
- Modify : `shared/schema.ts` (`content.origine text`, avec `'presence'` pour ce circuit) ; Create : `migrations/0041_*.sql` ; Modify : `MIGRATIONS.md`
- Create : `server/services/fil/presence.ts`, `presence.test.ts`
- Modify : `server/services/auto-planner.ts` (après `passageAtelierMatin`, sous `filActifPour`)

**Interfaces :**
- Consumes : `depsQuotidien.placer` (`atelier/deps.ts`), `etatPost` (`@shared/atelier`), `rattacherAvantCreation` (tâche 3).
- Produces :
  - `seuilPresenceJours(contentBandwidth: string | null, platformPriority: string | null): number` (pur). Il lit un rythme dans le texte libre de `brand_dna.content_bandwidth` (« 2 posts par semaine », « quotidien », « 1/mois »…) et renvoie `ceil(7 / postsParSemaine)`, borné à **[2, 14]**. Sans rythme lisible : **7**. `platformPriority` sert seulement à choisir la plateforme.
  - `etatPresence(posts: {publishedAt, scheduledFor, socialAccountId, platform, contentStatus, postStatus}[], comptesActifs: {id, platform}[], n: number, maintenant: Date): { aProposer: boolean; plateforme: string | null; joursDepuisDernier: number | null }`. `aProposer` vaut vrai si aucun post n'a été **publié** depuis `n` jours et qu'aucun n'est prévu dans les `n` prochains jours, pour au moins un compte actif.
  - `proposerPostsPresence(userId: string, maintenant: Date): Promise<{ crees: number }>`. Un appel IA donne 1 à 3 posts (consigne, plateforme, pilier), fondés sur l'identité, les piliers (`contentPillars`), la veille et l'actualité de l'agence. Ils sont insérés dans `content` avec `origine: 'presence'`, `campaignId: null`, `consigne` posée et `scheduledFor` sur les prochains jours travaillés. Puis `placer` crée la tâche d'atelier du jour, rattachée par la règle « contenu ». Aucune publication, et `autoPost: false`.
  - Anti-doublon : rien si un post `origine='presence'` non publié existe déjà dans la fenêtre de `n` jours.

- [ ] **Step 1 : tests.**
  - `seuilPresenceJours("2 posts par semaine")` vaut 4, `("quotidien")` vaut 2 et `("1 par mois")` vaut 14. `(null)` et `("je ne sais pas")` valent 7.
  - `etatPresence` : un post **programmé mais pas publié** il y a 10 jours ne compte pas comme publié.
  - Une campagne qui a des posts prévus dans la fenêtre donne `aProposer: false`.
  - `proposerPostsPresence` lancé deux fois le même jour ne crée qu'un lot.
  - Aucun post créé n'a `autoPost: true`.
  - Non-régression : `filtrerTachesGenerees` retire toujours une tâche « Écrire un post LinkedIn » venue de l'auto-planner (`filtre-taches-generees.test.ts` inchangé et vert).
- [ ] **Step 2 :** migration `0041` (un `ADD COLUMN`), relue et appliquée en dev, section dans `MIGRATIONS.md`. Implémenter, puis commit `feat(fil): cadence de présence, posts proposés à l'atelier (0041)`.

---

## Lot 4 : les sept points de la consolidation, dans Naya

### Task 12 : migration 0042 et mails qui attendent une réponse

**Files :**
- Modify : `shared/schema.ts` ; Create : `migrations/0042_*.sql` ; Modify : `MIGRATIONS.md`
- Create : `server/services/fil/mails-attente.ts`, `mails-attente.test.ts`, `server/services/fil/__fixtures__/unipile-emails.json`
- Modify : `server/services/unipile-mail.ts` (lecture)

**Interfaces :**
- Produces (migration `0042`, uniquement des `CREATE TABLE`) :
  - `mails_en_attente` (`id`, `user_id` FK cascade, `thread_id text`, `task_id integer`, `expediteur text`, `sujet text`, `dernier_message_at timestamp`, `created_at`) avec un index unique `(user_id, thread_id)` ;
  - `etat_taches_fond` (`nom text` clé primaire, `dernier_debut`, `dernier_succes`, `derniere_erreur text`, `derniere_erreur_at`) ;
  - `indicateurs_releves` (`id`, `user_id` FK cascade, `cle text`, `valeur double precision` nullable, `texte text`, `indisponible text`, `releve_le date`) avec un index unique `(user_id, cle, releve_le)`.
- Produces :
  - `listerEmailsRecus(accountId: string, depuis: Date): Promise<EmailUnipile[]>` dans `unipile-mail.ts` : `GET /api/v1/emails`, paginé. Vérifier les paramètres dans la doc Unipile (`mailscontroller_listmails`) et les figer dans la fixture.
  - `filsEnAttente(emails: EmailUnipile[], adressesPropres: Set<string>, adressesProspects: Set<string>, maintenant: Date): { threadId: string; expediteur: string; nom: string; sujet: string; dernierAt: Date; administratif: boolean }[]` (pur). Un fil est retenu si son dernier message a moins de 14 jours, vient d'une adresse qui n'est pas à Jeanne, d'un humain (pas `noreply|no-reply|notifications?|newsletter|mailer-daemon`, pas d'en-tête `List-Unsubscribe`, `Auto-Submitted` ≠ `no`, `Precedence: bulk|list`), et pas d'un prospect. `administratif` se lit par mots-clés fermés (facture, URSSAF, impôts, banque, contrat, devis signé, administratif, attestation).
  - `synchroniserMailsEnAttente(userId: string, maintenant: Date): Promise<{ creees: number }>` crée « Répondre à {nom} : {sujet} » avec une échéance à +2 jours (+7 si administratif). La tâche est rattachée au projet, au client ou au prospect dont l'adresse ou le domaine correspond, sinon sans projet. Une ligne `mails_en_attente` est écrite. Un `thread_id` déjà présent ne crée **jamais** de nouvelle tâche.

- [ ] **Step 1 : tests sur la fixture.**
  - Les exclusions une par une (Review Focus 3).
  - Fil de 15 jours : exclu. Dernier message de Jeanne : exclu.
  - Deuxième passage : 0 création. Tâche cochée puis troisième passage : 0 création.
  - Mot « facture » dans le sujet : échéance +7.
  - Compte Gmail Unipile absent ou déconnecté (`emailUnipileAccountId` nul) : `{creees: 0}`, sans erreur.
- [ ] **Step 2 :** migration générée, relue (3 `CREATE TABLE`, 2 index uniques), appliquée en dev. Implémenter. Branché dans `runDailyAutoPlanner` sous `filActifPour`. Commit `feat(fil): mails en attente de réponse (0042)`.

### Task 13 : santé des tâches de fond

**Files :**
- Create : `server/services/fil/etat-taches-fond.ts`, `etat-taches-fond.test.ts`
- Modify : `server/services/auto-planner.ts` (`runDailyAutoPlanner`), `server/services/veille-ao/planificateur.ts`, `server/services/prospection-sender.ts`, `scheduleReadingRoom` (`server/index.ts`), `server/services/agent/indexeur.ts`

**Interfaces :**
- Produces :
  - `suivrePassage<T>(nom: NomTacheFond, fn: () => Promise<T>): Promise<T>`, qui écrit dans `etat_taches_fond` le début, le succès ou l'erreur. Un échec d'écriture ne fait jamais échouer `fn`. `NomTacheFond = "planificateur"|"veille_ao"|"envoi_prospection"|"revue_du_matin"|"indexeur"`.
  - `ATTENDUS: Record<NomTacheFond, { libelle: string; tolereMinutes: number }>` : 26 h pour les quotidiens, 30 min pour l'envoi de prospection et l'indexeur.
  - `pannes(etats, maintenant): { nom: string; dernierSucces: string | null }[]` (pur). Une panne, c'est pas de succès depuis la tolérance, ou une erreur plus récente que le dernier succès. La veille AO n'est attendue que si `utilisatricesVeilleAO()` n'est pas vide.

- [ ] **Step 1 : tests de `pannes`** : jamais passé, en retard, erreur après un succès, et tout va bien.
- [ ] **Step 2 :** implémenter et envelopper les cinq tâches. Naya signale la panne mais ne refait pas leur travail. `construireMatin` remplit `pannes`. Commit `feat(fil): contrôle des tâches de fond`.

### Task 14 : mouvements, agenda et chantiers sans mouvement

**Files :**
- Create : `server/services/fil/mouvements.ts`, `mouvements.test.ts`

**Interfaces :**
- Consumes : `getCalendarEvents(userId, debut, fin)` (`google-calendar.ts`), `CarteFil`.
- Produces :
  - `type Chantier = { cle: string; libelle: string; projetId: number; objectifId?: number; etapeId?: number; noms: string[] /* projet, client, prospects liés */ }`
  - `chantiersDe(carte: CarteFil, projetsActifs, clients, leadsActifs): Chantier[]` : une étape active, sinon un objectif actif sans étape, sinon un projet actif sans objectif.
  - `evenementCite(titre: string, noms: string[]): boolean` : comparaison sans accents ni casse, sur des mots entiers, en ignorant les noms de moins de 3 lettres.
  - `chantiersSansMouvement(chantiers, mouvements: { cle: string; at: Date }[], maintenant: Date, seuilJours = 15): { libelle: string; joursSansMouvement: number; prochainPas: string }[]`. Un mouvement, c'est : une tâche faite, une tâche créée par Jeanne (`source: manual`), un contenu publié, un prospect contacté, une réponse reçue, ou un rendez-vous de l'agenda qui cite le chantier. Le prochain pas est la prochaine tâche non faite de l'étape, sinon le titre de l'étape.
  - `collecterMouvements(userId, chantiers, depuis): Promise<{cle, at}[]>`. Aucune tâche n'est créée depuis l'agenda. Sans agenda relié, on continue sans cette source.

- [ ] **Step 1 : tests.**
  - « Point Garance » cite le chantier « Garance ». « Garantie » ne le cite pas.
  - Un chantier à 14 jours n'est pas signalé, à 15 il l'est.
  - Un rendez-vous il y a 3 jours remet le compteur à 3.
- [ ] **Step 2 :** implémenter, `construireMatin` remplit `chantiersBloques`, puis commit `feat(fil): chantiers sans mouvement et agenda`.

### Task 15 : indicateurs avec leur valeur précédente

**Files :**
- Create : `server/services/fil/indicateurs.ts`, `indicateurs.test.ts`
- Modify : `server/services/social-publishers.ts` (lecture `followers_count` Instagram ; LinkedIn seulement si l'API du compte relié le permet, sinon « indisponible »)

**Interfaces :**
- Produces :
  - `CLES_INDICATEURS` : `prospection_envois_4s`, `prospection_reponses_4s`, `prospection_interesses_4s`, `prospection_rdv_4s`, `pipeline_en_discussion`, `pipeline_relances_echues`, `pipeline_signes` (texte « n / cible », la cible étant lue dans l'objectif `revenue` actif), `audience_abonnes_{compteId}`, `audience_posts_4s_{compteId}`, `ao_a_venir`, `ao_premiers_jets_sans_decision`, `ao_en_redaction_ou_deposes`.
  - `calculerIndicateurs(userId, maintenant, deps): Promise<Indicateur[]>`. Les rendez-vous se comptent dans l'agenda (`evenementCite` sur les noms des prospects). Sans agenda : `indisponible: "agenda non relié"`.
  - `releverEtComparer(userId, aujourdhui, deps): Promise<Indicateur[]>`. Il écrit le relevé du jour (upsert) et lit, pour chaque clé, le dernier relevé **disponible** d'avant aujourd'hui, qui devient `precedente`. Un indicateur indisponible écrit `indisponible` et `valeur: null`, sans écraser.
  - `ligneIndicateurs(ind: Indicateur[]): string` (pur) : une ligne courte pour le mot du matin, avec le sens (↑ ↓ =).

- [ ] **Step 1 : tests.**
  - Indisponible : `valeur: null`, la précédente vient du dernier relevé disponible (Review Focus 4).
  - Le relevé est idempotent dans la journée.
  - « 1 / 2 » quand la cible de l'objectif vaut « 2 clients ». Sans cible numérique : « 1 ».
  - `ligneIndicateurs` ne dépasse pas 140 caractères.
- [ ] **Step 2 :** implémenter. Le relevé est fait au passage du matin, et `construireMatin` remplit `indicateurs`. Le détail s'affiche dans un volet repliable sous le mot du matin (tâche 18) : pas de tableau de bord séparé. Commit `feat(fil): indicateurs et valeur précédente`.

### Task 16 : la création, version Naya

**Files :**
- Create : `server/services/fil/creation.ts`, `creation.test.ts`

**Interfaces :**
- Produces :
  - `suiviCreation(posts, comptesActifs, campagnes, maintenant): { alertes: string[]; aValider: { libelle: string; lien: string }[] }` (pur). Il donne :
    - une alerte par compte actif sans aucun post programmé ni publié dans les 7 prochains jours ;
    - `aValider` : les posts à l'état `brouillon` ou `a_rediger` (`etatPost`) prévus dans les 3 jours (lien vers `lienAtelier`) ;
    - les phases de campagne dont le début tombe dans les 7 jours et qui ne sont pas validées (lire la forme réelle de `campaigns.phases` avant d'écrire le test, et la figer dans le test).
  - Rendez-vous récurrents de création (« Encore Merci : 3 recettes de la semaine », le lundi) : ce sont les **rituels existants** (`recurring_rituals`, `ritual-materialize.ts`). Seul ajout : la tâche matérialisée passe par `rattacherAvantCreation` (canal `contenu`, projet du rituel).

- [ ] **Step 1 : tests.** Compte actif sans post dans 7 jours : une alerte. Post publié hier et rien de prévu : une alerte quand même (la fenêtre regarde devant). Brouillon prévu après-demain : présent dans `aValider`. La tâche de rituel « Encore Merci » est rattachée à l'objectif de visibilité du projet.
- [ ] **Step 2 :** implémenter, `construireMatin` remplit `creation`, puis commit `feat(fil): suivi de création`.

### Task 17 : clôture du vendredi et réconciliation du lundi

**Files :**
- Create : `server/services/fil/cloture.ts`, `cloture.test.ts`
- Modify : `server/routes-fil.ts`

**Interfaces :**
- Produces :
  - `aTrancher(taches: Task[], maintenant: Date): { tacheId: number; titre: string; ouverteDepuis: number }[]` : tâches non faites, non archivées, créées il y a plus de 7 jours. Calculé seulement le vendredi (Europe/Paris).
  - Le vendredi, une tâche courte « Trancher les {n} tâches ouvertes » (15 min) est créée, une fois par semaine.
  - `POST /api/fil/trancher` (`{ tacheId, geste: "faire"|"deplacer"|"abandonner", date? }`) : `faire` met la tâche à aujourd'hui, `deplacer` la met à la date donnée, `abandonner` l'archive (`archivedAt`). Tout passe par `modifierTache`. Naya ne tranche jamais seule.
  - `reconciliation(userId, maintenant, deps): Promise<{ source; libelle; lien }[]>`, seulement le lundi :
    - les conversations `inbox_conversations` `a_traiter` sans tâche, ou dont la tâche est faite sans réponse envoyée ;
    - les appels d'offres à score fort sans décision ;
    - les posts à valider sans tâche d'atelier ;
    - les `mails_en_attente` dont la tâche a disparu.

- [ ] **Step 1 : tests.**
  - Vendredi : une tâche à 8 jours est listée, une à 7 ne l'est pas. Jeudi : `[]`.
  - `abandonner` archive sans supprimer.
  - Lundi : une réponse de prospect sans tâche est listée. Mardi : `[]`.
- [ ] **Step 2 :** implémenter, puis commit `feat(fil): clôture du vendredi et réconciliation du lundi`.

### Task 18 : le lot 4 au mot du matin (web et mobile)

**Files :**
- Modify : `server/services/fil/matin.ts`, `client/src/pages/aujourdhui/BlocMatinFil.tsx`, `logique.ts` et `logique.test.ts`, `mobile/components/fil/BlocMatinFil.tsx`, locales

**Interfaces :**
- Consumes : `MatinFil` complet (tâches 12 à 17).

- [ ] **Step 1 : tests de `resumeMatin`.** Les sections apparaissent dans l'ordre de la spec : pannes, incohérences, chantiers bloqués, retards, nouveaux. Une phrase unique quand rien ne cloche. La section `cloture` n'apparaît que le vendredi, et `reconciliation` que le lundi.
- [ ] **Step 2 : implémenter.**
  - La ligne des indicateurs, et sous elle le volet repliable du détail avec les valeurs précédentes et « indisponible ».
  - Les pannes, les chantiers et la création.
  - La liste à trancher, avec trois boutons.
  - La réconciliation, avec des liens.
  - Même chose sur le mobile.
- [ ] **Step 3 :** `tsc` (racine et mobile), vitest, captures `.maquette/`, puis commit `feat(fil): les sept points au mot du matin`.

---

## Mise en ligne, lot par lot

1. Pour chaque migration (`0040`, puis `0041`, puis `0042`) : sauvegarde Neon de `production`, répétition sur une branche d'essai, puis `scripts/migrate-prod.ts` lancé par Jeanne. **La migration d'abord, le push ensuite**, quand aucun travail de fond ne tourne (pas de « Repenser » ni de génération en cours).
2. `FIL_CONDUCTEUR_USERS=<id de Jeanne>` sur Railway. Au premier passage, `miseEnRoute` pose la date et les propositions de rattachement des chaînes s'affichent.
3. Mobile : commit et push du sous-module `mobile/`, puis mise à jour du pointeur dans le dépôt.

## Étape finale (humaine, pas de code) : arrêter la consolidation de 9 h 04

- [ ] Pendant au moins une semaine complète (un vendredi et un lundi compris), Jeanne compare chaque matin le mot de Naya au message de la routine « Consolidation pilotage ».
- [ ] **Seulement après sa confirmation explicite**, désactiver la routine `trig_01PZVRTZWoLB3PBT132EDRJs`, avec l'outil de routines de Claude, sur sa demande. La base Pilotage dans Notion n'est plus alimentée. Rien n'est supprimé dans Notion.
- [ ] Noter la date d'arrêt dans la spec (§8).
