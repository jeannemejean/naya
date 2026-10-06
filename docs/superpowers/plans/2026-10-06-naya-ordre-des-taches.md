# Ordre des tâches (mode projet) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aucune tâche non terminée ne commence avant la fin de ses prérequis non terminés, quel que soit le chemin qui place ou déplace les tâches ; dépendances toujours valides ; descriptions sans « Task N ».

**Architecture:** Une règle PURE (`server/services/precedence.ts`) qui calcule les déplacements ; branchée dans `storage.fixOverlappingTasks` (re-tassage commun, déjà appelé par la plupart des chemins) sous forme de boucle « précédences → re-tassage » bornée ; appel ajouté aux chemins qui n'en avaient pas. Un point d'entrée unique pour créer une dépendance (refus auto-référence / inter-comptes / inexistant / cycle). Consigne IA renforcée + filet pur contre « Task N ».

**Tech Stack:** Express, Drizzle (Postgres Neon), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-naya-ordre-des-taches-design.md`

## Global Constraints

- Règle : une tâche non terminée, planifiée (date + heure), ne commence pas avant `fin du prérequis + tampon` pour chacun de ses prérequis non terminés et planifiés. Prérequis terminé ou non planifié → aucune contrainte.
- Débordement de la journée → prochain **jour travaillé** (préférences `workDays`, défaut `mon,tue,wed,thu,fri`) à `workDayStart` (défaut `09:00`). Fin de journée `workDayEnd` (défaut `18:00`). Tampon = `bufferMin` des préférences (défaut 10, plafonné comme dans `fixOverlappingTasks`).
- Auto-références et cycles : ignorés, jamais de boucle infinie, les tâches concernées ne bougent pas.
- Boucle « précédences → re-tassage » bornée à **5 tours**.
- Jamais de suppression de tâche ; la règle ne change que `scheduledDate` / `scheduledTime`.
- Une tâche du jour courant n'est jamais replacée dans le passé (garde existante de `fixOverlappingTasks`).
- **Aucun test contre la base de production.** Tests avec `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test`. `npx tsc --noEmit` à zéro.
- Commentaires en français, style du dépôt. Commits en français, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Ne jamais pousser.**

## Review Focus

- **Prérequis planifié un jour non travaillé** (samedi) : le dépendant ne doit pas atterrir un samedi ; prochain jour travaillé. → test Task 1.
- **Durée nulle ou absente** sur un prérequis : traitée comme 30 min, pas comme 0. → test Task 1.
- **Prérequis dont la fin dépasse déjà la journée** (tâche longue tard) : le dépendant part le jour travaillé suivant. → test Task 1.
- **Déplacement manuel d'un dépendant AVANT sa bloquante** : il revient juste après (via PATCH → `fixOverlappingTasks`). → test Task 4 (orchestration).
- **Dépendance dont une tâche est archivée** : ne contraint pas (la tâche n'est pas dans les tâches visibles). → test Task 4.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/services/precedence.ts` (+ test) | Règle pure : déplacements nécessaires |
| `server/services/references-taches.ts` (+ test) | Filet pur contre « Task N » |
| `server/services/dependances.ts` (+ test) | Détection de cycle pure + `ajouterDependance` (DB) |
| `server/services/stabiliser-planning.ts` (+ test) | Orchestration pure de la boucle précédences/re-tassage (fonctions injectées) |
| `server/storage.ts` | `fixOverlappingTasks` = boucle ; ancien corps renommé `retasserJours` (privé) |
| `server/routes.ts` | Sites de création de dépendances → `ajouterDependance` ; `generate-monthly` index ; appels `fixOverlappingTasks` ajoutés ; route `POST /api/tasks/:id/dependencies` 400 ; filet descriptions |
| `server/services/auto-planner.ts` | Dépendances via `ajouterDependance` ; `fixOverlappingTasks` après `rolloverStaleTasks` |
| `server/services/openai.ts` | Consigne : descriptions autonomes, titres, prérequis plus tôt |
| `scripts/reordonner-planning.ts` | Remise en ordre ponctuelle, à blanc par défaut |

---

