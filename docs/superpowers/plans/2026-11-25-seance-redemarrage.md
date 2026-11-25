# Séance de redémarrage : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une séance de redémarrage menée dans le chat de Naya, qui met le tableau à jour projet par projet.
- Mise à jour du tableau : tâches, note, statut, créneaux réguliers, envois aux marques avec relances.
- Évaluation des réseaux (Naya + Metricool + Instagram).

**Architecture :**
- Un module serveur `server/services/redemarrage/` garde l'état de la séance (table dédiée), fait le bilan silencieux et fournit au modèle du chat la consigne du projet en cours.
- Les écritures passent par UNE nouvelle proposition groupée par projet (`appliquer_bilan_projet`), validable ligne par ligne et annulable via le journal `agent_actions` étendu à de nouvelles tables.
- Créneaux : `recurring_rituals` + intervalle en semaines.
- Envois : nouvelle table `envois`, relances matérialisées comme les rituels.
- Metricool : lu par son API officielle avec un jeton chiffré, saisi par l'utilisatrice.

**Tech Stack :** Express, Drizzle/Neon (drizzle-kit), React + react-query + wouter, vitest, SDK Anthropic (boucle agent existante), i18n react-i18next.

**Spec :** `docs/superpowers/specs/2026-11-25-seance-redemarrage-design.md`

