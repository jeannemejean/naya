# Fil 3 — LOT 3A : la réception propre — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** mesurer la réception réelle d'un contenu **contre son intention**, avec une ingestion en port dont le seul adaptateur de ce lot est manuel (saisie + CSV).

**Architecture :** une fonction pure `receivedVsIntentScore` porte toute la règle de jugement. Un port `ReceptionSource` isole l'origine des signaux ; `ingest.ts` ne connaît que le port. Chaque signal ingéré écrit une entrée `memory_entries` `fil="reception"` en best-effort.

**Spec :** `docs/superpowers/specs/2026-08-30-naya-reception-fil3-design.md`

**Stack :** Express + Drizzle ORM + PostgreSQL Neon (pgvector), React + Vite, vitest.

## Contraintes globales

- **LOT 3A UNIQUEMENT.** Ne crée **pas** `brand_conversions`, `conversion_attributions`, `arbitration_log`. Ne code aucune ingestion concurrent ni réseau. Les points d'arrêt §4.0 et §5.0 du brief attendent une validation humaine.
- **Best-effort partout.** Ni l'ingestion, ni le scoring, ni l'écriture mémoire ne doivent faire échouer une action utilisateur.
- **Jamais les likes.** Aucun champ, aucune sortie utilisateur.
- **`reach` absent ou nul → `null`, jamais `0`.** On ne fabrique pas un taux.
- **Jamais une intention devinée.** Inconnue → `null` ; le contenu est exclu du scoring.
- **Ne recycle pas `content.goal`** — champ libre requis existant, ce n'est pas l'intention. Ajoute `intent`.
- **Ne branche pas** `getInstagramAnalytics` / `getLinkedInAnalytics` sur `content_reception` : c'est de la vanité au sens de la spec. Laisse-les pour la page Analytics existante.
- **Migrations :** `npx drizzle-kit generate`, **relecture du SQL généré**, puis application **manuelle sur dev-local uniquement** dans ce lot. Il n'existe ni script ni runner `migrate` dans ce dépôt. `db:push` interdit en production.
- **Ne jamais lancer `npm install`** : il élague des paquets et crée des dossiers `« * 2 »`. Aucune dépendance nouvelle n'est requise.
- **Ne pas `git push`.** Ce lot se termine par une revue, pas par un déploiement.
- **i18n :** toute chaîne visible passe par `client/src/locales/fr.ts` ET `en.ts` ; `locales.test.ts` vérifie la parité.
- Vérification à chaque tâche : `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` tout vert.
- **Si une micro-décision n'est pas couverte : note ton hypothèse dans le message de commit.** Ne devine pas en silence.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/services/reception/score.ts` | *(créé)* `receivedVsIntentScore` — PUR, aucune base, aucun modèle |
| `server/services/reception/score.test.ts` | *(créé)* les quatre cas du brief + bornes |
| `server/services/reception/types.ts` | *(créé)* `ReceptionSignal` + interface `ReceptionSource` (LE PORT) |
| `server/services/reception/sources/manual.ts` | *(créé)* saisie + CSV — seul adaptateur du lot |
| `server/services/reception/sources/instagram.ts` | *(créé)* squelette, erreur explicite, jamais atteint par défaut |
| `server/services/reception/ingest.ts` | *(créé)* normalise, upsert idempotent, écrit la mémoire |
| `server/services/reception/reception.test.ts` | *(créé)* parsing CSV, garde Instagram |
| `shared/schema.ts` | *(modifié)* `content.intent`, `projects.attributionWindowDays`, 3 tables |
| `server/storage.ts` | *(modifié)* accès `content_reception` |
| `server/routes.ts` | *(modifié)* saisie, import CSV, lecture |
| `client/src/pages/content-calendar.tsx` | *(modifié)* saisie de réception + import + restitution du score |
| `client/src/locales/{fr,en}.ts` | *(modifiés)* nouvelles chaînes |

---

### Task 1 : le score contre l'intention (la pièce maîtresse)

**Fichiers :** Créer `server/services/reception/score.ts` et `server/services/reception/score.test.ts`

**Interfaces produites :** `Intent`, `ScoreInput`, `ScoreResult`, `receivedVsIntentScore`, `REFERENCE_RATES`, `INTENT_WEIGHTS`, `REFERENCE_REACH`, `SENTIMENT_INFLUENCE` — consommés par les tâches 4 et 5.

