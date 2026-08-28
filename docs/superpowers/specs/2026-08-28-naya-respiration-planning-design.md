# Respiration entre les tâches — design

**Date :** 2026-08-28
**Statut :** validé avec Jeanne, prêt pour le plan d'implémentation

## Le problème

Les tâches sont collées bout à bout. Mesuré sur la base de production le 2026-08-27 :
**gap = 0 entre absolument toutes les tâches consécutives**, de 9h00 à 17h40, tous les
jours, sur les 58 tâches planifiées. Aucune notion de respiration n'existe dans le code,
et `user_preferences` n'a aucun champ de tampon.

Demande de Jeanne : « parfois Naya doit comprendre qu'il faut mettre une petite pause
entre certaines tâches, en fonction du fonctionnement de l'utilisateur qu'elle aura
compris au fur et à mesure ».

Interrogée sur la nature du besoin, Jeanne a retenu **les quatre** causes proposées :
récupérer, changer de nature de travail, absorber le débordement, vivre entre les tâches.
C'est structurant : il ne faut **pas** modéliser une cause. Quatre causes distinctes
produisent le même besoin observable — de l'air entre deux blocs — et Naya n'a aucun
moyen fiable de les distinguer.

## La contrainte qui a tout décidé

Naya n'a **aucune mémoire de ce qui se passe réellement**. Vérifié sur les deux bases :

| Source | État au 2026-08-28 |
| --- | --- |
| Tâches terminées | **0**, jamais (93 tâches mai→juillet en dev, 58 en prod) |
| `tasks.actual_duration` | lu par 3 services, **écrit par aucun** |
| `task_feedback` | table **vide** |
| Feedback quotidien du Planning | part dans `localStorage`, n'atteint jamais le serveur (`planning.tsx:313`) |

Conséquence : `duration-calibration.ts` (cron hebdomadaire) et `behavior-patterns.ts`
calculent sur un ensemble vide depuis toujours et renvoient `{}`.

Les suppressions de routine préservent toujours les tâches terminées (`completed = false`
partout) : l'historique n'a donc pas été effacé, il n'a jamais existé. Seul un reset de
compte efface tout (`storage.ts:1990`).

**Usage réel de Jeanne :** elle coche « parfois, en fin de journée ». Les horodatages de
complétion ne peuvent donc pas servir de signal de rythme — tout serait daté ~18h.

C'est pourquoi l'apprentissage retenu est **déclaratif** (question de fin de journée) et
non observationnel. Ce n'est pas le signal le plus fin, c'est le seul qui soit honnête
avec l'usage réel.

## Périmètre

**Dans le périmètre :**
1. Un tampon configurable entre tâches consécutives, appliqué par le re-tassage.
2. La génération quotidienne qui tient compte du tampon.
3. La persistance du retour de fin de journée.
4. Une règle d'adaptation pure qui fait évoluer le tampon.
5. La restitution du tampon en vigueur à l'utilisateur.

**Hors périmètre (chantier séparé) :** rendre le pointage des tâches sans effort pour
débloquer l'apprentissage observationnel. C'est le vrai goulot de la promesse « Naya te
connaît de mieux en mieux », mais c'est un problème de produit bien plus large que les
pauses.

**Volontairement écarté :** un tampon différencié par catégorie de tâche. Jeanne a demandé
« entre *certaines* tâches », mais Naya n'a aujourd'hui aucune donnée pour savoir
lesquelles. Différencier sans preuve reviendrait à inventer. On commence uniforme ; la
différenciation deviendra possible quand il y aura de la matière.

## Conception

### 1. Le tampon dans le re-tassage

`repackDay` (`server/services/schedule-repack.ts`) reçoit une option `bufferMin`. Après
chaque tâche placée, le curseur avance de `durée + bufferMin` au lieu de `durée`.

Règles :
- le tampon ne s'applique **pas** avant la première tâche de la journée ;
- il ne s'applique **pas** avant une plage bloquée (`blockedRanges`) : un rendez-vous
  commence à son heure, un tampon ne peut pas le décaler ;
- il ne s'applique **pas** avant une tâche ancrée (rituel à heure fixe), pour la même
  raison ;
- il ne compte **pas** dans le test de débordement : une tâche qui finit pile à
  `dayEndMin` reste planifiée, le tampon qui la suit est simplement tronqué.

La fonction reste pure et testable. Le tampon étant lu par `fixOverlappingTasks`, il
s'applique automatiquement à tous les chemins d'écriture.

### 2. Le stockage

Deux colonnes additives sur `user_preferences` :

| Colonne | Type | Rôle |
| --- | --- | --- |
| `buffer_min` | integer NOT NULL DEFAULT 10 | tampon en vigueur, en minutes |
| `buffer_adjusted_at` | timestamp NULL | date du dernier ajustement (verrou hebdomadaire) |

Migration appliquée via le MCP Neon sur **dev-local (`br-divine-base-anmsv1nj`) ET
production (`br-floral-wave-ane2h3l1`) AVANT le push**, comme toute migration de ce
projet (pas de `db:push` automatique au déploiement Railway).

