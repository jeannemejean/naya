# Ordre des tâches dans le calendrier (mode projet) — conception

**Date :** 6 octobre 2026

> Demande d'origine, dans les mots de l'utilisatrice : « je voudrais que tu prennes bien le temps de regarder que les tâches soient bien créées en mode projet, c'est-à-dire que la tâche qui sera placée en premier dans le calendrier [soit] la première tâche, et un peu à la manière d'un diagramme de Gantt, que la tâche suivante qui sert à réaliser l'objectif ne puisse être mise dans le calendrier qu'à partir du moment où la tâche précédente, qui est donc une tâche bloquante, [est] réalisée. »
>
> Choix tranché ensuite : la tâche suivante **reste dans le calendrier**, toujours **après** la tâche bloquante, verrouillée tant que celle-ci n'est pas cochée ; si la bloquante glisse, la suivante glisse avec elle.

## Ce qu'on construit

1. **Une règle unique de précédence** : aucune tâche non terminée ne commence avant la fin de ses prérequis non terminés. Appliquée après **tout** placement ou déplacement de tâches, y compris un déplacement manuel.
2. **Des dépendances toujours valides** : un seul point d'entrée qui refuse l'auto-dépendance, l'inter-comptes, l'inexistant et le cycle.
3. **Des descriptions autonomes** : plus de « Task 2 » ; un prérequis est cité par son titre.
4. **Une remise en ordre ponctuelle** du planning existant de l'utilisatrice, validée par elle avant application.

## Ce qu'on ne construit pas

