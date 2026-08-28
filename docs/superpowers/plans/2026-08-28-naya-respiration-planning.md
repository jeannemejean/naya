# Respiration entre les tâches — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** insérer une respiration configurable entre les tâches du planning, et la rendre adaptative à partir du retour de fin de journée de l'utilisateur.

**Architecture :** le tampon est une option de la fonction pure `repackDay`, lue depuis `user_preferences` par `fixOverlappingTasks` — donc appliquée automatiquement sur tous les chemins d'écriture. La génération quotidienne intègre le tampon dans son calibrage pour ne pas produire des journées qui débordent. Une règle pure `nextBufferMin` fait évoluer la valeur chaque semaine à partir des retours persistés dans une table dédiée.

**Spec :** `docs/superpowers/specs/2026-08-28-naya-respiration-planning-design.md`

**Stack :** Express + Drizzle ORM + PostgreSQL Neon, React + Vite, vitest.

## Contraintes globales

- **Français partout dans l'UI.** Toute chaîne visible passe par i18n, ajoutée **dans `client/src/locales/fr.ts` ET `client/src/locales/en.ts`**. `client/src/locales/locales.test.ts` vérifie la parité des clés et échouera sinon.
- **Migrations appliquées à la main via le MCP Neon AVANT le push.** Projet `dawn-waterfall-68860472`. Les deux branches : dev `br-divine-base-anmsv1nj` **et** production `br-floral-wave-ane2h3l1`. Il n'y a pas de `db:push` automatique au déploiement Railway — pousser du code avant la migration provoque des 500 en production.
- **Une seule instruction SQL par appel `run_sql`** (pas de multi-statement), et DDL idempotente (`IF NOT EXISTS`).
- **Ne jamais lancer `npm install`** sur ce dépôt : il élague des paquets et crée des dossiers `« * 2 »`. Aucune dépendance nouvelle n'est requise par ce plan.
- **Un `git push origin main` déclenche le déploiement en production.** Ne pousser qu'une fois toutes les tâches terminées et vérifiées.
- Vérification à chaque tâche : `npx tsc --noEmit -p tsconfig.json` doit être silencieux et `npx vitest run` tout vert.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/services/schedule-repack.ts` | *(modifié)* option `bufferMin` dans le re-tassage |
| `server/services/rhythm-buffer.ts` | *(créé)* règle pure d'adaptation `nextBufferMin` |
| `server/services/rhythm-buffer.test.ts` | *(créé)* tests de la règle |
| `shared/schema.ts` | *(modifié)* colonnes `bufferMin` / `bufferAdjustedAt`, table `dailyRhythmFeedback` |
| `server/storage.ts` | *(modifié)* lecture du tampon dans `fixOverlappingTasks`, accès à la table de retours |
| `server/services/auto-planner.ts` | *(modifié)* calibrage du nombre de tâches |
| `server/routes.ts` | *(modifié)* `POST /api/planning/daily-feedback` |
| `server/index.ts` | *(modifié)* appel hebdomadaire de l'adaptation |
| `client/src/pages/planning.tsx` | *(modifié)* le retour quotidien va au serveur, plus au `localStorage` |
| `client/src/pages/settings.tsx` | *(modifié)* affichage et réglage manuel du tampon |
| `client/src/locales/{fr,en}.ts` | *(modifiés)* nouvelles chaînes |

---

### Task 1 : le tampon dans le re-tassage

**Fichiers :**
- Modifier : `server/services/schedule-repack.ts`
- Test : `server/services/schedule-repack.test.ts`

**Interfaces :**
- Produit : `RepackOptions.bufferMin?: number` — minutes de respiration insérées après chaque tâche flexible placée.

Comportement défini : le tampon avance uniquement le curseur, donc il s'applique **entre deux tâches flexibles consécutives**. Il ne s'applique pas avant la première tâche de la journée (le curseur part de `floor`), ni avant une plage bloquée ou une ancre (elles sont immuables et réservées avant la boucle), ni dans le test de débordement (une tâche qui finit pile à `dayEndMin` reste planifiée).

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à la fin de `server/services/schedule-repack.test.ts` :

```typescript
describe("repackDay — respiration entre les tâches", () => {
  it("insère le tampon entre deux tâches consécutives", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 540, durationMin: 30 }, // 09:00–09:30
      { id: 2, startMin: 570, durationMin: 30 }, // 09:30 → doit passer à 09:40
    ];
    const { moves } = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(moves.find((m) => m.id === 2)?.newStartMin).toBe(580);
  });

  it("n'insère pas de tampon avant la première tâche de la journée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 540, durationMin: 30 }];
    const r = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(r.moves).toEqual([]);
  });

  it("ne décale pas une tâche ancrée avec le tampon", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 540, durationMin: 30 },              // 09:00–09:30
      { id: 2, startMin: 570, durationMin: 30, anchored: true }, // rituel 09:30, intouchable
    ];
    const { moves } = repackDay(tasks, { ...opts, bufferMin: 10 });
    expect(moves.find((m) => m.id === 2)).toBeUndefined();
  });

  it("ne fait pas déborder une tâche qui finit pile à la fin de journée", () => {
    const tasks: RepackTask[] = [{ id: 1, startMin: 17 * 60, durationMin: 60 }]; // 17:00–18:00
    expect(repackDay(tasks, { ...opts, bufferMin: 15 }).overflow).toEqual([]);
  });

  it("tampon absent ou nul = comportement inchangé", () => {
    const tasks: RepackTask[] = [
      { id: 1, startMin: 540, durationMin: 30 },
      { id: 2, startMin: 570, durationMin: 30 },
    ];
    expect(repackDay(tasks, { ...opts, bufferMin: 0 }).moves).toEqual([]);
    expect(repackDay(tasks, opts).moves).toEqual([]);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/schedule-repack.test.ts`
Attendu : ÉCHEC sur « insère le tampon entre deux tâches consécutives » (reçu 570, attendu 580). Les autres passent déjà — ce sont des garde-fous de non-régression.

- [ ] **Étape 3 : ajouter l'option**

Dans `RepackOptions`, après `floorMin` :

```typescript
  /**
   * Respiration insérée APRÈS chaque tâche flexible placée, en minutes. Elle avance
   * seulement le curseur : elle ne décale donc jamais une ancre ni une plage bloquée
   * (réservées avant la boucle), et n'entre pas dans le test de débordement — une tâche
   * qui finit pile à `dayEndMin` reste planifiée, son tampon est simplement tronqué.
   */
  bufferMin?: number;
```

- [ ] **Étape 4 : appliquer le tampon**

Dans `repackDay`, remplacer la dernière ligne de la boucle sur `sorted` :

```typescript
    cursor = start + task.durationMin;
```

par :

```typescript
    cursor = start + task.durationMin + (opts.bufferMin ?? 0);
```

- [ ] **Étape 5 : vérifier que tout passe**

Commandes :
```bash
npx vitest run server/services/schedule-repack.test.ts
npx tsc --noEmit -p tsconfig.json
```
Attendu : tests verts, `tsc` silencieux.

- [ ] **Étape 6 : commit**

```bash
git add server/services/schedule-repack.ts server/services/schedule-repack.test.ts
git commit -m "feat(planning): option bufferMin dans le re-tassage"
```

---

### Task 2 : stocker le tampon et le brancher

**Fichiers :**
- Modifier : `shared/schema.ts:129` (table `userPreferences`)
- Modifier : `server/storage.ts` (`fixOverlappingTasks`)

**Interfaces :**
- Consomme : `RepackOptions.bufferMin` (tâche 1).
- Produit : `userPreferences.bufferMin` (integer, défaut 10) et `userPreferences.bufferAdjustedAt` (timestamp nullable), lus par les tâches 3, 5 et 6.

- [ ] **Étape 1 : appliquer la migration sur la branche DEV**

Outil MCP `mcp__Neon__run_sql`, `projectId: "dawn-waterfall-68860472"`, `branchId: "br-divine-base-anmsv1nj"`, un appel par instruction :

```sql
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS buffer_min integer NOT NULL DEFAULT 10;
```

```sql
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS buffer_adjusted_at timestamp;
```

- [ ] **Étape 2 : appliquer la même migration sur la branche PRODUCTION**

Mêmes instructions, `branchId: "br-floral-wave-ane2h3l1"`. Additive, donc transparente pour le code déjà en ligne.

- [ ] **Étape 3 : déclarer les colonnes dans le schéma Drizzle**

Dans `shared/schema.ts`, table `userPreferences`, juste après `lunchBreakEnd` (ligne ~140) :

```typescript
  // Respiration entre deux tâches, en minutes. Ajustée automatiquement chaque semaine
  // d'après les retours de fin de journée (cf. rhythm-buffer.ts), modifiable à la main.
  bufferMin: integer("buffer_min").notNull().default(10),
  bufferAdjustedAt: timestamp("buffer_adjusted_at"),
```

- [ ] **Étape 4 : lire le tampon dans le re-tassage**

Dans `server/storage.ts`, méthode `fixOverlappingTasks`, à côté des autres valeurs tirées de `prefs` (près de `const lunchEnabled = ...`) :

```typescript
    const bufferMin = Math.max(0, prefs?.bufferMin ?? 10);
```

Puis dans l'appel à `repackDay`, ajouter le champ à l'objet d'options :

```typescript
        blockedRanges: blockedByDate.get(date) ?? [],
        bufferMin,
```

- [ ] **Étape 5 : vérifier**

Commandes :
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```
Attendu : `tsc` silencieux, toute la suite verte.

- [ ] **Étape 6 : commit**

```bash
git add shared/schema.ts server/storage.ts
git commit -m "feat(planning): tampon persisté dans les préférences et appliqué au re-tassage"
```

---

### Task 3 : la génération quotidienne tient compte du tampon

**Fichiers :**
- Modifier : `server/services/auto-planner.ts:356-357`

**Interfaces :**
- Consomme : `userPreferences.bufferMin` (tâche 2), déjà disponible dans `prefs` à cet endroit de `generateForUser`.

Sans ce changement, ajouter de la respiration ferait simplement déborder les journées en cascade sur le lendemain. On veut une journée calibrée juste dès la génération.

- [ ] **Étape 1 : intégrer le tampon au coût d'une tâche**

Remplacer :

```typescript
  const AVG_TASK_MIN = 45;
  const dynamicMaxTotal = Math.max(1, Math.min(8, Math.floor((availableMin * energyFactor) / AVG_TASK_MIN)));
```

par :

```typescript
  const AVG_TASK_MIN = 45;
  // Une tâche coûte sa durée MOYENNE plus sa respiration : sans ça, on génère une journée
  // pleine qui déborde dès que le re-tassage insère les tampons.
  const bufferMin = Math.max(0, prefs?.bufferMin ?? 10);
  const slotCostMin = AVG_TASK_MIN + bufferMin;
  const dynamicMaxTotal = Math.max(1, Math.min(8, Math.floor((availableMin * energyFactor) / slotCostMin)));
```

- [ ] **Étape 2 : vérifier**

Commandes :
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```
Attendu : `tsc` silencieux, suite verte.

- [ ] **Étape 3 : commit**

```bash
git add server/services/auto-planner.ts
git commit -m "feat(planning): la génération quotidienne intègre la respiration"
```

---

### Task 4 : persister le retour de fin de journée

**Fichiers :**
- Modifier : `shared/schema.ts` (nouvelle table)
- Modifier : `server/storage.ts` (accès)
- Modifier : `server/routes.ts` (nouvel endpoint, à placer près de `/api/planning/fix-overlaps`, ligne ~2162)
- Modifier : `client/src/pages/planning.tsx:312-321`

**Interfaces :**
- Produit : table `dailyRhythmFeedback`, `storage.recordDailyRhythmFeedback(...)`, `storage.getRecentRhythmFeedback(userId, days)` — consommés par la tâche 5.

Le contexte du jour est capturé **au moment du signal** : sans lui, un retour vieux de trois semaines devient ininterprétable puisque les tâches auront changé ou disparu.

- [ ] **Étape 1 : créer la table sur la branche DEV**

`mcp__Neon__run_sql`, `projectId: "dawn-waterfall-68860472"`, `branchId: "br-divine-base-anmsv1nj"` :

```sql
CREATE TABLE IF NOT EXISTS daily_rhythm_feedback (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id),
  feedback_date text NOT NULL,
  signal text NOT NULL,
  task_count integer,
  planned_minutes integer,
  buffer_min integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT daily_rhythm_feedback_user_date_unique UNIQUE (user_id, feedback_date)
);
```

- [ ] **Étape 2 : créer la même table sur la branche PRODUCTION**

Même instruction, `branchId: "br-floral-wave-ane2h3l1"`.

- [ ] **Étape 3 : déclarer la table dans le schéma Drizzle**

Dans `shared/schema.ts`, à la suite des autres tables de planning :

```typescript
/**
 * Retour quotidien de l'utilisateur sur la densité de sa journée. Alimente l'ajustement
 * automatique de la respiration (cf. server/services/rhythm-buffer.ts). Le contexte du
 * jour est figé au moment du signal : les tâches concernées peuvent disparaître ensuite.
 */
export const dailyRhythmFeedback = pgTable("daily_rhythm_feedback", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  feedbackDate: text("feedback_date").notNull(),   // YYYY-MM-DD
  signal: text("signal").notNull(),                // on_track | felt_overloaded | tasks_wrong
  taskCount: integer("task_count"),
  plannedMinutes: integer("planned_minutes"),
  bufferMin: integer("buffer_min"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userDateUnique: unique("daily_rhythm_feedback_user_date_unique").on(table.userId, table.feedbackDate),
}));
export type DailyRhythmFeedback = typeof dailyRhythmFeedback.$inferSelect;
```

Vérifier que `unique` est bien importé depuis `drizzle-orm/pg-core` en tête de fichier ; l'ajouter à la liste d'imports si absent.

- [ ] **Étape 4 : ajouter les accès dans le storage**

Dans `server/storage.ts`, près des autres méthodes de tâches. Ajouter aussi les signatures correspondantes à l'interface `IStorage`.

```typescript
  /** Un seul retour par jour : un second envoi corrige le premier. */
  async recordDailyRhythmFeedback(entry: {
    userId: string; feedbackDate: string; signal: string;
    taskCount: number; plannedMinutes: number; bufferMin: number;
  }): Promise<void> {
    await db.insert(dailyRhythmFeedback).values(entry)
      .onConflictDoUpdate({
        target: [dailyRhythmFeedback.userId, dailyRhythmFeedback.feedbackDate],
        set: {
          signal: entry.signal,
          taskCount: entry.taskCount,
          plannedMinutes: entry.plannedMinutes,
          bufferMin: entry.bufferMin,
        },
      });
  }

  async getRecentRhythmFeedback(userId: string, days: number): Promise<DailyRhythmFeedback[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return await db.select().from(dailyRhythmFeedback)
      .where(and(
        eq(dailyRhythmFeedback.userId, userId),
        gte(dailyRhythmFeedback.createdAt, since),
      ));
  }
