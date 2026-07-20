# BRIEF — Phase 1 : Abstraction du modèle (NayaModelProvider)

> À exécuter par Claude Code **dans le repo NayaVision-29**.
> Lis ce fichier en entier avant de commencer. Respecte les garde-fous à la lettre.
> Objectif global : rendre le moteur IA agnostique au modèle, pour que l'intelligence vive dans la couche Naya et non chez le fournisseur. C'est le socle de toutes les phases suivantes.

---

## 0. Contexte (état réel du code — déjà vérifié)

- Tous les appels IA passent par `server/services/claude.ts` :
  - `callClaude({ model, system, messages, max_tokens, temperature, userId })`
  - `callClaudeWithContext({ userId, projectId, userMessage, model, ... })` → injecte `NAYA_SYSTEM_VOICE` + `buildNayaContext()`.
  - `streamClaude({ ... , res })` pour le streaming SSE.
- `server/services/openai.ts` **ne parle pas à OpenAI** : il importe et utilise `callClaude` / `callClaudeWithContext`. Ne pas le « débrancher », juste le laisser appeler la nouvelle couche via `claude.ts`.
- Le coût est imputé par utilisateur dans `callClaude` via `recordSpend()` + `estimateClaudeCostEur()` (`server/services/usage.ts`). **Ce comportement doit être préservé à l'identique.**
- ~25 sites d'appel importent `callClaude` / `callClaudeWithContext` / `CLAUDE_MODELS` depuis `./claude` (routes.ts, prospection.ts, task-intelligence.ts, companion.ts, auto-planner.ts, goal-tasks.ts, etc.).
- Aucun embedding n'existe encore dans le repo.

---

## 1. Objectif de la phase

