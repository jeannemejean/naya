# Rituels récurrents & messages à Naya — design

**Date :** 2026-07-24
**Statut :** validé par Jeanne, prêt pour le plan d'implémentation

## Problème

Deux manques constatés par Jeanne sur la carte « Où en est ce projet ? (dis tout à Naya) »
(`client/src/pages/project/ProjectContextEditor.tsx`) :

1. **Rien ne dit que le message est parti.** La note s'enregistre sur `onBlur`, en silence,
   et l'indicateur « Enregistré » disparaît après 2 s. Il n'y a pas de bouton d'envoi.
2. **Rien n'agit sur le message.** `projects.status_note` est un champ unique, écrasé à chaque
   saisie, injecté au contexte IA. Écrire « tous les matins je fais un brief news, 20 min, et il
   ne faut rien planifier par-dessus » ne produit aucun effet sur le planning.

Le second point est le vrai besoin : un **engagement récurrent**. Or Naya n'a **aucune notion de
récurrence** — `grep -i "recurr|repeat" shared/schema.ts` ne renvoie rien. Il n'existe que des
pauses par date (`day_availability.breaks`), que le planificateur respecte déjà.

## Décisions produit (Jeanne, 2026-07-24)

| Question | Décision |
|---|---|
| Niveau d'action de Naya | **Elle propose, l'utilisateur valide.** Rien ne bouge sans clic. |
| Historique des messages | **Champ unique conservé.** Pas de fil de discussion. Bouton + confirmation seulement. |
| Forme du rituel | **Une vraie tâche à cocher**, pas un bloc grisé. |
| Où d'abord | **Page projet.** Le Dashboard sera aligné après validation. |
| Survie au redémarrage | **Le rituel survit** et se re-matérialise. |

## Architecture

### Pourquoi une table dédiée

Un rituel ne peut pas être une tâche répétée : `deleteIncompleteFutureTasks` (redémarrage de la
planification) supprime **toutes** les tâches futures incomplètes. Le rituel disparaîtrait au
premier redémarrage — ce qui contredit la décision « le rituel survit ».

Le rituel est donc la **source**, la tâche du jour en est le **reflet** :

```
recurring_rituals  ──matérialisation──>  tasks (une par rituel et par date)
   (définition,                             (jetable, recréée à la demande)
    survit à tout)
```

### Schéma

```ts
export const recurringRituals = pgTable("recurring_rituals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id), // null = transverse
  title: text("title").notNull(),
  days: text("days").notNull().default("mon,tue,wed,thu,fri"), // même format que work_days
  startTime: text("start_time").notNull(),      // "HH:MM"
  durationMinutes: integer("duration_minutes").notNull().default(30),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
```

Sur `tasks`, une colonne additive :

```ts
ritualId: integer("ritual_id").references(() => recurringRituals.id),
```

+ index unique `(ritual_id, scheduled_date)` — c'est ce qui rend la matérialisation idempotente.

**Migration additive**, appliquée via Neon MCP sur `dev-local` ET production **avant** le push
(pas de `db:push` au déploiement Railway).

### Matérialisation

```ts
// server/services/rituals.ts
export async function materializeRituals(userId: string, date: string): Promise<number>
```

- Ne fait rien si `date` n'est pas dans les `days` du rituel.
- Crée la tâche (`source: 'ritual'`, `ritualId`, `scheduledDate`, `scheduledTime`,
  `scheduledEndTime`, `estimatedDuration`) si elle n'existe pas déjà pour ce couple.
- Ne crée rien si une tâche existe déjà pour ce couple `(ritual_id, date)`, complétée ou non —
  l'index unique le garantit. En revanche, si la tâche a été **supprimée** (cas du redémarrage de
  la planification), elle est bien recréée : c'est la contrepartie de « le rituel survit ».

Appelée **avant** la génération IA, dans les trois chemins d'écriture :

| Chemin | Fichier |
|---|---|
| Job quotidien 06:00 UTC | `auto-planner.ts` → `generateForUser` |
| « Générer mon plan » / redémarrage | `routes.ts` → `POST /api/tasks/generate-daily` |
| Redémarrage de la planification | `routes.ts` → `POST /api/planning/restart` |