- **Pas de retrait du calendrier** des tâches bloquées (option écartée par l'utilisatrice). L'affichage verrouillé existant (cadenas, grisé, « attend … ») est conservé tel quel.
- **Pas de génération de dépendances manquantes** a posteriori (les chaînes que l'IA n'a pas déclarées ne sont pas devinées). La consigne de génération est renforcée pour qu'elle les déclare.
- **Pas de modification de dépendances valides existantes**, ni de suppression de tâches.

## État constaté (code + production, 6 oct. 2026)

| Élément | Emplacement | État |
|---|---|---|
| Dépendances | `shared/schema.ts` → `taskDependencies` (`task_id`, `depends_on_task_id`, `relation_type` `blocked_by`/`follows`/`subtask_of`) | 8 lignes en prod, dont **533 ← 533** (auto-dépendance) |
| Violations en prod | tâches 531/533, 551/550, 539/537 | La tâche dépendante est planifiée **avant** son prérequis |
| Tri par dépendances | `server/services/dependency-sort.ts` → `orderGeneratedTasks` | Utilisé **seulement** par l'auto-planner, par projet et par jour |
| Création de dépendances | `routes.ts` → `POST /api/tasks/generate-daily` (~5739), `generate-monthly` (~4656), `POST /api/tasks/:id/dependencies` (~5915), `storage.createTaskDependency`, auto-planner (~561) | Seul l'auto-planner filtre l'auto-référence. `generate-monthly` : index **décalés** après `.filter(!_unschedulable)` |
| Re-tassage commun | `storage.fixOverlappingTasks(userId, fromDate)` → `schedule-repack.ts` `repackDay` | Appelé par generate-daily, PATCH tâche (déplacement manuel), campagnes, auto-planner (4 sites), 2 autres routes. **Ignore les dépendances** |
| Chemins sans re-tassage | `rebalance-week`, `place-today`, `generate-monthly`, `replan/apply`, `rolloverStaleTasks` | Placent/déplacent sans dépendances |
| Verrou | `server/services/task-lock.ts` (`verrouDeTache`), routes `/complete` et `/toggle` | Empêche de **cocher** une tâche bloquée ; UI cadenas (`time-grid.tsx`, `todays-tasks.tsx`) |
| Consigne IA | `server/services/openai.ts` → `generateDailyTasks` (~562-580) | Explique les index ; **ne dit pas** de ne pas citer « Task N » ni de placer les prérequis avant |

## Conception

### 1. La règle de précédence (cœur, PUR)

Nouveau module `server/services/precedence.ts` :

```ts
respecterPrecedences(entree: {
  taches: Array<{ id: number; scheduledDate: string | null; scheduledTime: string | null; estimatedDuration: number | null; completed: boolean }>;
  dependances: Array<{ taskId: number; dependsOnTaskId: number }>;
  calendrier: { joursTravailles: Set<string>; debutJournee: string; finJournee: string; tamponMin: number };
}): Array<{ id: number; scheduledDate: string; scheduledTime: string }>  // déplacements à appliquer
```

- Ne considère que les dépendances dont **les deux** tâches sont non terminées et planifiées (date + heure). Un prérequis terminé ne contraint plus rien ; un prérequis sans date ne contraint pas (il sera placé ailleurs).
- Ignore auto-références et cycles (les tâches d'un cycle gardent leur place — jamais de boucle infinie).
- Parcours topologique : pour chaque tâche, `débutMin = max(début actuel, fin de chaque prérequis + tampon)`. Si ce début + durée dépasse `finJournee`, la tâche part au **prochain jour travaillé** à `debutJournee` (puis la contrainte se réapplique). Les tâches non contraintes ne bougent pas.
- Rend uniquement les déplacements (liste vide si tout est déjà dans l'ordre).

La fonction ne gère **pas** les chevauchements : c'est le rôle du re-tassage existant.

### 2. Brancher la règle au re-tassage commun

`storage.fixOverlappingTasks(userId, fromDate)` devient « précédences puis re-tassage », en boucle jusqu'à stabilité (≤ 5 tours) :

1. charger tâches visibles + dépendances de l'utilisateur ;
2. `respecterPrecedences` → appliquer les déplacements ;
3. re-tassage existant (`repackDay`, débordement au jour travaillé suivant) ;
4. si une précédence est de nouveau violée (le débordement peut en créer), recommencer.

Ainsi **tous** les appelants actuels héritent de la règle, y compris le **déplacement manuel** (PATCH `/api/tasks/:id`) : reporter une bloquante fait glisser ses suivantes ; glisser une suivante avant sa bloquante la ramène juste après.

On **ajoute** un appel à `fixOverlappingTasks` à la fin des chemins qui n'en ont pas : `rebalance-week`, `place-today`, `generate-monthly`, `replan/apply`, `rolloverStaleTasks`.

Les tâches du jour courant ne sont jamais replacées dans le passé (règle déjà portée par `fixOverlappingTasks`).

### 3. Dépendances valides

Nouveau point d'entrée unique `storage.ajouterDependance(userId, taskId, dependsOnTaskId, relationType)` qui refuse (sans lever, en rendant `false`) :
- `taskId === dependsOnTaskId` ;
- l'une des deux tâches inexistante ou appartenant à un autre compte ;
- un cycle (le prérequis dépend déjà, directement ou non, de la tâche).

Tous les sites de création passent par lui. `generate-monthly` mappe les index **avant** filtrage (même technique que l'auto-planner : `__srcIndex`). La route `POST /api/tasks/:id/dependencies` répond 400 sur refus.

### 4. Descriptions autonomes

- Consigne de `generateDailyTasks` (et `generateMonthlyPlan`) : chaque description se comprend seule ; une autre tâche est citée **par son titre**, jamais par un numéro ; un prérequis reçoit un `scheduledTime` antérieur.
- Filet : fonction pure `remplacerReferencesNumerotees(description, titresParIndex)` qui remplace « Task N » / « Tâche N » / « task #N » par le titre de la tâche visée quand l'index est connu (1-based dans le texte, 0-based dans la sortie — testé dans les deux sens), sinon par « la tâche précédente ».

### 5. Remise en ordre ponctuelle

Script `scripts/reordonner-planning.ts` (même garde d'endpoint que `migrate-prod.ts`) :
- mode **à blanc** par défaut : liste les déplacements prévus (tâche, avant → après) et les dépendances invalides à supprimer (auto-références) ;
- mode `--appliquer` : applique, puis relance `fixOverlappingTasks`.
L'utilisatrice valide la liste à blanc avant toute application.

## Erreurs

- La règle ne lève jamais : une donnée incohérente (date invalide, durée nulle → 30 min) est traitée prudemment ; au pire la tâche ne bouge pas.
- La boucle est bornée (5 tours) ; au-delà, on journalise et on garde le dernier état sans chevauchement.
- Un échec de la règle dans `fixOverlappingTasks` ne bloque pas le re-tassage (best-effort, journalisé).

## Tests

- `precedence.test.ts` : prérequis plus tard le même jour → dépendant poussé après ; débordement → jour travaillé suivant (week-end sauté) ; chaîne A→B→C en cascade ; prérequis terminé → aucune contrainte ; auto-référence et cycle → aucun déplacement, pas de boucle ; tâche non contrainte jamais déplacée ; tampon respecté.
- Boucle précédence + re-tassage : un débordement qui recrée une violation est corrigé au tour suivant.
- `ajouterDependance` : refus auto-référence, inter-comptes, inexistant, cycle direct et indirect ; acceptation normale.
- `generate-monthly` : index correctement mappés après filtrage.
- `remplacerReferencesNumerotees` : « Task 2 », « Tâche 2 », « task #3 », index inconnu, aucune mention.
- Route : `POST /api/tasks/:id/dependencies` refuse l'auto-référence (400).
- Cas réels de prod rejoués : 531/533, 551/550, 539/537.

**Aucun test contre la base de production.** Le script de remise en ordre est d'abord exécuté à blanc.
