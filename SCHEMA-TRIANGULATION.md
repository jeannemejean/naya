# SCHÉMA DE DONNÉES — Le moteur de triangulation

> Spec de schéma à intégrer dans `shared/schema.ts` (Drizzle). Conçu pour la triangulation à trois fils.
> Décisions actées avec Jeanne : fenêtre d'attribution **configurable par marque** ; benchmark concurrent **prévu au schéma, ingestion plus tard** ; embeddings **OpenAI `text-embedding-3-small` → `vector(1536)`**.
> Les snippets suivent les conventions de ton `schema.ts` existant. À relire avant `db:push` — ce sont ces choix qui font le moat.

---

## 0. Pré-requis pgvector

```sql
-- migration manuelle (une fois)
CREATE EXTENSION IF NOT EXISTS vector;
```

Côté Drizzle (pg-core récent expose le type `vector`) :

```typescript
import { pgTable, serial, varchar, integer, text, jsonb, timestamp, boolean, doublePrecision, vector, index } from "drizzle-orm/pg-core";
```

Dimension figée : **1536** (text-embedding-3-small). La changer impose de réindexer toute la mémoire — d'où le choix maintenant.

---

## BLOC A — Les marques (Fil 1)

`project` = une marque. `brand_dna` (déjà lié à `projectId`) porte le Fil 1. Deux ajouts :

```typescript
// Sur la table projects (ou brand_dna) — la fenêtre d'attribution est PAR MARQUE :
attributionWindowDays: integer("attribution_window_days").default(30),
// 7 pour une cible B2C impulsive, 60-90 pour un client d'agence B2B. Réglable par marque.

// Versionnage du Fil 1 : on conserve l'historique de l'ADN plutôt que d'écraser.
// Option simple : ajouter à brand_dna
version: integer("version").default(1),
supersededAt: timestamp("superseded_at"), // null = version courante
```

> Le versionnage permet à la Phase 4 (« fils vivants ») de proposer des révisions d'ADN tout en gardant l'historique d'évolution de la marque — une donnée que personne d'autre n'a.

---

## BLOC B — La mémoire à trois fils

Une table unique, discriminée par `fil`, avec un index vectoriel partagé. La cadence est gérée à la **récupération** (demi-vie de fraîcheur par fil), pas par des tables séparées.

```typescript
export const memoryEntries = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id), // null = mémoire transverse (Fil 2 global)
  fil: text("fil").notNull(),            // "cap" | "founder" | "reception"
  entryType: text("entry_type").notNull(), // fait | décision | préférence | signal_réception | observation
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  salience: doublePrecision("salience").default(0.5), // importance, ajustée par l'usage
  sourceCaptureId: integer("source_capture_id").references(() => quickCaptureEntries.id),
  supersededAt: timestamp("superseded_at"), // versionnage (Fil 1 surtout)
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  embIdx: index("memory_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  filIdx: index("memory_fil_idx").on(t.userId, t.projectId, t.fil),
}));
```

### Récupération (le détail qui compte)

`buildNayaContext()` ne lit plus « les 5 dernières ». Pour la décision en cours il calcule, **par fil** :

```
score = similarité_sémantique × fraîcheur(fil) × salience
```

avec une **demi-vie propre au fil** :

| Fil | Demi-vie de fraîcheur indicative |
|-----|----------------------------------|
| cap (ADN) | ~180 jours |
| founder | ~30 jours |
| reception | ~7 jours |

> C'est ce qui empêche un point d'ADN de 3 mois d'être noyé par du bruit de réception récent — et inversement.

---

## BLOC C — La réception (Fil 3)

### C.1 Le contenu porte son intention (croisement Fil 1 × Fil 3)

```typescript
// Sur la table content existante — ajouter :
intent: text("intent"), // "awareness" | "consideration" | "conversion"
publishedAt: timestamp("published_at"),
projectId: integer("project_id").references(() => projects.id), // quelle marque
```

### C.2 Réception par post (signaux RAPIDES)

```typescript
export const contentReception = pgTable("content_reception", {
  id: serial("id").primaryKey(),
  contentId: integer("content_id").notNull().references(() => content.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  platform: text("platform").notNull(),       // instagram | linkedin | tiktok ...
  saves: integer("saves").default(0),
  shares: integer("shares").default(0),
  comments: integer("comments").default(0),
  reach: integer("reach").default(0),          // pour normaliser (taux, pas valeurs brutes)
  sentimentScore: doublePrecision("sentiment_score"), // -1..1, via sentiment-analysis.ts
  // Le juge : la réception MESURÉE CONTRE l'intention du post.
  receivedVsIntentScore: doublePrecision("received_vs_intent_score"),
  measuredAt: timestamp("measured_at").defaultNow(),
});
```

> `receivedVsIntentScore` est calculé : des saves élevés sur un post `awareness` = haut ; les mêmes saves sur un post `conversion` sans conversion = bas. C'est l'opération de triangulation, matérialisée.

### C.3 Conversion par marque (signal LENT, multi-touch)