1. Introduire une abstraction **`NayaModelProvider`** (interface unique) derrière laquelle se cachent les fournisseurs : Anthropic aujourd'hui, OpenAI en secours, ton modèle maison demain.
2. Faire de `claude.ts` un simple **adaptateur** qui délègue à un **registre de providers** + un **routeur** (quelle tâche → quel modèle).
3. **Journaliser chaque invocation** (contexte d'entrée → sortie, modèle, tokens, latence, type de tâche). C'est le minerai du futur jeu d'entraînement (Phase 5) — à démarrer maintenant.
4. Exposer dès maintenant un point d'extension **`embed()`** (stub) pour préparer la mémoire sémantique (Phase 2).

## 1bis. Non-objectifs (NE PAS faire dans cette phase)

- ❌ Ne pas implémenter la vraie recherche sémantique / pgvector (c'est la Phase 2).
- ❌ Ne pas entraîner ni brancher de modèle maison (Phase 5).
- ❌ Ne pas modifier la logique métier des services (auto-planner, prospection, etc.).
- ❌ Ne pas changer la signature publique de `callClaude` / `callClaudeWithContext` / `streamClaude`. **Zéro site d'appel ne doit être modifié.**

---

## 2. Garde-fous (non négociables)

- **Compatibilité ascendante totale.** Les exports actuels de `claude.ts` gardent exactement la même signature et le même comportement. On change l'intérieur, pas l'interface.
- **Imputation des coûts inchangée.** `recordSpend` continue d'être appelé avec le même montant pour `userId`. Si possible, déplace le calcul de coût dans la couche provider, mais le résultat doit être identique.
- **Injection de la voix Naya préservée.** `callClaudeWithContext` continue d'injecter `NAYA_SYSTEM_VOICE` + `buildNayaContext()` dans le `system`.
- **Aucune clé secrète en dur.** Lire `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` depuis `process.env` uniquement.
- **Pas de dépendance lourde nouvelle.** Réutiliser `@anthropic-ai/sdk` déjà présent. La journalisation utilise Drizzle + la base existante.
- **Échec gracieux.** Si la journalisation échoue, elle ne doit JAMAIS faire planter un appel IA (try/catch silencieux, comme `recordSpend` aujourd'hui).

---

## 3. Architecture cible

```
server/services/ai/
├── types.ts             ← interface NayaModelProvider + types (TaskKind, GenerateInput, GenerateResult…)
├── providers/
│   ├── anthropic.ts     ← implémente NayaModelProvider avec @anthropic-ai/sdk (déplace la logique de claude.ts)
│   └── openai.ts        ← implémente NayaModelProvider avec l'API OpenAI (provider de secours, optionnel/feature-flag)
├── router.ts            ← politique : TaskKind → { provider, model }
├── registry.ts          ← instancie et expose les providers selon les clés env disponibles
└── invocation-log.ts    ← écrit chaque appel dans la table ai_invocations (best-effort)

server/services/claude.ts ← devient un adaptateur fin qui appelle ai/registry + ai/router (signatures inchangées)
```

### 3.1 L'interface (server/services/ai/types.ts)

```typescript
export type TaskKind =
  | "strategic_reasoning"   // → modèle "smart" (Sonnet)
  | "fast_generation"       // → modèle "fast" (Haiku)
  | "extraction"            // → modèle dédié extraction (Haiku pour l'instant)
  | "classification"        // → fast
  | "embedding";            // → provider d'embeddings (stub Phase 1)

export interface ChatMessage { role: "user" | "assistant"; content: string; }

export interface GenerateInput {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface EmbedInput { texts: string[]; }
export interface EmbedResult { vectors: number[][]; model: string; provider: string; }

export interface NayaModelProvider {
  readonly name: string;                       // "anthropic" | "openai" | "naya-local"
  supports(task: TaskKind): boolean;
  generate(input: GenerateInput, model: string): Promise<GenerateResult>;
  embed?(input: EmbedInput, model: string): Promise<EmbedResult>;  // optionnel en Phase 1
  // streaming : garder le stream dans l'adaptateur claude.ts en Phase 1 (pas besoin de l'abstraire tout de suite)
}
```

### 3.2 Le routeur (server/services/ai/router.ts)

Politique simple, centralisée, modifiable en un seul endroit :

```typescript
// Mappe une intention métier vers (provider, model). Lit un éventuel override env.
export function route(task: TaskKind): { provider: string; model: string } {
  switch (task) {
    case "strategic_reasoning": return { provider: "anthropic", model: "claude-sonnet-4-6" };
    case "fast_generation":
    case "classification":
    case "extraction":          return { provider: "anthropic", model: "claude-haiku-4-5-20251001" };
    case "embedding":           return { provider: "openai", model: "text-embedding-3-small" }; // DÉCIDÉ : dimension 1536 (fige pgvector)
  }
}
```

> Conserver la constante `CLAUDE_MODELS = { fast, smart }` exportée par `claude.ts` (des sites l'importent). En interne, la faire pointer vers le routeur pour rester cohérente.

### 3.3 Journalisation (nouvelle table Drizzle)

Ajouter dans `shared/schema.ts` :

```typescript
export const aiInvocations = pgTable("ai_invocations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  projectId: integer("project_id").references(() => projects.id), // quelle marque (croisement triangulation + corpus Phase 5)
  taskKind: text("task_kind"),               // TaskKind
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),       // le contexte injecté (or du futur fine-tuning)
  userMessage: text("user_message"),
  output: text("output"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  costEur: doublePrecision("cost_eur"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertAiInvocationSchema = createInsertSchema(aiInvocations).omit({ id: true, createdAt: true });
export type AiInvocation = typeof aiInvocations.$inferSelect;
```

- Ajouter `getAiInvocations` / `createAiInvocation` dans `server/storage.ts` (suivre le style des fonctions existantes).
- `invocation-log.ts` appelle `storage.createAiInvocation(...)` en **best-effort** (try/catch, `.catch(()=>{})`, jamais bloquant).
- Prévoir un flag env `AI_LOG_PROMPTS` (défaut `true` en dev). Si `false`, journaliser les métadonnées (modèle, tokens, latence, coût) **sans** le texte des prompts/outputs (RGPD / volumétrie).

---

## 4. Étapes d'implémentation (ordre conseillé)

1. Créer `server/services/ai/types.ts` (interface + types ci-dessus).
2. Créer `server/services/ai/providers/anthropic.ts` : déplacer la logique d'appel `@anthropic-ai/sdk` qui est aujourd'hui dans `claude.ts.callClaude`. Calculer `usage` et le coût ici.
3. Créer `server/services/ai/router.ts` et `server/services/ai/registry.ts` (registry instancie Anthropic toujours ; OpenAI seulement si `OPENAI_API_KEY` présent).
4. Ajouter la table `ai_invocations` dans `shared/schema.ts` + fonctions storage + `invocation-log.ts`.
5. Réécrire `server/services/claude.ts` comme **adaptateur** :
   - `callClaude(opts)` → mappe vers `registry.get(provider).generate(...)` via le routeur ; conserve `recordSpend`; appelle `logInvocation(...)`. **Signature et retour `Promise<string>` inchangés.**
   - `callClaudeWithContext(opts)` → inchangé en surface ; construit toujours `NAYA_SYSTEM_VOICE + buildNayaContext()` puis délègue à `callClaude`. Passe un `taskKind` par défaut `"strategic_reasoning"` (ou `"fast_generation"` si `model === CLAUDE_MODELS.fast`).
   - `streamClaude(opts)` → reste tel quel pour cette phase (on n'abstrait pas le stream maintenant), mais ajoute la journalisation best-effort du `finalMessage`.
   - `CLAUDE_MODELS` reste exporté, valeurs inchangées.
6. **Embeddings (décidé) :** implémenter `embed()` sur le **provider OpenAI** avec `text-embedding-3-small` → vecteurs **1536 dim** (c'est une fonction de ~10 lignes, ça débloque la Phase 2). Le provider Anthropic peut garder un `embed()` qui `throw`. ⚠️ La dimension 1536 est figée ici car elle conditionne pgvector côté mémoire — ne pas la changer sans réindexer.
7. `npm run db:push` pour créer la table.
8. Lancer les tests existants (`vitest`) — ils doivent tous rester verts.

---

## 5. Critères d'acceptation (vérifie tout avant de dire « terminé »)

- [ ] `npm run build` passe sans erreur TypeScript.
- [ ] Les tests existants passent (`npx vitest run`), sans modification de leur contenu.
- [ ] **Aucun fichier site-d'appel modifié** : `git diff --stat` ne montre des changements QUE dans `server/services/claude.ts`, `server/services/ai/**`, `shared/schema.ts`, `server/storage.ts` (+ migration). Si un autre fichier change, c'est une régression de signature → corrige.
- [ ] Un appel via `callClaudeWithContext` produit toujours une réponse et **incrémente le coût** (`recordSpend`) comme avant.
- [ ] Une ligne est écrite dans `ai_invocations` à chaque appel (vérifie en base).
- [ ] Couper `ANTHROPIC_API_KEY` → message d'erreur clair, pas de crash silencieux ; la journalisation d'échec n'empêche rien.
- [ ] Changer la politique d'un `TaskKind` dans `router.ts` modifie bien le modèle utilisé (test manuel rapide).

## 6. Test de fumée à écrire

Ajouter `server/services/ai/router.test.ts` (vitest) :
- `route("strategic_reasoning")` renvoie le modèle smart.
- `route("extraction")` renvoie le modèle fast.
- `registry.get("anthropic")` existe ; `registry.get("inconnu")` lève une erreur explicite.

---

## 7. Definition of Done

L'intérieur du moteur IA est désormais une couche `ai/` que **tu** possèdes : providers interchangeables, routage centralisé, et chaque appel est journalisé pour constituer le corpus propriétaire. De l'extérieur, rien n'a bougé. Tu peux maintenant attaquer la Phase 2 (mémoire sémantique) en branchant un vrai `embed()` sur le provider, sans rien réécrire ailleurs.

> ⚠️ Avant de coder : si une décision d'architecture te semble ambiguë (nommage, frontière d'un module, format de la table de log), **liste tes hypothèses dans le commit** plutôt que de deviner en silence. C'est précisément le schéma de log et la politique de routage qui décideront de la qualité du moat — ne les bâcle pas.