```

Ajouter `dailyRhythmFeedback` et `type DailyRhythmFeedback` à l'import depuis `@shared/schema` en tête de `storage.ts`.

- [ ] **Étape 5 : ajouter l'endpoint**

Dans `server/routes.ts`, juste après `/api/planning/fix-overlaps` :

```typescript
  app.post('/api/planning/daily-feedback', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { date, signal } = req.body;

      const ALLOWED = ['on_track', 'felt_overloaded', 'tasks_wrong'];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !ALLOWED.includes(signal)) {
        return res.status(400).json({ message: 'date (YYYY-MM-DD) et signal valides requis' });
      }

      // Le contexte est dérivé côté serveur : le client ne sait pas ce qui compte.
      const dayTasks = await storage.getTasksInRange(userId, date, date);
      const prefs = await storage.getUserPreferences(userId).catch(() => null);

      await storage.recordDailyRhythmFeedback({
        userId,
        feedbackDate: date,
        signal,
        taskCount: dayTasks.length,
        plannedMinutes: dayTasks.reduce((sum, t) => sum + (t.estimatedDuration || 30), 0),
        bufferMin: prefs?.bufferMin ?? 10,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Error recording daily feedback:', error);
      res.status(500).json({ message: 'Failed to record daily feedback' });
    }
  });