TDD strict : les tests d'abord, vus échouer, puis l'implémentation.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `server/services/reception/score.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { receivedVsIntentScore, type ScoreInput } from "./score";

const base: ScoreInput = {
  intent: "awareness", saves: 0, shares: 0, comments: 0,
  reach: 1000, sentimentScore: null, conversionsInWindow: 0,
};

describe("receivedVsIntentScore", () => {
  it("awareness bien reçu : beaucoup de partages → score haut", () => {
    const r = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, saves: 20, comments: 10 });
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThan(0.7);
    expect(r.rationale).toContain("awareness");
  });

  it("consideration bien reçu : saves et commentaires forts → score haut", () => {
    const r = receivedVsIntentScore({ ...base, intent: "consideration", saves: 25, comments: 12, shares: 8 });
    expect(r.score!).toBeGreaterThan(0.7);
  });

  // LE cas littéral de la spec : la triangulation Fil 1 × Fil 3.
  it("conversion avec saves élevés et ZÉRO conversion → score bas", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "conversion", saves: 40, comments: 15, shares: 12, conversionsInWindow: 0,
    });
    expect(r.score!).toBeLessThan(0.4);
    expect(r.rationale).toContain("conversion");
  });

  it("les mêmes saves sur awareness valent bien mieux que sur conversion", () => {
    const signals = { saves: 40, comments: 15, shares: 12, conversionsInWindow: 0 };
    const aw = receivedVsIntentScore({ ...base, intent: "awareness", ...signals });
    const cv = receivedVsIntentScore({ ...base, intent: "conversion", ...signals });
    expect(aw.score!).toBeGreaterThan(cv.score!);
  });

  it("portée absente → null, jamais 0, et confiance nulle", () => {
    const r = receivedVsIntentScore({ ...base, reach: null, saves: 40 });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.rationale.toLowerCase()).toContain("portée");
  });

  it("portée à zéro → null aussi (on ne divise pas par zéro pour fabriquer un taux)", () => {
    expect(receivedVsIntentScore({ ...base, reach: 0, saves: 40 }).score).toBeNull();
  });

  it("sans intention, le contenu est exclu du scoring", () => {
    const r = receivedVsIntentScore({ ...base, intent: null, saves: 40 });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.rationale.toLowerCase()).toContain("intention");
  });

  it("une portée faible abaisse la confiance sans annuler le score", () => {
    const fort = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, reach: 1000 });
    const faible = receivedVsIntentScore({ ...base, intent: "awareness", shares: 1, reach: 50 });
    expect(faible.confidence).toBeLessThan(fort.confidence);
    expect(faible.score).not.toBeNull();
  });

  it("un sentiment négatif dégrade le score sans le renverser", () => {
    const neutre = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, sentimentScore: null });
    const hostile = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, sentimentScore: -1 });
    expect(hostile.score!).toBeLessThan(neutre.score!);
    expect(hostile.score!).toBeGreaterThan(neutre.score! * 0.85);
  });

  it("le score reste borné à [0,1] même avec un sentiment maximal", () => {
    const r = receivedVsIntentScore({
      ...base, intent: "awareness", shares: 100, saves: 100, comments: 100, sentimentScore: 1,
    });
    expect(r.score!).toBeLessThanOrEqual(1);
    expect(r.score!).toBeGreaterThanOrEqual(0);
  });

  it("un signal absent (null) n'est pas traité comme un zéro : il baisse la confiance", () => {
    const complet = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: 10, shares: 5 });
    const partiel = receivedVsIntentScore({ ...base, intent: "consideration", saves: 20, comments: null, shares: 5 });
    expect(partiel.confidence).toBeLessThan(complet.confidence);
  });

  it("la conversion est ignorée pour awareness", () => {
    const sans = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, conversionsInWindow: 0 });
    const avec = receivedVsIntentScore({ ...base, intent: "awareness", shares: 15, conversionsInWindow: 50 });
    expect(avec.score).toBe(sans.score);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/reception/score.test.ts`
Attendu : ÉCHEC — le module `./score` n'existe pas.

- [ ] **Étape 3 : écrire la fonction**

Créer `server/services/reception/score.ts` :

