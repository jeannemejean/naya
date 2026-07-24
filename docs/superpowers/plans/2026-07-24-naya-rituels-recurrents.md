# Rituels récurrents & messages à Naya — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à Jeanne d'envoyer un message à Naya depuis la page projet, et à Naya de proposer un rituel récurrent qui, une fois validé, occupe un créneau protégé dans le planning.

**Architecture :** Le rituel est la source de vérité (table `recurring_rituals`, qui survit à tout) ; la tâche du jour n'en est que le reflet, recréée par `materializeRituals` avant chaque génération IA. La tâche du rituel est créée avec `schedulingMode: 'fixed'`, ce qui la rend inamovible dans `storage.createTask` : ce sont les autres tâches qui l'évitent.

**Tech Stack :** Express + Drizzle ORM + PostgreSQL Neon, React + react-query + Wouter, Claude Sonnet (`CLAUDE_MODELS.smart`), vitest.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-07-24-naya-rituels-recurrents-design.md`
- Périmètre v1 : `create_ritual` uniquement. Aucune autre proposition d'action.
- Naya **propose**, l'utilisateur valide. Aucune écriture de rituel sans clic explicite sur « Appliquer ».
- Le champ note reste **unique** (`projects.status_note`), pas de fil de messages.
- Le rituel **survit** au redémarrage de la planification et se re-matérialise.
- Page projet uniquement (`client/src/pages/project/`). Ne pas toucher au Dashboard.
- Migration **additive** appliquée via Neon MCP sur `dev-local` (`br-divine-base-anmsv1nj`) **ET** production (`br-floral-wave-ane2h3l1`) **avant** le push. Railway ne joue pas `db:push`.
- Tout chemin de (re)planification se termine par `storage.fixOverlappingTasks` (règle projet).
- Tout appel Claude passe par `callClaude`/`callClaudeDetailed` avec `userId` (imputation du plafond IA) et est protégé par `isAiBlocked` → `429 ai_monthly_limit_reached`.
- Réponses utilisateur en français. Code et identifiants en anglais.
- Commandes de vérification : `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `shared/schema.ts` | Table `recurringRituals` + colonne `tasks.ritualId` (modif) |
| `server/services/rituals.ts` | Logique pure : `ritualOccursOn`, `buildRitualTask` (création) |
| `server/services/rituals.test.ts` | Tests purs (création) |
| `server/services/ritual-materialize.ts` | `materializeRituals` (accès storage) (création) |
| `server/services/ritual-materialize.test.ts` | Tests avec storage mocké (création) |
| `server/services/ritual-analyze.ts` | Analyse du message par Claude → propositions (création) |
| `server/services/ritual-analyze.test.ts` | Tests avec Claude mocké (création) |
| `server/storage.ts` | CRUD rituels + `getRitualTaskForDate` (modif) |
| `server/routes.ts` | 4 routes + branchement matérialisation (modif) |
| `server/services/auto-planner.ts` | Matérialisation avant génération quotidienne (modif) |
| `server/services/account-reset-plan.ts` | Ajout de `recurring_rituals` à la cascade (modif) |
| `client/src/pages/project/useProjectPage.ts` | Hooks `useAnalyzeNote`, `useRituals`, `useCreateRitual`, `useDeactivateRitual` (modif) |
| `client/src/pages/project/ProjectContextEditor.tsx` | Bouton d'envoi + encart de proposition (modif) |
| `client/src/pages/project/ritual-format.ts` | `formatDays` — helper pur (création) |
| `client/src/pages/project/ritual-format.test.ts` | Tests de `formatDays` (création) |
| `client/src/pages/project/RitualList.tsx` | Liste des rituels du projet + désactivation (création) |

---

### Task 1 : Schéma — table `recurring_rituals` et colonne `tasks.ritual_id`

**Files:**
- Modify: `shared/schema.ts`

**Interfaces:**
- Consumes: rien
- Produces: `recurringRituals` (table Drizzle), types `RecurringRitual` / `InsertRecurringRitual`, colonne `tasks.ritualId`

- [ ] **Step 1 : Ajouter la table après `dayAvailability` dans `shared/schema.ts`**

```ts
// ─── Rituels récurrents ──────────────────────────────────────────────────────
// La DÉFINITION d'un engagement répété (ex. « brief news 20 min tous les matins »).
// Elle survit à tout, notamment au redémarrage de la planification qui supprime les
// tâches futures : les tâches du jour n'en sont que le reflet, re-matérialisé.
export const recurringRituals = pgTable("recurring_rituals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id), // null = transverse
  title: text("title").notNull(),
  days: text("days").notNull().default("mon,tue,wed,thu,fri"), // même format que work_days
  startTime: text("start_time").notNull(),                     // "HH:MM"
  durationMinutes: integer("duration_minutes").notNull().default(30),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_recurring_rituals_user").on(t.userId),
]);

export type RecurringRitual = typeof recurringRituals.$inferSelect;
export type InsertRecurringRitual = typeof recurringRituals.$inferInsert;
```

- [ ] **Step 2 : Ajouter la colonne sur `tasks`**

Dans la définition de `tasks`, à côté de `milestoneId`, ajouter :

```ts
  ritualId: integer("ritual_id").references(() => recurringRituals.id),
```

Puis, dans le bloc d'index de `tasks`, ajouter l'index unique qui rend la matérialisation idempotente :

```ts
  uniqueIndex("tasks_ritual_date_uq").on(t.ritualId, t.scheduledDate),
```

Note : `recurringRituals` est déclarée APRÈS `tasks` dans le fichier. Drizzle accepte la référence par callback (`() => recurringRituals.id`), donc l'ordre de déclaration ne pose pas de problème.

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie, exit 0

- [ ] **Step 4 : Commit**

```bash
git add shared/schema.ts
git commit -m "feat(rituels): schéma — table recurring_rituals + tasks.ritual_id"
```

---

### Task 2 : Logique pure des rituels

**Files:**
- Create: `server/services/rituals.ts`
- Test: `server/services/rituals.test.ts`