### Task 1 : La règle de précédence (pure)

**Files:** Create `server/services/precedence.ts`, `server/services/precedence.test.ts`

**Interfaces — Produces:**
```ts
export interface TachePlanifiable { id: number; scheduledDate: string | null; scheduledTime: string | null; estimatedDuration: number | null; completed: boolean }
export interface Calendrier { joursTravailles: Set<string>; debutJournee: string; finJournee: string; tamponMin: number }
export interface Deplacement { id: number; scheduledDate: string; scheduledTime: string }
export function respecterPrecedences(e: { taches: TachePlanifiable[]; dependances: Array<{ taskId: number; dependsOnTaskId: number }>; calendrier: Calendrier }): Deplacement[]
```
`joursTravailles` contient des abréviations `sun,mon,tue,wed,thu,fri,sat`.

- [ ] **Step 1 : tests qui échouent** — `server/services/precedence.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { respecterPrecedences, type TachePlanifiable, type Calendrier } from "./precedence";

const cal: Calendrier = { joursTravailles: new Set(["mon", "tue", "wed", "thu", "fri"]), debutJournee: "09:00", finJournee: "18:00", tamponMin: 10 };
const t = (id: number, d: string | null, h: string | null, dur: number | null = 60, completed = false): TachePlanifiable =>
  ({ id, scheduledDate: d, scheduledTime: h, estimatedDuration: dur, completed });
// 2026-10-06 = mardi, 2026-10-09 = vendredi, 2026-10-10 = samedi, 2026-10-12 = lundi
const run = (taches: TachePlanifiable[], deps: Array<[number, number]>, c = cal) =>
  respecterPrecedences({ taches, dependances: deps.map(([taskId, dependsOnTaskId]) => ({ taskId, dependsOnTaskId })), calendrier: c });

describe("respecterPrecedences", () => {
  it("cas réel 531/533 : l'envoi planifié la veille du modèle part après le modèle", () => {
    const r = run([t(531, "2026-10-06", "15:06", 45), t(533, "2026-10-07", "14:00", 60)], [[531, 533]]);
    expect(r).toEqual([{ id: 531, scheduledDate: "2026-10-07", scheduledTime: "15:10" }]);
  });

  it("cas réel 551/550 : même jour, le dépendant passe après la fin du prérequis + tampon", () => {
    const r = run([t(551, "2026-10-08", "10:55", 30), t(550, "2026-10-08", "11:25", 45)], [[551, 550]]);
    expect(r).toEqual([{ id: 551, scheduledDate: "2026-10-08", scheduledTime: "12:20" }]);
  });

  it("ne déplace rien quand l'ordre est déjà bon", () => {
    expect(run([t(1, "2026-10-06", "09:00", 60), t(2, "2026-10-06", "11:00", 60)], [[2, 1]])).toEqual([]);
  });

  it("débordement de la journée → prochain jour travaillé à l'ouverture (week-end sauté)", () => {
    const r = run([t(2, "2026-10-09", "09:00", 60), t(1, "2026-10-09", "16:30", 60)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-12", scheduledTime: "09:00" }]);
  });

  it("prérequis un samedi → le dépendant ne tombe pas un week-end", () => {
    const r = run([t(2, "2026-10-09", "10:00", 30), t(1, "2026-10-10", "10:00", 30)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-12", scheduledTime: "09:00" }]);
  });

  it("cascade A → B → C", () => {
    const r = run(
      [t(1, "2026-10-07", "14:00", 60), t(2, "2026-10-06", "09:00", 60), t(3, "2026-10-06", "10:00", 60)],
      [[2, 1], [3, 2]],
    );
    expect(r).toEqual([
      { id: 2, scheduledDate: "2026-10-07", scheduledTime: "15:10" },
      { id: 3, scheduledDate: "2026-10-07", scheduledTime: "16:20" },
    ]);
  });

  it("prérequis terminé → aucune contrainte", () => {
    expect(run([t(2, "2026-10-06", "09:00"), t(1, "2026-10-07", "09:00", 60, true)], [[2, 1]])).toEqual([]);
  });

  it("prérequis non planifié → aucune contrainte", () => {
    expect(run([t(2, "2026-10-06", "09:00"), t(1, null, null)], [[2, 1]])).toEqual([]);
  });

  it("auto-référence et cycle : aucun déplacement, pas de boucle", () => {
    expect(run([t(533, "2026-10-07", "14:00")], [[533, 533]])).toEqual([]);
    expect(run([t(1, "2026-10-06", "09:00"), t(2, "2026-10-06", "10:00")], [[1, 2], [2, 1]])).toEqual([]);
  });

  it("durée absente ou nulle traitée comme 30 min", () => {
    const r = run([t(2, "2026-10-06", "09:00", 30), t(1, "2026-10-06", "09:00", 0)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-06", scheduledTime: "09:40" }]);
  });

  it("une tâche non contrainte n'est jamais déplacée", () => {
    const r = run([t(1, "2026-10-07", "09:00"), t(2, "2026-10-06", "09:00"), t(9, "2026-10-06", "08:00")], [[2, 1]]);
    expect(r.map((d) => d.id)).toEqual([2]);
  });

  it("prérequis dont la fin dépasse déjà la journée → jour travaillé suivant", () => {
    const r = run([t(2, "2026-10-06", "09:00", 30), t(1, "2026-10-06", "17:30", 90)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-07", scheduledTime: "09:00" }]);
  });
});
```

