# L'espace de lecture — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque matin, Naya lit le marché de chaque projet actif et pose entre zéro et trois questions auxquelles seule l'utilisatrice peut répondre ; ce qui n'est pas traité disparaît le soir sans laisser de dette, ce qui est répondu devient de la mémoire de marque.

**Architecture:** Un job quotidien (cron 05:00 UTC) orchestré par `runReadingRoom(userId, today)` : requêtes de veille persistées par projet → recherche SERP sur la verticale actualités bornée à 7 jours → tri en deux étages (étage 1 déterministe et pur, étage 2 un seul appel `smart` comparatif par projet) → scrape + rédaction de la fiche → écriture en base. Les fiches du jour sont injectées dans `buildNayaContext`, donc tout ce qui consomme le contexte en hérite sans branchement supplémentaire. Deux surfaces : une section « Ce matin » en tête du Reading Hub, une ligne d'appel sur le dashboard.

**Tech Stack:** TypeScript, Express, Drizzle ORM + PostgreSQL (Neon), vitest, React + react-query + shadcn/ui, Bright Data (SERP API + Web Unlocker), Claude via `server/services/claude.ts` et le routeur `server/services/ai/router.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-naya-espace-lecture-design.md` — à lire en entier avant la première tâche. Le plan argumente depuis le spec ; les deux voyagent ensemble.

## Global Constraints

Ces contraintes s'appliquent implicitement à **toutes** les tâches.

- **Seuil de rétention : `0.7`.** Constante, jamais un réglage utilisateur, jamais abaissé pour remplir une revue. Zéro fiche est une sortie valide.
- **Plafonds : 3 fiches par matin au total, 2 au maximum pour un même projet.** Constantes.
- **Fraîcheur : 7 jours maximum.**
- **Plafond SERP : 24 requêtes par jour et par utilisateur.**
- **Périmètre : uniquement les projets `projectStatus = 'active'`** (personnels et clients).
- **Aucun compteur, aucune série, aucun badge, aucune relance, aucun taux de traitement** nulle part dans l'interface ni dans les textes.
- **Best-effort de bout en bout :** un `try/catch` par utilisateur et par étape ; une source, un scrape ou un modèle qui échoue dégrade la revue sans rien casser et sans erreur visible.
- **Aucune tâche de planning** n'est créée par cette fonctionnalité.
- **Aucune écriture dans le fil `savoir`.** La réponse de l'utilisatrice va dans le fil `cap`, avec le `projectId` de la fiche.
- **Langue :** tout le code, les commentaires et les textes d'interface en français. Les identifiants de code en français quand le dépôt le fait déjà (c'est le cas dans `server/services/`).
- **Tests :** vitest, fichiers `*.test.ts` colocalisés à côté du service. La logique de décision est extraite en fonctions pures et testée sans base ni réseau.
- **Migrations :** `npx drizzle-kit generate`, relecture du SQL à la main, puis `npm run db:migrate` sur dev. **Jamais `db:push`.** La production est une décision manuelle et séparée.
- **Commandes de vérification :** `npx vitest run` (1325 tests verts au départ) et `npm run build`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/services/reading/url.ts` | Canonicalisation d'URL, hachage, normalisation de titre. Pur. |
| `server/services/reading/triage.ts` | Les deux étages du tri et les constantes de plafond. Étage 1 pur. |
| `server/services/reading/queries.ts` | Génération, persistance et régénération hebdomadaire des requêtes de veille. |
| `server/services/reading/source.ts` | Exécution SERP actualités → candidats normalisés. |
| `server/services/reading/card.ts` | Scrape + rédaction de la fiche + parsing de la sortie modèle. |
| `server/services/reading/runner.ts` | `runReadingRoom` : orchestration, plafonds, expiration, best-effort. |
| `server/services/reading/*.test.ts` | Tests colocalisés, un fichier par module testé. |
| `shared/schema.ts` (modifié) | Tables `reading_queries`, `reading_cards` ; `projectId` sur `saved_articles`. |
| `server/services/serp.ts` (modifié) | Troisième paramètre optionnel : verticale + fenêtre de fraîcheur. |
| `server/services/naya-context.ts` (modifié) | Section 8 : la revue du jour. |
| `server/routes.ts` (modifié) | Endpoints `/api/reading/*`. |
| `server/index.ts` (modifié) | Cron 05:00 UTC. |
| `client/src/pages/reading-hub.tsx` (modifié) | Section « Ce matin ». |
| `client/src/pages/dashboard.tsx` (modifié) | Ligne d'appel vers la revue. |

---

### Task 1 : la verticale actualités dans `serpSearch`

C'est la seule inconnue technique du spec, donc elle passe en premier : si la forme de la réponse ne convient pas, tout le reste est conçu pour basculer sur la recherche web classique sans autre changement.

**Files:**
- Modify: `server/services/serp.ts:13-46`
- Test: `server/services/serp.test.ts` (existe déjà — on ajoute un `describe`)

**Interfaces:**
- Consumes: rien.
- Produces: `serpSearch(query: string, userId?: string, opts?: SerpOptions): Promise<SerpResult[]>` avec `interface SerpOptions { vertical?: "web" | "news"; freshness?: "week" }` ; `buildSerpUrl(query: string, opts?: SerpOptions): string` (pure, exportée pour le test) ; `parseSerpBody(body: any): SerpResult[]` (pure, exportée) ; `SerpResult` gagne `publishedAtRaw?: string`.

- [ ] **Step 1: Écrire les tests qui échouent**

Compléter l'import existant en tête de `server/services/serp.test.ts` avec `buildSerpUrl` et `parseSerpBody`, puis ajouter à la fin du fichier :

```typescript

describe("buildSerpUrl — la verticale et la fenêtre de fraîcheur", () => {
  it("sans options : une recherche web classique, comme avant", () => {
    const url = buildSerpUrl("actualité packaging");
    expect(url).toContain("https://www.google.com/search?q=");
    expect(url).not.toContain("tbm=");
    expect(url).not.toContain("tbs=");
  });

  it("verticale actualités + 7 jours : tbm=nws et tbs=qdr:w", () => {
    const url = buildSerpUrl("actualité packaging", { vertical: "news", freshness: "week" });
    expect(url).toContain("tbm=nws");
    expect(url).toContain("tbs=qdr%3Aw");
  });

  it("la requête est encodée, y compris les opérateurs", () => {
    expect(buildSerpUrl('site:lesechos.fr "packaging durable"')).toContain(
      encodeURIComponent('site:lesechos.fr "packaging durable"'),
    );
  });
});

describe("parseSerpBody — les deux formes de réponse Bright Data", () => {
  it("lit la forme web (organic), comme la prospection aujourd'hui", () => {
    const out = parseSerpBody({ organic: [{ link: "https://a.fr/x", title: "A", description: "desc" }] });
    expect(out).toEqual([{ link: "https://a.fr/x", title: "A", description: "desc", source: undefined, publishedAtRaw: undefined }]);
  });

  it("lit la forme actualités (news) et en retient la date brute", () => {
    const out = parseSerpBody({
      news: [{ link: "https://b.fr/y", title: "B", source: "Les Echos", date: "il y a 2 jours" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].link).toBe("https://b.fr/y");
    expect(out[0].source).toBe("Les Echos");   // la source alimente la fiche — sans elle, « source inconnue »
    expect(out[0].publishedAtRaw).toBe("il y a 2 jours");
  });

  it("une réponse vide ou inattendue ne jette pas : liste vide", () => {
    expect(parseSerpBody(null)).toEqual([]);
    expect(parseSerpBody({})).toEqual([]);
    expect(parseSerpBody({ organic: "pas un tableau" })).toEqual([]);
  });

  it("un résultat sans lien est écarté", () => {
    expect(parseSerpBody({ organic: [{ title: "sans lien" }] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run server/services/serp.test.ts`
Expected: FAIL — `buildSerpUrl` et `parseSerpBody` ne sont pas exportés.

- [ ] **Step 3: Implémenter**

Dans `server/services/serp.ts`, remplacer l'interface `SerpResult` et le corps de `serpSearch` :

```typescript
export interface SerpResult { link: string; title: string; description?: string; source?: string; publishedAtRaw?: string }

/** Verticale et fenêtre de fraîcheur. Générique : la lecture s'en sert, la prospection non. */
export interface SerpOptions { vertical?: "web" | "news"; freshness?: "week" }

/** Construit l'URL Google interrogée via la SERP API. Pur — testé isolément. */
export function buildSerpUrl(query: string, opts: SerpOptions = {}): string {
  const params = new URLSearchParams({ q: query });
  if (opts.vertical === "news") params.set("tbm", "nws");
  if (opts.freshness === "week") params.set("tbs", "qdr:w");
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * Extrait les résultats du corps SERP. Deux formes possibles :
 * `organic` (recherche web, ce que lit la prospection) et `news` (verticale actualités,
 * qui porte en plus une date brute — c'est elle qui rend la fraîcheur fiable).
 * Pur, tolérant : toute forme inattendue rend une liste vide plutôt que de jeter.
 */
export function parseSerpBody(body: any): SerpResult[] {
  const raw: any[] = Array.isArray(body?.news) ? body.news : Array.isArray(body?.organic) ? body.organic : [];
  return raw
    .map((o) => ({
      link: o?.link || o?.url || "",
      title: o?.title || "",
      description: o?.description || o?.snippet || undefined,
      source: o?.source || o?.publisher || undefined,
      publishedAtRaw: o?.date || o?.published || undefined,
    }))
    .filter((r) => r.link);
}

export async function serpSearch(query: string, userId?: string, opts: SerpOptions = {}): Promise<SerpResult[]> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return [];
  const zone = process.env.BRIGHT_DATA_SERP_ZONE || "naya";
  const url = buildSerpUrl(query, opts);
  try {
    const res = await fetch(SERP_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "json", data_format: "parsed_light" }),
    });
    if (userId) recordSpend(userId, SERP_COST_EUR).catch(() => {});
    if (!res.ok) return [];
    const wrapper: any = await res.json();
    let body: any = wrapper?.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { return []; } }
    return parseSerpBody(body);
  } catch {
    return [];
  }
}
```

Les appels existants (`sourceLeadsFromQueries`, prospection) ne passent pas de troisième argument : leur comportement est strictement inchangé.

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/serp.test.ts`
Expected: PASS, y compris les tests de prospection déjà présents dans le fichier.

- [ ] **Step 5: Vérifier la forme réelle contre l'API Bright Data**

C'est la vérification qui décide de la suite. Avec `BRIGHT_DATA_API_KEY` dans l'environnement :

```bash
npx tsx -e '
import { serpSearch } from "./server/services/serp";
serpSearch("actualité packaging durable", undefined, { vertical: "news", freshness: "week" })
  .then((r) => { console.log("résultats:", r.length); console.log(JSON.stringify(r.slice(0, 3), null, 2)); });
'
```

Attendu : au moins un résultat, avec `publishedAtRaw` renseigné.

**Si `publishedAtRaw` est vide ou si la liste est vide**, ne pas insister et ne pas inventer de parsing : noter le constat dans le journal de la tâche, et poursuivre le plan en appelant `serpSearch` **sans options** (repli recherche web). Le seul impact est sur l'étage 1 (Task 3), dont le test de fraîcheur devient « on écarte tout candidat dont la date est inconnue **ou** vieille de plus de 7 jours » — le code écrit en Task 3 gère déjà les deux cas.

- [ ] **Step 6: Commit**

```bash
git add server/services/serp.ts server/services/serp.test.ts
git commit -m "feat(serp): la verticale actualites et la fenetre de 7 jours, en option"
```

---

### Task 2 : le schéma et la migration

**Files:**
- Modify: `shared/schema.ts` (ajout de deux tables ; `projectId` sur `savedArticles`)
- Create: `migrations/00XX_*.sql` (généré par drizzle-kit)

**Interfaces:**
- Consumes: rien.
- Produces: `readingQueries`, `readingCards` (tables Drizzle) ; types `ReadingQuery = typeof readingQueries.$inferSelect`, `ReadingCard = typeof readingCards.$inferSelect`, exportés depuis `@shared/schema` et consommés par toutes les tâches suivantes, client compris.