### 3. La génération quotidienne

`auto-planner.ts:358` calcule le nombre de tâches du jour par
`temps disponible × facteur d'énergie / AVG_TASK_MIN` (45 min). Le tampon y est intégré :
le coût d'une tâche devient `AVG_TASK_MIN + bufferMin`.

Sans ça, ajouter de la respiration ferait simplement déborder les journées en cascade sur
le lendemain. Décision de Jeanne : **une journée honnête plutôt qu'une journée pleine qui
déborde**. Effet attendu avec le défaut de 10 min : environ **une tâche de moins par
jour**.

### 4. Le retour de fin de journée

Le widget existe déjà dans `planning.tsx` (trois choix : `on_track`, `felt_overloaded`,
`tasks_wrong`) mais son résultat part dans `localStorage` et n'atteint jamais le serveur.

Nouvelle table `daily_rhythm_feedback` :

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | serial PK | |
| `user_id` | varchar → users | |
| `feedback_date` | text `YYYY-MM-DD` | jour concerné |
| `signal` | text | `on_track` \| `felt_overloaded` \| `tasks_wrong` |
| `task_count` | integer | contexte : nombre de tâches planifiées ce jour-là |
| `planned_minutes` | integer | contexte : total des durées estimées |
| `buffer_min` | integer | tampon en vigueur au moment du retour |
| `created_at` | timestamp | |

Contrainte **UNIQUE (user_id, feedback_date)** : un seul retour par jour, réécrit si Jeanne
change d'avis (`ON CONFLICT DO UPDATE`).

Le contexte est capturé **au moment du signal** — sans lui, un retour vieux de trois
semaines devient ininterprétable, puisque les tâches du jour auront changé ou disparu.
C'est le même choix que celui déjà fait pour `task_feedback` (« soft ref — task may be
deleted »).

Endpoint : `POST /api/planning/daily-feedback` `{ date, signal }`. Le serveur dérive
lui-même `task_count`, `planned_minutes` et `buffer_min` — le client n'envoie que ce qu'il
sait.

### 5. La règle d'adaptation

Fonction **pure** `nextBufferMin(current, signals)` dans un module dédié
(`server/services/rhythm-buffer.ts`), où `signals` est la liste des retours des 14
derniers jours.

```
soit N = nombre total de signaux des 14 derniers jours (les trois types confondus)

si N < 5                              → inchangé (pas assez de matière)
si ajusté il y a moins de 7 jours     → inchangé (verrou hebdomadaire)
si felt_overloaded / N ≥ 0,60         → current + 5
si on_track / N ≥ 0,80                → current - 5
sinon                                 → inchangé
résultat borné à [0, 30]
```

`tasks_wrong` est compté dans le total mais ne pousse dans aucun sens : il parle de la
pertinence des tâches, pas de la densité de la journée.

**Un seul ajustement par semaine.** La date du dernier ajustement est stockée
(`user_preferences.buffer_adjusted_at`) et la fonction pure la reçoit en entrée : sans ce
garde-fou, le tampon oscillerait à chaque nouveau retour.

Appel : dans le cron hebdomadaire existant qui fait déjà tourner
`computeDurationCalibration` et `analyzeBehaviorPatterns`, pour ne pas créer un
ordonnanceur de plus.

### 6. La restitution

Le tampon en vigueur est affiché dans les Réglages, en langage clair :
« Naya te laisse 10 min entre deux blocs — ajusté d'après tes retours de fin de journée. »
Champ modifiable à la main ; une modification manuelle réinitialise
`buffer_adjusted_at` pour que l'adaptation automatique reparte de la valeur choisie.

Sans cette restitution, Naya devient une boîte noire qui décale les journées sans dire
pourquoi.

## Tests

Fonctions pures, testées en priorité :
- `repackDay` avec `bufferMin` : tampon appliqué entre deux tâches, absent en début de
  journée, absent avant une plage bloquée et avant une ancre, sans effet sur le calcul de
  débordement.
- `nextBufferMin` : seuil des 5 signaux, montée à 60 %, descente à 80 %, bornes 0 et 30,
  `tasks_wrong` neutre, verrou hebdomadaire.
- Dérivation du contexte du retour (nombre de tâches, minutes planifiées).

Les enveloppes DB (`storage`) restent minces et non testées unitairement, conformément au
reste du projet.

## Risques

- **Le signal est grossier.** Il dira « la journée était trop dense », jamais « il me faut
  12 minutes ». L'adaptation se fera lentement, par paliers de 5 min. C'est le prix de
  l'usage réel de Jeanne, et c'est assumé.
- **10 min est un pari, pas une mesure.** Aucune donnée ne le fonde. La restitution en
  Réglages permet de corriger à la main immédiatement.
- **Si Jeanne ne répond jamais au widget**, le tampon reste à 10 min pour toujours. Le
  système dégrade proprement vers « une valeur fixe raisonnable » plutôt que vers un
  comportement erratique.
- **Moins de tâches par jour.** Effet voulu, mais visible dès le premier jour. À annoncer
  clairement plutôt qu'à laisser découvrir.
