# Refuser une tâche — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuser une tâche depuis le panneau ou le planning, expliquer pourquoi (appris par Naya), et la voir remplacée directement par une tâche générée au même créneau, avec ses dépendances.

**Architecture:** Fonctions pures (`server/services/refus/pur.ts`), génération isolée (`server/services/refus/remplacement.ts`), service orchestrateur à dépendances injectées (`server/services/refus/service.ts`) + implémentation réelle (`server/services/refus/deps.ts`), route mince, UI réutilisant `task-feedback-modal.tsx` en mode « refuser ».

**Tech Stack:** Express, Drizzle, TypeScript, Vitest, React + TanStack Query + react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-06-naya-refuser-tache-design.md`

## Global Constraints

- Raisons acceptées (exactement) : `not_useful`, `wrong_timing`, `already_done`, `not_aligned`, `too_vague`, `wrong_approach`, `other`. Autre valeur → 400 `invalid_reason`.
- `task_feedback.feedbackType = "refused"` pour ce chemin ; il compte parmi les signaux négatifs du générateur.
- Souvenir : `memory_entries` `fil: "founder"`, `entryType: "préférence"`, `projectId` de la tâche, `salience: 0.8`, embedding best-effort, **uniquement si `freeText` non vide** ; texte `A refusé la tâche « <titre> » (<raison lisible>) : <freeText>`.
- Remplacement : même `scheduledDate`, `scheduledTime`, `projectId` ; durée générée bornée **15–240 min** (défaut = durée d'origine, sinon 30) ; `source: "replacement"`.
- Un refus ne doit jamais échouer à cause de la mémoire, de la génération, des dépendances ou du re-tassage (journaliser `[refus] …`).
- Tâche d'un autre compte → 404 ; id non numérique / négatif → 400 `invalid_task_id`.
- Dépendances transférées via `ajouterDependance` (jamais d'insert direct).
- UI : chaînes via `t()`, clés FR + EN ; bouton « Refuser » masqué pour un événement d'agenda (`source === "gcal"`).
- Tests avec `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test` ; `npx tsc --noEmit` à zéro. Commentaires en français. Commits en français + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Ne jamais pousser.** Aucun accès à une vraie base.

## Review Focus

- **Refus d'une tâche bloquante dont les suivantes sont déjà planifiées** : le remplacement doit les bloquer à son tour, et l'ordre rester juste après re-tassage. → test service (dépendances dans les deux sens).
- **Explication très longue** (> 2 000 caractères) : tronquée proprement dans le souvenir et dans le prompt, pas d'échec. → test pur.
- **Double clic sur « Refuser et remplacer »** : un seul refus. → bouton désactivé pendant la requête (Task 5) + 404 propre au second appel (tâche déjà supprimée).
- **Tâche sans projet** : souvenir avec `projectId` null, remplacement sans projet. → test service.
- **Tâche sans date/heure** : remplacement sans date/heure (le re-tassage la placera). → test service.

---

### Task 1 : Fonctions pures

**Files:** Create `server/services/refus/pur.ts`, `server/services/refus/pur.test.ts`.

**Produces:**
```ts
export const RAISONS_REFUS = ["not_useful","wrong_timing","already_done","not_aligned","too_vague","wrong_approach","other"] as const;
export type RaisonRefus = typeof RAISONS_REFUS[number];
export function estRaisonRefus(x: unknown): x is RaisonRefus;
export function libelleRaison(r: RaisonRefus): string; // FR lisible : "pas utile", "mauvais moment", "déjà fait", "pas aligné", "trop vague", "mauvaise approche", "autre"
export function texteSouvenirRefus(titre: string, raison: RaisonRefus, freeText: string | null | undefined): string | null; // null si freeText vide ; freeText tronqué à 1500 car. avec « … »
export function ligneContexteRefus(f: { taskTitle: string; taskType?: string|null; taskCategory?: string|null; taskSource?: string|null; feedbackType: string; reason: string; freeText?: string|null }): string; // ligne actuelle + ` — "${freeText}"` si présent (tronqué 300)
export interface Remplacement { title: string; description: string; type: string; category: string; estimatedDuration: number; activationPrompt?: string | null }
export function validerRemplacement(brut: unknown, dureeOrigine: number | null | undefined): Remplacement | null; // null si title/description absents ou non-string ; durée bornée 15–240, défaut dureeOrigine||30 ; type/category défaut "generic"/"general" ; title tronqué 200
```
La ligne actuelle du générateur est : `- ${taskTitle} (${taskType || ''}/${taskCategory || ''}, source: ${taskSource || 'unknown'}) — ${feedbackType}, reason: ${reason}` (voir `server/routes.ts`, `rejectedTasksContext`). `ligneContexteRefus` la reproduit à l'identique puis ajoute le texte.

- [ ] Tests d'abord (au moins) : `estRaisonRefus` ok/ko ; `texteSouvenirRefus` null sur "", "   ", undefined ; format exact avec raison lisible ; troncature à 1500 ; `ligneContexteRefus` identique à l'ancien format sans texte, avec ` — "…"` sinon ; `validerRemplacement` : objet valide, title manquant → null, durée 5 → 15, 999 → 240, absente → durée d'origine, origine absente → 30, valeurs non-string → null.
- [ ] RED → implémenter → GREEN → commit `feat(refus): fonctions pures (raisons, souvenir, contexte, validation)`.

---

### Task 2 : Génération du remplacement

**Files:** Create `server/services/refus/remplacement.ts`, `server/services/refus/remplacement.test.ts`.

**Produces:** `export async function genererRemplacement(input: { userId: string; tache: { title: string; description?: string|null; type?: string|null; category?: string|null; estimatedDuration?: number|null; projectId?: number|null }; raison: RaisonRefus; freeText?: string|null; refusRecents: string[] }): Promise<Remplacement | null>` — ne lève jamais.

- Appelle `callClaudeWithContext` (`server/services/claude.ts`) avec `projectId` de la tâche, modèle `CLAUDE_MODELS.fast`, `max_tokens` ~800. Message utilisateur (en anglais comme les autres prompts du générateur) : la tâche refusée (titre + description), la raison lisible, l'explication (tronquée 1500), les refus récents (10 lignes max), et la consigne : propose ONE replacement task serving the same goal for this project, avoiding what was refused and why; self-contained description; never refer to another task by number; respond with JSON only `{title, description, type, category, estimatedDuration, activationPrompt}`.
- Parse avec `stripMarkdownJSON` si exporté par `openai.ts` (sinon retirer les clôtures ```), puis `validerRemplacement(brut, tache.estimatedDuration)`.
- Applique `imposerLangueDuCompte([r], userId)` (`server/services/garde-langue.ts`) puis `remplacerReferencesNumerotees(texte, [])` sur description et activationPrompt.
- Toute erreur → `console.error('[refus] génération…')` et `null`.