## Global Constraints
- Interface en français via `t()` (clés dans `client/src/locales/fr.ts` et `en.ts`). La garde `client/src/locales/jsx-guard.test.ts` doit rester verte, sans augmenter `jsx-baseline.json`.
- Écritures de l'agent : jamais directes. Tout passe par une proposition à valider, sauf la création d'envoi et la mise à jour de la séance elle-même (état interne).
- Toute écriture faite par une proposition validée est journalisée dans `agent_actions` et annulable 24 h (`annulerAction`).
- Utilisatrice toujours prise de la session (`ctx.userId` / `req.userId`), jamais d'un argument du modèle.
- Jetons tiers chiffrés au repos avec `encryptToken` / `decryptToken` (`server/services/token-crypto.ts`). Jamais renvoyés au client ni journalisés.
- Aucune API privée non documentée. Metricool : seulement l'API publique documentée.
- Aucun test n'appelle un service extérieur réel. `fetch` est toujours injecté ou simulé.
- Activation par interrupteur `SEANCE_REDEMARRAGE_USERS` (liste d'ids séparés par des virgules, même forme que `FIL_CONDUCTEUR_USERS`). Hors liste : aucune proposition de séance, aucune route active (404).
- Migrations : `npx drizzle-kit generate` → `migrations/0053_*.sql`, une seule migration pour tout le plan (Task 1). Elle est répétée sur une branche Neon avant la prod. Pas de push sur main sans le « oui » de Jeanne.
- Seuil d'absence : `SEUIL_ABSENCE_JOURS = 7`.

## Review Focus
1. **Séance interrompue puis reprise le lendemain**, avec des propositions d'un projet encore en attente. La reprise doit reposer la proposition (ou la refaire si elle a expiré), pas sauter le projet.
2. **Validation partielle** (lignes décochées) puis annulation. Seules les lignes appliquées sont défaites, et une ligne modifiée à la main depuis bloque l'annulation de façon lisible.
3. **Metricool sans accès API** (401/403, offre sans API) ou jeton absent. L'évaluation continue avec Naya + Instagram et dit en clair ce qui manque, sans planter ni inventer de chiffres.
4. **Instagram connecté sans la portée statistiques** (compte connecté avant l'ajout de la portée). Les posts sont listés, les chiffres sont marqués indisponibles, et le texte invite à reconnecter.
5. **Créneau « toutes les 2 semaines » créé un mercredi pour le lundi.** La première occurrence est le lundi suivant, puis tous les 14 jours. Le redémarrage du planning (qui supprime les tâches futures) les re-matérialise sans doublon.

---

### Task 1 : Migration unique et types partagés

**Files :**
- Modify : `shared/schema.ts`. Ajouter à `recurringRituals` deux champs : `intervalWeeks` (`interval_weeks` integer not null default 1) et `anchorDate` (`anchor_date` date null). Ajouter les tables `envois`, `seancesRedemarrage` et `connexionsMetricool`.
- Create : `migrations/0053_*.sql` (généré).
- Test : `shared/schema-redemarrage.test.ts`.

**Interfaces : Produces**
- `envois` : `id serial`, `userId varchar → users (cascade)`, `projectId integer → projects null`, `marque text not null`, `contact text null`, `objet text not null` (le projet présenté, texte libre), `canal text null` (mail, linkedin, instagram, autre), `envoyeLe date not null`, `statut text not null default 'envoye'`, `prochaineRelance date null`, `notes text null`, `createdAt`, `updatedAt`. Index `(userId, prochaineRelance)`.
  - `STATUTS_ENVOI = ["envoye","relance","reponse","accepte","refuse","sans_suite"] as const`, exporté depuis `shared/envois.ts`.
- `seancesRedemarrage` : `id serial`, `userId` (cascade), `statut text not null default 'en_cours'` (en_cours | terminee | abandonnee), `absenceDepuis timestamp null`, `bilan jsonb not null` (bilan silencieux, Task 6), `projets jsonb not null` (`{ projectId, etat: 'a_faire'|'en_cours'|'fait'|'saute', propositionId?: number }[]`), `projetCourant integer null`, `evaluation jsonb null`, `createdAt`, `updatedAt`, `termineeAt timestamp null`. Index unique partiel : une seule séance `en_cours` par utilisatrice.
- `connexionsMetricool` : `userId varchar primary key → users (cascade)`, `jetonChiffre text not null`, `mcUserId text not null`, `blogId text not null`, `etat text not null default 'ok'` (ok | refuse), `verifieLe timestamp null`.
- Types exportés : `Envoi`, `InsertEnvoi`, `SeanceRedemarrage`, `ConnexionMetricool`.

- [ ] **Step 1 :** écrire `shared/schema-redemarrage.test.ts`. Il vérifie que `getTableColumns(recurringRituals)` contient `intervalWeeks` et `anchorDate`, que `getTableColumns(envois)` contient `prochaineRelance` et `statut`, et que `STATUTS_ENVOI` vaut exactement la liste ci-dessus.
- [ ] **Step 2 :** `npx vitest run shared/schema-redemarrage.test.ts` → FAIL (exports manquants).
- [ ] **Step 3 :** ajouter les colonnes, les tables et `shared/envois.ts`, puis `npx drizzle-kit generate`. Relire le SQL : seulement des ADD COLUMN et des CREATE TABLE / INDEX, aucun DROP.
- [ ] **Step 4 :** `npx vitest run shared/schema-redemarrage.test.ts && npx tsc --noEmit -p .` → PASS, 0 erreur.
- [ ] **Step 5 :** commit `feat(redemarrage): schéma (intervalle des rituels, envois, séances, Metricool)`.

### Task 2 : Créneaux « toutes les N semaines »

**Files :**
- Modify : `server/services/rituals.ts`. `ritualOccursOn` reçoit en plus `intervalWeeks` et `anchorDate`.
- Modify : `server/services/ritual-materialize.ts` (passer les nouveaux champs) et les routes rituels (`server/routes.ts` ~2961-3027 : accepter `intervalWeeks` 1-8 et `anchorDate`).
- Modify : `client/src/pages/project/RitualList.tsx` et `ritual-format.ts`. Afficher « toutes les 2 semaines » ; choix de l'intervalle dans le formulaire.
- Test : `server/services/rituals.test.ts` (existant, ajouter des cas).

**Interfaces : Produces** `ritualOccursOn(days: string, date: string, opts?: { intervalWeeks?: number; anchorDate?: string | null }): boolean`.
- Sans `opts`, ou avec `intervalWeeks <= 1`, le comportement est identique à l'actuel.
- Sinon, le jour doit être dans `days`, ne pas précéder `anchorDate`, et la semaine ISO (lundi) de `date` doit être à un multiple de `intervalWeeks` semaines de la semaine ISO de `anchorDate`.
- `anchorDate` null avec un intervalle supérieur à 1 : traité comme intervalle 1. La route pose toujours `anchorDate` à la création, égale à la date du jour.

- [ ] **Step 1 :** tests dans `rituals.test.ts` :
  - `ritualOccursOn("mon","2026-11-30",{intervalWeeks:2,anchorDate:"2026-11-25"}) === true` ;
  - `"2026-12-07"` → `false` ;
  - `"2026-12-14"` → `true` ;
  - `"2026-11-23"` (avant l'ancre) → `false` ;
  - sans opts, `ritualOccursOn("mon","2026-12-07") === true`.
- [ ] **Step 2 :** `npx vitest run server/services/rituals.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter, brancher `materializeRituals` (`ritual.intervalWeeks`, `ritual.anchorDate`) et la route (validation 1 ≤ intervalWeeks ≤ 8, sinon 400). Afficher l'intervalle côté client avec de nouvelles clés i18n `rituels.toutesLesNSemaines`.
- [ ] **Step 4 :** `npx vitest run server/services/rituals.test.ts server/services/ritual-materialize.test.ts client/src/locales` → PASS.
- [ ] **Step 5 :** commit `feat(rituels): fréquence toutes les N semaines`.

### Task 3 : Envois aux marques et relances

**Files :**
- Create : `server/services/envois/store.ts`. CRUD borné à userId : `creerEnvoi`, `majEnvoi`, `envoisDe(userId, { projectId? })`, `getEnvoi(id, userId)`.
- Create : `server/services/envois/relances.ts`. `materializeRelances(userId: string, date: string): Promise<number>` crée, pour chaque envoi dont `prochaineRelance === date` et dont le statut est dans (`envoye`, `relance`), une tâche « Relancer {marque} : {objet} ».
  - La tâche est `fixed` seulement si un créneau est fourni ; sinon elle est `flexible`, 15 min, `source: "relance_envoi"`.
  - Pas de nouvelle colonne : l'idempotence passe par (`source = 'relance_envoi'`, titre exact, `scheduledDate`) pour cette utilisatrice.
- Create : `server/routes-envois.ts`. `GET /api/envois?projectId=`, `POST /api/envois`, `PATCH /api/envois/:id`, enregistrées dans `server/routes.ts`.
- Modify : `server/services/auto-planner.ts:222`, `server/routes.ts:2477` et `:5232`. Appeler `materializeRelances` juste après `materializeRituals`, même `catch`.
- Create : `client/src/pages/project/EnvoisPanel.tsx`. Liste des envois du projet (marque, objet, envoyé le, statut, prochaine relance), changement de statut et de date de relance. Monté dans la page projet à côté de `RitualList`.
- Test : `server/services/envois/relances.test.ts`, `server/routes-envois.test.ts`.

**Interfaces : Produces**
- `creerEnvoi(userId: string, e: Omit<InsertEnvoi,"id"|"userId"|"createdAt"|"updatedAt">): Promise<Envoi>`.
- `majEnvoi(userId: string, id: number, champs: Partial<Pick<Envoi,"statut"|"prochaineRelance"|"notes"|"contact">>): Promise<Envoi | undefined>`.
- `materializeRelances(userId, date)`.
- `PATCH` modifie `prochaineRelance` : la tâche de relance non faite de l'ancienne date (même titre, `source relance_envoi`) est supprimée. La nouvelle est créée le jour venu.

- [ ] **Step 1 :** tests :
  - relance due aujourd'hui → 1 tâche ;
  - deuxième appel → 0 (idempotent) ;
  - statut `reponse` → 0 ;
  - envoi d'une autre utilisatrice → 0 ;
  - route : `PATCH` d'un envoi d'une autre → 404 ;
  - `PATCH prochaineRelance` supprime la tâche non faite de l'ancienne date, et garde une tâche cochée.
- [ ] **Step 2 :** `npx vitest run server/services/envois server/routes-envois.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter, puis le panneau client (clés `envois.*`).
- [ ] **Step 4 :** mêmes tests + `client/src/locales` → PASS.
- [ ] **Step 5 :** commit `feat(envois): suivi des envois aux marques et relances`.

### Task 4 : Journal et annulation étendus

**Files :**
- Modify : `server/services/agent/depot.ts`. `LigneJournal.table` accepte en plus `"projects" | "recurring_rituals" | "envois"`.
- Modify : `server/services/agent/journal.ts`. `GESTIONS` gagne trois entrées :
  - `projects` : lire avec `storage.getProject(id,userId)`, restaurer avec `storage.updateProject` sur les seuls champs `statusNote` et `projectStatus`, supprimer → erreur (jamais créé) ;
  - `recurring_rituals` : lire borné à userId, restaurer par update, supprimer par `deactivateRitual` puis suppression des tâches futures non faites du rituel ;
  - `envois` : lire, restaurer, supprimer via `store.ts`.
- Modify : `server/services/agent/propositions.ts`. `LECTEURS` gagne `recurring_rituals` et `envois` pour l'empreinte (`projects` existe).
- Test : `server/services/agent/journal.test.ts` (ajouter des cas).

- [ ] **Step 1 :** tests :
  - action avec une ligne `projects` (avant `{statusNote:"A"}`, après `{statusNote:"B"}`) → `annulerAction` remet « A » ;
  - si statusNote vaut « C » entre-temps → `{ok:false, raison:"modifiee"}` ;
  - ligne `recurring_rituals` créée (avant null) → annulation désactive le rituel et supprime ses tâches futures non faites ;
  - ligne `envois` créée → supprimée.
- [ ] **Step 2 :** `npx vitest run server/services/agent/journal.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run server/services/agent` → PASS.
- [ ] **Step 5 :** commit `feat(agent): annulation des projets, rituels et envois`.

### Task 5 : Proposition groupée par projet, validable ligne par ligne

**Files :**
- Create : `server/services/redemarrage/bilan-projet.ts`. Outil `appliquer_bilan_projet` construit avec `outilAValider`, `dureeMs` de 7 jours.
- Modify : `server/services/agent/propositions.ts`. `validerProposition(userId, id, maintenant, options)` accepte `options.lignes?: number[]` (indices dans `changements` à appliquer). Quand c'est fourni, `executer` reçoit `{ ...arguments, lignesRetenues: lignes }`. Les outils qui l'ignorent appliquent tout, ce qui laisse le comportement actuel inchangé.
- Modify : `server/routes-agent.ts:57`. Le corps facultatif `{ lignes: number[] }` est validé (entiers ≥ 0 et < nombre de changements, sinon 400).
- Modify : `server/services/agent/registre.ts`. Ajouter l'outil au `REGISTRE` et à `HORS_CONVERSATION` (c'est la séance qui le propose, Task 7).
- Modify : `client/src/components/companion/Propositions.tsx`. Une case à cocher par changement, quand la proposition porte `selectionnable: true` (nouveau champ facultatif de `PropositionVue` dans `shared/agent.ts`). « Valider » envoie les indices cochés. Clés `propositions.validerSelection`.
- Test : `server/services/redemarrage/bilan-projet.test.ts`, `server/services/agent/propositions.test.ts` (ajout).

**Interfaces : Produces**
```ts
export type OperationBilan =
  | { type: "cocher_tache"; taskId: number }
  | { type: "archiver_tache"; taskId: number }
  | { type: "note_projet"; texte: string }                       // statusNote
  | { type: "statut_projet"; statut: "active" | "paused" | "incubating" }
  | { type: "creer_creneau"; titre: string; days: string; startTime: string; durationMinutes: number; intervalWeeks: number }
  | { type: "arreter_creneau"; ritualId: number }
  | { type: "creer_envoi"; marque: string; objet: string; canal?: string; envoyeLe: string; prochaineRelance?: string; contact?: string }
  | { type: "creer_tache"; titre: string; dureeMinutes?: number; date?: string };
export interface ArgsBilanProjet { projectId: number; operations: OperationBilan[]; lignesRetenues?: number[] }
```
- Un changement par opération, dans le même ordre (indice = indice d'opération), avec des libellés lisibles en français.
- L'empreinte couvre chaque tâche touchée (`completed`, `archivedAt`), le projet (`statusNote`, `projectStatus`) et chaque rituel arrêté (`active`).
- `executer` applique les opérations retenues, chacune isolément (réussite partielle), et écrit UNE action `agent_actions` dont les lignes couvrent tout ce qui a été écrit. Il rend `actionId`.
- Les créneaux créés reçoivent `anchorDate` = date du jour (fuseau), puis sont matérialisés sur 14 jours, comme la route rituels, avec `fixOverlappingTasks`.

- [ ] **Step 1 :** tests :
  - aperçu de 3 opérations → 3 changements ;
  - validation avec `lignes:[0,2]` → seules les opérations 0 et 2 sont appliquées ; l'action journalisée ne contient que leurs lignes ;
  - une tâche cochée à la main entre l'aperçu et la validation → `expiree` ;
  - `lignes:[5]` sur 3 changements → route 400 ;
  - `projectId` d'une autre utilisatrice → refus d'aperçu `projet_introuvable` ;
  - un outil existant (`deplacer_taches`) validé sans `lignes` se comporte comme avant.
- [ ] **Step 2 :** `npx vitest run server/services/redemarrage/bilan-projet.test.ts server/services/agent/propositions.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (serveur puis client).
- [ ] **Step 4 :** `npx vitest run server/services/agent server/services/redemarrage server/routes-agent.test.ts client/src` → PASS.
- [ ] **Step 5 :** commit `feat(redemarrage): proposition groupée par projet, validable ligne par ligne`.

### Task 6 : Absence et bilan silencieux

**Files :**
- Create : `server/services/redemarrage/absence.ts`. `derniereActivite(userId): Promise<Date | null>` renvoie le maximum de :
  - `tasks.completedAt` ;
  - `companion_conversations.createdAt` où `role = 'user'` ;
  - `task_schedule_events.createdAt`.

  `absenceDetectee(derniere: Date | null, maintenant: Date): boolean` vaut vrai si `derniere` est non nulle et vieille d'au moins `SEUIL_ABSENCE_JOURS`.
- Create : `server/services/redemarrage/bilan.ts`. `bilanSilencieux(deps, userId, depuis: Date, maintenant: Date): Promise<BilanSilencieux>`, avec `deps` injecté (storage, lecteurs réseaux de la Task 8).
- Test : `absence.test.ts`, `bilan.test.ts`.

**Interfaces : Produces**
```ts
export interface BilanProjet {
  projectId: number; nom: string; statut: string; priorite: number | null;
  noteActuelle: string | null;
  tachesEnRetard: { id: number; titre: string; date: string }[];   // non faites, non archivées, date < aujourd'hui
  derniereTacheFaite: string | null;                                // ISO
  postsPrevus: number; postsPublies: number;                        // Naya seulement ici ; Metricool ajouté par la Task 8
  creneaux: { id: number; titre: string; rythme: string }[];
  envoisEnCours: { id: number; marque: string; objet: string; prochaineRelance: string | null }[];
}
export interface BilanSilencieux { depuis: string; projets: BilanProjet[] }
```
- Ordre des projets : actifs d'abord, puis en pause ; ensuite par `priorityLevel` croissant (null en dernier), puis par nom. Les projets `incubating` sont exclus.

- [ ] **Step 1 :** tests :
  - activité il y a 8 jours → absence ;
  - il y a 6 jours → non ;
  - aucune activité → non (compte neuf) ;
  - bilan : une tâche en retard d'un projet en pause apparaît ;
  - les projets sont triés actifs → pause ;
  - un projet `incubating` est absent ;
  - une tâche d'une autre utilisatrice n'apparaît jamais.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run server/services/redemarrage` → PASS.
- [ ] **Step 5 :** commit `feat(redemarrage): détection d'absence et bilan silencieux`.

### Task 7 : La séance dans le chat

**Files :**
- Create : `server/services/redemarrage/seance.ts`. Ce module :
  - crée une séance (`demarrerSeance(userId, maintenant)`, ou rend la séance `en_cours` existante) ;
  - avance (`projetSuivant`) ;
  - rattache une proposition au projet courant ;
  - termine (`terminerSeance`) ou abandonne.
- Create : `server/services/redemarrage/consigne.ts`. `consigneSeance(seance: SeanceRedemarrage): string` est le texte ajouté au système du chat quand une séance est `en_cours`. Il contient :
  - le bilan du projet courant ;
  - la règle « montrer ce que tu sais en 2-3 lignes, demander où elle en est, au plus 2 relances ciblées, puis appeler `proposer_bilan_projet` » ;
  - la règle « ne jamais demander ce qui est dans le bilan » ;
  - la règle « détecter le travail fait hors de Naya et proposer un créneau régulier ».
- Create : outil de conversation `proposer_bilan_projet` (classe `a_valider`, offert au modèle seulement pendant une séance). Il appelle `proposerHorsConversation(..., "appliquer_bilan_projet", args)` pour le projet courant, le rattache à la séance et renvoie la proposition `selectionnable`.
- Create : outil de conversation `passer_projet` (direct, état interne : marque le projet `saute`).
- Create : outil `consulter_evaluation_reseaux` (lecture, Task 8).
- Modify : `server/routes-agent.ts`. Nouvelles routes :
  - `POST /api/redemarrage/demarrer` ;
  - `GET /api/redemarrage` (séance en cours, ou proposition d'en lancer une si absence détectée) ;
  - `POST /api/redemarrage/abandonner`.

  Dans `POST /api/companion/chat`, si une séance est en cours : ajouter `consigneSeance` au système et les outils de séance à la liste.
- Modify : `server/services/agent/boucle.ts`. Seulement si nécessaire pour accepter des outils et une consigne supplémentaires en paramètre (`executerAgent(..., { outilsEnPlus?, consigneEnPlus? })`).
- Modify : `client/src/components/NayaCompanion.tsx`. Ajouts :
  - un bandeau « On fait le point ? » quand `GET /api/redemarrage` propose une séance, avec les boutons Commencer et Plus tard ;
  - pendant la séance, l'indicateur « Projet 3/7 : {nom} » et le bouton « Reprendre plus tard » ;
  - un bouton « Faire le point » toujours accessible dans le menu du chat.

  Clés `redemarrage.*`.
- Fin de séance : quand le dernier projet est `fait` ou `saute`, `terminerSeance` calcule l'évaluation (Task 8) et la stocke. La séance donne au modèle la consigne d'écrire le récap : évaluation, ce que Naya a compris de sa façon de travailler, créneaux et envois ajoutés.
- Reprise : à chaque message, si le projet courant a une proposition `en_attente`, elle est remontée au client. Si elle est `expiree`, le projet repasse `en_cours` sans proposition, et la consigne demande de la refaire à partir de l'historique.
- Test : `seance.test.ts`, `consigne.test.ts`, `server/routes-redemarrage.test.ts`.

- [ ] **Step 1 :** tests :
  - `demarrerSeance` deux fois → même séance ;
  - hors `SEANCE_REDEMARRAGE_USERS` → routes 404 et pas de proposition de séance ;
  - après validation de la proposition du projet 1, `projetSuivant` passe au projet 2 ;
  - séance interrompue puis rechargée → même projet courant et même proposition en attente ;
  - proposition expirée → le projet repasse `en_cours` sans proposition ;
  - tous les projets faits → statut `terminee`, `evaluation` non nulle ;
  - `consigneSeance` contient le nom du projet courant et ses tâches en retard, mais aucune donnée d'un autre projet.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter serveur puis client.
- [ ] **Step 4 :** `npx vitest run server/services/redemarrage server/routes-redemarrage.test.ts server/services/agent client/src` → PASS.
- [ ] **Step 5 :** commit `feat(redemarrage): la séance dans le chat`.

### Task 8 : Évaluation des réseaux (Naya, Metricool, Instagram)

**Files :**
- Create : `server/services/metricool/client.ts`. Client de l'API publique Metricool.
  - **Avant d'écrire**, lire la documentation officielle de l'API Metricool (page « API » de l'aide Metricool, et la doc liée depuis le compte) et fixer dans un commentaire d'en-tête les URL exactes : base, en-tête d'authentification, paramètres `userId` / `blogId`, liste des posts programmés ou publiés sur une période, statistiques par réseau. Si une fonction n'est pas documentée, ne pas la coder et renvoyer `indisponible`.
  - Signatures : `postsMetricool(cx: { jeton: string; mcUserId: string; blogId: string }, debut: Date, fin: Date, f?: typeof fetch): Promise<{ ok: true; posts: { reseau: string; prevuLe: string; publie: boolean; texte: string }[] } | { ok: false; raison: "refuse" | "indisponible" | "erreur" }>` et `statsMetricool(cx, debut, fin, f?)`, qui rend `{ ok: true; parReseau: { reseau: string; portee: number | null; abonnesGagnes: number | null; meilleurs: { texte: string; portee: number | null }[] }[] } | { ok: false; raison }`.
  - Un 401 ou 403 donne `refuse`, et l'état de la connexion passe à `refuse`.
- Create : `server/routes-metricool.ts`. Connexion depuis les Réglages : `PUT /api/metricool/connexion` (jeton, mcUserId, blogId → chiffré, puis vérifié par un appel à `postsMetricool` sur 1 jour), `DELETE`, `GET` (état seulement, jamais le jeton).
- Create : `client/src/pages/settings/MetricoolConnexion.tsx`. Champs, état, lien vers l'aide Metricool. Monté dans la page Réglages, section connexions.
- Modify : `server/services/social-oauth.ts:45`. Ajouter la portée `instagram_business_manage_insights` derrière l'interrupteur `INSTAGRAM_INSIGHTS_SCOPE=1`, même forme que les commentaires.
- Create : `server/services/redemarrage/reseaux.ts`.
  - `lireInstagram(compte, debut, fin, f?)` utilise `graph.instagram.com` : `/me/media` (posts de la période) et `/{media}/insights?metric=reach,saved,shares` si la portée est présente ; sinon les chiffres sont `null`, avec la raison `portee_manquante`.
  - `evaluationReseaux(deps, userId, depuis, maintenant): Promise<EvaluationReseaux>` assemble :
    - prévu contre publié : posts Naya (`content`) + posts Metricool, dédoublonnés par réseau, minute et 40 premiers caractères du texte ;
    - chiffres : Metricool en priorité, Instagram sinon ;
    - LinkedIn profil : `limites: ["linkedin_profil_non_lisible"]`.
- Test : `server/services/metricool/client.test.ts` (fetch simulé à partir des réponses documentées), `server/services/redemarrage/reseaux.test.ts`, `server/routes-metricool.test.ts`.

**Interfaces : Produces**
```ts
export interface EvaluationReseaux {
  depuis: string;
  parReseau: { reseau: string; prevus: number; publies: number; manques: { texte: string; prevuLe: string }[];
               portee: number | null; abonnesGagnes: number | null; meilleurs: { texte: string; portee: number | null }[]; source: "metricool" | "instagram" | "naya" }[];
  limites: string[];   // codes : metricool_absent, metricool_refuse, portee_manquante, instagram_expire, linkedin_profil_non_lisible
}
```
- [ ] **Step 1 :** tests :
  - Metricool 403 → `limites` contient `metricool_refuse`, l'évaluation est rendue avec Naya seule et la connexion passe à `refuse` ;
  - jeton absent → `metricool_absent` ;
  - un même post dans Naya et dans Metricool → compté une fois ;
  - Instagram sans portée → chiffres `null` + `portee_manquante`, jamais 0 ;
  - `GET /api/metricool/connexion` ne contient jamais le jeton ;
  - le jeton est stocké chiffré (`isEncrypted`).
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter. Brancher `evaluationReseaux` dans `bilanSilencieux` (`postsPrevus` / `postsPublies` par projet, Metricool compris) et dans `terminerSeance`. Ajouter l'outil de lecture `consulter_evaluation_reseaux`.
- [ ] **Step 4 :** `npx vitest run server/services/metricool server/services/redemarrage server/routes-metricool.test.ts client/src` → PASS.
- [ ] **Step 5 :** commit `feat(redemarrage): évaluation des réseaux avec Metricool et Instagram`.

### Task 9 : Envois depuis le chat, à tout moment

**Files :**
- Modify : `server/services/agent/outils/directs.ts`. Nouvel outil direct `noter_envoi` (marque, objet, canal?, envoyeLe?, prochaineRelance?, projetId?). Par défaut, envoyeLe = aujourd'hui et prochaineRelance = envoyeLe + 7 jours. Il est journalisé (ligne `envois` créée) et annulable.
- Modify : `server/services/agent/registre.ts`. `DIRECTS_AUTORISES` gagne `noter_envoi`. Le test du registre doit être mis à jour : la table de vérité est la spec.
- Modify : `server/services/agent/outils/lecture.ts`. Nouvel outil `consulter_envois`.
- Test : `server/services/agent/outils/directs.test.ts`, `registre.test.ts`.

- [ ] **Step 1 :** tests :
  - « noter_envoi » sans dates → envoyeLe = aujourd'hui (fuseau Europe/Paris), relance à J+7 ;
  - annulation → envoi supprimé ;
  - `consulter_envois` ne rend que ceux de l'utilisatrice.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run server/services/agent` → PASS.
- [ ] **Step 5 :** commit `feat(envois): noter un envoi depuis le chat`.

### Task 10 : Vérification d'ensemble

- [ ] **Step 1 :** `npx tsc --noEmit -p . && npx vitest run > /tmp/naya-suite.log 2>&1; tail -5 /tmp/naya-suite.log` → 0 erreur de type, suite entièrement verte.
- [ ] **Step 2 :** répéter la migration 0053 sur une branche Neon tirée de la prod (`MIGRATION_DATABASE_URL=<branche> npx tsx scripts/migrate-prod.ts`) → succès, `recurring_rituals` existants avec `interval_weeks = 1`.
- [ ] **Step 3 :** lancer l'app en local (`NAYA_SANS_TACHES_DE_FOND=1`, `SEANCE_REDEMARRAGE_USERS=<id de test>`) sur la branche Neon, faire une séance de bout en bout et vérifier en captures :
  - bandeau ;
  - un projet ;
  - validation partielle ;
  - « Reprendre plus tard » ;
  - reprise ;
  - fin avec évaluation.
- [ ] **Step 4 :** commit éventuel des corrections. Mise en ligne seulement avec le « oui » de Jeanne : migration prod, puis push, puis `SEANCE_REDEMARRAGE_USERS` et `INSTAGRAM_INSIGHTS_SCOPE` dans Railway.