- [ ] **Step 2 :** `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test npx vitest run server/services/precedence.test.ts` → FAIL (module absent).

- [ ] **Step 3 : implémentation** — `server/services/precedence.ts` :

```ts
// Règle de précédence du calendrier (« mode projet »). PURE.
//
// Demande de Jeanne (6 octobre 2026) : comme dans un diagramme de Gantt, la tâche qui sert
// à réaliser la suivante passe d'abord. Constaté en prod le même jour : « Envoyer les 3 DMs »
// planifiée la VEILLE du modèle qu'elle utilise. Le placement ignorait les dépendances.
//
// Cette fonction ne gère pas les chevauchements (c'est le rôle du re-tassage) : elle dit
// seulement quelles tâches doivent partir plus tard, et où au plus tôt.

export interface TachePlanifiable { id: number; scheduledDate: string | null; scheduledTime: string | null; estimatedDuration: number | null; completed: boolean }
export interface Calendrier { joursTravailles: Set<string>; debutJournee: string; finJournee: string; tamponMin: number }
export interface Deplacement { id: number; scheduledDate: string; scheduledTime: string }

const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const enMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const enHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duree = (d: number | null) => (d && d > 0 ? d : 30);

function estTravaille(date: string, cal: Calendrier): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return cal.joursTravailles.has(JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}
function jourTravailleSuivant(date: string, cal: Calendrier): string {
  const [y, m, d] = date.split("-").map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 14; i++) {
    c.setUTCDate(c.getUTCDate() + 1);
    if (cal.joursTravailles.has(JOURS[c.getUTCDay()])) break;
  }
  return c.toISOString().slice(0, 10);
}

export function respecterPrecedences(e: {
  taches: TachePlanifiable[];
  dependances: Array<{ taskId: number; dependsOnTaskId: number }>;
  calendrier: Calendrier;
}): Deplacement[] {
  const cal = e.calendrier;
  const ouverture = enMin(cal.debutJournee);
  const fermeture = enMin(cal.finJournee);

  // Position courante des tâches non terminées ET planifiées.
  const pos = new Map<number, { date: string; debut: number; duree: number }>();
  for (const t of e.taches) {
    if (t.completed || !t.scheduledDate || !t.scheduledTime) continue;
    if (!DATE.test(t.scheduledDate) || !HHMM.test(t.scheduledTime)) continue;
    pos.set(t.id, { date: t.scheduledDate, debut: enMin(t.scheduledTime), duree: duree(t.estimatedDuration) });
  }

  // Arêtes utiles : les deux bouts planifiés, pas d'auto-référence, sans doublon.
  const prerequis = new Map<number, number[]>();
  const suivants = new Map<number, number[]>();
  const vues = new Set<string>();
  for (const { taskId, dependsOnTaskId } of e.dependances) {
    if (taskId === dependsOnTaskId || !pos.has(taskId) || !pos.has(dependsOnTaskId)) continue;
    const cle = `${taskId}<${dependsOnTaskId}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    (prerequis.get(taskId) ?? prerequis.set(taskId, []).get(taskId)!).push(dependsOnTaskId);
    (suivants.get(dependsOnTaskId) ?? suivants.set(dependsOnTaskId, []).get(dependsOnTaskId)!).push(taskId);
  }

  // Tri topologique (Kahn). Les nœuds d'un cycle ne sortent jamais : ils ne bougent pas.
  const degre = new Map<number, number>();
  for (const id of pos.keys()) degre.set(id, prerequis.get(id)?.length ?? 0);
  const file = [...pos.keys()].filter((id) => degre.get(id) === 0).sort((a, b) => a - b);
  const ordre: number[] = [];
  while (file.length) {
    const id = file.shift()!;
    ordre.push(id);
    for (const s of suivants.get(id) ?? []) {
      degre.set(s, degre.get(s)! - 1);
      if (degre.get(s) === 0) file.push(s);
    }
  }

  const deplaces = new Map<number, Deplacement>();
  for (const id of ordre) {
    const pres = prerequis.get(id);
    if (!pres?.length) continue;
    const moi = pos.get(id)!;

    // Le plus tôt possible : après la fin de CHAQUE prérequis, tampon compris.
    let date = moi.date;
    let debut = moi.debut;
    for (const p of pres) {
      const pp = pos.get(p)!;
      const finP = pp.debut + pp.duree + cal.tamponMin;
      if (pp.date > date || (pp.date === date && finP > debut)) {
        date = pp.date;
        debut = finP;
      }
    }
    if (date === moi.date && debut === moi.debut) continue; // déjà dans l'ordre

    // Jour non travaillé ou journée qui déborde → ouverture du jour travaillé suivant.
    if (!estTravaille(date, cal) || debut + moi.duree > fermeture) {
      date = jourTravailleSuivant(date, cal);
      debut = ouverture;
    }
    debut = Math.max(debut, ouverture);

    pos.set(id, { ...moi, date, debut });
    deplaces.set(id, { id, scheduledDate: date, scheduledTime: enHHMM(debut) });
  }

  return [...deplaces.values()];
}
```

- [ ] **Step 4 :** relancer → PASS. Si un test de cas réel diverge d'une minute, vérifier l'arithmétique dans le test (fin + 10 min de tampon) avant de toucher au code.
- [ ] **Step 5 :** commit `feat(planning): règle de précédence pure (mode projet)`.

---

### Task 2 : Dépendances valides (cycle pur + point d'entrée unique)

**Files:** Create `server/services/dependances.ts`, `server/services/dependances.test.ts`. Modify `server/routes.ts` (route `POST /api/tasks/:id/dependencies` ~5915 ; création dans `generate-daily` ~5739-5762 ; `generate-monthly` ~4521 & ~4656), `server/services/auto-planner.ts` (~561).

**Interfaces — Produces:**
```ts
export function creeraitUnCycle(aretes: Array<{ taskId: number; dependsOnTaskId: number }>, taskId: number, dependsOnTaskId: number): boolean // PUR
export async function ajouterDependance(userId: string, taskId: number, dependsOnTaskId: number, relationType?: string): Promise<boolean>
```

- [ ] **Step 1 : tests (pur)** :

```ts
import { describe, it, expect } from "vitest";
import { creeraitUnCycle } from "./dependances";