```typescript
/**
 * La réception MESURÉE CONTRE l'intention — la triangulation Fil 1 × Fil 3.
 *
 * Des saves élevés sur un post d'awareness sont un succès ; les mêmes saves sur un post
 * de conversion qui n'a rien converti sont un échec. C'est toute la règle.
 *
 * Fonction PURE : aucune base, aucun modèle, aucune horloge. Testable isolément.
 *
 * On ne mesure JAMAIS les likes (vanité) et on ne raisonne QUE sur des taux normalisés
 * par la portée. Sans portée, un compteur brut ne veut rien dire : on renvoie `null`,
 * jamais `0` — l'absence de mesure n'est pas une mauvaise mesure.
 */

export type Intent = "awareness" | "consideration" | "conversion";

export interface ScoreInput {
  intent: Intent | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  reach: number | null;
  /** -1..1, optionnel. Voir D5 de la spec : aucun calcul automatique dans ce lot. */
  sentimentScore: number | null;
  /** Reste 0 tant que le LOT 3B (attribution) n'existe pas. */
  conversionsInWindow: number;
}

export interface ScoreResult {
  score: number | null;
  confidence: number;
  rationale: string;
}

/**
 * Taux considérés comme « bons ». DÉFAUTS RÉVISABLES — pas des vérités.
 * Un taux brut n'est pas un score : il se compare à une référence.
 */
export const REFERENCE_RATES = {
  saves: 0.02,
  shares: 0.01,
  comments: 0.01,
  conversions: 0.005,
} as const;

/** Poids par intention. DÉFAUTS RÉVISABLES. La conversion est ignorée hors intention conversion. */
export const INTENT_WEIGHTS: Record<Intent, Record<keyof typeof REFERENCE_RATES, number>> = {
  awareness:     { saves: 0.25, shares: 0.60, comments: 0.15, conversions: 0 },
  consideration: { saves: 0.45, shares: 0.20, comments: 0.35, conversions: 0 },
  conversion:    { saves: 0.15, shares: 0.05, comments: 0.10, conversions: 0.70 },
};

/** Portée au-delà de laquelle la mesure est jugée pleinement fiable. RÉVISABLE. */
export const REFERENCE_REACH = 500;

/** Le sentiment module le score d'au plus ±10 % : il nuance, il ne décide pas. RÉVISABLE. */
export const SENTIMENT_INFLUENCE = 0.1;

/** Facteur appliqué à la confiance quand le sentiment est inconnu. RÉVISABLE. */
const NO_SENTIMENT_CONFIDENCE = 0.9;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const LABELS: Record<keyof typeof REFERENCE_RATES, string> = {
  saves: "les enregistrements",
  shares: "les partages",
  comments: "les commentaires",
  conversions: "la conversion",
};

export function receivedVsIntentScore(input: ScoreInput): ScoreResult {
  const { intent, reach, sentimentScore } = input;

  if (!intent) {
    return {
      score: null,
      confidence: 0,
      rationale:
        "Ce contenu n'a pas d'intention déclarée : on ne peut pas juger sa réception contre elle. Il est exclu du scoring, ce n'est pas un échec.",
    };
  }

  if (reach === null || reach === undefined || reach <= 0) {
    return {
      score: null,
      confidence: 0,
      rationale:
        "Portée inconnue : sans elle, un compteur brut ne dit rien. On ne fabrique pas de taux — la mesure attend.",
    };
  }

  const weights = INTENT_WEIGHTS[intent];
  const raw: Record<keyof typeof REFERENCE_RATES, number | null> = {
    saves: input.saves,
    shares: input.shares,
    comments: input.comments,
    // La conversion est toujours connue : 0 conversion est une information, pas une absence.
    conversions: input.conversionsInWindow,
  };

  let score = 0;
  let presentWeight = 0;
  let totalWeight = 0;
  let best: { key: keyof typeof REFERENCE_RATES; sub: number } | null = null;

  for (const key of Object.keys(weights) as (keyof typeof REFERENCE_RATES)[]) {
    const w = weights[key];
    if (w <= 0) continue;
    totalWeight += w;

    const value = raw[key];
    if (value === null || value === undefined) continue; // absent ≠ zéro
    presentWeight += w;

    const sub = clamp01(value / reach / REFERENCE_RATES[key]);
    score += w * sub;
    if (!best || w > weights[best.key]) best = { key, sub };
  }

  const completeness = totalWeight > 0 ? presentWeight / totalWeight : 0;
  const reachConfidence = clamp01(reach / REFERENCE_REACH);
  const confidence = clamp01(
    reachConfidence * completeness * (sentimentScore === null ? NO_SENTIMENT_CONFIDENCE : 1),
  );

  if (sentimentScore !== null && sentimentScore !== undefined) {
    // Le sentiment nuance d'au plus ±10 % : un accueil hostile abîme un bon score,
    // il ne le renverse pas.
    const s = Math.min(1, Math.max(-1, sentimentScore));
    score = score * (1 + SENTIMENT_INFLUENCE * s);
  }
  score = clamp01(score);

  const dominant = best ? LABELS[best.key] : "aucun signal";
  const verdict =
    best === null ? "aucun signal exploitable"
    : best.sub >= 0.6 ? `${dominant} portent bien`
    : best.sub >= 0.3 ? `${dominant} restent tièdes`
    : `${dominant} ne suivent pas`;

  const rationale =
    `Intention ${intent} : ${verdict}. ` +
    (score < 0.4
      ? `Ce contenu n'a pas trouvé son public sur ce qui comptait pour lui.`
      : score < 0.7
        ? `Réception correcte, sans plus, au regard de ce qu'il visait.`
        : `Ce contenu a fait ce qu'on attendait de lui.`);

  return { score, confidence, rationale };
}
```

- [ ] **Étape 4 : vérifier**

```bash
npx vitest run server/services/reception/score.test.ts
npx tsc --noEmit -p tsconfig.json
```
Attendu : les 12 tests verts, `tsc` silencieux. Si un seuil de test ne passe pas, **n'ajuste pas le test pour le faire passer** : vérifie d'abord l'arithmétique des poids, et si un défaut de D1/D2 est réellement mal calibré, corrige la constante et dis-le dans le commit.

- [ ] **Étape 5 : commit**

```bash
git add server/services/reception/score.ts server/services/reception/score.test.ts
git commit -m "feat(reception): receivedVsIntentScore, la réception mesurée contre l'intention"
```

---

### Task 2 : le schéma et la migration

**Fichiers :** Modifier `shared/schema.ts`. Générer `migrations/00XX_*.sql`.

**Interfaces produites :** tables `contentReception`, `competitors`, `competitorReception` ; colonnes `content.intent`, `projects.attributionWindowDays` — consommées par les tâches 4 à 7.

- [ ] **Étape 1 : ajouter `intent` sur `content`**

Dans `shared/schema.ts`, table `content`, juste après `goal` :

```typescript
  // Intention au sens de la triangulation Fil 1 × Fil 3 : "awareness" | "consideration"
  // | "conversion". NE PAS confondre avec `goal` ci-dessus, champ libre requis qui n'est
  // pas une intention. `null` = intention inconnue → le contenu est exclu du scoring,
  // jamais deviné.
  intent: text("intent"),
