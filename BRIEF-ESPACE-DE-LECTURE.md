# BRIEF — L'espace de lecture : la revue du matin

> À exécuter par Claude Code **dans le repo NayaVision-29**.
> Lis ce fichier en entier avant de commencer. Les garde-fous du §2 ne sont pas des préférences : ce sont les conditions pour que la fonctionnalité soit utilisée plutôt qu'évitée.

---

## 0. Le problème réel

Jeanne sait réagir à l'actualité de ses marchés et sait donner son avis. Ce qu'elle n'a pas, c'est le temps et le déclencheur pour **trouver** les contenus auxquels réagir. Réagir à l'actualité est structurant dans la construction d'une marque personnelle, et c'est aujourd'hui l'action qui ne se fait pas.

La fonctionnalité ne produit donc pas de la lecture. Elle produit **un déclencheur quotidien, court, par marque, qui appelle un avis.**

Ce qui la ferait échouer, dans l'ordre : trop de fiches, des fiches sans intérêt, un backlog qui s'accumule, un compteur de retard. Chacun de ces points est traité en §2.

---

## 1. Contexte — état réel du code (vérifié le 30 août 2026)

Ce qui existe et qui **ne fait pas** ce qu'on décrit :

- Page `client/src/pages/reading-hub.tsx` + table `saved_articles` + routes `/api/saved-articles`. Le modèle actuel suppose que l'article est **déjà trouvé** : l'utilisateur colle une URL, `articleAnalysisService.analyzeArticle()` l'analyse contre le `brand_dna` **global**.
- ⚠️ `saved_articles` n'a **pas** de `projectId` : c'est la seule partie de Naya qui ignore le multi-marques.
- Aucune source automatique, aucun job quotidien, aucune notion de post social.

Ce qui existe et sert de socle — **tout est déjà branché et payé, aucun nouveau fournisseur, aucune nouvelle permission** :

- `server/services/serp.ts` → `serpSearch(query, userId)` : requête Google via la SERP API Bright Data, résultats organiques parsés, coût déjà imputé via `recordSpend` / `SERP_COST_EUR`. Aujourd'hui utilisée uniquement par la prospection ; elle est **générique**, ne la spécialise pas davantage.
- `server/services/brightdata-enrich.ts` → `scrapeAsMarkdown(url, maxChars)` : Web Unlocker, n'importe quelle page → markdown tronqué. `webScrapeConfigured()` pour la garde.
- `server/services/article-analysis.ts` → `articleAnalysisService`. **Ne le réécris pas** ; on ne s'en sert pas ici (il juge un article dans l'absolu, pas contre une marque), mais on ne le casse pas non plus.
- Le cron : `server/index.ts` monte `scheduleAutoPlanner()` (06:00 UTC), `scheduleEndOfDayRollover()`, `scheduleWeeklyIntelligence()`. Le motif est un `setInterval` horaire qui teste l'heure UTC. **Reprends exactement ce motif**, avec un `try/catch` par utilisateur et par étape.
- Mémoire Phase 2 : `retrieveMemories()` (fil `cap` par marque) et `extractToMemory()`. Le fil `cap` est la meilleure source pour savoir ce qui compte pour une marque — meilleure que le `brand_dna` seul.
- `quick_capture` et la table `content` pour la suite du parcours.

---

## 2. Garde-fous (non négociables — c'est le cœur du brief)

- **Trois fiches par jour maximum, tous projets confondus.** Pas trois par projet. Le plafond est une constante, pas un réglage utilisateur.
- **Zéro fiche est une sortie normale et valide.** Si rien ne passe le seuil de pertinence, la revue du matin est vide et le dit sereinement. **Interdit de compléter avec le moins mauvais pour atteindre trois.** Une mauvaise fiche coûte plus cher que pas de fiche.
- **Les fiches non traitées expirent en silence à la fin de la journée.** Aucun report, aucun cumul, aucune pile. Une fiche ne peut être conservée que par une action volontaire (« garder »).
- **Aucun compteur, aucune série, aucun badge, aucune relance.** Jamais de « tu n'as pas réagi depuis X jours », jamais de taux de traitement. C'est le garde-fou explicite d'`ARCHI-TRIANGULATION-MOTEUR.md` : la voix Naya ne culpabilise pas.
- **Naya n'écrit pas l'avis.** Elle donne le fait, l'enjeu pour la marque, un angle possible et **une question**. Le brouillon n'existe qu'après la réponse (§4.3).
- **Best-effort de bout en bout.** Une source qui échoue, un scrape qui rate, un modèle qui répond mal : la revue se dégrade, elle ne casse rien et ne réveille aucune erreur visible.
- **Coût borné.** Seuls les projets `projectStatus = 'active'` sont veillés. Plafond dur de requêtes SERP par jour. Le garde-fou de dépense de `usage.ts` s'applique ; s'il est atteint, la revue s'arrête proprement.
- **Migrations** : `drizzle-kit generate` → relecture du SQL → `migrate`. Jamais de `db:push` en prod.