- [ ] Tests : mocker `./../claude` (`callClaudeWithContext`) et `../garde-langue` (identité) : réponse JSON valide → Remplacement ; réponse non-JSON → null ; levée → null ; le prompt contient la raison lisible et l'explication ; « Task 2 » dans la description → remplacé.
- [ ] commit `feat(refus): génération d'une tâche de remplacement`.

---

### Task 3 : Service de refus (orchestration)

**Files:** Create `server/services/refus/service.ts`, `server/services/refus/service.test.ts`, `server/services/refus/deps.ts`.

**Produces:**
```ts
export interface RefusDeps {
  lireTache(id: number): Promise<TacheRefusable | undefined>; // TacheRefusable = { id, userId, title, description, type, category, source, projectId, scheduledDate, scheduledTime, estimatedDuration, learnedAdjustmentCount }
  enregistrerRetour(row: {...task_feedback fields...}): Promise<void>;
  ecrireSouvenir(input: { userId: string; projectId: number | null; texte: string }): Promise<void>;
  lireDependances(taskId: number): Promise<{ prerequis: number[]; dependants: number[] }>;
  refusRecents(userId: string): Promise<string[]>; // lignes ligneContexteRefus, 10 dernières négatives
  generer(input: Parameters<typeof genererRemplacement>[0]): Promise<Remplacement | null>;
  creerTache(row: {...}): Promise<{ id: number } & Record<string, unknown>>;
  ajouterDependance(userId: string, taskId: number, dependsOnTaskId: number): Promise<boolean>;
  supprimerTache(id: number): Promise<void>;
  retasser(userId: string, fromDate: string): Promise<void>;
  aujourdhui(): string; // Paris YYYY-MM-DD
}
export type ResultatRefus =
  | { statut: "introuvable" }
  | { statut: "refusee"; remplacement: Record<string, unknown> | null; raison?: "generation_failed" };
export async function refuserTache(deps: RefusDeps, input: { userId: string; taskId: number; raison: RaisonRefus; freeText?: string | null }): Promise<ResultatRefus>;
```
Ordre exact : lire (introuvable si absente ou autre compte) → retour (`feedbackType: "refused"`, `timesRescheduled: learnedAdjustmentCount||0`) → souvenir si `texteSouvenirRefus` non null (try/catch) → lire dépendances → refus récents → générer → si null : supprimer, retasser, `{refusee, remplacement:null, raison:"generation_failed"}` → sinon créer (même date/heure/projet, `source:"replacement"`, champs du remplacement) → `ajouterDependance(remplaçant, p)` pour chaque prérequis ; `ajouterDependance(d, remplaçant)` pour chaque dépendant → supprimer la refusée → retasser depuis `max(aujourdhui, scheduledDate ?? aujourdhui)` → `{refusee, remplacement}`. Chaque étape après le retour : try/catch + `console.error('[refus] …')`, jamais de levée.