```

- [ ] **Étape 2 : ajouter `attributionWindowDays` sur `projects`**

Dans la table `projects` :

```typescript
  // Fenêtre d'attribution PAR MARQUE (décision actée). Créée ici, consommée par le LOT 3B :
  // une conversion est créditée à la fenêtre de contenus qui l'a précédée, jamais au dernier.
  attributionWindowDays: integer("attribution_window_days").default(30),
```

- [ ] **Étape 3 : créer les tables de réception**

À la suite de la table `content` dans `shared/schema.ts` :

```typescript
/**
 * Réception par contenu — signaux RAPIDES (SCHEMA-TRIANGULATION.md §C.2).
 *
 * RGPD par construction : cette table ne porte QUE des compteurs agrégés et un score.
 * Aucune identité, aucun texte d'audience, aucun identifiant de commentateur. Un futur
 * adaptateur réseau peut lire des commentaires pour en dériver un sentiment agrégé, il ne
 * doit JAMAIS en persister le texte ni l'auteur.
 *
 * On ne stocke pas les likes : c'est de la vanité au sens de la spec.
 */
export const contentReception = pgTable("content_reception", {
  id: serial("id").primaryKey(),
  contentId: integer("content_id").notNull().references(() => content.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id),
  platform: text("platform").notNull(),
  saves: integer("saves"),
  shares: integer("shares"),
  comments: integer("comments"),
  reach: integer("reach"),               // sert à normaliser : sans elle, pas de taux
  sentimentScore: doublePrecision("sentiment_score"), // -1..1, optionnel
  receivedVsIntentScore: doublePrecision("received_vs_intent_score"),
  confidence: doublePrecision("confidence"),
  rationale: text("rationale"),
  source: text("source").notNull().default("manual"), // manual | csv | <futur adaptateur>
  measuredAt: timestamp("measured_at").notNull(),     // normalisé au jour pour l'idempotence
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  // Idempotence de l'ingestion : rejouer le même import écrase, ne double pas.
  uniqueMeasure: unique("content_reception_unique_measure").on(t.contentId, t.platform, t.measuredAt),
}));
export type ContentReception = typeof contentReception.$inferSelect;
export type InsertContentReception = typeof contentReception.$inferInsert;

/**
 * Concurrents — SCHÉMA SEUL (SCHEMA-TRIANGULATION.md bloc C bis).
 * Créés maintenant pour éviter une migration de plus. AUCUNE ingestion dans ce lot.
 */
export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  handle: text("handle"),
  platform: text("platform"),
  isActive: boolean("is_active").default(false), // false = listé, pas encore suivi
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Réception concurrent — taux NORMALISÉS uniquement, jamais de valeurs brutes, jamais
 * d'auteur. Restitution produit : apprentissage, jamais scoreboard.
 */