describe("creeraitUnCycle", () => {
  const a = (t: number, d: number) => ({ taskId: t, dependsOnTaskId: d });
  it("auto-référence = cycle", () => expect(creeraitUnCycle([], 5, 5)).toBe(true));
  it("cycle direct : B dépend de A, on ajoute A dépend de B", () => expect(creeraitUnCycle([a(2, 1)], 1, 2)).toBe(true));
  it("cycle indirect : C→B→A, on ajoute A dépend de C", () => expect(creeraitUnCycle([a(2, 1), a(3, 2)], 1, 3)).toBe(true));
  it("chaîne normale acceptée", () => expect(creeraitUnCycle([a(2, 1)], 3, 2)).toBe(false));
  it("graphe vide accepté", () => expect(creeraitUnCycle([], 2, 1)).toBe(false));
});
```

- [ ] **Step 2 :** FAIL attendu.
- [ ] **Step 3 : implémentation** `server/services/dependances.ts` :
  - `creeraitUnCycle` : vrai si `taskId === dependsOnTaskId`, ou si `taskId` est atteignable depuis `dependsOnTaskId` en suivant les arêtes « dépend de » (parcours en largeur, ensemble des visités).
  - `ajouterDependance(userId, taskId, dependsOnTaskId, relationType = "blocked_by")` : charge les deux tâches (`db.select().from(tasks).where(inArray(tasks.id,[taskId,dependsOnTaskId]))`) → `false` si l'une manque ou si `userId` ne correspond pas aux deux ; charge les arêtes existantes de l'utilisateur (jointure `task_dependencies`→`tasks` filtrée `tasks.userId`) → `false` si `creeraitUnCycle` ; `false` si l'arête existe déjà ; sinon insère et rend `true`. Ne lève jamais (try/catch → `false` + `console.error('[dependances] …')`).
- [ ] **Step 4 : brancher les sites de création** :
  - `generate-daily` : remplacer `storage.createTaskDependency({...})` par `await ajouterDependance(userId, ...)` (les ids viennent de `batchSaved`). Garder le reste (dont la règle `fractionBlocked`).
  - `generate-monthly` : le `.filter(!_unschedulable)` (~4521) décale les index. Avant le filtre, poser `__srcIndex` sur chaque tâche (index d'origine dans la sortie IA), puis mapper `dep.taskIndex`/`dep.dependsOnIndex` via une `Map<srcIndex, savedId>` au lieu de `savedTasks[i]`. Création via `ajouterDependance`.
  - auto-planner (~561) : remplacer l'insert direct par `ajouterDependance`.
  - route `POST /api/tasks/:id/dependencies` : utiliser `ajouterDependance(req.userId, Number(req.params.id), Number(body.dependsOnTaskId), body.relationType)` ; `false` → `400 { message: "invalid_dependency" }` ; succès → `201`. Lire le corps actuel de la route pour garder sa forme de réponse si elle renvoie la ligne (dans ce cas, relire la ligne créée).
- [ ] **Step 5 :** test route dans `server/routes.agenda-fait.test.ts`-like : nouveau fichier `server/routes.dependances.test.ts` (même harnais que `server/routes.task-lock.test.ts`) qui mocke `./services/dependances` (`ajouterDependance` → `false`) et vérifie `400` ; et `true` → `201`.
- [ ] **Step 6 :** `npx tsc --noEmit`, suite complète, commit `fix(dependances): point d'entrée unique, refus auto-référence/inter-comptes/cycle ; index mensuels corrects`.