```typescript
export const brandConversions = pgTable("brand_conversions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  convertedAt: timestamp("converted_at").notNull(),
  conversionType: text("conversion_type"),     // lead | vente | rdv ...
  value: doublePrecision("value"),
  // Fenêtre d'attribution = projects.attributionWindowDays (PAR MARQUE).
  attributionWindowDays: integer("attribution_window_days"), // figé au moment du calcul
  createdAt: timestamp("created_at").defaultNow(),
});

// Crédit multi-touch : on relie une conversion AUX contenus de sa fenêtre, avec un poids.
export const conversionAttributions = pgTable("conversion_attributions", {
  id: serial("id").primaryKey(),
  conversionId: integer("conversion_id").notNull().references(() => brandConversions.id),
  contentId: integer("content_id").notNull().references(() => content.id),
  creditWeight: doublePrecision("credit_weight").notNull(), // somme des poids d'une conversion = 1
});
```

> **Interdit explicite** (à commenter dans le code) : jamais de last-touch. Une conversion est créditée à la *fenêtre* de contenus qui l'a précédée, pondérée (multi-touch). C'est le principe d'attribution central — la conversion est un signal lent de marque, pas un applaudissement de post.

---

## BLOC C bis — Concurrents (PRÉVU AU SCHÉMA, ingestion plus tard)

Tables créées maintenant pour éviter une migration ultérieure ; **aucune ingestion codée avant le roc 3a**.

```typescript
export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id), // concurrent DE quelle marque
  name: text("name").notNull(),
  handle: text("handle"),
  platform: text("platform"),
  isActive: boolean("is_active").default(false), // false = listé mais pas encore suivi
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitorReception = pgTable("competitor_reception", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  postRef: text("post_ref"),
  engagementRate: doublePrecision("engagement_rate"), // NORMALISÉ, jamais valeurs brutes
  sentimentScore: doublePrecision("sentiment_score"),
  observedAt: timestamp("observed_at").defaultNow(),
});
```

> Rappel produit : 3b se compare en **taux normalisés** et se restitue comme **apprentissage**, jamais comme tableau de scores. La voix Naya ne doit pas culpabiliser.

---

## BLOC D — Les journaux

### D.1 Journal d'appels (Phase 1 — corpus brut)

Déjà spécifié dans `BRIEF-PHASE-1-MODEL-PROVIDER.md`. **Ajouts requis** suite à cette conception :

```typescript
// ai_invocations — ajouter :
projectId: integer("project_id").references(() => projects.id), // quelle marque
// taskKind est déjà prévu. Ces deux champs rendent le corpus exploitable (Phase 5) et croisable par marque.
```

### D.2 Journal d'arbitrage (Phase 3 — décisions)

```typescript
export const arbitrationLog = pgTable("arbitration_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: integer("project_id").references(() => projects.id),
  decisionContext: text("decision_context"),     // la question posée à l'arbitre
  filsConsulted: jsonb("fils_consulted"),         // quels slivers de chaque fil ont pesé
  dominantFil: text("dominant_fil"),              // cap | founder | reception
  rationale: text("rationale"),                   // pourquoi ce fil a primé
  confidence: doublePrecision("confidence"),      // l'arbitre PEUT dire "donnée insuffisante"
  createdAt: timestamp("created_at").defaultNow(),
});
```

> Deux journaux, deux grains : `ai_invocations` = appels modèle bruts ; `arbitration_log` = décisions. Mêmes clés (`userId`, `projectId`, timestamp) pour les croiser. Ensemble, ils forment la traçabilité produit ET le corpus d'entraînement de la Phase 5.

---

## Récapitulatif des tables

| Table | Bloc | Rôle | Phase |
|-------|------|------|-------|
| `projects` / `brand_dna` (+ champs) | A | Fil 1 + fenêtre d'attribution par marque + versionnage | 2 |
| `memory_entries` | B | Mémoire unifiée 3 fils + embeddings | 2 |
| `content` (+ intent) | C | Intention de chaque contenu (croisement) | 3 |
| `content_reception` | C | Réception par post (rapide) | 3 |
| `brand_conversions` + `conversion_attributions` | C | Conversion par marque (lent, multi-touch) | 3 |
| `competitors` + `competitor_reception` | C bis | Benchmark (prévu, ingestion plus tard) | 3b |
| `ai_invocations` (+ projectId) | D | Corpus d'appels bruts | 1 |
| `arbitration_log` | D | Journal des décisions d'arbitrage | 3 |

---

## Ce qui reste à décider plus tard (pas bloquant)

- Le **schéma de pondération multi-touch** (linéaire ? décroissant vers la conversion ?) — à calibrer sur données réelles.
- La **politique de l'arbitre** (comment pondérer les fils) — composant de la Phase 3, à concevoir avant de coder.
- La **demi-vie exacte** par fil — valeurs de départ ci-dessus, à affiner par mesure.

> ⚠️ Avant `db:push` : valide les types `vector` (selon la version de drizzle-orm installée, il faudra peut-être un `customType` si `vector` n'est pas exporté) et l'extension pgvector sur ton instance PostgreSQL (Neon et Railway la supportent).
