# Design — Page projet (résumé + contexte pour Naya + tâches plus intelligentes)

> Spec validée avec Jeanne (22 juillet 2026). Une page dédiée par projet : elle résume où en est le
> projet (fait / pas fait), permet de nourrir Naya en infos que l'app ne peut pas deviner, et — surtout —
> fait enfin remonter ce contexte à la génération de tâches. Décrit le *quoi* et le *pourquoi*.

---

## 0. Le problème (dit par Jeanne) & la cause racine (constatée dans le code)

Jeanne : « je veux cliquer sur un projet et arriver sur une page qui me résume où on en est, ce qu'on a
fait / pas fait ; et pouvoir ajouter des infos par projet — ce qui a changé, ce que j'ai fait hors Naya —
parce que sinon la création de tâches manque d'informations et n'est pas assez intelligente. »

Constat code (reco préalable) :
- **Aucune page projet n'existe.** Cliquer un projet (menu latéral) ne fait que `setActiveProjectId` ; pas de route `/projects/:id`. Le détail vit dans un `Sheet` sur `/projects` (onglets Tâches/Objectifs/Roadmap/ADN).
- **Le `statusNote` (« Dis à Naya où tu en es ») existe déjà** (`projects.status_note`, `shared/schema.ts:75`, éditable via `StatusNotePopover`/`ProjectStatusNote` dans `dashboard.tsx`, PATCH `/api/projects/:id` — champ whitelisté `server/services/project-fields.ts:15`) **et est bien injecté** dans `buildNayaContext` (`server/services/naya-context.ts`, section « Où en est … »).
- **MAIS la génération de tâches principale l'ignore.** `server/services/goal-tasks.ts` (`generateTasksForGoal`, route `POST /api/goals/:goalId/generate-tasks`, bouton « Générer un plan » du Sheet projet) construit un prompt maigre et appelle `callClaude` **sans** `buildNayaContext` : pas de statut, pas de stade, pas de jalons. Le **planificateur quotidien** (`auto-planner.ts`) utilise aussi une struct `projectContext` réduite (sans statusNote ni jalons). → **c'est la cause racine du « pas assez intelligent ».**
- **Le stade du projet existe en base mais sans UI.** `project_strategy_profiles.current_stage` (`ideation|early|growth|mature`, `shared/schema.ts:104`) est injecté dans le contexte (« Stade actuel ») **mais aucune interface ne permet de le renseigner** → il reste vide, donc inutile.

---

## 1. Décisions actées (brainstorming)

| # | Décision | Choix |
|---|----------|-------|
| 1 | Saisie d'infos projet | **Champ libre (`statusNote`) + sélecteur de STADE** (`currentStage`) |
| 2 | Résumé en tête de page | **Factuel toujours à jour + bouton « Demander un point à Naya »** (IA à la demande) |
| 3 | Navigation | Cliquer un projet devient la **destination par défaut** = la page projet |
| 4 | Correctif tâches | **Inclus dans le lot** : recâbler la génération de tâches sur `buildNayaContext` |

---

## 2. La page projet — `/projects/:id`

Nouvelle route Wouter dans `client/src/App.tsx` (branche authentifiée). Composant `client/src/pages/project/ProjectPage.tsx`.
Shell habituel (Sidebar + colonne principale + en-tête `bg-white border-b`). En-tête : nom du projet + badge client + retour.