---

### Task 3 : Descriptions autonomes (consigne + filet)

**Files:** Create `server/services/references-taches.ts` (+ test). Modify `server/services/openai.ts` (consignes `generateDailyTasks` ~520-580, `generateMonthlyPlan` ~898), `server/routes.ts` (persistance `generate-daily` et `generate-monthly`), `server/services/auto-planner.ts` (persistance).

**Interfaces — Produces:** `export function remplacerReferencesNumerotees(texte: string, titres: string[]): string` — `titres[i]` = titre de la tâche d'index 0-based `i` dans la sortie IA.

- [ ] **Step 1 : tests** :

```ts
import { describe, it, expect } from "vitest";
import { remplacerReferencesNumerotees as r } from "./references-taches";
const titres = ["Rédiger le modèle de DM", "Lister 10 fondatrices", "Envoyer les DMs"];
describe("remplacerReferencesNumerotees", () => {
  it("« Task 2 » (1-based dans le texte) → titre de l'index 1", () =>
    expect(r("Using the list from Task 2, send", titres)).toBe("Using the list from « Lister 10 fondatrices », send"));
  it("« Tâche 1 » et « task #3 »", () => {
    expect(r("Reprends la Tâche 1.", titres)).toBe("Reprends « Rédiger le modèle de DM ».");
    expect(r("after task #3", titres)).toBe("after « Envoyer les DMs »");
  });
  it("index inconnu → « la tâche précédente »", () => expect(r("from Task 9", titres)).toBe("from la tâche précédente"));
  it("aucune mention → inchangé", () => expect(r("Rien à voir, 3 DMs", titres)).toBe("Rien à voir, 3 DMs"));
});
```
  Note : « Reprends la Tâche 1 » → l'article « la » précède ; la regex remplace `(la\s+)?(Task|Tâche|tâche|task)\s*#?\s*(\d+)` (article optionnel absorbé) pour éviter « la « … » ». Ajuster si besoin pour que les 4 tests passent.