La tâche du rituel occupe le créneau **avant** que l'IA ne place quoi que ce soit : « ne rien
planifier par-dessus » devient une propriété mécanique, pas une consigne confiée au modèle.

Si une autre tâche occupe déjà l'heure du rituel (une tâche remontée par le rollover, par exemple),
`repackDay` traite les tâches par heure de début croissante : le rituel, placé le plus tôt, garde
son créneau et c'est l'autre tâche qui glisse. Aucune règle supplémentaire n'est nécessaire.

Chaque chemin se termine déjà par `fixOverlappingTasks` (règle projet), qui garantit l'absence de
chevauchement et le respect des horaires.

### Analyse du message

```
POST /api/projects/:id/status-note/analyze   { note: string }
  → enregistre projects.status_note (comportement actuel conservé)
  → Claude (CLAUDE_MODELS.smart) + sortie structurée
  → { understood: string, proposals: RitualProposal[] }
```

```ts
interface RitualProposal {
  kind: 'create_ritual';
  title: string;
  days: string;            // "mon,tue,wed,thu,fri"
  startTime: string;       // "HH:MM"
  durationMinutes: number;
}
```

Aucune écriture de rituel à ce stade. L'application est un second appel explicite :

```
POST /api/rituals   { projectId, title, days, startTime, durationMinutes }
  → crée le rituel
  → materializeRituals sur les 14 prochains jours
  → fixOverlappingTasks
```

**Périmètre v1 : `create_ritual` uniquement.** Créer une tâche ponctuelle ou replanifier par
message relève du Companion, qui le fait déjà — on ne construit pas un second système en parallèle.
Un message sans rituel renvoie `proposals: []` et un `understood` du type « Noté. Rien à changer
dans ton planning. » — ce qui constitue déjà la confirmation visible qui manque aujourd'hui.

### Interface

`ProjectContextEditor.tsx` :

- L'enregistrement `onBlur` est **remplacé** par un bouton **« Envoyer à Naya »** (désactivé si le
  texte est inchangé ou vide). Un seul chemin d'enregistrement, pas deux.
- Pendant l'appel : « Naya lit… ».
- Réponse : encart avec le `understood` et, s'il y a une proposition, un résumé lisible
  (« Brief news + posts JMD — du lundi au vendredi, 9h00, 20 min ») avec **Appliquer** / **Ignorer**.
- Après application : confirmation, et le rituel apparaît dans le planning.

Les rituels existants du projet sont listés sous le champ, avec la possibilité de les désactiver
(`active: false`) — sans quoi un rituel créé par erreur serait impossible à retirer.

## Cascade de suppression

`recurring_rituals` devient parent de `tasks` (`tasks.ritual_id`). Le test
`account-reset-plan.test.ts` **échouera** tant que le plan de reset ne sera pas mis à jour — c'est
son rôle.

Ordre requis dans `ACCOUNT_RESET_PLAN` : `tasks` (déjà en phase 3) **avant** `recurring_rituals`,
à ajouter en phase 9 (autres enfants de `projects`).

`deleteIncompleteFutureTasks` supprime les tâches de rituel comme les autres : elles sont
re-matérialisées ensuite. Conforme à « le rituel survit ».

## Tests

**Purs (vitest, sans DB) :**
- `ritualOccursOn(days, date)` — jours concernés, y compris hors jours ouvrés.
- `buildRitualTask(ritual, date)` — calcul de `scheduledEndTime`, durée.
- Analyse : parsing de la sortie structurée, message sans rituel → `proposals: []`.

**Avec storage mocké :**
- `materializeRituals` idempotente : deux appels → une seule tâche.
- Ne recrée pas la tâche d'un rituel déjà complété ce jour-là.
- Rituel inactif → aucune tâche.

**Vérification réelle :** exécution sur une branche Neon copiée de la production, en repartant de
l'état réel de Jeanne — création du rituel « brief news 20 min », génération, puis contrôle qu'aucune
tâche ne chevauche le créneau et que le rituel réapparaît après un redémarrage.

## Hors périmètre

- Rituels sur le Dashboard (`ProjectStatusNote`) — après validation de la page projet.
- Autres types de propositions (tâche ponctuelle, replanification) — le Companion les couvre.
- Récurrences complexes (toutes les 2 semaines, un jour du mois).
- Édition d'un rituel existant : v1 permet créer et désactiver, pas modifier.
