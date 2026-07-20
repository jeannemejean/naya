# BRIEF — Phase 2 : La mémoire à trois cadences

> À exécuter par Claude Code **dans le repo NayaVision-29**, après la Phase 1 (déjà en prod).
> Lis ce fichier en entier + `SCHEMA-TRIANGULATION.md` + `ARCHI-TRIANGULATION-MOTEUR.md` + `DECISIONS-MEMOIRE-IA.md` avant de commencer.
> Objectif : remplacer la mémoire plate (« les 5 dernières ») par un vrai système de mémoire sémantique à trois fils, à trois cadences. C'est le cœur technique du moat.
> **Toutes les décisions de design (formule de scoring, demi-vies, K, embeddings, prompt d'extraction) sont FIGÉES dans `DECISIONS-MEMOIRE-IA.md`, fondées sur l'état de l'art (Generative Agents, Mem0, Zep). Applique-les telles quelles — aucune n'est à rediscuter.**

---

## 0. Contexte (état réel, post-Phase 1)

- La couche `server/services/ai/` existe : providers, routeur, `embed()` **déjà implémenté** (OpenAI, via `TaskKind = "embedding"`). ⚠️ **La Phase 2 met à jour le modèle d'embedding** : passer de `text-embedding-3-small` à **`text-embedding-3-large` avec `dimensions: 1536`** (réduction matryoshka — meilleure qualité, surtout en français, sans changer la dimension). Rien n'est encore embeddé en prod, donc ce changement est gratuit. Voir Décision 5.
- `buildNayaContext(userId, projectId)` (server/services/naya-context.ts) assemble le contexte. Sa **Section 7 « Mémoire business récente »** lit aujourd'hui `getRecentMemories(userId, 5)` → c'est ce qu'on remplace.
- La table `business_memory` existe (texte libre, `type`, `content`). On ne la supprime pas : on la **fait évoluer / on migre son contenu** vers la nouvelle mémoire.
- `ai_invocations` journalise déjà chaque appel (avec `projectId`). La migration prod se fait désormais via `drizzle-kit generate` → relecture → `migrate` (plus de `db:push` sur prod).

---

## 1. Objectif de la phase

1. Activer **pgvector** et créer la table unifiée **`memory_entries`** (les trois fils : `cap` / `founder` / `reception`).
2. Construire le **pipeline d'extraction** : capture / conversation Companion / feedback → entrées de mémoire **typées et routées vers le bon fil**, embeddées.
3. Construire la **récupération par fil** : `score = similarité_sémantique × fraîcheur(demi-vie du fil) × salience`.
4. **Brancher la récupération dans `buildNayaContext()`** à la place de la mémoire plate.
5. Corriger le **trou `streamClaude` / userId** repéré en Phase 1.

## 1bis. Non-objectifs (NE PAS faire ici)

- ❌ Pas d'ingestion de réception réelle (saves/sentiment/conversion) — c'est la **Phase 3** (`content_reception`, `brand_conversions`).
- ❌ Pas de moteur d'arbitrage — **Phase 3**.
- ❌ Pas d'auto-enrichissement de l'ADN ni de détection d'écart — **Phase 4**.
- ❌ Pas de benchmark concurrent (`competitors`) — **Phase 3b**.
- ❌ Ne pas créer `content_reception`, `brand_conversions`, `arbitration_log` maintenant (tables d'autres phases).

---

## 2. Garde-fous (non négociables)

- **Best-effort partout.** L'extraction et l'embedding ne doivent JAMAIS bloquer ni faire échouer un appel IA ou une action utilisateur (try/catch, asynchrone, fire-and-forget).
- **Compatibilité ascendante de `buildNayaContext()`.** On ajoute un paramètre **optionnel** ; aucun site d'appel existant ne doit casser. `getRecentMemories` peut rester comme fallback.
- **Coût maîtrisé.** Extraction sur le modèle `fast` (Haiku) via le routeur ; embeddings via `embed()`. Respecter le garde-fou de dépense existant (`usage.ts`).
- **Discipline de migration.** Tout changement de schéma prod passe par `drizzle-kit generate` → relecture du SQL → `migrate`. Jamais de `db:push` sur prod. `db:push` autorisé sur dev-local uniquement.
- **pgvector.** Vérifier que l'extension est disponible sur l'instance Neon de prod (elle l'est) ; l'activer via migration (`CREATE EXTENSION IF NOT EXISTS vector`).
- **Pas de secret en dur.** `OPENAI_API_KEY` doit être présent dans l'env de prod (Railway) pour `embed()`.

---

## 3. Architecture cible

```
server/services/memory/
├── schema additions (shared/schema.ts) : table memory_entries
├── extract.ts        ← pipeline d'extraction (texte source → entrées typées par fil → embed → insert)
├── retrieve.ts       ← récupération par fil (score = sim × fraîcheur(fil) × salience)
└── memory.test.ts    ← tests

server/services/naya-context.ts ← Section 7 réécrite : mémoires récupérées PAR FIL
server/services/claude.ts        ← streamClaude reçoit userId/projectId ; callClaudeWithContext passe userMessage comme focusText
```

### 3.1 La table (shared/schema.ts)

Suivre `SCHEMA-TRIANGULATION.md` §Bloc B. Points clés :

```typescript
export const memoryEntries = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'set null' }), // null = mémoire transverse (fil founder global)
  fil: text("fil").notNull(),            // "cap" | "founder" | "reception"
  entryType: text("entry_type").notNull(), // fait | décision | préférence | signal_reception | observation
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  salience: doublePrecision("salience").default(0.5),
  sourceCaptureId: integer("source_capture_id").references(() => quickCaptureEntries.id, { onDelete: 'set null' }),
  supersededAt: timestamp("superseded_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  embIdx: index("memory_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  filIdx: index("memory_fil_idx").on(t.userId, t.projectId, t.fil),
}));
```

> ⚠️ **Vérifier le type `vector`** selon la version de `drizzle-orm` installée. S'il n'est pas exporté par `drizzle-orm/pg-core`, utiliser un `customType<{ data: number[] }>` qui sérialise en `vector(1536)`, OU écrire la colonne + l'index `hnsw` directement dans le SQL de migration et déclarer la colonne en `customType` côté Drizzle. Tester l'INSERT et le SELECT avant d'aller plus loin.

### 3.2 L'extraction en deux temps (server/services/memory/extract.ts)

Pipeline **Mem0-style** (extraction + moteur de mise à jour). Détails et prompt complet : `DECISIONS-MEMOIRE-IA.md` §4 et §7.

```
extractToMemory(input: { userId, projectId?, sourceText, sourceType, sourceCaptureId? })
```

**Temps 1 — Extraction.** Appelle le modèle `fast` (Haiku) via le routeur, `TaskKind = "extraction"`, avec le **prompt d'extraction figé** (Décision 7, à copier tel quel). Il renvoie un tableau JSON d'entrées atomiques : `{ fil, entryType, content, importance }` (`importance` 0-10). Si rien de durable → `[]`. **Ne fabrique aucune information.**

**Temps 2 — Moteur de mise à jour (anti-doublons, crucial).** Pour chaque entrée extraite : `embed()` le `content`, puis chercher l'entrée existante la plus proche dans le même `(userId, projectId, fil)` :
- similarité ≥ **0.92** et même sens → **NOOP** (option : rafraîchir `createdAt`/`salience` de l'existante) ;
- similarité élevée mais **valeur changée/contredite** → **UPDATE** : `supersededAt = now()` sur l'ancienne + insertion de la nouvelle (bi-temporel, on garde l'historique) ;
- zone ambiguë **0.85-0.92** → un appel `fast` (Haiku) tranche ADD/UPDATE/NOOP ;
- sinon → **ADD**.
- `salience` stockée = `importance / 10`.

> Sans le Temps 2, `memory_entries` se remplit de quasi-doublons et la récupération se dégrade. C'est l'enseignement n°1 de Mem0 — ne pas le sauter.

**Best-effort, asynchrone (fire-and-forget).** À brancher sur les points existants :
- création d'une `quick_capture` ;
- tour de conversation du Companion (`companionConversations`) ;
- `task_feedback` enregistré.

### 3.3 La récupération (server/services/memory/retrieve.ts)

```
retrieveMemories(userId, projectId?, focusText?, limits?) : { cap: [], founder: [], reception: [] }
```

- Embedde `focusText` (le sujet de la décision en cours). Si absent → fallback : tri par `recency × salience` sans relevance.
- Pour **chaque fil**, récupère un lot de candidats par similarité vectorielle (ANN), puis classe par **somme pondérée normalisée** (standard Generative Agents — voir Décision 1) :

```
score = w_rel · relevance + w_imp · importance + w_rec · recency
        (relevance = cosinus normalisé min-max sur les candidats ; importance = salience [0,1] ; recency [0,1])
recency = 0.5 ^ (age_jours / demi_vie(fil))
poids de départ : w_rel = w_imp = w_rec = 1.0
```

> ⚠️ **Somme pondérée, PAS un produit.** (Le brief initial disait « × » — c'est corrigé : la forme additive normalisée est le standard validé et ne s'effondre pas quand un facteur est proche de 0.)

| Fil | Demi-vie | K |
|-----|----------|---|
| cap | 180 j | 3 |
| founder | 45 j | 4 |
| reception | 10 j | 5 |

- Ignorer les entrées `supersededAt != null`.

### 3.4 Intégration dans buildNayaContext (server/services/naya-context.ts)

- Ajouter un paramètre **optionnel** : `buildNayaContext(userId, projectId?, focusText?)`.
- Remplacer la **Section 7** : au lieu de `getRecentMemories(userId, 5)`, appeler `retrieveMemories(userId, projectId, focusText)` et rendre **trois sous-sections** (Cap / Fondateur / Réception) avec les entrées pertinentes.
- Dans `claude.ts`, `callClaudeWithContext` passe son `userMessage` comme `focusText` à `buildNayaContext`. Les autres appelants qui n'ont pas de focus naturel l'omettent (fallback fraîcheur).

### 3.5 Le fix streamClaude (server/services/claude.ts)

- `streamClaude` accepte et propage `userId` + `projectId` jusqu'à `logInvocation(...)`, pour que les appels en streaming (Companion) entrent dans le corpus avec leur attribution. Vérifier ce qui utilise `streamClaude` et leur passer ces champs.

### 3.6 Backfill (migration douce des données existantes)

- Script ponctuel : pour chaque ligne de `business_memory`, créer une entrée `memory_entries` (fil déduit du `type`, à défaut `cap`), embeddée. Best-effort, idempotent (ne pas re-backfiller deux fois). Donne une mémoire immédiate à partir de l'existant.

---

## 4. Étapes d'implémentation (ordre conseillé)

1. **Spike pgvector d'abord.** Migration `CREATE EXTENSION vector` + `memory_entries` + index hnsw. Valider INSERT/SELECT d'un vecteur 1536 sur dev. Si le type Drizzle pose problème, régler ça avant tout le reste.
2. `retrieve.ts` avec le scoring (testable sur données semées).
3. `extract.ts` + branchements best-effort sur capture / companion / feedback.
4. Intégration `buildNayaContext` (Section 7 par fil) + `focusText` depuis `callClaudeWithContext`.
5. Fix `streamClaude`.
6. Script de backfill `business_memory` → `memory_entries`.
7. Tests (§5). Migration générée, relue, appliquée sur dev ; **prod plus tard, après ta semaine d'usage.**

---

## 5. Critères d'acceptation

- [ ] `npm run build` et `npx vitest run` verts (tests existants inchangés).
- [ ] INSERT puis SELECT d'un vecteur 1536 fonctionnent en base ; l'index hnsw existe.
- [ ] `extractToMemory` produit des entrées atomiques routées dans le bon fil, avec `importance` 0-10 → `salience` ; sur un texte vide/inutile → `[]`, aucune entrée fabriquée.
- [ ] **Moteur de mise à jour testé** : ré-extraire un fait quasi identique ne crée PAS de doublon (NOOP) ; un fait qui contredit l'ancien marque l'ancien `supersededAt` et insère le nouveau (UPDATE).
- [ ] Le scoring de récupération est une **somme pondérée normalisée** (pas un produit) ; embeddings via `text-embedding-3-large` réduit à 1536.
- [ ] `retrieveMemories` classe bien par `sim × fraîcheur × salience` : à pertinence égale, l'entrée plus récente d'un fil court (reception) remonte ; un point `cap` ancien n'est pas noyé par du bruit récent.
- [ ] `buildNayaContext(userId, projectId, focusText)` injecte trois sous-sections mémoire ; **aucun site d'appel existant cassé** (le 3e param est optionnel).
- [ ] Un appel **streamé** (Companion) écrit une ligne dans `ai_invocations` **avec userId + projectId**.
- [ ] Extraction et embedding sont best-effort : couper `OPENAI_API_KEY` ne casse aucun appel IA (la mémoire se dégrade silencieusement).
- [ ] Backfill exécuté sur dev : les lignes `business_memory` apparaissent dans `memory_entries`, embeddées.

## 6. Definition of Done

`buildNayaContext()` ne récite plus des champs ni « les 5 dernières » : il **récupère, par fil et par cadence, les souvenirs pertinents** pour la décision en cours, et chaque interaction nourrit la mémoire via l'extraction. Le socle de la triangulation est posé. La Phase 3 (réception réelle + arbitrage) pourra s'y brancher.

> ✅ **Toutes les décisions de design sont déjà prises** (prompt d'extraction, demi-vies, K, formule de scoring, embeddings) et figées dans `DECISIONS-MEMOIRE-IA.md`, fondées sur l'état de l'art. Tu n'as RIEN à rediscuter ni à improviser sur ces points : applique-les. Si tu rencontres une micro-décision d'implémentation non couverte (nommage, structure d'un module), liste ton hypothèse dans le commit plutôt que de bloquer.