- [ ] **Step 2 :** FAIL → **Step 3 :** implémenter → PASS.
- [ ] **Step 4 : consignes** (`openai.ts`) : ajouter aux règles de `generateDailyTasks` et `generateMonthlyPlan` :
  - « Each description must be understandable on its own. Never refer to another task by number ("Task 2", "task #1"); if you refer to another task, quote its exact title. »
  - « A prerequisite (dependsOnIndex) must have an EARLIER scheduledDate/scheduledTime than the task that depends on it. »
  (Ces phrases sont des consignes au modèle, pas des consignes de langue : elles ne doivent pas tomber sous `server/language-guard.test.ts` — vérifier que la suite reste verte.)
- [ ] **Step 5 : filet** : à la persistance des tâches générées (`generate-daily`, `generate-monthly`, auto-planner), appliquer `remplacerReferencesNumerotees(description, titresDuLot)` où `titresDuLot` = titres de la sortie IA dans l'ordre d'origine (avant tout filtrage), sur `description` et `activationPrompt`.
- [ ] **Step 6 :** tsc + suite, commit `fix(generation): descriptions autonomes, plus de « Task N »`.

---

### Task 4 : Brancher la règle au re-tassage commun

**Files:** Create `server/services/stabiliser-planning.ts` (+ test). Modify `server/storage.ts` (`fixOverlappingTasks`).

**Interfaces — Produces:**
```ts
export async function stabiliserPlanning(f: {
  calculerDeplacements: () => Promise<Array<{ id: number; scheduledDate: string; scheduledTime: string }>>;
  appliquerDeplacements: (d: Array<{ id: number; scheduledDate: string; scheduledTime: string }>) => Promise<void>;
  retasser: () => Promise<number>;
  maxTours?: number; // défaut 5
}): Promise<{ tours: number; retasses: number; deplaces: number; stable: boolean }>
```
Boucle : `d = calculerDeplacements()` ; si `d.length` → `appliquer(d)` ; `retasses += retasser()` ; si le calcul suivant rend `[]` → stable, sortir ; sinon recommencer jusqu'à `maxTours`. Un premier calcul vide fait quand même UN `retasser()` (comportement actuel de `fixOverlappingTasks` préservé).

- [ ] **Step 1 : tests (fonctions injectées)** : (a) aucun déplacement → 1 retassage, stable ; (b) déplacement puis stable → appliqué une fois, 2 calculs ; (c) violation recréée par le retassage au tour 1, résolue au tour 2 ; (d) violation perpétuelle → s'arrête à 5 tours, `stable: false`, sans lever ; (e) `calculerDeplacements` qui lève → retasse quand même une fois, ne lève pas.
- [ ] **Step 2-4 :** FAIL → implémenter → PASS.
- [ ] **Step 5 : `storage.fixOverlappingTasks`** :
  - Renommer le corps actuel en méthode privée `retasserJours(userId, fromDate): Promise<number>` (inchangée).
  - Nouveau `fixOverlappingTasks(userId, fromDate)` : appelle `stabiliserPlanning` avec
    - `calculerDeplacements` : charge les tâches visibles non archivées `scheduledDate >= fromDate` (même requête que `retasserJours`) + leurs dépendances (`task_dependencies` dont `task_id` ∈ ces ids) + préférences → `respecterPrecedences({ taches, dependances, calendrier })` (calendrier depuis `workDays`/`workDayStart`/`workDayEnd`/`bufferMin` comme `retasserJours`). Filtrer les déplacements qui placeraient une tâche du jour courant (Paris) dans le passé : si `scheduledDate === aujourd'hui` et heure < maintenant, laisser le re-tassage gérer (ne pas proposer).
    - `appliquerDeplacements` : `db.update(tasks).set({ scheduledDate, scheduledTime, updatedAt })` par id, filtré `userId`.
    - `retasser` : `this.retasserJours(userId, fromDate)`.
  - Renvoyer le même nombre qu'avant (`retasses + deplaces`). Journaliser `[precedence] N déplacement(s), stable=…` quand `deplaces > 0`.