export const competitorReception = pgTable("competitor_reception", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  postRef: text("post_ref"),
  engagementRate: doublePrecision("engagement_rate"),
  sentimentScore: doublePrecision("sentiment_score"),
  observedAt: timestamp("observed_at").defaultNow(),
});
```

Vérifie que `unique`, `doublePrecision`, `boolean`, `integer`, `timestamp` sont bien importés depuis `drizzle-orm/pg-core` en tête de fichier ; ajoute ce qui manque.

- [ ] **Étape 4 : générer et RELIRE la migration**

```bash
npx drizzle-kit generate
```

Puis **lis le fichier SQL généré dans `migrations/`** et vérifie, avant toute application :
- il ajoute bien `intent` et `attribution_window_days` en colonnes **nullable ou avec défaut** (aucune réécriture de données existantes) ;
- il crée les trois tables et la contrainte `content_reception_unique_measure` ;
- il ne contient **aucun `DROP`**, aucune modification de table existante autre que les deux ajouts de colonne.

Si le SQL contient autre chose, **arrête-toi et signale-le** plutôt que de l'appliquer.

- [ ] **Étape 5 : appliquer sur dev-local uniquement**

Le `.env` local pointe sur la branche Neon `dev-local` — sûr. Applique le SQL généré :

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-) node -e "
const pg=require('pg'); const fs=require('fs');
const sql=fs.readFileSync(process.argv[1],'utf8');
const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(sql).then(()=>{console.log('migration appliquée');return p.end()})
 .catch(e=>{console.error('ERREUR:',e.message);process.exit(1)});
" migrations/<le_fichier_généré>.sql
```

**N'applique rien sur la production.** Elle sera migrée au moment du merge, hors de ce lot.

- [ ] **Étape 6 : vérifier**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```

- [ ] **Étape 7 : commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(reception): schéma du fil 3 — intent, fenêtre d'attribution, réception, concurrents"
```

---

### Task 3 : le port et ses adaptateurs

**Fichiers :** Créer `server/services/reception/types.ts`, `sources/manual.ts`, `sources/instagram.ts`, `reception.test.ts`

**Interfaces produites :** `ReceptionSignal`, `ReceptionSource`, `parseReceptionCsv`, `instagramSource` — consommés par les tâches 4 et 5.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `server/services/reception/reception.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { parseReceptionCsv } from "./sources/manual";
import { instagramSource } from "./sources/instagram";

describe("parseReceptionCsv", () => {
  it("lit une ligne complète", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,shares,comments,reach,measured_at\n42,instagram,10,3,5,1000,2026-08-15",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ contentId: 42, platform: "instagram", saves: 10, reach: 1000 });
  });

  it("reporte les erreurs LIGNE PAR LIGNE sans jeter le reste du fichier", () => {
    const r = parseReceptionCsv(
      "content_id,platform,saves,reach\n42,instagram,10,1000\nabc,instagram,5,500\n43,instagram,7,900",
    );
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(3);
    expect(r.errors[0].message).toBeTruthy();
  });

  it("refuse un fichier sans les colonnes obligatoires", () => {
    const r = parseReceptionCsv("saves,reach\n10,1000");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message.toLowerCase()).toContain("content_id");
  });

  it("laisse un signal absent à null plutôt que de le mettre à zéro", () => {
    const r = parseReceptionCsv("content_id,platform,saves,reach\n42,instagram,,1000");
    expect(r.rows[0].saves).toBeNull();
  });

  it("normalise measured_at au jour", () => {
    const r = parseReceptionCsv(
      "content_id,platform,reach,measured_at\n42,instagram,1000,2026-08-15T13:45:00Z",
    );
    expect(r.rows[0].measuredAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("rejette une valeur négative", () => {
    const r = parseReceptionCsv("content_id,platform,saves,reach\n42,instagram,-3,1000");
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("adaptateur Instagram", () => {
  it("refuse d'être utilisé et NOMME la permission manquante", async () => {
    await expect(instagramSource.fetchSignals({ contentId: 1, platformPostId: "x" }))
      .rejects.toThrow(/instagram_business_manage_insights/);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/reception/reception.test.ts`
Attendu : ÉCHEC — modules inexistants.

- [ ] **Étape 3 : écrire le port**

Créer `server/services/reception/types.ts` :