```

- [ ] **Étape 6 : envoyer le retour au serveur côté client**

Dans `client/src/pages/planning.tsx`, remplacer `handleDailyFeedback` (ligne ~312) :

```typescript
  const dailyFeedbackMutation = useMutation({
    mutationFn: (signal: string) =>
      apiRequest('POST', '/api/planning/daily-feedback', { date: today, signal }).then(r => r.json()),
  });

  function handleDailyFeedback(key: string) {
    // Le localStorage reste, mais seulement pour ne pas re-demander le même jour :
    // la source de vérité est désormais le serveur.
    localStorage.setItem(`naya_daily_feedback_${today}`, key);
    setDailyFeedbackGiven(key);
    setDailyFeedbackThanks(true);
    setTimeout(() => setDailyFeedbackThanks(false), 2000);
    dailyFeedbackMutation.mutate(key);
  }
```

Vérifier que `apiRequest` est bien déjà importé dans ce fichier (il l'est, utilisé par les autres mutations).

- [ ] **Étape 7 : vérifier**

Commandes :
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run build
```
Attendu : `tsc` silencieux, suite verte, build OK.

- [ ] **Étape 8 : commit**

```bash
git add shared/schema.ts server/storage.ts server/routes.ts client/src/pages/planning.tsx
git commit -m "feat(planning): le retour de fin de journée est enfin persisté"
```