---

## 3. Schéma

```typescript
// Les requêtes de veille, PAR PROJET. Générées par l'IA, éditables par l'utilisateur.
export const readingQueries = pgTable("reading_queries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  origin: text("origin").notNull().default("ai"),   // ai | manual
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Une fiche de lecture. Sert AUSSI de mémoire des URLs déjà vues (index unique).
export const readingCards = pgTable("reading_cards", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  urlHash: text("url_hash").notNull(),        // hash de l'URL canonique — la clé d'unicité
  title: text("title").notNull(),
  source: text("source"),
  publishedAt: timestamp("published_at"),
  relevanceScore: doublePrecision("relevance_score"),
  relevanceRationale: text("relevance_rationale"),
  factSummary: text("fact_summary"),          // ce qui s'est passé
  whyThisBrand: text("why_this_brand"),       // pourquoi ça touche CETTE marque
  angle: text("angle"),                       // l'angle possible — jamais l'avis
  question: text("question"),                 // la question qui déclenche l'avis
  userAnswer: text("user_answer"),
  answeredAt: timestamp("answered_at"),
  status: text("status").notNull().default("proposed"), // proposed | answered | kept | expired | rejected
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  seenIdx: uniqueIndex("reading_card_seen_idx").on(t.userId, t.urlHash),
  dayIdx: index("reading_card_day_idx").on(t.userId, t.status, t.createdAt),
}));
```

> L'index unique `(userId, urlHash)` fait office de mémoire des vus : une URL déjà proposée, même expirée ou rejetée, **n'est jamais reproposée**. Les lignes expirées restent en base — c'est ce qui rend la règle vraie.

**Pendant qu'on y est, une ligne :** ajoute `projectId` (nullable) à `saved_articles`. C'est la dette relevée au §1 ; ça n'ajoute aucun travail et ça remet la sauvegarde manuelle dans le monde multi-marques.

---

## 4. Le pipeline

```
server/services/reading/
├── queries.ts     ← génération et persistance des requêtes de veille par projet
├── source.ts      ← exécution SERP + dédoublonnage + canonicalisation d'URL
├── triage.ts      ← LE TRI (deux étages) — la partie pure est testée isolément
├── card.ts        ← lecture de l'article + rédaction de la fiche
├── runner.ts      ← runReadingRoom(userId, today) : orchestration, plafonds, best-effort
└── reading.test.ts
```

### 4.1 Les requêtes de veille (`queries.ts`)

Pour chaque projet actif, Naya compose 3 à 6 requêtes à partir de l'ADN de marque, des entrées du fil `cap` en mémoire, du secteur et du `statusNote` du projet. Elles sont **persistées** dans `reading_queries` et **régénérées au maximum une fois par semaine** — pas à chaque exécution : des requêtes stables donnent une veille stable, et Jeanne doit pouvoir les corriger à la main.

Les requêtes visent l'actualité, pas la documentation : privilégie les formulations datées et sectorielles plutôt que les termes génériques de l'ADN.

### 4.2 Le tri (`triage.ts`) — la pièce critique

La veille par recherche thématique produit **beaucoup de bruit**. C'est ici que la fonctionnalité se gagne ou se perd.

**Étage 1 — déterministe, pur, sans modèle, testé :**
- fraîcheur : rien de plus vieux que 7 jours ;
- `urlHash` déjà présent en base → écarté sans appel modèle ;
- domaines exclus (agrégateurs, sites de contenu automatique) — liste en constante, commentée ;
- canonicalisation d'URL avant hachage (retirer les paramètres de suivi) ;
- dédoublonnage par titre normalisé, pas seulement par URL.

**Étage 2 — jugement modèle (`fast`, via le routeur Phase 1) :**
Le modèle ne juge **pas** si l'article est bon. Il juge une seule chose : **« cette personne, avec cette marque, a-t-elle quelque chose de non-évident à en dire ? »** Sortie : `{ score 0-1, rationale }`.

- Seuil de rétention **strict** (départ : 0.7). En dessous, on jette.
- **Le nombre de fiches retenues est ce qui reste après le seuil — jamais un quota à remplir.**
- Tri final par score décroissant, plafonné à 3, avec au plus 2 fiches pour une même marque (pour qu'une marque bavarde ne prenne pas toute la revue).

### 4.3 La fiche (`card.ts`)

Pour chaque contenu retenu — et seulement ceux-là, pour ne pas scraper le bruit :
1. `scrapeAsMarkdown(url)` pour lire le contenu réel. **Si le scrape échoue, on n'écrit pas de fiche à partir du seul titre** : on jette. Juger un titre produit des fiches creuses.
2. Rédaction sur le modèle `smart`, via `callClaudeWithContext` avec le `projectId` de la marque (la voix Naya et le contexte de marque sont ainsi injectés) :
   - **le fait** : 2 à 3 lignes, ce qui s'est passé, sans emphase ;
   - **pourquoi cette marque** : le lien explicite avec le positionnement, appuyé sur le fil `cap` ;
   - **l'angle** : une prise possible — un terrain, pas une opinion. Naya ne dit jamais ce qu'il faut penser ;
   - **la question** : une seule, précise, ouverte, qui appelle un avis que seule Jeanne peut donner. C'est le champ le plus important de la fiche ; une question générique (« qu'en penses-tu ? ») est un échec.