```typescript
/**
 * LE PORT d'ingestion de la réception.
 *
 * Les « saves » ne sont récupérables sur AUCUN réseau connecté aujourd'hui (Instagram
 * exige `instagram_business_manage_insights`, non demandé ; TikTok n'expose aucune lecture
 * de métriques ; LinkedIn n'a pas d'équivalent sur les posts personnels). L'ingestion est
 * donc un PORT, jamais un appel direct : le Fil 3 fonctionne dès aujourd'hui avec
 * l'adaptateur manuel, et les adaptateurs réseau viendront derrière la même interface sans
 * rien réécrire ailleurs.
 */

export interface ReceptionSignal {
  contentId: number;
  platform: string;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  reach: number | null;
  sentimentScore: number | null;
  measuredAt: Date;
  source: string;
}

export interface ReceptionSource {
  readonly name: string;
  fetchSignals(ref: { contentId: number; platformPostId?: string | null }): Promise<ReceptionSignal[]>;
}

export interface CsvRowError {
  line: number;
  message: string;
}
```

- [ ] **Étape 4 : écrire l'adaptateur manuel**

Créer `server/services/reception/sources/manual.ts`. Réutilise `parseCsv` de `server/services/csv.ts` (ne réécris pas un parseur). Exporte :

```typescript
export function parseReceptionCsv(text: string): {
  rows: Omit<ReceptionSignal, "source">[];
  errors: CsvRowError[];
}
```

Règles à respecter :
- colonnes obligatoires `content_id` et `platform` ; leur absence rejette le fichier avec une erreur nommant la colonne manquante ;
- `saves`, `shares`, `comments`, `reach` : entier ≥ 0, ou `null` si la cellule est vide — **une cellule vide n'est pas un zéro** ;
- une valeur non numérique ou négative produit une erreur **sur sa ligne** et n'interrompt pas le fichier ;
- `measured_at` optionnel, parsé puis **normalisé à minuit UTC** ; absent → le jour courant à minuit UTC ;
- la numérotation des lignes d'erreur compte l'en-tête comme ligne 1.

Exporte aussi un `manualSource: ReceptionSource` dont `fetchSignals` lève une erreur explicite : la saisie manuelle est poussée, pas tirée.

- [ ] **Étape 5 : écrire le squelette Instagram**

Créer `server/services/reception/sources/instagram.ts` :

```typescript
import type { ReceptionSource } from "../types";

/**
 * Adaptateur Instagram — SQUELETTE. Volontairement non fonctionnel.
 *
 * Les insights par média (`saved`, `reach`, `shares`) exigent la permission
 * `instagram_business_manage_insights`, que l'app ne demande pas aujourd'hui
 * (`server/services/social-oauth.ts` ne demande que `instagram_business_basic` et
 * `instagram_business_content_publish`). L'obtenir suppose un tour d'App Review Meta.
 *
 * Ce fichier existe pour prouver que le port se suffit : le jour où la permission est
 * accordée, seul ce fichier change. Il n'est atteint par AUCUN chemin par défaut.
 */
export const instagramSource: ReceptionSource = {
  name: "instagram",
  async fetchSignals() {
    throw new Error(
      "Adaptateur Instagram indisponible : la lecture des insights par média exige la permission " +
        "`instagram_business_manage_insights`, non accordée à cette app. Utilise la saisie manuelle " +
        "ou l'import CSV en attendant l'App Review Meta.",
    );
  },
};
```

- [ ] **Étape 6 : vérifier**

```bash
npx vitest run server/services/reception/reception.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Étape 7 : commit**

```bash
git add server/services/reception/
git commit -m "feat(reception): port d'ingestion, adaptateur manuel et squelette Instagram"
```

---

### Task 4 : l'ingestion et le branchement mémoire

**Fichiers :** Créer `server/services/reception/ingest.ts`. Modifier `server/storage.ts`.

**Interfaces produites :** `ingestSignals(userId, signals) → { written, skipped, errors }` — consommée par la tâche 5.

- [ ] **Étape 1 : ajouter les accès storage**

Dans `server/storage.ts` (et les signatures dans `IStorage`) :

```typescript
  /** Upsert idempotent : rejouer la même mesure écrase, ne double pas. */
  async upsertContentReception(row: InsertContentReception): Promise<void> {
    await db.insert(contentReception).values(row)
      .onConflictDoUpdate({
        target: [contentReception.contentId, contentReception.platform, contentReception.measuredAt],
        set: {
          saves: row.saves, shares: row.shares, comments: row.comments, reach: row.reach,
          sentimentScore: row.sentimentScore, receivedVsIntentScore: row.receivedVsIntentScore,
          confidence: row.confidence, rationale: row.rationale, source: row.source,
        },
      });
  }

  async getContentReception(contentId: number): Promise<ContentReception[]> {
    return await db.select().from(contentReception)
      .where(eq(contentReception.contentId, contentId))
      .orderBy(desc(contentReception.measuredAt));
  }