**Interfaces:**
- Consumes: type `RecurringRitual` (Task 1)
- Produces:
  - `ritualOccursOn(days: string, date: string): boolean`
  - `buildRitualTask(ritual: RecurringRitual, date: string): { title: string; scheduledDate: string; scheduledTime: string; scheduledEndTime: string; estimatedDuration: number; schedulingMode: 'fixed'; source: 'ritual' }`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `server/services/rituals.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { ritualOccursOn, buildRitualTask } from "./rituals";
import type { RecurringRitual } from "@shared/schema";

const RITUAL = {
  id: 1, userId: "u1", projectId: 3,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00",
  durationMinutes: 20,
  active: true,
  createdAt: null,
} as unknown as RecurringRitual;

describe("ritualOccursOn", () => {
  it("reconnaît un jour concerné", () => {
    // 2026-07-24 est un vendredi
    expect(ritualOccursOn("mon,tue,wed,thu,fri", "2026-07-24")).toBe(true);
  });

  it("exclut un jour non concerné", () => {
    // 2026-07-25 est un samedi
    expect(ritualOccursOn("mon,tue,wed,thu,fri", "2026-07-25")).toBe(false);
  });

  it("accepte un rituel de week-end (indépendant des jours ouvrés)", () => {
    expect(ritualOccursOn("sat,sun", "2026-07-25")).toBe(true);
  });

  it("tolère les espaces et les majuscules", () => {
    expect(ritualOccursOn("Mon, Fri", "2026-07-24")).toBe(true);
  });
});

describe("buildRitualTask", () => {
  it("calcule l'heure de fin à partir de la durée", () => {
    const t = buildRitualTask(RITUAL, "2026-07-24");
    expect(t.scheduledTime).toBe("09:00");
    expect(t.scheduledEndTime).toBe("09:20");
    expect(t.estimatedDuration).toBe(20);
    expect(t.scheduledDate).toBe("2026-07-24");
    expect(t.title).toBe("Brief news + posts JMD");
  });

  it("gère un passage d'heure", () => {
    const t = buildRitualTask({ ...RITUAL, startTime: "08:50", durationMinutes: 20 }, "2026-07-24");
    expect(t.scheduledEndTime).toBe("09:10");
  });

  it("ancre la tâche : schedulingMode 'fixed' pour que les autres tâches l'évitent", () => {
    const t = buildRitualTask(RITUAL, "2026-07-24");
    expect(t.schedulingMode).toBe("fixed");
    expect(t.source).toBe("ritual");
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run server/services/rituals.test.ts`
Expected: FAIL — `Failed to resolve import "./rituals"`

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `server/services/rituals.ts` :

```ts
// Logique PURE des rituels récurrents : aucun accès DB, aucun appel réseau.
import type { RecurringRitual } from "@shared/schema";

const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Le rituel tombe-t-il ce jour-là ? `days` suit le format de `work_days` ("mon,tue,…"). */
export function ritualOccursOn(days: string, date: string): boolean {
  const set = new Set(days.toLowerCase().split(",").map((d) => d.trim()));
  const [y, m, d] = date.split("-").map(Number);
  // UTC : évite tout décalage de fuseau sur le nom du jour.
  return set.has(DAY_ABBRS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}

export interface RitualTaskDraft {
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  scheduledEndTime: string;
  estimatedDuration: number;
  schedulingMode: "fixed";
  source: "ritual";
}

/**
 * Construit la tâche du jour à partir du rituel.
 * `schedulingMode: 'fixed'` est essentiel : dans storage.createTask, une tâche `fixed`
 * garde son heure et ce sont les AUTRES tâches qui se décalent pour l'éviter.
 */
export function buildRitualTask(ritual: RecurringRitual, date: string): RitualTaskDraft {
  const [h, m] = ritual.startTime.split(":").map(Number);
  const endMin = h * 60 + m + ritual.durationMinutes;
  const scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

  return {
    title: ritual.title,
    scheduledDate: date,
    scheduledTime: ritual.startTime,
    scheduledEndTime,
    estimatedDuration: ritual.durationMinutes,
    schedulingMode: "fixed",
    source: "ritual",
  };
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run: `npx vitest run server/services/rituals.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5 : Commit**

```bash
git add server/services/rituals.ts server/services/rituals.test.ts
git commit -m "feat(rituels): logique pure — ritualOccursOn + buildRitualTask"
```

---

### Task 3 : Storage — CRUD des rituels

**Files:**
- Modify: `server/storage.ts`