### 4.4 Le parcours après la réponse

- Jeanne répond dans le champ → `status = answered`, `userAnswer` enregistré.
- **C'est seulement là qu'apparaît « fais-moi un brouillon ».** Le brouillon part de **sa** réponse, jamais de la fiche seule : ce qu'elle publie reste sa voix, la génération ne fait que la mettre en forme.
- Un bouton « en faire un post » crée une ligne `content` liée au projet, avec le brouillon en `body`.
- La réponse est envoyée à `extractToMemory` avec `subjectProjectId` = la marque de la fiche (elle est **connue**, pas devinée : aucune question de marque à poser). C'est de l'avis de fondatrice sur son marché — exactement ce que le fil `cap` doit capter.

### 4.5 Le job (`runner.ts` + cron)

- `runReadingRoom(userId, today)` : projets actifs → requêtes → sourcing → tri → fiches → écriture.
- Cron **05:00 UTC** (07:00 Paris), avant l'auto-planner de 06:00, pour que la revue soit prête au réveil. Même motif que `scheduleWeeklyIntelligence` : `setInterval` horaire, test de l'heure UTC, `try/catch` par utilisateur.
- Au même passage : passer en `expired` toutes les fiches `proposed` de la veille. **Silencieusement.**
- Endpoint manuel `POST /api/reading/run` pour déclencher à la demande (développement et rattrapage).

---

## 5. L'écran

Une section « Ce matin » en tête du Reading Hub existant (ne crée pas une page de plus) :

- 0 à 3 fiches, chacune identifiée par sa marque (pastille du projet).
- Le fait, l'enjeu, l'angle, puis **la question en évidence** et un champ de réponse ouvert — pas replié derrière un clic.
- Actions : répondre · garder · passer. « Passer » ne demande pas de justification et n'affiche aucune conséquence.
- Vide : « Rien qui mérite ton avis ce matin. » Point. **Aucune excuse, aucun bouton pour en chercher plus.**
- Le reste du Reading Hub (articles sauvegardés à la main) est inchangé.

---

## 6. Critères d'acceptation

- [ ] `npm run build` et `npx vitest run` verts, tests existants inchangés.
- [ ] Migration générée, relue, appliquée sur dev.
- [ ] L'étage 1 du tri est **pur** et testé : fraîcheur, doublon d'URL, doublon de titre, canonicalisation, domaine exclu.
- [ ] Test : quand aucun candidat ne passe le seuil, la revue rend **zéro fiche** — et rien dans le code ne peut abaisser le seuil pour en produire.
- [ ] Test : plafond de 3 fiches, maximum 2 par marque.
- [ ] Une URL déjà proposée un jour précédent (même expirée) n'est **jamais** reproposée.
- [ ] Un scrape en échec ne produit pas de fiche.
- [ ] Les fiches `proposed` de la veille passent en `expired` sans notification ni report.
- [ ] Aucun compteur, aucune série, aucune relance nulle part dans l'interface.
- [ ] Le bouton « brouillon » n'existe pas tant que `userAnswer` est vide.
- [ ] Une réponse crée une entrée mémoire sur la bonne marque ; un échec d'extraction ne casse rien.
- [ ] Clé Bright Data absente → la revue ne tourne pas et ne réveille aucune erreur visible.
- [ ] Les requêtes de veille sont visibles et éditables par l'utilisateur.

---

## 7. Ce que ce brief NE demande PAS

- ❌ Pas de veille sur des comptes déclarés (LinkedIn/Instagram nominatifs) — c'est un second chantier, la recherche thématique passe d'abord.
- ❌ Pas de tâche créée dans le planning pour « réagir à l'actu » — ce serait rendre à la culpabilité ce que les garde-fous lui retirent.
- ❌ Pas de refonte du Reading Hub existant ni de `article-analysis.ts`.
- ❌ Pas de notification, pas d'email, pas de push.
- ❌ Rien de la Phase 3 (réception, arbitrage).

---

## 8. Definition of Done

Chaque matin, Naya a lu le marché de chaque marque active et pose entre zéro et trois questions auxquelles Jeanne est la seule à pouvoir répondre. Ce qu'elle ne traite pas disparaît sans laisser de dette. Ce qu'elle répond devient de la mémoire de marque, et peut devenir un post en un clic — avec ses mots.

> ⚠️ Le réflexe à combattre pendant l'implémentation : « il n'y a qu'une fiche aujourd'hui, baissons le seuil ». Non. Une revue vide est un bon jour de veille où il ne s'est rien passé. C'est le seul moyen que les fiches restent crédibles.