**Navigation (destination par défaut) :** partout où l'on cliquait un projet pour juste l'« activer », on
**navigue** désormais vers `/projects/:id` (en continuant à `setActiveProjectId(id)` pour que le reste de
l'app connaisse le projet actif) :
- Menu latéral : items du dropdown projets (`sidebar.tsx` ~L224-244).
- Dashboard : cartes `ActiveProjectBand` (`dashboard.tsx`) deviennent cliquables → navigation.
- `/projects` : le clic sur une `ProjectCard` peut mener à la page (ou garder le Sheet — voir §6).

---

## 3. Le résumé — factuel + « point Naya » à la demande

### 3.1 Bandeau factuel (toujours à jour, gratuit)
Assemblé à partir de données existantes, aucun appel IA :
- **Stade** (`currentStage` du strategy profile) + **catégorie/priorité** du projet.
- **Objectif actif** (top `project_goals` actif) + **barre de progression** (`currentValue`/`targetValue` si dispo, sinon état).
- **Jalons** : compteurs **faits / en cours / à venir** (depuis `project_milestones` : `completed` vs `active/unlocked` vs `locked`).
- **Activité récente** : nb de tâches complétées cette semaine (données de tâches existantes).

### 3.2 Bouton « ✦ Demander un point à Naya » (IA à la demande)
Nouvel endpoint `POST /api/projects/:id/situation` → `callClaudeWithContext(userId, projectId, prompt)` (donc
tout `buildNayaContext` : statusNote, stade, jalons, objectifs, ADN, énergie). Le prompt demande une **synthèse
courte** « où en est le projet + 2-3 prochaines priorités concrètes ». Renvoie `{ text }`. **Soumis au plafond
de coût IA** (`usage.ts`, `isAiBlocked`). Affiché sous le bandeau, régénérable, jamais auto-lancé (à la demande).

---

## 4. Nourrir Naya — note libre + stade

Un bloc « Où en est ce projet ? (dis tout à Naya) » :
- **Champ libre** = le `statusNote` existant (PATCH `/api/projects/:id { statusNote }`, déjà whitelisté). Texte
  d'aide : « Naya connaît déjà ce que tu fais dans l'app. Note ici ce qu'elle ne peut pas deviner : un événement
  externe, une décision, un blocage, ce que tu as fait hors Naya. » Enregistrement (bouton ou onBlur).
- **Sélecteur de STADE** = `currentStage` (`idéation | lancement | croissance | mature`). **Nouveau côté écriture :**
  besoin d'un endpoint pour mettre à jour `project_strategy_profiles.current_stage`. Vérifier s'il existe une
  route d'update/upsert du strategy profile ; sinon ajouter `PATCH /api/projects/:id/strategy-profile
  { currentStage }` (upsert : crée le profil s'il n'existe pas). Enregistrement instantané.

Les deux alimentent `buildNayaContext` → donc Naya (companion, tâches, point de situation).

---

## 5. Le fait / pas-fait — jalons

Réutiliser le composant **`MilestoneRoadmap`** existant (`client/src/pages/projects.tsx:561-657`, `GET
/api/projects/:id/milestones`, confirmation de conditions `manual_confirm`) comme section « Feuille de route »
de la page projet. C'est la représentation canonique « ce qu'on a fait / ce qu'on n'a pas fait ».
Accès rapides (liens/onglets) vers le détail existant : **Tâches, Objectifs, ADN de marque** (réutiliser les
panneaux du Sheet `/projects` ou y renvoyer — voir §6).

---

## 6. ⭐ Le correctif clé — génération de tâches contextualisée

C'est le cœur du besoin de Jeanne. Faire remonter le contexte projet à la génération de tâches :
- **`goal-tasks.ts` `generateTasksForGoal`** : remplacer l'appel `callClaude` maigre par un appel qui reçoit
  `buildNayaContext(userId, projectId)` — soit via `callClaudeWithContext`, soit en préfixant le prompt par le
  contexte. Résultat : statusNote + stade + jalons (faits/bloqués, **règle : jamais de tâche pour un jalon
  verrouillé**) + objectif + ADN atteignent le modèle. Préserver la sortie (mêmes champs de tâches, même parsing)
  et l'imputation de coût par user.
- **`auto-planner.ts`** (planificateur quotidien) : enrichir la struct `projectContext` (~L349-357) pour inclure
  `statusNote` et un résumé de jalons (faits/à venir), ou router via `callClaudeWithContext`. Ne pas casser la
  logique de placement des créneaux (anti-chevauchement, fenêtres).
- Ne PAS toucher aux autres consommateurs déjà corrects (companion, task-intelligence passent déjà par le contexte).

**Décision produit implicite :** on ne change pas *ce que* génère l'IA (format, nombre), seulement la *qualité*
du contexte qu'elle reçoit. Pas de sur-ingénierie du prompt au-delà de l'injection du contexte.

---

## 7. Hors périmètre (YAGNI)

- Pas de refonte de la page Stratégie ni de l'ADN de marque (réutilisés tels quels).
- Pas d'extraction IA automatique du stade / des changements (Jeanne choisit le stade elle-même).
- Le « point Naya » est **à la demande**, pas auto-régénéré à chaque visite.
- Pas de nouveaux champs structurés (focus/blocages/etc.) — un champ libre suffit (décision 1).
- Pas de refonte du Sheet `/projects` existant ; la page projet le complète (peut réutiliser ses panneaux).

---

## 8. Modèle de données (rappel — quasi tout existe)

- `projects.status_note` (existe, whitelisté PATCH). 
- `project_strategy_profiles.current_stage` (existe ; **manque l'UI + l'endpoint d'écriture**).
- `project_goals`, `project_milestones` (+ conditions), `brand_dna` (per-project), `target_personas` (existent).
- **Aucune migration de schéma nécessaire** — le seul « nouveau » est un endpoint d'écriture du `current_stage`
  (sur une colonne qui existe déjà) + l'endpoint « point Naya ».

---

## 9. Critères de succès

1. Cliquer un projet ouvre une **page projet** qui résume l'état (stade, objectif+progression, jalons faits/à faire, activité).
2. Jeanne peut **renseigner le stade** (impossible aujourd'hui) et **écrire une note** que Naya lit.
3. Le bouton **« Demander un point à Naya »** produit une vraie synthèse contextualisée.
4. **Les tâches générées** (bouton « Générer un plan » d'un objectif, et le planning quotidien) tiennent compte
   du statut + du stade + des jalons → nettement plus pertinentes (le vrai fix).
5. Patte JMD respectée ; aucune migration ; plafond de coût IA respecté.

---

## 10. Découpage d'implémentation (indicatif — détaillé dans le plan)

1. **Backend — écriture du stade** : endpoint upsert `current_stage` sur `project_strategy_profiles` (+ storage).
2. **Backend — point Naya** : `POST /api/projects/:id/situation` via `callClaudeWithContext` (gate coût IA).
3. **Backend — correctif tâches** : `goal-tasks.ts` (+ struct du daily planner) reçoivent `buildNayaContext`.
4. **Backend — agrégat résumé** : un endpoint (ou réutilisation) fournissant les compteurs jalons + activité récente si pas déjà dispo côté client.
5. **Frontend — route + page** : `/projects/:id`, `ProjectPage.tsx` (shell, en-tête, sections).
6. **Frontend — bandeau factuel** + bouton « point Naya ».
7. **Frontend — bloc note + sélecteur de stade** (save statusNote + currentStage).
8. **Frontend — feuille de route** (réutilise `MilestoneRoadmap`) + accès rapides Tâches/Objectifs/ADN.
9. **Frontend — navigation** : clic projet (sidebar + dashboard) → `/projects/:id` (en gardant `setActiveProjectId`).
10. **Tests** : helpers purs (agrégats résumé), et vérif que le contexte projet atteint bien la génération de tâches.