```

- [ ] **Étape 2 : écrire l'ingestion**

Créer `server/services/reception/ingest.ts`. Pour chaque signal :

1. charger le contenu (`storage.getContentById` ou équivalent — vérifie ce qui existe) ; contenu introuvable ou n'appartenant pas à `userId` → erreur sur ce signal, on continue les autres ;
2. calculer le score avec `receivedVsIntentScore` — `intent` du contenu, `conversionsInWindow: 0` (le LOT 3B le remplira) ;
3. `upsertContentReception` ;
4. écrire l'entrée mémoire (étape 3) en **best-effort** ;
5. renvoyer `{ written, skipped, errors }`.

**Aucune exception ne doit remonter** : une ingestion qui échoue ne casse aucune action utilisateur.

- [ ] **Étape 3 : le branchement mémoire**

Dans le même fichier, après l'upsert, en best-effort (try/catch qui logge et continue) :

```typescript
// On écrit DIRECTEMENT dans memory_entries : il n'y a rien à « extraire » d'un signal
// chiffré, donc on ne passe pas par extractToMemory. La marque est CONNUE (celle du
// contenu) — aucune question de routage de marque ici.
const phrase =
  `Réception mesurée du contenu « ${content.title} » (${signal.platform}) : ` +
  `${result.score === null ? "score indisponible" : `score ${(result.score * 100).toFixed(0)}/100`} ` +
  `contre une intention ${content.intent ?? "non déclarée"}. ${result.rationale}`;

const embedding = await embedText(phrase).catch(() => null);
await db.insert(memoryEntries).values({
  userId,
  projectId: content.projectId,
  fil: "reception",
  entryType: "signal_reception",
  content: phrase,
  embedding,
  salience: result.confidence > 0 ? result.confidence : 0.5,
});
```

- [ ] **Étape 4 : vérifier**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```

- [ ] **Étape 5 : commit**

```bash
git add server/services/reception/ingest.ts server/storage.ts
git commit -m "feat(reception): ingestion idempotente et écriture mémoire fil reception"
```

---

### Task 5 : les routes

**Fichiers :** Modifier `server/routes.ts`

Trois routes, placées près des routes `/api/content` existantes (autour de la ligne 6221) :

- `POST /api/content/:id/reception` — saisie d'une mesure `{ platform, saves, shares, comments, reach, sentimentScore?, measuredAt? }`. Valide : entiers ≥ 0 ou `null`, `platform` non vide, `measuredAt` normalisé au jour. Appelle `ingestSignals`. Renvoie le score, la confiance et la raison — **jamais un simple accusé de réception muet**.
- `POST /api/content/reception/import` — corps `{ csv: string }`. Parse, ingère les lignes valides, renvoie `{ imported, errors }` avec **les erreurs ligne par ligne**.
- `GET /api/content/:id/reception` — l'historique des mesures d'un contenu.

Toutes derrière `isAuthenticated`, toutes vérifiant que le contenu appartient à l'utilisateur.