- [ ] **Step 1: Ajouter les deux tables**

À la suite de `savedArticles` dans `shared/schema.ts` :

```typescript
// ════════════════════════════════════════════════════════════════════════════════
// L'ESPACE DE LECTURE — la revue du matin.
// Voir docs/superpowers/specs/2026-09-29-naya-espace-lecture-design.md
// ════════════════════════════════════════════════════════════════════════════════

// Les requêtes de veille, PAR PROJET. Générées par l'IA, éditables par l'utilisateur.
// Régénérées au plus une fois par semaine : des requêtes stables font une veille stable.
export const readingQueries = pgTable("reading_queries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  origin: text("origin").notNull().default("ai"),   // ai | manual
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  projIdx: index("reading_query_proj_idx").on(t.userId, t.projectId, t.isActive),
}));

// Une fiche de lecture. Sert AUSSI de mémoire des URLs déjà vues (index unique) :
// les lignes expirées et rejetées RESTENT en base, c'est ce qui rend vraie la règle
// « une URL déjà proposée n'est jamais reproposée ».
export const readingCards = pgTable("reading_cards", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  urlHash: text("url_hash").notNull(),
  title: text("title").notNull(),
  source: text("source"),
  publishedAt: timestamp("published_at"),
  relevanceScore: doublePrecision("relevance_score"),
  relevanceRationale: text("relevance_rationale"),
  factSummary: text("fact_summary"),
  whyThisBrand: text("why_this_brand"),
  angle: text("angle"),
  question: text("question"),
  userAnswer: text("user_answer"),
  answeredAt: timestamp("answered_at"),
  status: text("status").notNull().default("proposed"), // proposed | answered | kept | expired | rejected
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  seenIdx: uniqueIndex("reading_card_seen_idx").on(t.userId, t.urlHash),
  dayIdx: index("reading_card_day_idx").on(t.userId, t.status, t.createdAt),
}));

export type ReadingQuery = typeof readingQueries.$inferSelect;
export type ReadingCard = typeof readingCards.$inferSelect;
```

- [ ] **Step 2: Corriger la dette `saved_articles`**

Dans la définition de `savedArticles`, ajouter sous `userId` :

```typescript
  // Multi-marques : seule table qui l'ignorait encore. Nullable — les lignes existantes
  // ont été créées avant la notion de projet, on ne leur en invente pas une.
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
```

- [ ] **Step 3: Générer la migration**

Run: `npx drizzle-kit generate`
Expected: un nouveau fichier `migrations/0016_*.sql`.

- [ ] **Step 4: Relire le SQL à la main**

Run: `cat migrations/0016_*.sql`

Vérifier, ligne par ligne : deux `CREATE TABLE`, un `ALTER TABLE saved_articles ADD COLUMN project_id`, l'index unique `reading_card_seen_idx`, les index simples, les `ON DELETE CASCADE`. **Aucun `DROP`, aucun `ALTER … TYPE`, aucune table existante touchée autrement que par l'ajout de colonne.** Si un `DROP` apparaît, s'arrêter et le signaler — c'est le signe d'une dérive entre le schéma et la base.

- [ ] **Step 5: Appliquer sur dev et vérifier la compilation**

Run: `npm run db:migrate && npm run build`
Expected: migration appliquée, build vert.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(lecture): le schema de la revue du matin, et projectId sur saved_articles"
```

---

### Task 3 : l'URL canonique et l'étage 1 du tri

C'est la pièce qui doit être irréprochable : elle est pure, donc entièrement testable, et c'est elle qui garantit qu'une URL déjà vue ne revient jamais.

**Files:**
- Create: `server/services/reading/url.ts`
- Create: `server/services/reading/url.test.ts`
- Create: `server/services/reading/triage.ts`
- Create: `server/services/reading/triage.test.ts`

**Interfaces:**
- Consumes: `SerpResult` de `server/services/serp.ts`.
- Produces:
  - `canonicalizeUrl(raw: string): string | null`
  - `hashUrl(canonical: string): string`
  - `normalizeTitle(title: string): string`
  - `interface Candidat { url: string; urlHash: string; title: string; source: string | null; publishedAt: Date | null; projectId: number }`
  - `etage1(bruts: CandidatBrut[], opts: { today: Date; urlHashDejaVus: Set<string> }): Candidat[]`
  - `interface CandidatBrut { url: string; title: string; source?: string | null; publishedAt: Date | null; projectId: number }`
  - Constantes : `FRAICHEUR_JOURS = 7`, `DOMAINES_EXCLUS`, `SEUIL_RETENTION = 0.7`, `MAX_FICHES = 3`, `MAX_PAR_PROJET = 2`.

- [ ] **Step 1: Écrire les tests d'URL**

Créer `server/services/reading/url.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { canonicalizeUrl, hashUrl, normalizeTitle } from "./url";