---

### Task 5 : la règle d'adaptation

**Fichiers :**
- Créer : `server/services/rhythm-buffer.ts`
- Créer : `server/services/rhythm-buffer.test.ts`
- Modifier : `server/index.ts:74-77` (cron hebdomadaire existant)
- Modifier : `server/storage.ts` (une méthode d'écriture)

**Interfaces :**
- Consomme : `storage.getRecentRhythmFeedback` (tâche 4), `userPreferences.bufferMin` / `bufferAdjustedAt` (tâche 2).
- Produit : `nextBufferMin(input): number` et `adjustBufferForUser(userId): Promise<void>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `server/services/rhythm-buffer.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { nextBufferMin } from "./rhythm-buffer";

const NOW = new Date("2026-08-28T12:00:00Z");
const sig = (signal: string, n: number) => Array.from({ length: n }, () => ({ signal }));

describe("nextBufferMin", () => {
  it("ne bouge pas en dessous de 5 signaux", () => {
    expect(nextBufferMin({ current: 10, signals: sig("felt_overloaded", 4), lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("augmente de 5 quand au moins 60 % des retours disent surchargé", () => {
    const signals = [...sig("felt_overloaded", 3), ...sig("on_track", 2)]; // 60 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(15);
  });

  it("diminue de 5 quand au moins 80 % des retours disent que ça allait", () => {
    const signals = [...sig("on_track", 4), ...sig("tasks_wrong", 1)]; // 80 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(5);
  });

  it("ne bouge pas quand aucun seuil n'est atteint", () => {
    const signals = [...sig("on_track", 3), ...sig("felt_overloaded", 2)]; // 40 % / 60 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("compte tasks_wrong dans le total sans pousser dans aucun sens", () => {
    // 3 surchargé sur 6 = 50 %, sous le seuil : les tasks_wrong diluent, c'est voulu.
    const signals = [...sig("felt_overloaded", 3), ...sig("tasks_wrong", 3)];
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("respecte le verrou hebdomadaire", () => {
    const signals = sig("felt_overloaded", 6);
    const ilYA3Jours = new Date("2026-08-25T12:00:00Z");
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: ilYA3Jours, now: NOW })).toBe(10);
  });

  it("autorise l'ajustement passé 7 jours", () => {
    const signals = sig("felt_overloaded", 6);
    const ilYA8Jours = new Date("2026-08-20T12:00:00Z");
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: ilYA8Jours, now: NOW })).toBe(15);
  });

  it("plafonne à 30", () => {
    expect(nextBufferMin({ current: 30, signals: sig("felt_overloaded", 6), lastAdjustedAt: null, now: NOW })).toBe(30);
  });

  it("plancher à 0", () => {
    expect(nextBufferMin({ current: 0, signals: sig("on_track", 6), lastAdjustedAt: null, now: NOW })).toBe(0);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/rhythm-buffer.test.ts`
Attendu : ÉCHEC — le module `./rhythm-buffer` n'existe pas.

- [ ] **Étape 3 : écrire la règle**

Créer `server/services/rhythm-buffer.ts` :

```typescript
import { storage } from '../storage';

export const BUFFER_MIN_FLOOR = 0;
export const BUFFER_MIN_CEILING = 30;
export const BUFFER_STEP = 5;
const MIN_SIGNALS = 5;
const WINDOW_DAYS = 14;
const LOCK_DAYS = 7;

export interface RhythmSignal { signal: string }

export interface NextBufferInput {
  current: number;
  /** Retours des 14 derniers jours, tous types confondus. */
  signals: RhythmSignal[];
  lastAdjustedAt: Date | null;
  now: Date;
}

/**
 * Nouvelle respiration à appliquer, en minutes. PURE.
 *
 * Conservatrice par construction : il faut au moins 5 retours, un seul ajustement par
 * semaine, et des pas de 5 minutes. Sans ces garde-fous la valeur oscillerait à chaque
 * nouveau retour et l'utilisateur verrait son planning bouger sans comprendre pourquoi.
 *
 * `tasks_wrong` compte dans le total mais ne pousse ni dans un sens ni dans l'autre :
 * il parle de la pertinence des tâches, pas de la densité de la journée.
 */
export function nextBufferMin(input: NextBufferInput): number {
  const { current, signals, lastAdjustedAt, now } = input;

  if (signals.length < MIN_SIGNALS) return current;

  if (lastAdjustedAt) {
    const daysSince = (now.getTime() - lastAdjustedAt.getTime()) / 86_400_000;
    if (daysSince < LOCK_DAYS) return current;
  }

  const total = signals.length;
  const overloaded = signals.filter((s) => s.signal === 'felt_overloaded').length;
  const onTrack = signals.filter((s) => s.signal === 'on_track').length;

  let next = current;
  if (overloaded / total >= 0.6) next = current + BUFFER_STEP;
  else if (onTrack / total >= 0.8) next = current - BUFFER_STEP;

  return Math.min(BUFFER_MIN_CEILING, Math.max(BUFFER_MIN_FLOOR, next));
}

/** Enveloppe DB : lit les retours récents, applique la règle, persiste si ça a changé. */
export async function adjustBufferForUser(userId: string): Promise<void> {
  const prefs = await storage.getUserPreferences(userId);
  const signals = await storage.getRecentRhythmFeedback(userId, WINDOW_DAYS);

  const current = prefs?.bufferMin ?? 10;
  const next = nextBufferMin({
    current,
    signals,
    lastAdjustedAt: prefs?.bufferAdjustedAt ?? null,
    now: new Date(),
  });

  if (next === current) return;
  await storage.setBufferMin(userId, next, new Date());
  console.log(`[RhythmBuffer] user ${userId}: ${current} → ${next} min`);
}
```

- [ ] **Étape 4 : ajouter l'écriture dans le storage**

Dans `server/storage.ts` (et sa signature dans `IStorage`) :

```typescript
  async setBufferMin(userId: string, bufferMin: number, adjustedAt: Date): Promise<void> {
    await db.update(userPreferences)
      .set({ bufferMin, bufferAdjustedAt: adjustedAt })
      .where(eq(userPreferences.userId, userId));
  }
```

- [ ] **Étape 5 : brancher sur le cron hebdomadaire existant**

Dans `server/index.ts`, ajouter l'import en tête :

```typescript
import { adjustBufferForUser } from "./services/rhythm-buffer";
```

puis, dans `scheduleWeeklyIntelligence`, après `await analyzeBehaviorPatterns(userId);` :

```typescript
        await adjustBufferForUser(userId);
```

- [ ] **Étape 6 : vérifier**

Commandes :
```bash
npx vitest run server/services/rhythm-buffer.test.ts
npx tsc --noEmit -p tsconfig.json
npx vitest run
```
Attendu : les 9 tests passent, `tsc` silencieux, suite complète verte.

- [ ] **Étape 7 : commit**

```bash
git add server/services/rhythm-buffer.ts server/services/rhythm-buffer.test.ts server/storage.ts server/index.ts
git commit -m "feat(planning): la respiration s'ajuste chaque semaine d'après les retours"
```

---

### Task 6 : restituer et permettre de corriger

**Fichiers :**
- Modifier : `client/src/pages/settings.tsx` (carte horaires, ~ligne 375-420)
- Modifier : `client/src/locales/fr.ts`
- Modifier : `client/src/locales/en.ts`

**Interfaces :**
- Consomme : `userPreferences.bufferMin` via `GET /api/preferences`, écrit via `PATCH /api/preferences`.

Sans cette restitution, Naya devient une boîte noire qui décale les journées sans dire pourquoi. Une modification manuelle doit remettre `bufferAdjustedAt` à `null` pour que l'adaptation automatique reparte de la valeur choisie plutôt que de rester bloquée par le verrou hebdomadaire.

- [ ] **Étape 1 : ajouter les chaînes françaises**

Dans `client/src/locales/fr.ts`, dans l'objet `settings` :

```typescript
    bufferTitle: "Respiration entre les tâches",
    bufferHelp: "Naya te laisse ce temps entre deux blocs — ajusté d'après tes retours de fin de journée.",
    bufferUnit: "minutes",
```

- [ ] **Étape 2 : ajouter les mêmes clés en anglais**

Dans `client/src/locales/en.ts`, dans l'objet `settings` :

```typescript
    bufferTitle: "Breathing room between tasks",
    bufferHelp: "Naya leaves you this much time between blocks — adjusted from your end-of-day feedback.",
    bufferUnit: "minutes",
```

- [ ] **Étape 3 : vérifier la parité des dictionnaires**

Commande : `npx vitest run client/src/locales/locales.test.ts`
Attendu : vert. Une clé présente d'un seul côté fait échouer ce test.

- [ ] **Étape 4 : ajouter le champ dans les Réglages**

Dans `client/src/pages/settings.tsx`, ajouter l'état près des autres (`const [workEnd, ...]`) :

```typescript
  const [bufferMin, setBufferMin] = useState(10);
```

Dans le `useEffect` qui hydrate depuis `schedulePrefs`, après `setWorkEnd(...)` :

```typescript
      setBufferMin((schedulePrefs as any).bufferMin ?? 10);
```

Dans `handleSaveSchedule`, ajouter au payload de `updateScheduleMutation.mutate({ ... })` :

```typescript
      bufferMin,
      // Réglage manuel : on lève le verrou hebdomadaire pour que l'ajustement
      // automatique reparte de la valeur choisie.
      bufferAdjustedAt: null,
```

Dans le JSX de la carte horaires, à côté des champs de pause déjeuner :

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium">{t('settings.bufferTitle')}</label>
  <div className="flex items-center gap-2">
    <Input
      type="number"
      min={0}
      max={30}
      step={5}
      value={bufferMin}
      onChange={(e) => setBufferMin(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
      className="w-24"
    />
    <span className="text-sm text-muted-foreground">{t('settings.bufferUnit')}</span>
  </div>
  <p className="text-xs text-muted-foreground">{t('settings.bufferHelp')}</p>
</div>
```

- [ ] **Étape 5 : vérifier**

Commandes :
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run build
```
Attendu : `tsc` silencieux, suite verte, build OK.

- [ ] **Étape 6 : commit**

```bash
git add client/src/pages/settings.tsx client/src/locales/fr.ts client/src/locales/en.ts
git commit -m "feat(planning): la respiration est visible et modifiable dans les Réglages"
```

---

### Task 7 : vérification de bout en bout, puis déploiement

**Fichiers :** aucun (vérification).

- [ ] **Étape 1 : suite complète**

Commandes :
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run build
```
Attendu : tout vert. Ne pas continuer sinon.

- [ ] **Étape 2 : confirmer que les migrations sont bien passées en production**

`mcp__Neon__run_sql`, `projectId: "dawn-waterfall-68860472"`, `branchId: "br-floral-wave-ane2h3l1"` :

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name IN ('buffer_min','buffer_adjusted_at');
```

Attendu : **deux** lignes. Puis :

```sql
SELECT to_regclass('public.daily_rhythm_feedback') AS table_presente;
```

Attendu : `daily_rhythm_feedback`, pas `null`. **Si l'une des deux vérifications échoue, ne pas pousser** — le code provoquerait des 500 en production.

- [ ] **Étape 3 : déployer**

```bash
git push origin main
```

Railway déploie automatiquement (~3-4 min).

- [ ] **Étape 4 : vérifier la mise en ligne**

```bash
curl -s https://www.hellonaya.app/api/health
```
Attendu : `{"status":"ok","db":"connected",...}`.

- [ ] **Étape 5 : vérifier l'effet réel sur le planning**

`mcp__Neon__run_sql` sur `br-floral-wave-ane2h3l1` — les écarts entre tâches consécutives doivent valoir au moins le tampon :

```sql
WITH t AS (
  SELECT user_id, scheduled_date,
         substr(scheduled_time,1,2)::int*60 + substr(scheduled_time,4,2)::int AS s,
         COALESCE(estimated_duration,30) AS dur
  FROM tasks
  WHERE completed = false AND archived_at IS NULL
    AND scheduled_time ~ '^[0-9]{2}:[0-9]{2}$' AND scheduled_date >= CURRENT_DATE::text
), p AS (
  SELECT *, LEAD(s) OVER (PARTITION BY user_id, scheduled_date ORDER BY s) AS next_s FROM t
)
SELECT min(next_s - (s + dur)) AS ecart_minimum, count(*) AS paires
FROM p WHERE next_s IS NOT NULL;
```

Attendu : `ecart_minimum` ≥ 0 (jamais négatif — aucun chevauchement). L'écart n'atteindra le tampon qu'après un re-tassage des tâches existantes : déclencher `POST /api/planning/fix-overlaps` depuis l'app, ou attendre le prochain passage du planificateur.

---

## Notes pour l'implémenteur

- **Question laissée ouverte volontairement :** le tampon ne s'applique pas après une plage bloquée (une tâche qui suit un rendez-vous démarre pile à la fin du rendez-vous). C'est une conséquence du choix « le tampon n'avance que le curseur ». Si Jeanne veut de l'air après ses réunions, ce sera un ajout ultérieur explicite — ne pas l'improviser ici.
- **Les tâches existantes ne bougeront pas toutes seules.** Le tampon ne s'applique qu'au prochain re-tassage. C'est normal, et c'est ce que vérifie l'étape 5 de la tâche 7.
- **Ne pas toucher à `duration-calibration.ts` ni `behavior-patterns.ts`.** Ils tournent à vide (aucune tâche terminée n'existe), mais les réparer est un chantier séparé identifié dans la spec.