**Interfaces:**
- Consumes: `recurringRituals`, `RecurringRitual`, `InsertRecurringRitual` (Task 1)
- Produces, sur `DatabaseStorage` (et déclarés dans l'interface `IStorage`) :
  - `createRitual(data: InsertRecurringRitual): Promise<RecurringRitual>`
  - `getRituals(userId: string, projectId?: number): Promise<RecurringRitual[]>`
  - `getActiveRituals(userId: string): Promise<RecurringRitual[]>`
  - `deactivateRitual(id: number, userId: string): Promise<boolean>`
  - `getRitualTaskForDate(ritualId: number, date: string): Promise<{ id: number } | undefined>`

- [ ] **Step 1 : Ajouter les imports**

Dans le bloc d'import depuis `@shared/schema`, ajouter `recurringRituals`, et aux types importés `type RecurringRitual`, `type InsertRecurringRitual`.

- [ ] **Step 2 : Déclarer les méthodes dans l'interface `IStorage`**

Juste avant `// Journal des invocations IA (Phase 1 — corpus propriétaire)` :

```ts
  // Rituels récurrents
  createRitual(data: InsertRecurringRitual): Promise<RecurringRitual>;
  getRituals(userId: string, projectId?: number): Promise<RecurringRitual[]>;
  getActiveRituals(userId: string): Promise<RecurringRitual[]>;
  deactivateRitual(id: number, userId: string): Promise<boolean>;
  getRitualTaskForDate(ritualId: number, date: string): Promise<{ id: number } | undefined>;
```

- [ ] **Step 3 : Implémenter dans `DatabaseStorage`, juste avant `async createAiInvocation`**

```ts
  // ─── Rituels récurrents ───────────────────────────────────────────────────

  async createRitual(data: InsertRecurringRitual): Promise<RecurringRitual> {
    const [row] = await db.insert(recurringRituals).values(data).returning();
    return row;
  }

  async getRituals(userId: string, projectId?: number): Promise<RecurringRitual[]> {
    const conditions = [eq(recurringRituals.userId, userId)];
    if (projectId !== undefined) conditions.push(eq(recurringRituals.projectId, projectId));
    return db.select().from(recurringRituals)
      .where(and(...conditions))
      .orderBy(recurringRituals.startTime);
  }

  async getActiveRituals(userId: string): Promise<RecurringRitual[]> {
    return db.select().from(recurringRituals)
      .where(and(eq(recurringRituals.userId, userId), eq(recurringRituals.active, true)))
      .orderBy(recurringRituals.startTime);
  }

  async deactivateRitual(id: number, userId: string): Promise<boolean> {
    const result = await db.update(recurringRituals)
      .set({ active: false })
      .where(and(eq(recurringRituals.id, id), eq(recurringRituals.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  /** Une tâche existe-t-elle déjà pour ce rituel à cette date ? (idempotence) */
  async getRitualTaskForDate(ritualId: number, date: string): Promise<{ id: number } | undefined> {
    const [row] = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.ritualId, ritualId), eq(tasks.scheduledDate, date)))
      .limit(1);
    return row;
  }
```

- [ ] **Step 4 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie, exit 0

- [ ] **Step 5 : Commit**

```bash
git add server/storage.ts
git commit -m "feat(rituels): storage — CRUD rituels + getRitualTaskForDate"
```

---

### Task 4 : Matérialisation idempotente

**Files:**
- Create: `server/services/ritual-materialize.ts`
- Test: `server/services/ritual-materialize.test.ts`

**Interfaces:**
- Consumes: `ritualOccursOn`, `buildRitualTask` (Task 2) ; `storage.getActiveRituals`, `storage.getRitualTaskForDate`, `storage.createTask` (Task 3)
- Produces: `materializeRituals(userId: string, date: string): Promise<number>` — renvoie le nombre de tâches créées

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `server/services/ritual-materialize.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getActiveRituals: vi.fn(),
    getRitualTaskForDate: vi.fn(),
    createTask: vi.fn(),
  },
}));

import { storage } from "../storage";
import { materializeRituals } from "./ritual-materialize";

const RITUAL = {
  id: 1, userId: "u1", projectId: 3,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00",
  durationMinutes: 20,
  active: true,
  createdAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (storage.createTask as any).mockResolvedValue({ id: 99 });
});

describe("materializeRituals", () => {
  it("crée la tâche du jour pour un rituel actif", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-24"); // vendredi

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(1);
    expect((storage.createTask as any).mock.calls[0][0]).toMatchObject({
      userId: "u1",
      projectId: 3,
      ritualId: 1,
      title: "Brief news + posts JMD",
      scheduledDate: "2026-07-24",
      scheduledTime: "09:00",
      scheduledEndTime: "09:20",
      schedulingMode: "fixed",
    });
  });

  it("est idempotente : un second appel ne recrée rien", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue({ id: 99 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ne crée rien un jour non concerné", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-25"); // samedi

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ignore les rituels inactifs (getActiveRituals les exclut déjà)", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([]);

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("n'interrompt pas les autres rituels si l'un échoue", async () => {
    const second = { ...RITUAL, id: 2, title: "Revue du soir", startTime: "17:00" };
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL, second]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);
    (storage.createTask as any)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: 100 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run server/services/ritual-materialize.test.ts`
Expected: FAIL — `Failed to resolve import "./ritual-materialize"`

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `server/services/ritual-materialize.ts` :

```ts
// Matérialise les rituels d'un utilisateur en tâches concrètes pour une date donnée.
// Appelée AVANT toute génération IA : le créneau du rituel est ainsi déjà occupé.
import { storage } from "../storage";
import { ritualOccursOn, buildRitualTask } from "./rituals";

/**
 * Crée la tâche du jour pour chaque rituel actif tombant à cette date.
 * Idempotente : ne crée rien si une tâche existe déjà pour (ritualId, date).
 * Renvoie le nombre de tâches créées.
 */
export async function materializeRituals(userId: string, date: string): Promise<number> {
  const rituals = await storage.getActiveRituals(userId);
  let created = 0;

  for (const ritual of rituals) {
    if (!ritualOccursOn(ritual.days, date)) continue;

    const existing = await storage.getRitualTaskForDate(ritual.id, date);
    if (existing) continue;

    const draft = buildRitualTask(ritual, date);
    try {
      await storage.createTask({
        userId,
        projectId: ritual.projectId,
        ritualId: ritual.id,
        type: "execution",
        priority: 1,
        ...draft,
      } as any);
      created++;
    } catch (e: any) {
      // Un rituel en échec ne doit jamais bloquer les autres ni la génération.
      console.error(`[Rituals] materialize ${ritual.id} on ${date}:`, e?.message);
    }
  }

  return created;
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run: `npx vitest run server/services/ritual-materialize.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5 : Commit**

```bash
git add server/services/ritual-materialize.ts server/services/ritual-materialize.test.ts
git commit -m "feat(rituels): matérialisation idempotente des rituels en tâches"
```

---

### Task 5 : Analyse du message par Claude

**Files:**
- Create: `server/services/ritual-analyze.ts`
- Test: `server/services/ritual-analyze.test.ts`

**Interfaces:**
- Consumes: `callClaudeDetailed`, `assertNotTruncated`, `CLAUDE_MODELS` depuis `./claude`
- Produces:
  - `interface RitualProposal { kind: 'create_ritual'; title: string; days: string; startTime: string; durationMinutes: number }`
  - `interface NoteAnalysis { understood: string; proposals: RitualProposal[] }`
  - `analyzeStatusNote(opts: { userId: string; projectId: number; note: string; projectName: string }): Promise<NoteAnalysis>`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `server/services/ritual-analyze.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaudeDetailed: vi.fn() };
});

import * as claude from "./claude";
import { analyzeStatusNote } from "./ritual-analyze";

const ARGS = { userId: "u1", projectId: 3, projectName: "Agence JMD", note: "peu importe" };

beforeEach(() => vi.clearAllMocks());

describe("analyzeStatusNote", () => {
  it("extrait un rituel récurrent d'un message en langage naturel", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "Un rituel matinal de 20 minutes pour l'agence JMD.",
        proposals: [{
          kind: "create_ritual",
          title: "Brief news + posts JMD",
          days: "mon,tue,wed,thu,fri",
          startTime: "09:00",
          durationMinutes: 20,
        }],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      kind: "create_ritual", title: "Brief news + posts JMD", durationMinutes: 20,
    });
  });

  it("ne propose rien pour un message sans rituel", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({ understood: "Noté. Rien à changer dans ton planning.", proposals: [] }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toEqual([]);
    expect(result.understood).toContain("Noté");
  });

  it("tolère un JSON entouré de texte", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: 'Voici :\n```json\n{"understood":"ok","proposals":[]}\n```',
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);
    expect(result.proposals).toEqual([]);
  });

  it("rejette une réponse tronquée AVANT de parser", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: '{"understood":"ok","proposals":[{"kind":"create_ritu',
      stopReason: "max_tokens",
    });

    await expect(analyzeStatusNote(ARGS)).rejects.toThrow(/TRUNCATED/);
  });

  it("écarte une proposition mal formée plutôt que de la laisser passer", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({
        understood: "ok",
        proposals: [
          { kind: "create_ritual", title: "Sans heure", days: "mon", startTime: "nawak", durationMinutes: 20 },
          { kind: "create_ritual", title: "Valide", days: "mon", startTime: "09:00", durationMinutes: 20 },
        ],
      }),
      stopReason: "end_turn",
    });

    const result = await analyzeStatusNote(ARGS);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].title).toBe("Valide");
  });

  it("impute le coût IA à l'utilisateur", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({
      text: JSON.stringify({ understood: "ok", proposals: [] }), stopReason: "end_turn",
    });

    await analyzeStatusNote(ARGS);

    expect((claude.callClaudeDetailed as any).mock.calls[0][0]).toMatchObject({
      userId: "u1", projectId: 3,
    });
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run server/services/ritual-analyze.test.ts`
Expected: FAIL — `Failed to resolve import "./ritual-analyze"`

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `server/services/ritual-analyze.ts` :

```ts
// Lit le message libre écrit par l'utilisateur dans « Où en est ce projet ? » et en
// extrait d'éventuels RITUELS récurrents. N'écrit RIEN : ne fait que proposer.
import { callClaudeDetailed, assertNotTruncated, CLAUDE_MODELS } from "./claude";

export interface RitualProposal {
  kind: "create_ritual";
  title: string;
  days: string;            // "mon,tue,wed,thu,fri"
  startTime: string;       // "HH:MM"
  durationMinutes: number;
}

export interface NoteAnalysis {
  understood: string;
  proposals: RitualProposal[];
}

const VALID_DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/** Une proposition inexploitable est écartée : mieux vaut ne rien proposer qu'un rituel faux. */
function isValidProposal(p: any): p is RitualProposal {
  return (
    p && p.kind === "create_ritual" &&
    typeof p.title === "string" && p.title.trim().length > 0 &&
    typeof p.startTime === "string" && /^\d{2}:\d{2}$/.test(p.startTime) &&
    typeof p.durationMinutes === "number" && p.durationMinutes > 0 && p.durationMinutes <= 480 &&
    typeof p.days === "string" &&
    p.days.split(",").map((d: string) => d.trim().toLowerCase()).every((d: string) => VALID_DAYS.has(d))
  );
}

/** Extrait le premier objet JSON d'une réponse éventuellement entourée de texte. */
function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Réponse illisible du modèle (aucun JSON trouvé).");
  }
  return JSON.parse(text.slice(start, end + 1));
}

const SYSTEM = `Tu analyses une note écrite par un entrepreneur sur l'un de ses projets.

Ta SEULE mission : repérer un ENGAGEMENT RÉCURRENT (« tous les matins », « chaque lundi »,
« toutes les semaines ») qui devrait occuper un créneau protégé dans son planning.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{
  "understood": "une phrase courte, à la 2e personne, disant ce que tu as compris",
  "proposals": [
    { "kind": "create_ritual", "title": "…", "days": "mon,tue,wed,thu,fri",
      "startTime": "HH:MM", "durationMinutes": 20 }
  ]
}

Règles :
- Aucun engagement récurrent → "proposals": [] et un "understood" du type « Noté. Rien à changer dans ton planning. »
- Un événement ponctuel, une décision ou un blocage n'est PAS un rituel → "proposals": [].
- Si l'heure n'est pas précisée mais que le moment l'est (« le matin »), choisis 09:00 pour le matin,
  14:00 pour l'après-midi, 17:00 pour la fin de journée.
- Si la durée n'est pas précisée, mets 30.
- "days" par défaut : "mon,tue,wed,thu,fri".
- Titre court et actionnable, sans guillemets.`;

export async function analyzeStatusNote(opts: {
  userId: string;
  projectId: number;
  note: string;
  projectName: string;
}): Promise<NoteAnalysis> {
  const { text, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart,
    system: SYSTEM,
    messages: [{ role: "user", content: `Projet : ${opts.projectName}\n\nNote :\n${opts.note}` }],
    max_tokens: 800,
    userId: opts.userId,
    projectId: opts.projectId,
  });

  assertNotTruncated(stopReason, "analyse de la note projet");

  const parsed = extractJson(text);
  const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.filter(isValidProposal) : [];

  return {
    understood: typeof parsed.understood === "string" ? parsed.understood : "Noté.",
    proposals,
  };
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run: `npx vitest run server/services/ritual-analyze.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5 : Commit**

```bash
git add server/services/ritual-analyze.ts server/services/ritual-analyze.test.ts
git commit -m "feat(rituels): analyse du message projet → propositions de rituel"
```

---

### Task 6 : Cascade de suppression — ajouter les rituels au plan de reset

**Files:**
- Modify: `server/services/account-reset-plan.ts`

**Interfaces:**
- Consumes: `ACCOUNT_RESET_PLAN` existant
- Produces: plan couvrant `recurring_rituals`

- [ ] **Step 1 : Constater l'échec du garde-fou**

Run: `npx vitest run server/services/account-reset-plan.test.ts`
Expected: FAIL — `tasks.ritual_id → recurring_rituals : « recurring_rituals » n'est pas traitée par le plan de reset`

C'est le comportement attendu : le test détecte la nouvelle table avant qu'elle ne casse la production.

- [ ] **Step 2 : Ajouter l'étape au plan**

Dans `ACCOUNT_RESET_PLAN`, phase 9 (« autres enfants de projects »), après `{ table: "clients", mode: "delete" }` :

```ts
  // Les tâches (phase 3) sont déjà supprimées : les rituels peuvent partir.
  { table: "recurring_rituals", mode: "delete" },
```

- [ ] **Step 3 : Vérifier que le test repasse**

Run: `npx vitest run server/services/account-reset-plan.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 4 : Refléter le plan dans `resetUserOnboardingState`**

Dans `server/storage.ts`, phase 9, après la suppression de `clients` :

```ts
      await tx.delete(recurringRituals).where(eq(recurringRituals.userId, userId)); // tasks déjà supprimées (phase 3)
```

Ajouter `recurringRituals` aux imports depuis `@shared/schema` si ce n'est pas déjà fait (Task 3).

- [ ] **Step 5 : Vérifier la compilation et la suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, tous les tests passent

- [ ] **Step 6 : Commit**

```bash
git add server/services/account-reset-plan.ts server/storage.ts
git commit -m "fix(reset): inclure recurring_rituals dans la cascade de suppression"
```

---

### Task 7 : Migration Neon (dev + production)

**Files:**
- Aucun fichier modifié — opération sur les bases

**Interfaces:**
- Consumes: schéma de la Task 1
- Produces: table et colonne présentes sur `dev-local` et production

- [ ] **Step 1 : Appliquer sur la branche dev `br-divine-base-anmsv1nj`**

Via l'outil Neon MCP `run_sql` (une commande par appel, DDL idempotente) :

```sql
CREATE TABLE IF NOT EXISTS recurring_rituals (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id),
  project_id integer REFERENCES projects(id),
  title text NOT NULL,
  days text NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
  start_time text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now()
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_recurring_rituals_user ON recurring_rituals (user_id);
```

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ritual_id integer REFERENCES recurring_rituals(id);
```

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tasks_ritual_date_uq ON tasks (ritual_id, scheduled_date);
```

- [ ] **Step 2 : Vérifier sur dev**

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'ritual_id';
```
Expected: une ligne

- [ ] **Step 3 : Appliquer les mêmes 4 commandes sur la production `br-floral-wave-ane2h3l1`**

Migration purement additive : le code en production l'ignore jusqu'au déploiement.

- [ ] **Step 4 : Vérifier sur production**

```sql
SELECT count(*)::int FROM recurring_rituals;
```
Expected: `0`

- [ ] **Step 5 : Lancer l'application en local contre la branche dev**

Run: `npm run dev` puis `curl -s http://localhost:3000/api/health`
Expected: `{"status":"ok","db":"connected",…}`

Arrêter le serveur ensuite (`pkill -f "tsx server/index.ts"`) — le worker de publication sociale ne doit pas tourner inutilement.

---

### Task 8 : Routes serveur

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `analyzeStatusNote` (Task 5), `materializeRituals` (Task 4), storage (Task 3)
- Produces :
  - `POST /api/projects/:id/status-note/analyze` → `{ understood, proposals }`
  - `GET  /api/projects/:id/rituals` → `RecurringRitual[]`
  - `POST /api/rituals` → `{ ritual, materialized }`
  - `POST /api/rituals/:id/deactivate` → `{ deactivated: true }`

- [ ] **Step 1 : Ajouter les imports en tête de fichier**

```ts
import { analyzeStatusNote } from "./services/ritual-analyze";
import { materializeRituals } from "./services/ritual-materialize";
```

- [ ] **Step 2 : Ajouter les 4 routes, juste après le bloc `app.delete('/api/me/onboarding-reset', …)`**

```ts
  // ─── Rituels récurrents ─────────────────────────────────────────────────────

  app.post('/api/projects/:id/status-note/analyze', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id, 10);
      const { note } = req.body ?? {};
      if (typeof note !== 'string') {
        return res.status(400).json({ message: "note requise" });
      }

      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      // La note est enregistrée quoi qu'il arrive : l'analyse est un bonus,
      // son échec ne doit jamais faire perdre ce que l'utilisateur a écrit.
      await storage.updateProject(projectId, userId, { statusNote: note });

      if (await isAiBlocked(userId)) {
        return res.status(429).json({ message: "ai_monthly_limit_reached" });
      }

      const analysis = await analyzeStatusNote({
        userId, projectId, note, projectName: project.name,
      });
      res.json(analysis);
    } catch (error: any) {
      console.error("Error analyzing status note:", error);
      res.status(500).json({ message: "Analyse impossible" });
    }
  });

  app.get('/api/projects/:id/rituals', isAuthenticated, async (req: any, res) => {
    try {
      const rituals = await storage.getRituals(req.userId, parseInt(req.params.id, 10));
      res.json(rituals);
    } catch (error) {
      console.error("Error fetching rituals:", error);
      res.status(500).json({ message: "Lecture des rituels impossible" });
    }
  });

  app.post('/api/rituals', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { projectId, title, days, startTime, durationMinutes } = req.body ?? {};

      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ message: "title requis" });
      }
      if (typeof startTime !== 'string' || !/^\d{2}:\d{2}$/.test(startTime)) {
        return res.status(400).json({ message: "startTime requis (HH:MM)" });
      }
      const duration = Number(durationMinutes);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 480) {
        return res.status(400).json({ message: "durationMinutes invalide" });
      }
      if (projectId != null) {
        const project = await storage.getProject(Number(projectId), userId);
        if (!project) return res.status(404).json({ message: "Projet introuvable" });
      }

      const ritual = await storage.createRitual({
        userId,
        projectId: projectId != null ? Number(projectId) : null,
        title: title.trim(),
        days: typeof days === 'string' && days.trim() ? days.trim() : 'mon,tue,wed,thu,fri',
        startTime,
        durationMinutes: duration,
      });

      // Matérialiser les 14 prochains jours pour que l'effet soit visible tout de suite.
      const today = new Date();
      let materialized = 0;
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        materialized += await materializeRituals(userId, ds);
      }

      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await storage.fixOverlappingTasks(userId, todayStr).catch((e: any) =>
        console.error('[rituals] fixOverlappingTasks:', e?.message),
      );

      res.json({ ritual, materialized });
    } catch (error) {
      console.error("Error creating ritual:", error);
      res.status(500).json({ message: "Création du rituel impossible" });
    }
  });

  app.post('/api/rituals/:id/deactivate', isAuthenticated, async (req: any, res) => {
    try {
      const ok = await storage.deactivateRitual(parseInt(req.params.id, 10), req.userId);
      if (!ok) return res.status(404).json({ message: "Rituel introuvable" });
      res.json({ deactivated: true });
    } catch (error) {
      console.error("Error deactivating ritual:", error);
      res.status(500).json({ message: "Désactivation impossible" });
    }
  });
```

- [ ] **Step 3 : Brancher la matérialisation dans `POST /api/tasks/generate-daily`**

Dans ce handler, juste **avant** la boucle de génération par projet (donc avant tout appel IA), ajouter :

```ts
      // Les rituels occupent leur créneau AVANT que l'IA ne place quoi que ce soit.
      await materializeRituals(userId, todayStr).catch((e: any) =>
        console.error('[generate-daily] materializeRituals:', e?.message),
      );
```

- [ ] **Step 4 : Brancher la matérialisation dans `POST /api/planning/restart`**

Dans ce handler, entre la suppression des tâches futures et l'appel à `rolloverStaleTasks` :

```ts
      // Le rituel survit au redémarrage : on le re-matérialise immédiatement.
      await materializeRituals(userId, todayStr).catch((e: any) =>
        console.error('[planning/restart] materializeRituals:', e?.message),
      );
```

- [ ] **Step 5 : Vérifier compilation et suite de tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, tous les tests passent

- [ ] **Step 6 : Commit**

```bash
git add server/routes.ts
git commit -m "feat(rituels): routes analyse/CRUD + matérialisation dans les chemins de génération"
```

---

### Task 9 : Matérialisation dans le job quotidien

**Files:**
- Modify: `server/services/auto-planner.ts`

**Interfaces:**
- Consumes: `materializeRituals` (Task 4)
- Produces: rituels présents dans les plannings générés à 06:00 UTC

- [ ] **Step 1 : Ajouter l'import en tête de fichier**

```ts
import { materializeRituals } from './ritual-materialize';
```

- [ ] **Step 2 : Appeler au début de `generateForUser`**

Dans `generateForUser(userId, dateStr)`, juste après le garde `if (!brandDna) return;` :

```ts
  // Les rituels d'abord : leur créneau est pris avant que l'IA ne place ses tâches.
  await materializeRituals(userId, dateStr).catch(e =>
    console.error(`[AutoPlanner] materializeRituals ${userId} ${dateStr}:`, e.message)
  );
```

- [ ] **Step 3 : Vérifier compilation et suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, tous les tests passent

- [ ] **Step 4 : Commit**

```bash
git add server/services/auto-planner.ts
git commit -m "feat(rituels): matérialisation dans le planificateur quotidien"
```

---

### Task 10 : Hooks client

**Files:**
- Modify: `client/src/pages/project/useProjectPage.ts`

**Interfaces:**
- Consumes: routes de la Task 8
- Produces:
  - `useAnalyzeNote(id: number)` → mutation `(note: string) => NoteAnalysis`
  - `useRituals(id: number)` → query `RecurringRitual[]`
  - `useCreateRitual(id: number)` → mutation `(p: RitualProposal) => void`
  - `useDeactivateRitual(id: number)` → mutation `(ritualId: number) => void`
  - types `RitualProposal`, `NoteAnalysis` (redéclarés côté client)

- [ ] **Step 1 : Ajouter les types et hooks à la fin du fichier**

```ts
// ─── Rituels récurrents ─────────────────────────────────────────────────────

export interface RitualProposal {
  kind: "create_ritual";
  title: string;
  days: string;
  startTime: string;
  durationMinutes: number;
}

export interface NoteAnalysis {
  understood: string;
  proposals: RitualProposal[];
}

/** Enregistre la note ET demande à Naya ce qu'elle en comprend. */
export const useAnalyzeNote = (id: number) =>
  useMutation<NoteAnalysis, Error, string>({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/projects/${id}/status-note/analyze`, { note }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

export const useRituals = (id: number) =>
  useQuery<RecurringRitual[]>({ queryKey: [`/api/projects/${id}/rituals`] });

export const useCreateRitual = (id: number) =>
  useMutation<Response, Error, RitualProposal>({
    mutationFn: (p: RitualProposal) =>
      apiRequest("POST", `/api/rituals`, {
        projectId: id,
        title: p.title,
        days: p.days,
        startTime: p.startTime,
        durationMinutes: p.durationMinutes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}/rituals`] });
      // Le planning vient de changer : tâches et aperçus deviennent obsolètes.
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/range"] });
    },
  });

export const useDeactivateRitual = (id: number) =>
  useMutation<Response, Error, number>({
    mutationFn: (ritualId: number) => apiRequest("POST", `/api/rituals/${ritualId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}/rituals`] });
    },
  });
```

- [ ] **Step 2 : Compléter l'import de types en tête de fichier**

```ts
import type { Project, ProjectGoal, ProjectMilestone, ProjectStrategyProfile, RecurringRitual } from "@shared/schema";
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie, exit 0

- [ ] **Step 4 : Commit**

```bash
git add client/src/pages/project/useProjectPage.ts
git commit -m "feat(rituels): hooks client — analyse, liste, création, désactivation"
```

---

### Task 11 : Liste des rituels

**Files:**
- Create: `client/src/pages/project/ritual-format.ts`
- Create: `client/src/pages/project/RitualList.tsx`
- Test: `client/src/pages/project/ritual-format.test.ts`

**Interfaces:**
- Consumes: `useRituals`, `useDeactivateRitual` (Task 10)
- Produces:
  - `formatDays(days: string): string` (module pur, réutilisé par la Task 12)
  - `<RitualList projectId={number} />`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `client/src/pages/project/ritual-format.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { formatDays } from "./ritual-format";

describe("formatDays", () => {
  it("résume la semaine de travail", () => {
    expect(formatDays("mon,tue,wed,thu,fri")).toBe("du lun au ven");
  });

  it("résume la semaine complète", () => {
    expect(formatDays("mon,tue,wed,thu,fri,sat,sun")).toBe("tous les jours");
  });

  it("liste les jours épars", () => {
    expect(formatDays("mon,wed,fri")).toBe("lun · mer · ven");
  });

  it("tolère espaces et majuscules", () => {
    expect(formatDays("Mon, Wed")).toBe("lun · mer");
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run client/src/pages/project/ritual-format.test.ts`
Expected: FAIL — `Failed to resolve import "./ritual-format"`

- [ ] **Step 3 : Créer le module pur**

Créer `client/src/pages/project/ritual-format.ts` :

```ts
// Helper PUR d'affichage des jours d'un rituel. Isolé de RitualList.tsx pour rester
// testable en environnement node (le composant tire queryClient, côté navigateur).
const DAY_LABELS: Record<string, string> = {
  mon: "lun", tue: "mar", wed: "mer", thu: "jeu", fri: "ven", sat: "sam", sun: "dim",
};

/** "mon,tue,wed,thu,fri" → "du lun au ven" ; sinon "lun · mer · ven". */
export function formatDays(days: string): string {
  const list = days.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (list.length === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => list.includes(d))) {
    return "du lun au ven";
  }
  if (list.length === 7) return "tous les jours";
  return list.map((d) => DAY_LABELS[d] ?? d).join(" · ");
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run: `npx vitest run client/src/pages/project/ritual-format.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5 : Créer le composant**

Créer `client/src/pages/project/RitualList.tsx` :

```tsx
// Liste des rituels d'un projet. Sans ce composant, un rituel créé par erreur
// serait impossible à retirer.
import { useRituals, useDeactivateRitual } from "./useProjectPage";
import { formatDays } from "./ritual-format";
import { useToast } from "@/hooks/use-toast";
import { Repeat, X } from "lucide-react";

export default function RitualList({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: rituals = [] } = useRituals(projectId);
  const deactivate = useDeactivateRitual(projectId);

  const active = rituals.filter((r) => r.active);
  if (active.length === 0) return null;

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <p className="text-xs font-medium text-foreground">Rituels de ce projet</p>
      <ul className="space-y-1.5">
        {active.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-xs text-naya-olive-70">
            <Repeat className="w-3 h-3 text-naya-olive-55 flex-shrink-0" />
            <span className="flex-1 truncate">
              <strong className="font-medium text-foreground">{r.title}</strong>
              {" — "}{formatDays(r.days)}, {r.startTime}, {r.durationMinutes} min
            </span>
            <button
              onClick={() =>
                deactivate.mutate(r.id, {
                  onSuccess: () => toast({ title: "Rituel désactivé" }),
                  onError: () => toast({ title: "Échec de la désactivation", variant: "destructive" }),
                })
              }
              disabled={deactivate.isPending}
              title="Désactiver ce rituel"
              className="text-naya-olive-55 hover:text-naya-olive transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie, exit 0

- [ ] **Step 7 : Commit**

```bash
git add client/src/pages/project/ritual-format.ts client/src/pages/project/ritual-format.test.ts client/src/pages/project/RitualList.tsx
git commit -m "feat(rituels): liste des rituels du projet avec désactivation"
```

---

### Task 12 : Bouton « Envoyer à Naya » et encart de proposition

**Files:**
- Modify: `client/src/pages/project/ProjectContextEditor.tsx`

**Interfaces:**
- Consumes: `useAnalyzeNote`, `useCreateRitual`, types `NoteAnalysis`/`RitualProposal` (Task 10) ; `RitualList` et `formatDays` (Task 11)
- Produces: interface complète de la carte

- [ ] **Step 1 : Remplacer les imports et l'état du composant**

Remplacer l'import de `useProjectPage` par :

```ts
import { useSaveStage, useAnalyzeNote, useCreateRitual, type ProjectDetail, type NoteAnalysis, type RitualProposal } from "./useProjectPage";
import RitualList from "./RitualList";
import { formatDays } from "./ritual-format";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
```

`useSaveStatusNote` n'est plus utilisé par ce composant : l'enregistrement passe désormais par
`useAnalyzeNote`, qui enregistre la note côté serveur avant de l'analyser. Le hook reste exporté
pour le reste de l'app.

Retirer aussi l'import devenu inutile de l'icône `Check` (`import { Check } from "lucide-react"`),
qui servait uniquement à l'indicateur « Enregistré » supprimé.

Remplacer le corps du composant (état + handlers) par :

```tsx
export default function ProjectContextEditor({ project, strategyProfile }: ProjectContextEditorProps) {
  const { toast } = useToast();
  const analyze = useAnalyzeNote(project.id);
  const createRitual = useCreateRitual(project.id);
  const saveStage = useSaveStage(project.id);

  const [noteDraft, setNoteDraft] = useState(project.statusNote ?? "");
  const [analysis, setAnalysis] = useState<NoteAnalysis | null>(null);

  useEffect(() => {
    setNoteDraft(project.statusNote ?? "");
    setAnalysis(null);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unchanged = noteDraft.trim() === (project.statusNote ?? "").trim();

  const handleSend = () => {
    setAnalysis(null);
    analyze.mutate(noteDraft, {
      onSuccess: (result) => setAnalysis(result),
      onError: (err: any) => {
        const msg = String(err?.message ?? "");
        toast({
          title: "Naya n'a pas pu lire ton message",
          description: msg.includes("429")
            ? "Limite d'utilisation de l'IA atteinte pour ce mois-ci. Ta note est bien enregistrée."
            : "Ta note est enregistrée, mais l'analyse a échoué. Réessaie.",
          variant: "destructive",
        });
      },
    });
  };

  const handleApply = (proposal: RitualProposal) => {
    createRitual.mutate(proposal, {
      onSuccess: () => {
        toast({
          title: "Rituel ajouté à ton planning",
          description: `${proposal.title} — ${formatDays(proposal.days)}, ${proposal.startTime}.`,
        });
        setAnalysis(null);
      },
      onError: () => toast({ title: "Impossible d'ajouter le rituel", variant: "destructive" }),
    });
  };

  const handleStageChange = (value: string) => {
    saveStage.mutate(value, {
      onSuccess: () => {
        toast({ title: "Stade mis à jour", description: `Le projet est maintenant en « ${STAGE_OPTIONS.find((s) => s.value === value)?.label} ».` });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de mettre à jour le stade. Réessaie.", variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 2 : Remplacer le bloc de rendu de la note**

Remplacer tout le `<div>` contenant le label, le paragraphe d'aide et le `<Textarea>` par :

```tsx
      <div>
        <label htmlFor="project-status-note" className="text-sm font-medium text-foreground">
          Où en est ce projet ? (dis tout à Naya)
        </label>
        <p className="text-xs text-naya-olive-55 mt-1 mb-2">
          Naya connaît déjà ce que tu fais dans l'app. Note ici ce qu'elle ne peut pas deviner : un
          événement externe, une décision, un blocage, ce que tu as fait hors Naya.
        </p>
        <Textarea
          id="project-status-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Ex : tous les matins je fais un brief news, ça me prend 20 min…"
          className="min-h-[100px]"
        />

        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={handleSend} disabled={analyze.isPending || !noteDraft.trim() || unchanged}>
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {analyze.isPending ? "Naya lit…" : "Envoyer à Naya"}
          </Button>
        </div>

        {analysis && (
          <div className="mt-3 rounded-lg border border-naya-olive-18 bg-naya-olive-06 p-3 space-y-3">
            <p className="text-xs text-foreground">{analysis.understood}</p>

            {analysis.proposals.map((p, i) => (
              <div key={i} className="rounded-md border border-naya-olive-18 bg-white p-2.5 space-y-2">
                <p className="text-xs text-foreground">
                  <strong className="font-medium">{p.title}</strong>
                  {" — "}{formatDays(p.days)}, {p.startTime}, {p.durationMinutes} min
                </p>
                <p className="text-[11px] text-naya-olive-55">
                  Ce créneau sera réservé : rien ne sera planifié par-dessus.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleApply(p)} disabled={createRitual.isPending}>
                    {createRitual.isPending ? "Ajout…" : "Appliquer"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAnalysis(null)}>
                    Ignorer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RitualList projectId={project.id} />
```

- [ ] **Step 3 : Vérifier compilation et build**

Run: `npx tsc --noEmit && npm run build`
Expected: exit 0, build réussi

- [ ] **Step 4 : Lancer la suite complète**

Run: `npx vitest run`
Expected: tous les tests passent

- [ ] **Step 5 : Commit**

```bash
git add client/src/pages/project/ProjectContextEditor.tsx
git commit -m "feat(rituels): bouton « Envoyer à Naya » + encart de proposition"
```

---

### Task 13 : Vérification de bout en bout sur copie de production

**Files:**
- Aucun fichier modifié

**Interfaces:**
- Consumes: l'ensemble des tâches précédentes
- Produces: preuve que le rituel occupe son créneau et survit au redémarrage

- [ ] **Step 1 : Créer une branche Neon éphémère depuis la production**

Via l'outil Neon MCP `create_branch` : projet `dawn-waterfall-68860472`, parent `br-floral-wave-ane2h3l1`, nom `test-rituels`, avec `expiresAt` au lendemain.

- [ ] **Step 2 : Écrire le script de vérification**

Créer `verif-rituels.tmp.ts` à la racine du repo :

```ts
import { db } from "./server/db";
import { storage } from "./server/storage";
import { materializeRituals } from "./server/services/ritual-materialize";
import { sql } from "drizzle-orm";

const USER = "qNCa68cbCCGcMAcLWmehk";
const TODAY = new Date().toISOString().slice(0, 10);

const ritual = await storage.createRitual({
  userId: USER, projectId: null,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00", durationMinutes: 20,
});
console.log("rituel créé:", ritual.id);

const a = await materializeRituals(USER, TODAY);
const b = await materializeRituals(USER, TODAY); // idempotence
console.log(`matérialisation: ${a} puis ${b} (le second doit valoir 0)`);

await storage.fixOverlappingTasks(USER, TODAY);

const r: any = await db.execute(sql.raw(`
  SELECT scheduled_time, scheduled_end_time, scheduling_mode
  FROM tasks WHERE ritual_id = ${ritual.id} AND scheduled_date = '${TODAY}'`));
console.log("tâche du rituel:", (r.rows ?? r)[0]);

const chevauche: any = await db.execute(sql.raw(`
  SELECT count(*)::int n FROM tasks a JOIN tasks b ON a.id <> b.id
   AND a.scheduled_date = b.scheduled_date AND a.scheduled_time < b.scheduled_end_time
   AND b.scheduled_time < a.scheduled_end_time
  WHERE a.user_id = '${USER}' AND a.ritual_id = ${ritual.id} AND a.scheduled_date = '${TODAY}'`));
console.log("chevauchements sur le créneau du rituel:", (chevauche.rows ?? chevauche)[0].n);

// Survie au redémarrage
await storage.deleteIncompleteFutureTasks(USER, TODAY);
const apres = await materializeRituals(USER, TODAY);
console.log(`après redémarrage, rituel re-matérialisé: ${apres} (doit valoir 1)`);
process.exit(0);
```

- [ ] **Step 2 bis : Exécuter contre la branche éphémère**

```bash
DATABASE_URL="<connection string de test-rituels>" NODE_ENV=development npx tsx ./verif-rituels.tmp.ts
rm -f ./verif-rituels.tmp.ts
```

Expected :
- `matérialisation: 1 puis 0`
- `scheduling_mode: fixed`, `scheduled_time: 09:00`, `scheduled_end_time: 09:20`
- `chevauchements sur le créneau du rituel: 0`
- `après redémarrage, rituel re-matérialisé: 1`

- [ ] **Step 3 : Supprimer la branche de test**

Via l'outil Neon MCP `delete_branch` — demander confirmation à l'utilisateur avant.

- [ ] **Step 4 : Déployer**

```bash
npm run build && npx tsc --noEmit && npx vitest run
git push origin main
```

Vérifier ensuite :
```bash
gh api repos/jeannemejean/naya/commits/$(git rev-parse HEAD)/status --jq '.state'
curl -s https://www.hellonaya.app/api/health
```
Expected: `success`, puis `{"status":"ok","db":"connected",…}`

Rappel : la migration de la Task 7 doit être appliquée en production **avant** ce push.

---

## Notes d'implémentation

**Pourquoi `schedulingMode: 'fixed'`.** `storage.createTask` contient un garde anti-collision qui décale toute tâche dont le créneau est déjà pris — **sauf** les tâches `fixed`, qui gardent leur heure et que les autres évitent. C'est exactement le comportement voulu pour un rituel, et c'est plus solide que de compter sur l'ordre de création.

**Pourquoi la note est enregistrée avant l'analyse.** Si Claude échoue ou si le plafond IA est atteint, l'utilisateur ne doit pas perdre ce qu'il a écrit. L'enregistrement précède donc l'appel IA dans la route d'analyse.

**Le garde-fou du reset se déclenchera.** La Task 6 commence par constater l'échec de `account-reset-plan.test.ts`. C'est voulu : ce test existe précisément pour attraper une table oubliée avant la production.