describe("canonicalizeUrl", () => {
  it("retire les paramètres de suivi, garde les paramètres utiles", () => {
    expect(canonicalizeUrl("https://a.fr/x?utm_source=news&id=12&utm_campaign=z")).toBe("https://a.fr/x?id=12");
  });

  it("deux URLs qui ne diffèrent que par le suivi donnent la MÊME canonique", () => {
    const a = canonicalizeUrl("https://a.fr/article?utm_medium=mail");
    const b = canonicalizeUrl("https://a.fr/article?fbclid=abc");
    expect(a).toBe(b);
  });

  it("normalise le schéma, la casse de l'hôte, le www et le slash final", () => {
    expect(canonicalizeUrl("HTTP://WWW.A.fr/Article/")).toBe("http://a.fr/Article");
  });

  it("retire le fragment", () => {
    expect(canonicalizeUrl("https://a.fr/x#section-2")).toBe("https://a.fr/x");
  });

  it("rend null sur une URL inexploitable plutôt que de jeter", () => {
    expect(canonicalizeUrl("pas une url")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });
});

describe("hashUrl", () => {
  it("est stable et dépend de l'URL", () => {
    expect(hashUrl("https://a.fr/x")).toBe(hashUrl("https://a.fr/x"));
    expect(hashUrl("https://a.fr/x")).not.toBe(hashUrl("https://a.fr/y"));
  });
});

describe("normalizeTitle", () => {
  it("ignore la casse, les accents, la ponctuation et les espaces multiples", () => {
    expect(normalizeTitle("L'Été   du PACKAGING, enfin !")).toBe(normalizeTitle("l ete du packaging enfin"));
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/url.test.ts`
Expected: FAIL — le module `./url` n'existe pas.

- [ ] **Step 3: Implémenter `url.ts`**

```typescript
import { createHash } from "crypto";

// Paramètres de suivi : ils changent d'un partage à l'autre sans changer la page.
// Les garder ferait passer le même article pour deux articles différents.
const PARAMS_DE_SUIVI = /^(utm_|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|spm|xtor|at_medium|at_campaign)/i;

/** URL canonique : la clé d'identité d'un article. Pur. */
export function canonicalizeUrl(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = u.protocol.toLowerCase();
    for (const k of [...u.searchParams.keys()]) {
      if (PARAMS_DE_SUIVI.test(k)) u.searchParams.delete(k);
    }
    u.searchParams.sort();
    let out = u.toString();
    out = out.replace(/\?$/, "");
    // Slash final retiré, sauf sur la racine du domaine.
    if (out.endsWith("/") && new URL(out).pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

/** Hash de l'URL canonique — la valeur stockée dans reading_cards.urlHash. */
export function hashUrl(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Titre normalisé, pour repérer le même article republié sous une autre URL. */
export function normalizeTitle(title: string): string {
  return (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Lancer les tests d'URL**

Run: `npx vitest run server/services/reading/url.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire les tests de l'étage 1**

Créer `server/services/reading/triage.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { etage1, FRAICHEUR_JOURS } from "./triage";
import { hashUrl, canonicalizeUrl } from "./url";

const TODAY = new Date("2026-10-01T06:00:00Z");
const ilYA = (jours: number) => new Date(TODAY.getTime() - jours * 24 * 3600 * 1000);
const brut = (o: Partial<Parameters<typeof etage1>[0][number]> = {}) => ({
  url: "https://media.fr/article-a",
  title: "Le packaging durable change de régime",
  source: "Média",
  publishedAt: ilYA(1),
  projectId: 1,
  ...o,
});

describe("etage1 — le tri déterministe, avant tout appel modèle", () => {
  it("laisse passer un article frais et inconnu", () => {
    const out = etage1([brut()], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toHaveLength(1);
    expect(out[0].urlHash).toBe(hashUrl(canonicalizeUrl("https://media.fr/article-a")!));
  });

  it(`écarte ce qui est plus vieux que ${FRAICHEUR_JOURS} jours`, () => {
    const out = etage1([brut({ publishedAt: ilYA(FRAICHEUR_JOURS + 1) })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte un candidat SANS date : une date inconnue n'est pas une date fraîche", () => {
    const out = etage1([brut({ publishedAt: null })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte une URL déjà vue, même sous une forme avec paramètres de suivi", () => {
    const dejaVus = new Set([hashUrl(canonicalizeUrl("https://media.fr/article-a")!)]);
    const out = etage1([brut({ url: "https://media.fr/article-a?utm_source=x" })], { today: TODAY, urlHashDejaVus: dejaVus });
    expect(out).toEqual([]);
  });

  it("écarte les domaines exclus", () => {
    const out = etage1([brut({ url: "https://news.google.com/articles/xyz" })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("dédoublonne par titre normalisé, même quand les URLs diffèrent", () => {
    const out = etage1(
      [
        brut({ url: "https://media-a.fr/x", title: "Le packaging durable change de régime" }),
        brut({ url: "https://media-b.fr/y", title: "LE PACKAGING DURABLE CHANGE DE RÉGIME !" }),
      ],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("media-a.fr");  // le premier arrivé gagne
  });

  it("dédoublonne deux URLs identiques au suivi près à l'intérieur du même lot", () => {
    const out = etage1(
      [brut({ url: "https://media.fr/x?utm_source=a" }), brut({ url: "https://media.fr/x?utm_source=b" })],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
  });

  it("écarte une URL inexploitable sans jeter", () => {
    expect(etage1([brut({ url: "pas une url" })], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });

  it("ne fait aucun appel réseau ni modèle : la fonction est pure et synchrone", () => {
    expect(etage1([], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });
});
```

- [ ] **Step 6: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/triage.test.ts`
Expected: FAIL — le module `./triage` n'existe pas.

- [ ] **Step 7: Implémenter l'étage 1 dans `triage.ts`**

```typescript
import { canonicalizeUrl, hashUrl, normalizeTitle } from "./url";

// ── Constantes de politique. Aucune n'est un réglage utilisateur. ──────────────
export const FRAICHEUR_JOURS = 7;
export const SEUIL_RETENTION = 0.7;
export const MAX_FICHES = 3;
export const MAX_PAR_PROJET = 2;

// Agrégateurs et fermes de contenu : ils republient sans rien ajouter, et leurs URLs
// ne mènent pas à la source. Liste volontairement courte — à étendre sur constat, pas
// par précaution.
export const DOMAINES_EXCLUS = [
  "news.google.com",
  "msn.com",
  "flipboard.com",
  "medium.com",
  "pinterest.com",
  "quora.com",
];

export interface CandidatBrut {
  url: string;
  title: string;
  source?: string | null;
  publishedAt: Date | null;
  projectId: number;
}

export interface Candidat {
  url: string;          // URL canonique
  urlHash: string;
  title: string;
  source: string | null;
  publishedAt: Date;
  projectId: number;
}

/**
 * Étage 1 du tri : déterministe, pur, sans modèle. Il élimine ce qu'aucun jugement
 * ne rattraperait — le vieux, le déjà-vu, l'agrégateur, le doublon — AVANT de payer
 * le moindre appel. Un candidat sans date est écarté : une date inconnue n'est pas
 * une date fraîche, et une fiche sur un article de 2019 détruit la confiance.
 */
export function etage1(bruts: CandidatBrut[], opts: { today: Date; urlHashDejaVus: Set<string> }): Candidat[] {
  const limite = opts.today.getTime() - FRAICHEUR_JOURS * 24 * 3600 * 1000;
  const hashDuLot = new Set<string>();
  const titresDuLot = new Set<string>();
  const out: Candidat[] = [];

  for (const b of bruts) {
    if (!b.publishedAt || b.publishedAt.getTime() < limite) continue;

    const canonique = canonicalizeUrl(b.url);
    if (!canonique) continue;

    const hote = new URL(canonique).hostname;
    if (DOMAINES_EXCLUS.some((d) => hote === d || hote.endsWith(`.${d}`))) continue;

    const h = hashUrl(canonique);
    if (opts.urlHashDejaVus.has(h) || hashDuLot.has(h)) continue;

    const titre = normalizeTitle(b.title);
    if (!titre || titresDuLot.has(titre)) continue;

    hashDuLot.add(h);
    titresDuLot.add(titre);
    out.push({
      url: canonique,
      urlHash: h,
      title: b.title,
      source: b.source ?? null,
      publishedAt: b.publishedAt,
      projectId: b.projectId,
    });
  }

  return out;
}
```

- [ ] **Step 8: Lancer les tests**

Run: `npx vitest run server/services/reading/`
Expected: PASS — url.test.ts et triage.test.ts.

- [ ] **Step 9: Commit**

```bash
git add server/services/reading/url.ts server/services/reading/url.test.ts server/services/reading/triage.ts server/services/reading/triage.test.ts
git commit -m "feat(lecture): l'URL canonique et l'etage 1 du tri, purs et testes"
```

---

### Task 4 : l'étage 2 — le jugement comparatif et la sélection

Le modèle ne décide pas seul ce qui sort : il note, et une fonction pure applique le seuil et les plafonds. Cette séparation est ce qui rend « zéro fiche » impossible à contourner.

**Files:**
- Modify: `server/services/reading/triage.ts`
- Modify: `server/services/reading/triage.test.ts`

**Interfaces:**
- Consumes: `Candidat`, `SEUIL_RETENTION`, `MAX_FICHES`, `MAX_PAR_PROJET` (Task 3) ; `callClaude`, `CLAUDE_MODELS` de `server/services/claude.ts`.
- Produces:
  - `interface Note { url: string; score: number; rationale: string }`
  - `parseNotes(raw: string): Note[]` (pure)
  - `selectionFinale(candidats: Candidat[], notes: Note[]): Array<Candidat & { score: number; rationale: string }>` (pure)
  - `noterCandidats(input: { userId: string; projectId: number; contexteMarque: string; candidats: Candidat[] }): Promise<Note[]>`

- [ ] **Step 1: Écrire les tests**

Compléter l'import existant de `./triage` en tête de `server/services/reading/triage.test.ts` avec `parseNotes`, `selectionFinale`, `SEUIL_RETENTION`, `MAX_FICHES` et `MAX_PAR_PROJET` — un seul import par module — puis ajouter à la fin du fichier :

```typescript

const cand = (url: string, projectId = 1) => ({
  url, urlHash: `h-${url}`, title: `titre ${url}`, source: null,
  publishedAt: new Date("2026-09-30T08:00:00Z"), projectId,
});

describe("parseNotes — lire la sortie du modèle sans lui faire confiance", () => {
  it("lit un tableau JSON propre", () => {
    const out = parseNotes('[{"url":"https://a.fr/x","score":0.82,"rationale":"parce que"}]');
    expect(out).toEqual([{ url: "https://a.fr/x", score: 0.82, rationale: "parce que" }]);
  });

  it("lit un JSON entouré de texte ou de balises markdown", () => {
    const out = parseNotes('Voici :\n```json\n[{"url":"https://a.fr/x","score":0.9,"rationale":"r"}]\n```\nVoilà.');
    expect(out).toHaveLength(1);
  });

  it("rend une liste vide sur une sortie illisible, sans jeter", () => {
    expect(parseNotes("je n'ai pas compris")).toEqual([]);
    expect(parseNotes("")).toEqual([]);
  });

  it("écarte les entrées incomplètes ou au score hors bornes", () => {
    const out = parseNotes('[{"url":"https://a.fr/x","score":1.7,"rationale":"r"},{"score":0.9},{"url":"https://b.fr/y","score":0.8,"rationale":"r"}]');
    expect(out.map((n) => n.url)).toEqual(["https://b.fr/y"]);
  });
});

describe("selectionFinale — le seuil et les plafonds, hors de portée du modèle", () => {
  it("quand rien n'atteint le seuil : ZÉRO fiche, et surtout pas la moins mauvaise", () => {
    const candidats = [cand("https://a.fr/1"), cand("https://a.fr/2")];
    const notes = [
      { url: "https://a.fr/1", score: SEUIL_RETENTION - 0.01, rationale: "presque" },
      { url: "https://a.fr/2", score: 0.2, rationale: "non" },
    ];
    expect(selectionFinale(candidats, notes)).toEqual([]);
  });

  it("retient exactement ce qui passe le seuil, pas un de plus", () => {
    const candidats = [cand("https://a.fr/1"), cand("https://a.fr/2")];
    const notes = [
      { url: "https://a.fr/1", score: 0.95, rationale: "oui" },
      { url: "https://a.fr/2", score: 0.4, rationale: "non" },
    ];
    const out = selectionFinale(candidats, notes);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a.fr/1");
    expect(out[0].score).toBe(0.95);
  });

  it(`plafonne à ${MAX_FICHES} fiches, les mieux notées d'abord`, () => {
    const candidats = [1, 2, 3, 4, 5].map((i) => cand(`https://a.fr/${i}`, i));
    // Scores écrits en littéraux, jamais calculés : 0.71 + 2 * 0.05 vaut 0.8099999999999999
    // en binaire, et le test échouerait sur une égalité stricte.
    const scores = [0.72, 0.78, 0.84, 0.9, 0.96];
    const notes = candidats.map((c, i) => ({ url: c.url, score: scores[i], rationale: "r" }));
    const out = selectionFinale(candidats, notes);
    expect(out).toHaveLength(MAX_FICHES);
    expect(out.map((o) => o.score)).toEqual([0.96, 0.9, 0.84]);
  });

  it(`ne donne jamais plus de ${MAX_PAR_PROJET} fiches au même projet`, () => {
    const candidats = [cand("https://a.fr/1", 7), cand("https://a.fr/2", 7), cand("https://a.fr/3", 7), cand("https://b.fr/1", 8)];
    const notes = [
      { url: "https://a.fr/1", score: 0.99, rationale: "r" },
      { url: "https://a.fr/2", score: 0.98, rationale: "r" },
      { url: "https://a.fr/3", score: 0.97, rationale: "r" },
      { url: "https://b.fr/1", score: 0.75, rationale: "r" },
    ];
    const out = selectionFinale(candidats, notes);
    expect(out.filter((o) => o.projectId === 7)).toHaveLength(MAX_PAR_PROJET);
    expect(out.map((o) => o.url)).toContain("https://b.fr/1");
  });

  it("une note qui ne correspond à aucun candidat est ignorée (le modèle a inventé une URL)", () => {
    const out = selectionFinale([cand("https://a.fr/1")], [{ url: "https://invente.fr", score: 0.99, rationale: "r" }]);
    expect(out).toEqual([]);
  });

  it("un candidat non noté n'est pas retenu par défaut", () => {
    expect(selectionFinale([cand("https://a.fr/1")], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/triage.test.ts`
Expected: FAIL — `parseNotes` et `selectionFinale` ne sont pas exportés.

- [ ] **Step 3: Implémenter**

Ajouter à `server/services/reading/triage.ts` :

```typescript
import { callClaude, CLAUDE_MODELS } from "../claude";

export interface Note { url: string; score: number; rationale: string }

export const PROMPT_TRI = `Tu tries une veille pour UNE marque précise.

On te donne le contexte de la marque, puis une liste d'articles d'actualité récents
(titre, source, date, URL). Tu réponds à UNE SEULE question, pour chacun :

  « Cette personne, avec CETTE marque, a-t-elle quelque chose de NON ÉVIDENT à en dire ? »

Tu ne juges pas si l'article est bon, intéressant en soi, ou bien écrit. Tu juges s'il
appelle un point de vue que seule cette personne peut donner. Un article que n'importe
qui commenterait pareil ne vaut rien ici.

Tu notes les articles LES UNS PAR RAPPORT AUX AUTRES : le meilleur du lot n'est pas
forcément bon. Si aucun ne mérite mieux que 0.5, note-les tous en dessous de 0.5.
Ne cherche pas à en faire ressortir un.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{"url": "...", "score": 0.0 à 1.0, "rationale": "une phrase, en français"}]`;

/** Lit la sortie du modèle. Tolérante au bavardage et aux balises markdown. Pure. */
export function parseNotes(raw: string): Note[] {
  if (!raw || !raw.trim()) return [];
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return [];
  let brut: any;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((n) => n && typeof n.url === "string" && typeof n.score === "number" && n.score >= 0 && n.score <= 1)
    .map((n) => ({ url: n.url, score: n.score, rationale: typeof n.rationale === "string" ? n.rationale : "" }));
}

/**
 * Applique le seuil et les plafonds. Volontairement HORS du modèle : le nombre de fiches
 * est ce qui reste après le seuil, jamais un quota à remplir. Aucun chemin de ce code
 * ne peut abaisser SEUIL_RETENTION pour produire une fiche de plus.
 */
export function selectionFinale(
  candidats: Candidat[],
  notes: Note[],
): Array<Candidat & { score: number; rationale: string }> {
  const parUrl = new Map(candidats.map((c) => [c.url, c]));
  const retenus = notes
    .filter((n) => n.score >= SEUIL_RETENTION && parUrl.has(n.url))
    .sort((a, b) => b.score - a.score)
    .map((n) => ({ ...(parUrl.get(n.url) as Candidat), score: n.score, rationale: n.rationale }));

  const out: Array<Candidat & { score: number; rationale: string }> = [];
  const parProjet = new Map<number, number>();
  for (const r of retenus) {
    if (out.length >= MAX_FICHES) break;
    const n = parProjet.get(r.projectId) ?? 0;
    if (n >= MAX_PAR_PROJET) continue;
    parProjet.set(r.projectId, n + 1);
    out.push(r);
  }
  return out;
}

/**
 * Étage 2 : UN SEUL appel par marque, avec toute la liste. Le modèle voit le champ
 * entier, donc il distingue « le meilleur d'aujourd'hui » de « bon dans l'absolu » —
 * ce qu'un jugement article par article ne sait pas faire.
 */
export async function noterCandidats(input: {
  userId: string;
  projectId: number;
  contexteMarque: string;
  candidats: Candidat[];
}): Promise<Note[]> {
  if (input.candidats.length === 0) return [];
  const liste = input.candidats
    .map((c, i) => `${i + 1}. ${c.title}\n   source: ${c.source ?? "inconnue"} — ${c.publishedAt.toISOString().slice(0, 10)}\n   url: ${c.url}`)
    .join("\n");
  try {
    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      taskKind: "strategic_reasoning",
      system: PROMPT_TRI,
      max_tokens: 2048,
      userId: input.userId,
      projectId: input.projectId,
      messages: [{ role: "user", content: `CONTEXTE DE LA MARQUE\n${input.contexteMarque}\n\nARTICLES DU JOUR\n${liste}` }],
    });
    return parseNotes(raw);
  } catch (err: any) {
    console.error(`[Lecture] notation projet ${input.projectId} échouée:`, err?.message);
    return []; // best-effort : pas de note → pas de fiche, jamais d'erreur visible
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/reading/triage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/reading/triage.ts server/services/reading/triage.test.ts
git commit -m "feat(lecture): le jugement compare par marque, et le seuil hors de portee du modele"
```

---

### Task 5 : les requêtes de veille

**Files:**
- Create: `server/services/reading/queries.ts`
- Create: `server/services/reading/queries.test.ts`

**Interfaces:**
- Consumes: `readingQueries`, `projects`, `brandDna` (`@shared/schema`) ; `db` (`server/db`) ; `retrieveMemories` (`server/services/memory/retrieve`) ; `callClaude`, `CLAUDE_MODELS`.
- Produces:
  - `doitRegenerer(derniereGeneration: Date | null, today: Date): boolean` (pure)
  - `parseRequetes(raw: string): string[]` (pure)
  - `MAX_REQUETES_PAR_PROJET = 6`, `REGENERATION_JOURS = 7`
  - `assurerRequetes(userId: string, projectId: number, today: Date): Promise<string[]>` — rend les requêtes actives du projet, en les générant si besoin.

- [ ] **Step 1: Écrire les tests**

Créer `server/services/reading/queries.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { doitRegenerer, parseRequetes, MAX_REQUETES_PAR_PROJET, REGENERATION_JOURS } from "./queries";

const TODAY = new Date("2026-10-01T05:00:00Z");
const ilYA = (j: number) => new Date(TODAY.getTime() - j * 24 * 3600 * 1000);

describe("doitRegenerer — des requêtes stables font une veille stable", () => {
  it("aucune requête encore générée → on génère", () => {
    expect(doitRegenerer(null, TODAY)).toBe(true);
  });

  it("générées hier → on ne régénère pas", () => {
    expect(doitRegenerer(ilYA(1), TODAY)).toBe(false);
  });

  it(`générées il y a plus de ${REGENERATION_JOURS} jours → on régénère`, () => {
    expect(doitRegenerer(ilYA(REGENERATION_JOURS + 1), TODAY)).toBe(true);
  });

  it("exactement à la limite → on ne régénère pas encore", () => {
    expect(doitRegenerer(ilYA(REGENERATION_JOURS), TODAY)).toBe(false);
  });
});

describe("parseRequetes", () => {
  it("lit un tableau JSON de chaînes", () => {
    expect(parseRequetes('["packaging durable 2026","reglementation emballage France"]')).toEqual([
      "packaging durable 2026",
      "reglementation emballage France",
    ]);
  });

  it("tolère le bavardage autour du JSON", () => {
    expect(parseRequetes('Voici :\n```json\n["a","b"]\n```')).toEqual(["a", "b"]);
  });

  it(`plafonne à ${MAX_REQUETES_PAR_PROJET} requêtes`, () => {
    const dix = JSON.stringify(Array.from({ length: 10 }, (_, i) => `requete ${i}`));
    expect(parseRequetes(dix)).toHaveLength(MAX_REQUETES_PAR_PROJET);
  });

  it("écarte le vide, les doublons et les non-chaînes", () => {
    expect(parseRequetes('["a","","a",42,"  ","b"]')).toEqual(["a", "b"]);
  });

  it("rend une liste vide sur une sortie illisible", () => {
    expect(parseRequetes("rien de lisible")).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/queries.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `server/services/reading/queries.ts` :

```typescript
import { db } from "../../db";
import { and, eq, desc } from "drizzle-orm";
import { readingQueries, projects, brandDna } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";
import { retrieveMemories } from "../memory/retrieve";

export const MAX_REQUETES_PAR_PROJET = 6;
export const REGENERATION_JOURS = 7;

/** Régénérer au plus une fois par semaine : sinon la veille change de sujet tous les matins. */
export function doitRegenerer(derniereGeneration: Date | null, today: Date): boolean {
  if (!derniereGeneration) return true;
  const jours = (today.getTime() - derniereGeneration.getTime()) / (24 * 3600 * 1000);
  return jours > REGENERATION_JOURS;
}

/** Lit la sortie du modèle : un tableau de chaînes. Pure, tolérante, plafonnée. */
export function parseRequetes(raw: string): string[] {
  if (!raw) return [];
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return [];
  let brut: any;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const out: string[] = [];
  for (const q of brut) {
    if (typeof q !== "string") continue;
    const s = q.trim();
    if (!s || vues.has(s)) continue;
    vues.add(s);
    out.push(s);
    if (out.length >= MAX_REQUETES_PAR_PROJET) break;
  }
  return out;
}

const PROMPT_REQUETES = `Tu composes des requêtes de veille d'ACTUALITÉ pour une marque.

Règles :
- 3 à 6 requêtes, en français, formulées comme on cherche une actualité récente :
  secteur, acteurs, réglementation, marché — pas des termes génériques de positionnement.
- Pas de « qu'est-ce que », pas de définitions, pas de tutoriels : on cherche ce qui vient
  de se passer, pas de la documentation.
- Chaque requête vise un angle différent. Deux requêtes qui ramèneraient les mêmes
  articles sont une requête gâchée.

Réponds UNIQUEMENT par un tableau JSON de chaînes, sans texte autour : ["...", "..."]`;

/**
 * Rend les requêtes actives d'un projet, en les générant si elles manquent ou ont
 * plus d'une semaine. Best-effort : en cas d'échec de génération, on rend ce qui existe
 * déjà (éventuellement rien) plutôt que de casser la revue.
 */
export async function assurerRequetes(userId: string, projectId: number, today: Date): Promise<string[]> {
  const existantes = await db
    .select()
    .from(readingQueries)
    .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.isActive, true)))
    .orderBy(desc(readingQueries.createdAt));

  const derniereGeneration = existantes.length
    ? existantes.reduce<Date | null>((max, q) => {
        const d = q.createdAt ? new Date(q.createdAt) : null;
        return d && (!max || d > max) ? d : max;
      }, null)
    : null;

  // Les requêtes écrites à la main ne sont jamais remplacées par la génération.
  const manuelles = existantes.filter((q) => q.origin === "manual").map((q) => q.query);
  if (!doitRegenerer(derniereGeneration, today)) {
    return existantes.map((q) => q.query);
  }

  try {
    const [projet] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!projet) return existantes.map((q) => q.query);
    const adn = await db.select().from(brandDna).where(and(eq(brandDna.userId, userId), eq(brandDna.projectId, projectId))).catch(() => []);
    const mem = await retrieveMemories(userId, projectId, `actualité du marché de ${projet.name}`).catch(() => null);
    const cap = mem?.cap?.map((m) => `- ${m.content}`).join("\n") ?? "";

    const contexte = [
      `Marque : ${projet.name}`,
      projet.type ? `Type : ${projet.type}` : "",
      projet.description ? `Description : ${projet.description}` : "",
      projet.statusNote ? `Où en est la marque : ${projet.statusNote}` : "",
      adn.length ? `ADN de marque : ${JSON.stringify(adn[0]).slice(0, 1500)}` : "",
      cap ? `Ce qui compte pour cette marque :\n${cap}` : "",
    ].filter(Boolean).join("\n");

    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      taskKind: "strategic_reasoning",
      system: PROMPT_REQUETES,
      max_tokens: 800,
      userId,
      projectId,
      messages: [{ role: "user", content: contexte }],
    });

    const generees = parseRequetes(raw).filter((q) => !manuelles.includes(q));
    if (generees.length === 0) return existantes.map((q) => q.query);

    // Les anciennes générées sortent, les manuelles restent.
    await db
      .update(readingQueries)
      .set({ isActive: false })
      .where(and(eq(readingQueries.userId, userId), eq(readingQueries.projectId, projectId), eq(readingQueries.origin, "ai")));

    await db.insert(readingQueries).values(
      generees.map((q) => ({ userId, projectId, query: q, origin: "ai" as const, isActive: true })),
    );

    return [...manuelles, ...generees];
  } catch (err: any) {
    console.error(`[Lecture] génération de requêtes projet ${projectId} échouée:`, err?.message);
    return existantes.map((q) => q.query);
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/reading/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/reading/queries.ts server/services/reading/queries.test.ts
git commit -m "feat(lecture): les requetes de veille par projet, regenerees une fois par semaine"
```

---

### Task 6 : le sourcing

**Files:**
- Create: `server/services/reading/source.ts`
- Create: `server/services/reading/source.test.ts`

**Interfaces:**
- Consumes: `serpSearch`, `SerpResult` (Task 1) ; `CandidatBrut` (Task 3).
- Produces:
  - `parseDateRelative(raw: string | undefined, today: Date): Date | null` (pure)
  - `MAX_REQUETES_SERP_PAR_JOUR = 24`
  - `sourcerCandidats(input: { userId: string; today: Date; parProjet: Array<{ projectId: number; requetes: string[] }> }): Promise<CandidatBrut[]>`

- [ ] **Step 1: Écrire les tests**

Créer `server/services/reading/source.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { parseDateRelative } from "./source";

const TODAY = new Date("2026-10-01T06:00:00Z");

describe("parseDateRelative — Google Actualités date en clair, pas en ISO", () => {
  it("lit « il y a 2 jours »", () => {
    const d = parseDateRelative("il y a 2 jours", TODAY);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit « il y a 3 heures » → aujourd'hui", () => {
    expect(parseDateRelative("il y a 3 heures", TODAY)?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("lit la forme anglaise « 2 days ago »", () => {
    expect(parseDateRelative("2 days ago", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit une date absolue ISO", () => {
    expect(parseDateRelative("2026-09-28", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("rend null sur une date absente ou incompréhensible — l'étage 1 écartera le candidat", () => {
    expect(parseDateRelative(undefined, TODAY)).toBeNull();
    expect(parseDateRelative("l'autre jour", TODAY)).toBeNull();
  });

  it("ne rend jamais une date future", () => {
    expect(parseDateRelative("2027-01-01", TODAY)).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/source.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `server/services/reading/source.ts` :

```typescript
import { serpSearch } from "../serp";
import type { CandidatBrut } from "./triage";

// Plafond dur, par utilisateur et par jour. Le coût SERP est négligeable (~0,0014 €/requête) :
// ce plafond borne le BRUIT et le temps d'exécution, pas la dépense.
export const MAX_REQUETES_SERP_PAR_JOUR = 24;

const UNITES: Array<[RegExp, number]> = [
  [/(\d+)\s*(minute|min)/i, 1 / (24 * 60)],
  // Le `s?` n'est pas cosmétique : sans lui, le `\b` final ne matche jamais le pluriel
  // (« 3 heures », « 3 hours »), et les articles les plus FRAIS de la journée — ceux
  // datés en heures — se retrouvent sans date, donc écartés par l'étage 1. Le `\b` reste
  // nécessaire pour que le `h` isolé ne morde pas sur « 2 hommes ».
  [/(\d+)\s*(heures?|hours?|hrs?|h)\b/i, 1 / 24],
  [/(\d+)\s*(jour|day)/i, 1],
  [/(\d+)\s*(semaine|week)/i, 7],
  [/(\d+)\s*(mois|month)/i, 30],
  [/(\d+)\s*(an|année|year)/i, 365],
];

/**
 * Google Actualités donne « il y a 2 jours », pas une date ISO. Sans cette lecture,
 * tous les candidats seraient sans date — donc tous écartés par l'étage 1.
 * Une date incomprise rend null : on préfère perdre un article que d'en dater un faux.
 */
export function parseDateRelative(raw: string | undefined, today: Date): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) {
    const d = new Date(iso);
    return d.getTime() > today.getTime() ? null : d;
  }

  for (const [re, jours] of UNITES) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n)) return null;
      return new Date(today.getTime() - n * jours * 24 * 3600 * 1000);
    }
  }

  if (/aujourd'hui|today/i.test(s)) return new Date(today);
  if (/hier|yesterday/i.test(s)) return new Date(today.getTime() - 24 * 3600 * 1000);
  return null;
}

/**
 * Exécute les requêtes de veille et rend des candidats bruts, projet par projet.
 * Best-effort : une requête qui échoue est sautée, jamais propagée.
 */
export async function sourcerCandidats(input: {
  userId: string;
  today: Date;
  parProjet: Array<{ projectId: number; requetes: string[] }>;
}): Promise<CandidatBrut[]> {
  const out: CandidatBrut[] = [];
  let budget = MAX_REQUETES_SERP_PAR_JOUR;

  for (const { projectId, requetes } of input.parProjet) {
    for (const requete of requetes) {
      if (budget <= 0) {
        console.info(`[Lecture] plafond de ${MAX_REQUETES_SERP_PAR_JOUR} requêtes SERP atteint — sourcing interrompu`);
        return out;
      }
      budget -= 1;
      try {
        // pays/langue épinglés : sans eux, Bright Data sort par un pays aléatoire
        // (Germany, Croatia, Peru… mesuré) et un appel sur trois ne rend RIEN.
        const res = await serpSearch(requete, input.userId, { vertical: "news", freshness: "week", pays: "fr", langue: "fr" });
        for (const r of res) {
          out.push({
            url: r.link,
            title: r.title,
            source: r.source ?? null,
            publishedAt: parseDateRelative(r.publishedAtRaw, input.today),
            projectId,
          });
        }
      } catch (err: any) {
        console.error(`[Lecture] requête « ${requete} » échouée:`, err?.message);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/reading/source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/reading/source.ts server/services/reading/source.test.ts
git commit -m "feat(lecture): le sourcing actualites et la lecture des dates relatives"
```

---

### Task 7 : la fiche

**Files:**
- Create: `server/services/reading/card.ts`
- Create: `server/services/reading/card.test.ts`

**Interfaces:**
- Consumes: `scrapeAsMarkdown` (`server/services/brightdata-enrich`) ; `callClaudeWithContext` (`server/services/claude`) ; `Candidat` (Task 3).
- Produces:
  - `interface Fiche { factSummary: string; whyThisBrand: string; angle: string; question: string }`
  - `parseFiche(raw: string): Fiche | null` (pure)
  - `redigerFiche(input: { userId: string; candidat: Candidat & { score: number; rationale: string }; scrape?: typeof scrapeAsMarkdown }): Promise<Fiche | null>`

- [ ] **Step 1: Écrire les tests**

Créer `server/services/reading/card.test.ts` :

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseFiche, redigerFiche } from "./card";

const candidat = {
  url: "https://media.fr/a", urlHash: "h", title: "Un titre", source: "Média",
  publishedAt: new Date("2026-09-30T08:00:00Z"), projectId: 1, score: 0.9, rationale: "r",
};

describe("parseFiche", () => {
  it("lit les quatre champs", () => {
    const f = parseFiche('{"fait":"Il s\'est passé X.","pourquoi":"Ça touche la marque.","angle":"Un terrain.","question":"Et toi ?"}');
    expect(f).toEqual({ factSummary: "Il s'est passé X.", whyThisBrand: "Ça touche la marque.", angle: "Un terrain.", question: "Et toi ?" });
  });

  it("tolère le bavardage et les balises autour du JSON", () => {
    expect(parseFiche('```json\n{"fait":"a","pourquoi":"b","angle":"c","question":"d"}\n```')).not.toBeNull();
  });

  it("rend null si un champ manque : une fiche incomplète ne s'affiche pas", () => {
    expect(parseFiche('{"fait":"a","pourquoi":"b","angle":"c"}')).toBeNull();
  });

  it("rend null si la question est vide : c'est le champ qui fait la fiche", () => {
    expect(parseFiche('{"fait":"a","pourquoi":"b","angle":"c","question":"   "}')).toBeNull();
  });

  it("rend null sur une sortie illisible, sans jeter", () => {
    expect(parseFiche("désolé, je n'ai pas pu")).toBeNull();
  });
});

describe("redigerFiche — le scrape est obligatoire", () => {
  it("scrape en échec → AUCUNE fiche : juger un titre produit une fiche creuse", async () => {
    const scrape = vi.fn().mockResolvedValue(null);
    const f = await redigerFiche({ userId: "u1", candidat, scrape });
    expect(f).toBeNull();
    expect(scrape).toHaveBeenCalledWith(candidat.url, expect.any(Number));
  });

  it("contenu scrapé vide → AUCUNE fiche", async () => {
    const scrape = vi.fn().mockResolvedValue({ url: candidat.url, content: "   " });
    expect(await redigerFiche({ userId: "u1", candidat, scrape })).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/card.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `server/services/reading/card.ts` :

```typescript
import { scrapeAsMarkdown } from "../brightdata-enrich";
import { callClaudeWithContext } from "../claude";
import type { Candidat } from "./triage";

export interface Fiche {
  factSummary: string;
  whyThisBrand: string;
  angle: string;
  question: string;
}

const MAX_CARACTERES_ARTICLE = 6000;

export const PROMPT_FICHE = `Tu écris une fiche de lecture pour la fondatrice, sur UN article.

Quatre champs, et rien d'autre :
- "fait" : 2 à 3 lignes. Ce qui s'est passé. Sans emphase, sans adjectif de vente.
- "pourquoi" : le lien explicite avec le positionnement de CETTE marque. Si tu n'en trouves
  pas de précis, dis-le platement plutôt que d'en inventer un.
- "angle" : une prise possible — un TERRAIN, pas une opinion. Tu ne dis jamais ce qu'il faut
  penser : tu montres où il y aurait quelque chose à dire.
- "question" : UNE seule question, précise, ouverte, qui appelle un avis que SEULE elle peut
  donner, avec son expérience et sa position. Une question générique (« qu'en penses-tu ? »,
  « est-ce une bonne nouvelle ? ») est un échec : elle doit être impossible à poser à
  quelqu'un d'autre.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"fait": "...", "pourquoi": "...", "angle": "...", "question": "..."}`;

/** Lit la sortie du modèle. Pure. Un champ manquant ou vide invalide toute la fiche. */
export function parseFiche(raw: string): Fiche | null {
  if (!raw) return null;
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  const champ = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fait = champ(o?.fait), pourquoi = champ(o?.pourquoi), angle = champ(o?.angle), question = champ(o?.question);
  if (!fait || !pourquoi || !angle || !question) return null;
  return { factSummary: fait, whyThisBrand: pourquoi, angle, question };
}

/**
 * Lit l'article pour de vrai, puis rédige. Le scrape est OBLIGATOIRE : une fiche écrite
 * depuis le seul titre est creuse, et une fiche creuse coûte plus cher que pas de fiche.
 * `scrape` est injectable pour les tests.
 */
export async function redigerFiche(input: {
  userId: string;
  candidat: Candidat & { score: number; rationale: string };
  scrape?: typeof scrapeAsMarkdown;
}): Promise<Fiche | null> {
  const scrape = input.scrape ?? scrapeAsMarkdown;
  const c = input.candidat;
  try {
    const page = await scrape(c.url, MAX_CARACTERES_ARTICLE);
    if (!page || !page.content || !page.content.trim()) return null;

    const raw = await callClaudeWithContext({
      userId: input.userId,
      projectId: c.projectId,
      model: undefined, // défaut = smart
      max_tokens: 1200,
      additionalSystemContext: PROMPT_FICHE,
      userMessage: `ARTICLE\nTitre : ${c.title}\nSource : ${c.source ?? "inconnue"}\nDate : ${c.publishedAt.toISOString().slice(0, 10)}\nURL : ${c.url}\n\nCONTENU\n${page.content}`,
    });
    return parseFiche(raw);
  } catch (err: any) {
    console.error(`[Lecture] rédaction de fiche échouée pour ${c.url}:`, err?.message);
    return null;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/reading/card.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/reading/card.ts server/services/reading/card.test.ts
git commit -m "feat(lecture): la fiche, ecrite depuis l'article lu et jamais depuis le titre"
```

---

### Task 8 : l'orchestration et l'expiration

**Files:**
- Create: `server/services/reading/runner.ts`
- Create: `server/services/reading/runner.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède ; `db`, `readingCards`, `projects`.
- Produces:
  - `expirerFichesDeLaVeille(userId: string, today: Date): Promise<number>`
  - `runReadingRoom(userId: string, today: Date, deps?: DepsLecture): Promise<{ fichesEcrites: number }>`
  - `interface DepsLecture` — les cinq collaborateurs injectables, pour que l'orchestration soit testable sans base ni réseau.

- [ ] **Step 1: Écrire les tests**

Créer `server/services/reading/runner.test.ts` :

```typescript
import { describe, it, expect, vi } from "vitest";
import { runReadingRoom } from "./runner";

const TODAY = new Date("2026-10-01T05:00:00Z");
const hier = new Date("2026-09-30T08:00:00Z");

const depsBase = (over: any = {}) => ({
  projetsActifs: vi.fn().mockResolvedValue([{ id: 1, name: "JMD" }]),
  requetes: vi.fn().mockResolvedValue(["actu secteur"]),
  sourcer: vi.fn().mockResolvedValue([
    { url: "https://media.fr/a", title: "A", source: "M", publishedAt: hier, projectId: 1 },
  ]),
  hashDejaVus: vi.fn().mockResolvedValue(new Set<string>()),
  contexteMarque: vi.fn().mockResolvedValue("contexte"),
  noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/a", score: 0.9, rationale: "r" }]),
  rediger: vi.fn().mockResolvedValue({ factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" }),
  ecrire: vi.fn().mockResolvedValue(undefined),
  expirer: vi.fn().mockResolvedValue(0),
  ...over,
});

describe("runReadingRoom", () => {
  it("le chemin nominal : une fiche écrite", async () => {
    const deps = depsBase();
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
    expect(deps.ecrire).toHaveBeenCalledTimes(1);
  });

  it("expire les fiches de la veille À CHAQUE passage, même quand la revue est vide", async () => {
    const deps = depsBase({ sourcer: vi.fn().mockResolvedValue([]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(deps.expirer).toHaveBeenCalledWith("u1", TODAY);
    expect(out.fichesEcrites).toBe(0);
  });

  it("rien au-dessus du seuil → zéro fiche, et on n'a même pas scrapé", async () => {
    const deps = depsBase({ noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/a", score: 0.4, rationale: "r" }]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.rediger).not.toHaveBeenCalled();
  });

  it("une rédaction qui rend null n'écrit pas de fiche", async () => {
    const deps = depsBase({ rediger: vi.fn().mockResolvedValue(null) });
    expect((await runReadingRoom("u1", TODAY, deps as any)).fichesEcrites).toBe(0);
    expect(deps.ecrire).not.toHaveBeenCalled();
  });

  it("un projet qui échoue n'empêche pas les autres d'être veillés", async () => {
    const deps = depsBase({
      projetsActifs: vi.fn().mockResolvedValue([{ id: 1, name: "A" }, { id: 2, name: "B" }]),
      contexteMarque: vi.fn().mockImplementation(async (_u: string, projectId: number) => {
        if (projectId === 1) throw new Error("boom");
        return "contexte B";
      }),
      sourcer: vi.fn().mockResolvedValue([
        { url: "https://media.fr/b", title: "B", source: "M", publishedAt: hier, projectId: 2 },
      ]),
      noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/b", score: 0.9, rationale: "r" }]),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
  });

  it("aucun projet actif → aucune requête, aucun appel modèle", async () => {
    const deps = depsBase({ projetsActifs: vi.fn().mockResolvedValue([]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.noter).not.toHaveBeenCalled();
    expect(deps.sourcer).not.toHaveBeenCalled();
  });

  it("une URL déjà vue n'est jamais reproposée, même si le modèle la noterait haut", async () => {
    const { hashUrl, canonicalizeUrl } = await import("./url");
    const deps = depsBase({
      hashDejaVus: vi.fn().mockResolvedValue(new Set([hashUrl(canonicalizeUrl("https://media.fr/a")!)])),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.noter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/reading/runner.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `server/services/reading/runner.ts` :

```typescript
import { db } from "../../db";
import { and, eq, lt, inArray } from "drizzle-orm";
import { readingCards, projects } from "@shared/schema";
import { etage1, noterCandidats, selectionFinale } from "./triage";
import type { CandidatBrut } from "./triage";
import { assurerRequetes } from "./queries";
import { sourcerCandidats } from "./source";
import { redigerFiche } from "./card";
import { retrieveMemories } from "../memory/retrieve";
import { serpConfigured } from "../serp";
import { webScrapeConfigured } from "../brightdata-enrich";

export interface DepsLecture {
  projetsActifs: (userId: string) => Promise<Array<{ id: number; name: string }>>;
  requetes: (userId: string, projectId: number, today: Date) => Promise<string[]>;
  sourcer: (input: { userId: string; today: Date; parProjet: Array<{ projectId: number; requetes: string[] }> }) => Promise<CandidatBrut[]>;
  hashDejaVus: (userId: string) => Promise<Set<string>>;
  contexteMarque: (userId: string, projectId: number) => Promise<string>;
  noter: typeof noterCandidats;
  rediger: typeof redigerFiche;
  ecrire: (ligne: typeof readingCards.$inferInsert) => Promise<void>;
  expirer: (userId: string, today: Date) => Promise<number>;
}

const debutDuJour = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Les fiches non traitées de la veille passent en `expired`. En silence : aucun report,
 * aucun cumul, aucune notification. Les lignes RESTENT en base — c'est elles qui
 * empêchent une URL d'être reproposée.
 */
export async function expirerFichesDeLaVeille(userId: string, today: Date): Promise<number> {
  const res = await db
    .update(readingCards)
    .set({ status: "expired" })
    .where(and(eq(readingCards.userId, userId), eq(readingCards.status, "proposed"), lt(readingCards.createdAt, debutDuJour(today))))
    .returning({ id: readingCards.id });
  return res.length;
}

const depsParDefaut: DepsLecture = {
  projetsActifs: async (userId) =>
    db.select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.projectStatus, "active"))),
  requetes: assurerRequetes,
  sourcer: sourcerCandidats,
  hashDejaVus: async (userId) => {
    const rows = await db.select({ h: readingCards.urlHash }).from(readingCards).where(eq(readingCards.userId, userId));
    return new Set(rows.map((r) => r.h));
  },
  contexteMarque: async (userId, projectId) => {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    const mem = await retrieveMemories(userId, projectId, "actualité du marché").catch(() => null);
    const cap = mem?.cap?.map((m) => `- ${m.content}`).join("\n") ?? "";
    return [
      `Marque : ${p?.name ?? projectId}`,
      p?.description ? `Description : ${p.description}` : "",
      p?.statusNote ? `Où en est la marque : ${p.statusNote}` : "",
      cap ? `Ce qui compte pour cette marque :\n${cap}` : "",
    ].filter(Boolean).join("\n");
  },
  noter: noterCandidats,
  rediger: redigerFiche,
  ecrire: async (ligne) => { await db.insert(readingCards).values(ligne).onConflictDoNothing(); },
  expirer: expirerFichesDeLaVeille,
};

/**
 * La revue du matin, pour un utilisateur. Best-effort de bout en bout : chaque étape est
 * gardée, une marque qui échoue n'empêche pas les autres, et l'absence de clé Bright Data
 * arrête la revue sans réveiller la moindre erreur visible.
 */
export async function runReadingRoom(
  userId: string,
  today: Date,
  deps: DepsLecture = depsParDefaut,
): Promise<{ fichesEcrites: number }> {
  // L'expiration a lieu AVANT tout le reste et quoi qu'il arrive ensuite : une revue
  // qui ne tourne pas ne doit pas laisser les fiches d'hier traîner un jour de plus.
  await deps.expirer(userId, today).catch((err: any) => {
    console.error(`[Lecture] expiration échouée pour ${userId}:`, err?.message);
    return 0;
  });

  if (deps === depsParDefaut && (!serpConfigured() || !webScrapeConfigured())) {
    console.info("[Lecture] Bright Data non configuré — revue non exécutée");
    return { fichesEcrites: 0 };
  }

  const projets = await deps.projetsActifs(userId).catch(() => []);
  if (projets.length === 0) return { fichesEcrites: 0 };

  const parProjet: Array<{ projectId: number; requetes: string[] }> = [];
  for (const p of projets) {
    try {
      const requetes = await deps.requetes(userId, p.id, today);
      if (requetes.length) parProjet.push({ projectId: p.id, requetes });
    } catch (err: any) {
      console.error(`[Lecture] requêtes projet ${p.id} échouées:`, err?.message);
    }
  }
  if (parProjet.length === 0) return { fichesEcrites: 0 };

  const bruts = await deps.sourcer({ userId, today, parProjet }).catch((err: any) => {
    console.error(`[Lecture] sourcing échoué pour ${userId}:`, err?.message);
    return [];
  });
  if (bruts.length === 0) return { fichesEcrites: 0 };

  const dejaVus = await deps.hashDejaVus(userId).catch(() => new Set<string>());
  const candidats = etage1(bruts, { today, urlHashDejaVus: dejaVus });
  if (candidats.length === 0) return { fichesEcrites: 0 };

  // Étage 2 : UN appel par marque, sur ses propres candidats.
  const notes: Array<{ url: string; score: number; rationale: string }> = [];
  for (const p of projets) {
    const duProjet = candidats.filter((c) => c.projectId === p.id);
    if (duProjet.length === 0) continue;
    try {
      const contexte = await deps.contexteMarque(userId, p.id);
      notes.push(...(await deps.noter({ userId, projectId: p.id, contexteMarque: contexte, candidats: duProjet })));
    } catch (err: any) {
      console.error(`[Lecture] notation projet ${p.id} échouée:`, err?.message);
    }
  }

  const retenus = selectionFinale(candidats, notes);
  if (retenus.length === 0) return { fichesEcrites: 0 };

  const finDeJournee = new Date(debutDuJour(today).getTime() + 24 * 3600 * 1000 - 1);
  let fichesEcrites = 0;
  for (const r of retenus) {
    try {
      const fiche = await deps.rediger({ userId, candidat: r });
      if (!fiche) continue; // scrape ou rédaction en échec → pas de fiche, jamais de fiche creuse
      await deps.ecrire({
        userId,
        projectId: r.projectId,
        url: r.url,
        urlHash: r.urlHash,
        title: r.title,
        source: r.source,
        publishedAt: r.publishedAt,
        relevanceScore: r.score,
        relevanceRationale: r.rationale,
        factSummary: fiche.factSummary,
        whyThisBrand: fiche.whyThisBrand,
        angle: fiche.angle,
        question: fiche.question,
        status: "proposed",
        expiresAt: finDeJournee,
      });
      fichesEcrites += 1;
    } catch (err: any) {
      console.error(`[Lecture] écriture de fiche échouée pour ${r.url}:`, err?.message);
    }
  }
  return { fichesEcrites };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/reading/`
Expected: PASS — les cinq fichiers de test du dossier.

- [ ] **Step 5: Commit**

```bash
git add server/services/reading/runner.ts server/services/reading/runner.test.ts
git commit -m "feat(lecture): l'orchestration de la revue et l'expiration silencieuse"
```

---

### Task 9 : les endpoints

**Files:**
- Modify: `server/routes.ts` (nouveau bloc, à placer juste avant les routes `/api/saved-articles`, vers la ligne 6980)
- Modify: `server/services/memory/extract.ts:176` (union `sourceType`)

**Interfaces:**
- Consumes: `runReadingRoom` (Task 8) ; `readingCards`, `readingQueries`, `content` (`@shared/schema`) ; `extractToMemory` (`server/services/memory/extract`) ; `isAuthenticated`, `req.userId` (motif existant de `routes.ts`).
- Produces, consommés par le client (Tasks 12 et 13) :
  - `GET /api/reading/today` → `{ cards: ReadingCard[] }` — les fiches `proposed`/`answered` du jour, plus toutes les `kept`.
  - `POST /api/reading/cards/:id/answer` `{ answer: string }` → `{ card }`
  - `POST /api/reading/cards/:id/keep` → `{ card }`
  - `POST /api/reading/cards/:id/skip` → `{ ok: true }`
  - `POST /api/reading/cards/:id/to-content` → `{ contentId: number }`
  - `GET /api/reading/queries` → `{ queries: ReadingQuery[] }`
  - `POST /api/reading/queries` `{ projectId, query }` → `{ query }`
  - `PATCH /api/reading/queries/:id` `{ query?, isActive? }` → `{ query }`
  - `POST /api/reading/run` → `{ fichesEcrites: number }`

- [ ] **Step 1: Ouvrir `sourceType` à la lecture**

Dans `server/services/memory/extract.ts`, ligne 176 :

```typescript
  sourceType: "capture" | "companion" | "feedback" | "reading";
```

La valeur n'est pas persistée (voir le spec, « État constaté ») : aucune migration.

- [ ] **Step 2: Écrire les endpoints**

Dans `server/routes.ts`, ajouter le bloc. Les imports vont en tête de fichier avec les autres.

```typescript
  // ── L'espace de lecture — la revue du matin ─────────────────────────────────
  // Spec : docs/superpowers/specs/2026-09-29-naya-espace-lecture-design.md

  app.get('/api/reading/today', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const debutDuJour = new Date();
      debutDuJour.setUTCHours(0, 0, 0, 0);
      const cards = await db
        .select()
        .from(readingCards)
        .where(and(
          eq(readingCards.userId, userId),
          or(
            eq(readingCards.status, 'kept'),
            and(
              inArray(readingCards.status, ['proposed', 'answered']),
              gte(readingCards.createdAt, debutDuJour),
            ),
          ),
        ))
        .orderBy(desc(readingCards.relevanceScore));
      res.json({ cards });
    } catch (error) {
      console.error('[Lecture] GET /api/reading/today:', error);
      res.status(500).json({ message: 'Failed to fetch reading cards' });
    }
  });

  app.post('/api/reading/cards/:id/answer', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const id = parseInt(req.params.id, 10);
      const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
      if (!answer) return res.status(400).json({ message: 'Réponse vide' });

      const [card] = await db
        .update(readingCards)
        .set({ userAnswer: answer, answeredAt: new Date(), status: 'answered' })
        .where(and(eq(readingCards.id, id), eq(readingCards.userId, userId)))
        .returning();
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });

      // Mémoire best-effort : la marque est CONNUE (celle de la fiche), donc aucune
      // question de marque n'est posée. Un échec ici ne casse pas la réponse.
      extractToMemory({
        userId,
        projectId: card.projectId,
        subjectProjectId: card.projectId,
        sourceType: 'reading',
        sourceText: `À propos de « ${card.title} » (${card.url}).\nQuestion posée : ${card.question}\nAvis de la fondatrice : ${answer}`,
      }).catch((e: any) => console.error('[Lecture] extractToMemory:', e?.message));

      res.json({ card });
    } catch (error) {
      console.error('[Lecture] POST answer:', error);
      res.status(500).json({ message: 'Failed to save answer' });
    }
  });

  app.post('/api/reading/cards/:id/keep', isAuthenticated, async (req: any, res) => {
    try {
      const [card] = await db
        .update(readingCards)
        .set({ status: 'kept' })
        .where(and(eq(readingCards.id, parseInt(req.params.id, 10)), eq(readingCards.userId, req.userId)))
        .returning();
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });
      res.json({ card });
    } catch (error) {
      console.error('[Lecture] POST keep:', error);
      res.status(500).json({ message: 'Failed to keep card' });
    }
  });

  app.post('/api/reading/cards/:id/skip', isAuthenticated, async (req: any, res) => {
    try {
      // « Passer » ne demande aucune justification et n'affiche aucune conséquence.
      // La ligne RESTE en base : c'est elle qui empêche l'URL d'être reproposée.
      await db
        .update(readingCards)
        .set({ status: 'rejected' })
        .where(and(eq(readingCards.id, parseInt(req.params.id, 10)), eq(readingCards.userId, req.userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error('[Lecture] POST skip:', error);
      res.status(500).json({ message: 'Failed to skip card' });
    }
  });

  app.post('/api/reading/cards/:id/to-content', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const [card] = await db
        .select()
        .from(readingCards)
        .where(and(eq(readingCards.id, parseInt(req.params.id, 10)), eq(readingCards.userId, userId)));
      if (!card) return res.status(404).json({ message: 'Fiche introuvable' });
      // Garde-fou du spec : pas de brouillon tant qu'il n'y a pas d'avis. Ce qu'elle
      // publie part de SA réponse, jamais de la fiche seule.
      if (!card.userAnswer) return res.status(400).json({ message: "Aucune réponse : pas de brouillon" });

      const brouillon = await callClaudeWithContext({
        userId,
        projectId: card.projectId,
        max_tokens: 1200,
        additionalSystemContext:
          "Tu mets en forme l'avis de la fondatrice en post LinkedIn. Tu n'ajoutes AUCUNE opinion " +
          "qu'elle n'a pas exprimée : tu structures, tu resserres, tu gardes ses mots et son ton. " +
          "Pas de hashtags, pas d'emoji, pas de formule d'accroche creuse.",
        userMessage: `FAIT\n${card.factSummary}\n\nSON AVIS\n${card.userAnswer}\n\nSOURCE\n${card.url}`,
      });

      const [ligne] = await db
        .insert(content)
        .values({
          userId,
          projectId: card.projectId,
          title: card.title,
          body: brouillon,
          platform: 'linkedin',
          status: 'draft',
        })
        .returning({ id: content.id });

      res.json({ contentId: ligne.id });
    } catch (error) {
      console.error('[Lecture] POST to-content:', error);
      res.status(500).json({ message: 'Failed to create content' });
    }
  });

  app.get('/api/reading/queries', isAuthenticated, async (req: any, res) => {
    try {
      const queries = await db
        .select()
        .from(readingQueries)
        .where(eq(readingQueries.userId, req.userId))
        .orderBy(desc(readingQueries.createdAt));
      res.json({ queries });
    } catch (error) {
      console.error('[Lecture] GET queries:', error);
      res.status(500).json({ message: 'Failed to fetch queries' });
    }
  });

  app.post('/api/reading/queries', isAuthenticated, async (req: any, res) => {
    try {
      const projectId = parseInt(req.body?.projectId, 10);
      const q = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      if (!Number.isFinite(projectId) || !q) return res.status(400).json({ message: 'projectId et query requis' });
      const [query] = await db
        .insert(readingQueries)
        .values({ userId: req.userId, projectId, query: q, origin: 'manual', isActive: true })
        .returning();
      res.json({ query });
    } catch (error) {
      console.error('[Lecture] POST queries:', error);
      res.status(500).json({ message: 'Failed to create query' });
    }
  });

  app.patch('/api/reading/queries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const patch: Record<string, unknown> = {};
      if (typeof req.body?.query === 'string' && req.body.query.trim()) patch.query = req.body.query.trim();
      if (typeof req.body?.isActive === 'boolean') patch.isActive = req.body.isActive;
      if (Object.keys(patch).length === 0) return res.status(400).json({ message: 'Rien à modifier' });
      const [query] = await db
        .update(readingQueries)
        .set(patch)
        .where(and(eq(readingQueries.id, parseInt(req.params.id, 10)), eq(readingQueries.userId, req.userId)))
        .returning();
      if (!query) return res.status(404).json({ message: 'Requête introuvable' });
      res.json({ query });
    } catch (error) {
      console.error('[Lecture] PATCH queries:', error);
      res.status(500).json({ message: 'Failed to update query' });
    }
  });

  app.post('/api/reading/run', isAuthenticated, async (req: any, res) => {
    try {
      const out = await runReadingRoom(req.userId, new Date());
      res.json(out);
    } catch (error) {
      console.error('[Lecture] POST run:', error);
      res.status(500).json({ message: 'Failed to run reading room' });
    }
  });
```

Compléter les imports en tête de `server/routes.ts`. **Vérifié le 29/09 : la ligne 7 n'importe que `eq, and, inArray` de `drizzle-orm`** — il faut y ajouter `or`, `gte` et `desc`. Vérifier de même la présence de `db`, `content` et `callClaudeWithContext`, puis ajouter :

```typescript
import { readingCards, readingQueries } from "@shared/schema";
import { runReadingRoom } from "./services/reading/runner";
import { extractToMemory } from "./services/memory/extract";
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npm run build`
Expected: build vert. Toute erreur de type ici vient d'un import manquant dans l'en-tête de `routes.ts` — l'ajouter, ne pas contourner avec `any`.

- [ ] **Step 4: Essayer les endpoints à la main**

Serveur lancé (`npm run dev`), connectée dans le navigateur, depuis la console du navigateur :

```javascript
await (await fetch('/api/reading/today', { credentials: 'include' })).json()
// attendu : { cards: [] }
await (await fetch('/api/reading/run', { method: 'POST', credentials: 'include' })).json()
// attendu : { fichesEcrites: 0 } ou davantage, selon les clés Bright Data disponibles
```

- [ ] **Step 5: Lancer toute la suite**

Run: `npx vitest run`
Expected: PASS, 1325 tests existants inchangés plus les nouveaux.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts server/services/memory/extract.ts
git commit -m "feat(lecture): les endpoints de la revue, et l'avis qui part en memoire de marque"
```

---

### Task 10 : le cron

**Files:**
- Modify: `server/index.ts` (nouvelle fonction près de `scheduleWeeklyIntelligence`, ligne 65 ; appel près de la ligne 129)

**Interfaces:**
- Consumes: `runReadingRoom` (Task 8) ; `storage.getActiveUserIds()` (déjà utilisé par `scheduleWeeklyIntelligence`).
- Produces: `scheduleReadingRoom()`.

- [ ] **Step 1: Écrire la fonction**

Dans `server/index.ts`, après `scheduleWeeklyIntelligence` :

```typescript
// La revue du matin : 05:00 UTC, soit 07:00 à Paris — avant l'auto-planner de 06:00,
// pour qu'elle soit prête au réveil. Même motif que les autres jobs : un setInterval
// horaire qui teste l'heure UTC, et un try/catch par utilisateur.
function scheduleReadingRoom() {
  const TARGET_HOUR = 5;

  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR) return;

    console.log('[Lecture] Début de la revue du matin');
    const userIds = await storage.getActiveUserIds().catch(() => [] as string[]);
    for (const userId of userIds) {
      try {
        const { fichesEcrites } = await runReadingRoom(userId, new Date());
        console.log(`[Lecture] ${userId} : ${fichesEcrites} fiche(s)`);
      } catch (err: any) {
        console.error(`[Lecture] revue échouée pour ${userId}:`, err?.message);
      }
    }
    console.log('[Lecture] Fin de la revue du matin');
  }, 60 * 60 * 1000); // vérification chaque heure
}
```

Import en tête du fichier :

```typescript
import { runReadingRoom } from "./services/reading/runner";
```

Et l'appel, à côté de `scheduleWeeklyIntelligence();` (ligne 129) :

```typescript
  scheduleReadingRoom();
```

- [ ] **Step 2: Vérifier le démarrage**

Run: `npm run build && npm run dev`
Expected: le serveur démarre sans erreur. Aucun journal `[Lecture]` n'apparaît hors de la fenêtre 05:00 UTC — c'est le comportement attendu.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(lecture): le cron de 05h00 UTC, avant l'auto-planner"
```

---

### Task 11 : la revue dans le contexte de Naya

**Files:**
- Modify: `server/services/naya-context.ts` (nouvelle section après la Section 7, avant la section de langue, vers la ligne 203)

**Interfaces:**
- Consumes: `readingCards` (`@shared/schema`), `db`.
- Produces: rien de nouveau à l'extérieur — `buildNayaContext` gagne une section. C'est ce qui permet au compagnon, aux recommandations et à la génération de contenu de tenir compte de l'actualité sans branchement supplémentaire.

- [ ] **Step 1: Ajouter la section**

Dans `server/services/naya-context.ts`, juste avant `// Section finale : langue de génération` :

```typescript
    // Section 8 : la revue du jour (l'espace de lecture). Les fiches d'aujourd'hui,
    // pour que Naya puisse s'appuyer sur l'actualité du marché quand elle parle de la
    // semaine ou du contenu — SANS jamais en faire une tâche. Best-effort : si la
    // lecture échoue, le contexte se passe de cette section.
    try {
      const debutDuJour = new Date();
      debutDuJour.setUTCHours(0, 0, 0, 0);
      const fiches = await db
        .select()
        .from(readingCards)
        .where(and(
          eq(readingCards.userId, userId),
          inArray(readingCards.status, ['proposed', 'answered']),
          gte(readingCards.createdAt, debutDuJour),
          ...(projectId ? [eq(readingCards.projectId, projectId)] : []),
        ))
        .orderBy(desc(readingCards.relevanceScore));

      if (fiches.length > 0) {
        const bloc = fiches
          .map((f) => {
            const avis = f.userAnswer ? `\n  Son avis : ${f.userAnswer}` : "";
            return `- ${f.title} (${f.source ?? "source inconnue"})\n  Le fait : ${f.factSummary}\n  Angle possible : ${f.angle}${avis}`;
          })
          .join('\n');
        sections.push(
          `## La revue du jour — actualité de ses marchés\n${bloc}\n\n` +
          `Tu peux t'appuyer là-dessus si elle parle de contenu, de sa semaine ou de sa stratégie. ` +
          `Tu n'en fais jamais une tâche et tu ne lui reproches jamais de ne pas y avoir réagi.`,
        );
      }
    } catch (err: any) {
      console.error('[Lecture] section contexte échouée:', err?.message);
    }
```

Vérifier les imports en tête de `naya-context.ts` : `db`, `and`, `eq`, `gte`, `inArray`, `desc`, `readingCards`.

- [ ] **Step 2: Vérifier**

Run: `npm run build && npx vitest run`
Expected: build vert, tous les tests verts.

- [ ] **Step 3: Vérifier à la main que la section apparaît**

Après avoir exécuté `POST /api/reading/run` et obtenu au moins une fiche, poser une question au compagnon qui touche au contenu (« qu'est-ce que je pourrais publier cette semaine ? ») et vérifier dans les journaux serveur que le contexte contient « La revue du jour ». Si aucune fiche n'existe, la section doit être **absente** — pas vide.

- [ ] **Step 4: Commit**

```bash
git add server/services/naya-context.ts
git commit -m "feat(lecture): la revue du jour entre dans le contexte de Naya"
```

---

### Task 12 : la section « Ce matin » dans le Reading Hub

**Files:**
- Create: `client/src/components/reading/revue-du-matin.tsx`
- Modify: `client/src/pages/reading-hub.tsx` (insertion du composant en tête du contenu, après le `<h1>` ligne 183)

Le composant est un fichier à part : `reading-hub.tsx` fait déjà 498 lignes et la revue a son propre cycle de vie. Le reste de la page est strictement inchangé.

**Interfaces:**
- Consumes: `GET /api/reading/today`, `POST /api/reading/cards/:id/answer|keep|skip|to-content` (Task 9) ; type `ReadingCard` de `@shared/schema` (Task 2).
- Produces: `<RevueDuMatin />`, composant sans props.

- [ ] **Step 1: Écrire le composant**

Créer `client/src/components/reading/revue-du-matin.tsx` :

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetchJson';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { ReadingCard } from '@shared/schema';

interface Projet { id: number; name: string; color?: string | null }

// La revue du matin. Zéro à trois fiches. Aucun compteur, aucune série, aucune relance :
// une fiche non traitée disparaît le soir et personne n'en reparle.
export function RevueDuMatin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reponses, setReponses] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<{ cards: ReadingCard[] }>({
    queryKey: ['/api/reading/today'],
    queryFn: () => fetchJson('/api/reading/today'),
  });
  const { data: projets } = useQuery<Projet[]>({
    queryKey: ['/api/projects'],
    queryFn: () => fetchJson('/api/projects'),
  });

  const invalider = () => qc.invalidateQueries({ queryKey: ['/api/reading/today'] });

  const repondre = useMutation({
    mutationFn: ({ id, answer }: { id: number; answer: string }) =>
      fetchJson(`/api/reading/cards/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      }),
    onSuccess: invalider,
  });

  const garder = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/reading/cards/${id}/keep`, { method: 'POST' }),
    onSuccess: invalider,
  });

  const passer = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/reading/cards/${id}/skip`, { method: 'POST' }),
    onSuccess: invalider,
  });

  const enFaireUnPost = useMutation({
    mutationFn: (id: number) => fetchJson<{ contentId: number }>(`/api/reading/cards/${id}/to-content`, { method: 'POST' }),
    onSuccess: () => {
      toast({ title: 'Brouillon créé', description: 'Il t\'attend dans le calendrier éditorial.' });
      invalider();
    },
  });

  if (isLoading) return null;

  const cards = data?.cards ?? [];
  const nomProjet = (id: number) => projets?.find((p) => p.id === id)?.name ?? '';

  // Matin vide : une phrase, et rien d'autre. Pas d'excuse, pas de bouton pour en chercher plus.
  if (cards.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Ce matin</h2>
        <p className="text-sm text-muted-foreground">Rien qui mérite ton avis ce matin.</p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Ce matin</h2>
      <div className="space-y-4">
        {cards.map((c) => (
          <Card key={c.id} data-testid={`reading-card-${c.id}`}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Badge variant="outline" className="text-[10px]">{nomProjet(c.projectId)}</Badge>
                  <a href={c.url} target="_blank" rel="noreferrer" className="block font-medium leading-tight hover:underline">
                    {c.title}
                  </a>
                  {c.source && <p className="text-xs text-muted-foreground">{c.source}</p>}
                </div>
              </div>

              <p className="text-sm">{c.factSummary}</p>
              <p className="text-sm text-muted-foreground">{c.whyThisBrand}</p>
              <p className="text-sm"><span className="text-muted-foreground">Angle : </span>{c.angle}</p>

              <p className="text-base font-medium pt-1">{c.question}</p>

              {c.userAnswer ? (
                <div className="space-y-3">
                  <p className="text-sm whitespace-pre-wrap rounded-md bg-muted p-3">{c.userAnswer}</p>
                  {/* Le brouillon n'existe qu'APRÈS la réponse, et il part de sa réponse. */}
                  <Button size="sm" onClick={() => enFaireUnPost.mutate(c.id)} disabled={enFaireUnPost.isPending}>
                    En faire un post
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={reponses[c.id] ?? ''}
                    onChange={(e) => setReponses((r) => ({ ...r, [c.id]: e.target.value }))}
                    placeholder="Ton avis…"
                    rows={3}
                    data-testid={`reading-answer-${c.id}`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!((reponses[c.id] ?? '').trim()) || repondre.isPending}
                      onClick={() => repondre.mutate({ id: c.id, answer: (reponses[c.id] ?? '').trim() })}
                    >
                      Répondre
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => garder.mutate(c.id)}>Garder</Button>
                    <Button size="sm" variant="ghost" onClick={() => passer.mutate(c.id)}>Passer</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Brancher dans la page**

Dans `client/src/pages/reading-hub.tsx`, importer et insérer juste après le bloc du `<h1>` (vers la ligne 183) :

```tsx
import { RevueDuMatin } from '@/components/reading/revue-du-matin';
```

```tsx
        <RevueDuMatin />
```

Ne rien changer d'autre sur cette page : les articles sauvegardés à la main, les filtres et les onglets restent tels quels.

- [ ] **Step 3: Rendre les requêtes de veille visibles et éditables**

C'est un critère d'acceptation du spec : sans cet écran, la veille est une boîte noire que Jeanne ne peut pas corriger quand elle part de travers.

Créer `client/src/components/reading/requetes-de-veille.tsx` :

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetchJson';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { ReadingQuery } from '@shared/schema';

interface Projet { id: number; name: string }

// Ce que Naya cherche, en clair, et corrigeable à la main. Une requête écrite ici
// (origin = manual) n'est jamais remplacée par la régénération hebdomadaire.
export function RequetesDeVeille() {
  const qc = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState<Record<number, string>>({});
  const [nouvelle, setNouvelle] = useState<Record<number, string>>({});

  const { data } = useQuery<{ queries: ReadingQuery[] }>({
    queryKey: ['/api/reading/queries'],
    queryFn: () => fetchJson('/api/reading/queries'),
    enabled: ouvert,
  });
  const { data: projets } = useQuery<Projet[]>({
    queryKey: ['/api/projects'],
    queryFn: () => fetchJson('/api/projects'),
    enabled: ouvert,
  });

  const invalider = () => qc.invalidateQueries({ queryKey: ['/api/reading/queries'] });

  const modifier = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { query?: string; isActive?: boolean } }) =>
      fetchJson(`/api/reading/queries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: invalider,
  });

  const ajouter = useMutation({
    mutationFn: ({ projectId, query }: { projectId: number; query: string }) =>
      fetchJson('/api/reading/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, query }),
      }),
    onSuccess: invalider,
  });

  if (!ouvert) {
    return (
      <button
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        onClick={() => setOuvert(true)}
        data-testid="ouvrir-requetes-veille"
      >
        Ce que Naya surveille
      </button>
    );
  }

  const queries = data?.queries ?? [];

  return (
    <div className="mt-4 space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Ce que Naya surveille</h3>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOuvert(false)}>
          Fermer
        </button>
      </div>

      {(projets ?? []).map((p) => (
        <div key={p.id} className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.name}</p>
          {queries.filter((q) => q.projectId === p.id).map((q) => (
            <div key={q.id} className="flex items-center gap-2">
              <Input
                className="h-8 text-sm"
                value={brouillon[q.id] ?? q.query}
                onChange={(e) => setBrouillon((b) => ({ ...b, [q.id]: e.target.value }))}
                onBlur={() => {
                  const v = (brouillon[q.id] ?? q.query).trim();
                  if (v && v !== q.query) modifier.mutate({ id: q.id, patch: { query: v } });
                }}
                data-testid={`requete-${q.id}`}
              />
              <Switch
                checked={q.isActive}
                onCheckedChange={(v) => modifier.mutate({ id: q.id, patch: { isActive: v } })}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              className="h-8 text-sm"
              placeholder="Ajouter une recherche…"
              value={nouvelle[p.id] ?? ''}
              onChange={(e) => setNouvelle((n) => ({ ...n, [p.id]: e.target.value }))}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!((nouvelle[p.id] ?? '').trim())}
              onClick={() => {
                ajouter.mutate({ projectId: p.id, query: (nouvelle[p.id] ?? '').trim() });
                setNouvelle((n) => ({ ...n, [p.id]: '' }));
              }}
            >
              Ajouter
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Puis, dans `revue-du-matin.tsx`, rendre `<RequetesDeVeille />` en fin de section — **dans les deux cas, revue pleine et revue vide** : c'est justement les matins vides qu'on veut pouvoir aller corriger ce que Naya cherche.

- [ ] **Step 4: Vérifier la compilation et le cliquet i18n**

Run: `npm run build && npx vitest run client/src/locales/jsx-guard.test.ts`
Expected: build vert. **Le cliquet i18n va signaler les textes en dur du nouveau composant** : ajouter la ligne `"client/src/components/reading/revue-du-matin.tsx": <n>` dans `client/src/locales/jsx-baseline.json` avec le nombre exact que le test annonce. C'est le fonctionnement prévu du cliquet, pas un contournement.

- [ ] **Step 5: Vérifier à l'écran**

`npm run dev`, aller sur le Reading Hub :
- sans fiche → « Rien qui mérite ton avis ce matin. », et rien d'autre ;
- avec des fiches (après `POST /api/reading/run`) → la question est visible sans clic, le champ de réponse est ouvert, et **le bouton « En faire un post » n'apparaît pas** tant qu'on n'a pas répondu.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/reading/ client/src/pages/reading-hub.tsx client/src/locales/jsx-baseline.json
git commit -m "feat(lecture): la section « Ce matin » en tete du Reading Hub"
```

---

### Task 13 : la ligne d'appel sur le dashboard

**Files:**
- Modify: `client/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/reading/today` (Task 9).
- Produces: rien de réutilisable — un composant local au fichier.

- [ ] **Step 1: Ajouter le composant**

Dans `client/src/pages/dashboard.tsx`, au niveau des autres composants locaux du fichier :

```tsx
// Le déclencheur du matin. Rien ne s'affiche les jours vides : un déclencheur qui parle
// quand il n'a rien à dire devient du bruit, et un « 0 » serait un compteur de retard.
function AppelRevue() {
  const { data } = useQuery<{ cards: Array<{ id: number }> }>({
    queryKey: ['/api/reading/today'],
    queryFn: () => fetchJson('/api/reading/today'),
  });
  const n = data?.cards?.length ?? 0;
  if (n === 0) return null;

  return (
    <Link href="/reading-hub">
      <button
        className="w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
        data-testid="appel-revue"
      >
        {n === 1 ? 'Une chose à lire sur ton marché' : `${n} choses à lire sur ton marché`}
      </button>
    </Link>
  );
}
```

Vérifier que `useQuery`, `fetchJson` et `Link` (wouter) sont déjà importés dans le fichier ; ajouter ce qui manque.

- [ ] **Step 2: Placer la ligne**

Insérer `<AppelRevue />` en tête de la colonne principale du dashboard, avant la première `<Card>`, pour qu'elle soit visible sans défilement.

- [ ] **Step 3: Vérifier**

Run: `npm run build && npx vitest run client/src/locales/jsx-guard.test.ts`
Expected: build vert ; mettre à jour `jsx-baseline.json` pour `dashboard.tsx` si le test annonce un nouveau nombre.

À l'écran : sans fiche, **aucune trace** de la revue sur le dashboard. Avec deux fiches, la ligne apparaît et mène au Reading Hub.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/dashboard.tsx client/src/locales/jsx-baseline.json
git commit -m "feat(lecture): la ligne d'appel du dashboard, absente les matins vides"
```

---

### Task 14 : la vérification de bout en bout

**Files:** aucun fichier créé. Cette tâche produit un constat, et corrige ce qu'elle trouve.

- [ ] **Step 1: La suite complète**

Run: `npx vitest run && npm run build`
Expected: tous les tests verts (1325 existants + les nouveaux), build vert.

- [ ] **Step 2: Reprendre les critères d'acceptation du spec un par un**

Ouvrir `docs/superpowers/specs/2026-09-29-naya-espace-lecture-design.md`, section « Critères d'acceptation », et cocher chaque ligne en nommant **le test ou la vérification manuelle** qui la prouve. Pour toute ligne sans preuve, écrire le test manquant avant de continuer.

- [ ] **Step 3: Les trois vérifications que les tests ne couvrent pas**

1. **Aucun compteur nulle part.** `grep -rniE "depuis [0-9]+ jour|série|streak|taux de traitement|en retard" client/src/components/reading client/src/pages/reading-hub.tsx` → aucun résultat.
2. **Aucune tâche de planning créée.** `grep -rn "tasks" server/services/reading/` → aucun résultat.
3. **Aucune écriture dans le fil `savoir`.** `grep -rn "savoir" server/services/reading/ server/routes.ts | grep -i reading` → aucun résultat.

- [ ] **Step 4: Un jour complet, à la main**

Avec les clés Bright Data en place, sur la base de dev :

```bash
curl -X POST http://localhost:5000/api/reading/run -b "<cookie de session>"
```

Vérifier : entre 0 et 3 fiches, jamais plus de 2 pour un même projet, chaque fiche porte une question qui ne serait pas posable à quelqu'un d'autre. Puis relancer immédiatement la même commande : **aucune fiche en double** — les URLs sont déjà vues.

- [ ] **Step 5: Le lendemain**

Vérifier que les fiches de la veille laissées sans réponse sont passées en `expired`, qu'elles n'apparaissent plus à l'écran, que le dashboard est muet s'il n'y a rien, et qu'aucune notification ni aucun rappel n'a été produit.

```sql
SELECT status, count(*) FROM reading_cards GROUP BY status;
```

- [ ] **Step 6: Commit du journal de vérification**

```bash
git add -A
git commit -m "test(lecture): la verification de bout en bout de la revue du matin"
```

---

## Ce que ce plan ne fait pas

Rappel, pour qu'aucune tâche ne dérive :

- Aucune tâche de planning, aucun rappel, aucune notification, aucun email.
- Aucune veille sur des comptes sociaux nommés.
- Aucune écriture automatique dans le fil `savoir`.
- Aucune refonte du Reading Hub existant ni de `article-analysis.ts`.
- Aucun affichage dans le calendrier éditorial (`content-calendar.tsx` n'est pas touché).
- Aucune application de migration en production : c'est une décision manuelle, prise séparément, sauvegarde Neon faite.