- [ ] **Step 6 :** vérifier que `repackDay` conserve l'ordre relatif par `startMin` (lire `schedule-repack.ts`) — c'est ce qui rend la boucle convergente ; si ce n'est pas le cas, le noter en concern.
- [ ] **Step 7 :** tsc + suite complète, commit `feat(planning): le re-tassage respecte les précédences (boucle bornée)`.

---

### Task 5 : Appeler le re-tassage là où il manquait

**Files:** Modify `server/routes.ts` (`POST /api/tasks/rebalance-week` ~6209, `POST /api/tasks/place-today` ~4796, `POST /api/tasks/generate-monthly` ~4550, `replan/apply` ~6619), `server/services/auto-planner.ts` (`rolloverStaleTasks` ~168).

- [ ] **Step 1 :** à la fin de chacun (après les écritures, avant la réponse), ajouter `await storage.fixOverlappingTasks(userId, <date de début du chemin>).catch((e: any) => console.error('[<chemin>] retassage:', e?.message));`. Pour `rolloverStaleTasks`, utiliser `targetDate`. Ne pas modifier la forme des réponses.
- [ ] **Step 2 :** vérifier qu'aucun de ces chemins n'appelle déjà `fixOverlappingTasks` (éviter un double appel coûteux) et qu'aucun n'est appelé PAR `fixOverlappingTasks` (récursion).
- [ ] **Step 3 :** tsc + suite, commit `fix(planning): précédences aussi après rééquilibrage, placement du jour, génération mensuelle, replanning, report`.

---

### Task 6 : Script de remise en ordre (à blanc par défaut)

**Files:** Create `scripts/reordonner-planning.ts`.

- [ ] **Step 1 :** même garde que `scripts/migrate-prod.ts` (`REORDONNER_DATABASE_URL` obligatoire et doit contenir `ep-damp-water-anuyb0k6`) ; argument `--user <id>` obligatoire ; `--appliquer` optionnel.
- [ ] **Step 2 :** à blanc : lister (a) les auto-dépendances de l'utilisateur à supprimer ; (b) les déplacements `respecterPrecedences` sur ses tâches visibles à partir d'aujourd'hui (Paris), au format `id | titre (60 car.) | avant date heure → après date heure`. N'écrit rien.
- [ ] **Step 3 :** `--appliquer` : supprimer (a) ; puis exécuter la même boucle que `fixOverlappingTasks` (réutiliser `stabiliserPlanning` + `respecterPrecedences` + requêtes équivalentes, ou importer `storage` si l'import ne requiert que `DATABASE_URL` — dans ce cas poser `process.env.DATABASE_URL = REORDONNER_DATABASE_URL` avant import dynamique) ; afficher le résumé.
- [ ] **Step 4 :** tester la garde à blanc : URL absente → refus code 1 ; URL dummy → refus code 1. **Ne pas exécuter contre la prod** (c'est le contrôleur, avec l'accord de Jeanne).
- [ ] **Step 5 :** commit `chore(scripts): remise en ordre du planning selon les précédences (à blanc par défaut)`.

---

### Task 7 (contrôleur + Jeanne) : remise en ordre en prod et déploiement

Aucune étape sans accord explicite de Jeanne : exécuter le script à blanc sur son compte, lui montrer la liste ; sur accord, `--appliquer` ; pousser ; vérifier le déploiement.