- [ ] **Étape 1 : écrire les routes** (suis les patterns du fichier : `req.userId`, try/catch, statuts 400/404/500)
- [ ] **Étape 2 : vérifier** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`
- [ ] **Étape 3 : commit** — `git commit -m "feat(reception): routes de saisie, d'import CSV et de lecture"`

---

### Task 6 : l'interface

**Fichiers :** Modifier `client/src/pages/content-calendar.tsx`, `client/src/locales/fr.ts`, `client/src/locales/en.ts`

Sur un contenu **publié** (`publishedAt` non nul), une entrée « Réception » ouvre une modale :
- quatre champs numériques — enregistrements, partages, commentaires, portée — plus la date de mesure ;
- un bouton d'import CSV qui affiche les erreurs **ligne par ligne** ;
- après enregistrement, l'écran restitue **le score contre l'intention et sa raison**.

**Interdits, à respecter à la lettre :**
- aucun champ « likes », aucune mention de likes ;
- **aucun tableau de bord de chiffres bruts** — les compteurs saisis ne sont pas ré-affichés comme un palmarès ;
- aucune comparaison entre contenus, aucun classement : la restitution est un **apprentissage**, formulé dans la voix Naya ;
- si le score est `null`, l'écran dit pourquoi (portée manquante, intention absente) — c'est une sortie légitime, pas une erreur.

Toutes les chaînes via i18n, dans **fr.ts ET en.ts**.

- [ ] **Étape 1 : ajouter les clés dans les deux locales**
- [ ] **Étape 2 : vérifier la parité** — `npx vitest run client/src/locales/locales.test.ts`
- [ ] **Étape 3 : écrire la modale et le bouton d'import**
- [ ] **Étape 4 : vérifier** — `tsc`, `npx vitest run`, `npm run build`
- [ ] **Étape 5 : commit** — `git commit -m "feat(reception): saisie de réception et restitution du score dans le calendrier"`

---

### Task 7 : renseigner l'intention

**Fichiers :** Modifier `client/src/pages/content-calendar.tsx`, `server/routes.ts` (route `/api/content/generate`), `client/src/locales/{fr,en}.ts`

- **Formulaire de création** : un sélecteur à trois valeurs (`awareness`, `consideration`, `conversion`), **non requis**, avec un libellé qui explique que c'est ce contre quoi la réception sera jugée. Ne touche pas au champ `goal` existant.
- **Génération IA** : demande au modèle de déduire l'intention du contexte et de la renvoyer dans sa réponse structurée. Si la réponse ne contient pas l'une des trois valeurs exactement, écris `null`. **Jamais une valeur devinée ni une valeur par défaut.**
- Vérifie que la route `PATCH /api/content/:id` accepte `intent` (regarde si elle a une liste blanche de champs ; si oui, ajoute `intent`).

- [ ] **Étape 1 : ajouter les clés i18n dans les deux locales**
- [ ] **Étape 2 : le sélecteur dans le formulaire**
- [ ] **Étape 3 : la déduction à la génération, avec repli sur `null`**
- [ ] **Étape 4 : vérifier** — `tsc`, `npx vitest run`, `npm run build`
- [ ] **Étape 5 : commit** — `git commit -m "feat(reception): l'intention se renseigne à la création et à la génération"`

---

### Task 8 : vérification des critères d'acceptation

**Fichiers :** aucun (vérification).

- [ ] **Étape 1 : suite complète** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`. Tout vert, **tests existants inchangés**.

- [ ] **Étape 2 : vérifier le schéma sur dev-local**

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-) node -e "
const pg=require('pg'); const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(\`SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='content' AND column_name='intent') AS intent,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='projects' AND column_name='attribution_window_days') AS fenetre,
  to_regclass('public.content_reception')::text AS reception,
  to_regclass('public.competitors')::text AS concurrents,
  to_regclass('public.competitor_reception')::text AS reception_concurrents,
  to_regclass('public.brand_conversions')::text AS ne_doit_pas_exister\`)
 .then(r=>{console.log(JSON.stringify(r.rows[0],null,2));return p.end()});
"
```
Attendu : `intent` 1, `fenetre` 1, les trois tables présentes, et **`ne_doit_pas_exister` à `null`** — `brand_conversions` appartient au LOT 3B.

- [ ] **Étape 3 : aucune fuite de vanité**

```bash
grep -rniE "\blikes?\b" server/services/reception client/src/pages/content-calendar.tsx | grep -viE "dislike|unlike" || echo "aucune mention de likes — OK"
```

- [ ] **Étape 4 : l'adaptateur Instagram n'est atteignable par aucun chemin par défaut**

```bash
grep -rn "instagramSource" server/ --include="*.ts" | grep -v "sources/instagram.ts" | grep -v ".test.ts" || echo "jamais importé ailleurs — OK"
```

- [ ] **Étape 5 : rendre la main.** Ne pousse pas, ne merge pas. Le lot se termine par une revue.

---

## Notes pour l'implémenteur

- **Le point d'arrêt est réel.** Ce plan s'arrête à 3A. Ne crée ni `brand_conversions`, ni `conversion_attributions`, ni `arbitration_log`, et n'écris aucune logique d'attribution ou d'arbitrage — même « pour préparer ».
- **`conversionsInWindow` vaut 0 partout dans ce lot.** C'est correct et voulu : le LOT 3B le branchera. Ne cherche pas à le calculer.
- **Une ingestion ne casse jamais rien.** Si tu te surprends à laisser remonter une exception depuis `ingest.ts` vers une route utilisateur, c'est une régression.
- **Si une micro-décision manque au brief, note ton hypothèse dans le commit.** C'est une consigne explicite de la commanditaire, pas une politesse.
- **Tâches 5 à 7 : spécifiées par exigence, pas par code verbatim.** `server/routes.ts` et `client/src/pages/content-calendar.tsx` (1473 lignes) sont trop gros pour que le plan dicte chaque ligne sans figer des choix qui dépendent du contexte local. Lis les patterns voisins — mutations `useMutation`, `apiRequest`, `req.userId`, try/catch, statuts — et suis-les. Les contraintes listées dans ces tâches, elles, ne sont pas négociables : ce sont les critères d'acceptation du brief.