`deps.ts` : implémentation réelle (`storage.getTask`, `storage.createTaskFeedback`, insert `memoryEntries` avec `embedText` best-effort comme `campaign-reject/rejeter.ts`, select `taskDependencies`, `storage.getRecentTaskFeedback` + `ligneContexteRefus` filtrés sur `deleted|dismissed|deferred|refused`, `genererRemplacement`, `storage.createTask`, `ajouterDependance`, `storage.deleteTask`, `storage.fixOverlappingTasks`, helper Paris existant `aujourdhuiParis` de `server/services/repack-from.ts`).

- [ ] Tests (fakes) couvrant la spec + Review Focus : autre compte → introuvable sans écriture ; souvenir seulement avec texte ; remplacement même créneau/projet/source ; dépendances transférées dans les deux sens ; échec génération → suppression + retassage + `generation_failed` ; échec souvenir → refus OK ; tâche sans projet ; tâche sans date (retassage depuis aujourd'hui, remplacement sans date).
- [ ] commit `feat(refus): service de refus avec remplacement direct`.

---

### Task 4 : Route + le générateur lit le texte

**Files:** Modify `server/routes.ts`. Create `server/routes.refus.test.ts`.

- [ ] `POST /api/tasks/:id/refuser` : id `^\d+$` sinon 400 `invalid_task_id` ; `estRaisonRefus(body.reason)` sinon 400 `invalid_reason` ; `freeText` string ou null ; `refuserTache(refusDeps, …)` ; introuvable → 404 ; sinon 200 `{ refusee: true, remplacement, raison? }` ; erreur inattendue → 500 `refus_failed`.
- [ ] `rejectedTasksContext` (generate-daily) et la construction équivalente du replanning : utiliser `ligneContexteRefus` et inclure `refused` parmi les types négatifs.
- [ ] Test route (harnais de `server/routes.task-lock.test.ts`, mock de `./services/refus/service`) : 400 id fictif, 400 raison invalide, 404 introuvable, 200 avec remplacement.
- [ ] commit `feat(refus): route de refus ; le générateur lit l'explication`.

---

### Task 5 : Interface

**Files:** Modify `client/src/components/task-feedback-modal.tsx`, `client/src/components/task-workspace.tsx`, `client/src/components/todays-tasks.tsx`, `client/src/locales/fr.ts`, `client/src/locales/en.ts`. Create `client/src/lib/refus-api.ts`.

- [ ] `refus-api.ts` : `refuserTacheApi(taskId, reason, freeText) → { refusee, remplacement, raison? }` via `apiRequest("POST", …)`.
- [ ] `TaskFeedbackModal` : nouvelle prop `mode?: "retirer" | "refuser"` (défaut `retirer` = comportement actuel inchangé). En `refuser` : pas de choix supprimer/écarter/reporter ; titre `taskFeedback.refuseTitle` ; champ texte libellé `taskFeedback.explainLabel` avec placeholder `taskFeedback.explainPlaceholder`, mis en avant ; bouton `taskFeedback.refuseAndReplace` ; `onConfirm(feedbackType, reason, freeText)` appelé avec `"refused"`.
- [ ] `TaskWorkspace` : bouton « Refuser » dans l'en-tête (icône + `aria-label`), masqué si `task.source === "gcal"` ; ouvre la fenêtre en mode refuser ; à la confirmation : `refuserTacheApi` ; succès → toast `taskFeedback.replacedBy` (`{{title}}`) ou `taskFeedback.refusedNoReplacement` ; invalider les clés commençant par `/api/tasks` ; fermer le panneau. Désactiver pendant la requête.
- [ ] Bulle du planning (`PlannerTaskPopover` dans `todays-tasks.tsx`) : bouton « Refuser » (masqué pour un événement d'agenda) → même fenêtre/flux (fermer la bulle).
- [ ] Clés FR/EN : `refuse` (« Refuser » / « Decline »), `refuseTitle` (« Refuser cette tâche » / « Decline this task »), `explainLabel` (« Explique à Naya pourquoi » / « Tell Naya why »), `explainPlaceholder` (« Ex. : je ne fais pas de DM Instagram, je préfère LinkedIn. » / « e.g. I don't do Instagram DMs, I prefer LinkedIn. »), `refuseAndReplace` (« Refuser et remplacer » / « Decline and replace »), `replacedBy` (« Remplacée par « {{title}} » » / « Replaced by “{{title}}” »), `refusedNoReplacement` (« Tâche refusée. Naya n'a pas pu proposer de remplacement pour l'instant. » / « Task declined. Naya couldn't suggest a replacement right now. »), `refuseFailed` (« Le refus a échoué. Réessaie. » / « Declining failed. Try again. »).
- [ ] tsc + suite (gardes i18n) ; commit `feat(refus): bouton Refuser dans la tâche et le planning`.
