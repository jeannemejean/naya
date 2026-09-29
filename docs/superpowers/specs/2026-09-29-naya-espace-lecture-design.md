# L'espace de lecture — la revue du matin

Date : 2026-09-29
Statut : spec validée, plan à écrire
Remplace le brief `BRIEF-ESPACE-DE-LECTURE.md` du 31 août 2026, dont il reprend l'essentiel et dont il s'écarte sur quatre points listés en « Décisions ».

## Le problème

Jeanne sait réagir à l'actualité de ses marchés et sait donner son avis. Ce qu'elle n'a pas, c'est le temps et le déclencheur pour **trouver** les contenus auxquels réagir. Réagir à l'actualité est structurant dans la construction d'une marque personnelle, et c'est aujourd'hui l'action qui ne se fait pas.

La fonctionnalité ne produit donc pas de la lecture. Elle produit **un déclencheur quotidien, court, par marque, qui appelle un avis** — et elle rend cet avis disponible au reste de Naya, pour que le contenu et la stratégie se calent sur ce qui se passe réellement sur le marché.

Ce qui la ferait échouer, dans l'ordre : trop de fiches, des fiches sans intérêt, un backlog qui s'accumule, un compteur de retard. Chacun de ces points est traité dans « Garde-fous ».

## Périmètre

Dans le périmètre :

- Une veille quotidienne par projet actif, sur la verticale actualités, bornée à 7 jours.
- Un tri en deux étages dont le premier est pur et testé, le second comparatif par marque.
- Zéro à trois fiches par matin, chacune posant une question à laquelle seule l'utilisatrice peut répondre.
- La réponse devient de la mémoire de marque (fil `cap`) et peut devenir un brouillon de post.
- Les fiches du jour entrent dans `buildNayaContext` : tout ce qui consomme le contexte en hérite.
- Deux surfaces : une section « Ce matin » en tête du Reading Hub, une ligne d'appel sur le dashboard.
- La dette `saved_articles` sans `projectId`, corrigée au passage.

Hors périmètre, explicitement :

- Toute tâche de planning issue de l'actualité — voir « Décision 2 ».
- La veille sur des comptes sociaux nommés (LinkedIn/Instagram) : la recherche thématique passe d'abord.
- Toute alimentation automatique du fil `savoir` — voir « Décision 3 ».
- Toute refonte du Reading Hub existant ou de `article-analysis.ts`.
- Toute notification, tout email, tout push.
- Le calendrier éditorial comme surface d'affichage : `content-calendar.tsx` fait 1812 lignes, il attend un lot séparé si le besoin se confirme.

## État constaté

Relevé sur le dépôt le 2026-09-29, branche `main` à `db0d257`.

| Constat | Valeur |
|---|---|
| `readingQueries` / `readingCards` | absents du schéma — rien n'est implémenté |
| Fils de mémoire disponibles | `cap`, `founder`, `reception`, `savoir` (`server/services/memory/retrieve.ts:5`) |
| Demi-vie du fil `savoir` | 365 jours, top-K 3 (`retrieve.ts:14,20`) — arrivé le 22 septembre, postérieur au brief |
| Sourcing SERP | `serpSearch(query, userId)` (`server/services/serp.ts:21`), requête `google.com/search`, lit `body.organic` |
| Coût SERP | `SERP_COST_EUR` ≈ 0,0014 € la requête (`server/services/usage.ts:28`) — non contraignant |
| Scraping | `scrapeAsMarkdown(url, maxChars = 4000)` (`server/services/brightdata-enrich.ts:127`), garde `webScrapeConfigured()` (`:26`) |
| Motif de cron à reprendre | `scheduleWeeklyIntelligence()` (`server/index.ts:65`) : `setInterval` horaire, test de l'heure UTC, `try/catch` par utilisateur et par étape |
| Point d'injection du contexte | `buildNayaContext`, sectionné, la Section 7 injecte la mémoire par fil (`server/services/naya-context.ts:183`) |
| Écriture en mémoire | `extractToMemory({ userId, subjectProjectId, sourceText, sourceType })` (`server/services/memory/extract.ts:171`) ; `sourceType` vaut `capture | companion | feedback`, non persisté en base |
| Rédaction contextualisée | `callClaudeWithContext({ userId, projectId, userMessage, … })` (`server/services/claude.ts:31`) |
| Page cible | `client/src/pages/reading-hub.tsx`, 498 lignes, modèle « colle une URL » |
| Dette multi-marques | `saved_articles` n'a pas de `projectId` — seule table dans ce cas |
| Natures de projet | `projectKind` = `personal | client` ; `projectStatus` = `active | paused | incubating` (`shared/schema.ts`) |

## Décisions

Quatre arbitrages tranchés le 29 septembre, dont trois s'écartent du brief du 31 août.

**1. Le tri est comparatif, par marque, sur `smart`.** Le brief prévoyait un appel `fast` (Haiku) par candidat, jugeant chaque article dans l'absolu. Avec 40 à 60 survivants de l'étage 1 par jour, ce réglage produit soit trois fiches médiocres, soit zéro fiche en permanence : un modèle rapide calibre mal un seuil absolu, et un jugement aveugle aux autres candidats ne sait pas distinguer « le meilleur d'aujourd'hui » de « bon dans l'absolu ». On fait donc **un seul appel `smart` par projet**, qui reçoit l'ADN, le fil `cap` et toute la liste, et note les candidats les uns contre les autres. Un appel par projet actif et par jour, coût négligeable, et le modèle voit le champ entier.

**2. La revue nourrit le contexte et une suggestion visible — jamais une tâche.** Le §7 du brief interdisait toute tâche de planning issue de l'actualité, pour ne pas rendre à la culpabilité ce que les garde-fous lui retirent. Cette règle est maintenue. Mais la revue doit peser sur la journée : les fiches du jour entrent dans `buildNayaContext`, donc Naya s'appuie dessus spontanément quand elle parle de la semaine, du contenu ou de la stratégie. La suggestion est visible à deux endroits et deux seulement : la ligne d'appel du dashboard, et la fiche elle-même dans le Reading Hub avec son bouton « en faire un post ». Elle disparaît le soir avec la fiche. Aucune ligne dans le planning, aucun retard possible, aucun cumul.

**3. Le fil `savoir` et la revue ne se mélangent pas.** Le fil `savoir`, c'est le fond : les dossiers de recherche déposés délibérément, qui rendent Naya différente dans sa façon de construire une stratégie digitale à 360°. La revue du matin, c'est l'actualité de surface. « Garder » une fiche ne verse donc rien dans `savoir` : la fiche survit à l'expiration et reste dans le Reading Hub, point. En revanche la **réponse** de l'utilisatrice part dans le fil `cap` avec le `projectId` de la fiche — c'est de l'avis de fondatrice sur son marché, exactement ce que `cap` capte, et la marque est connue, donc aucune question de marque n'est posée.

**4. On cherche dans la verticale actualités, fenêtre 7 jours.** Le brief réutilisait `serpSearch` tel quel, c'est-à-dire une recherche web où le contenu evergreen et le SEO dominent et où la fraîcheur devrait être devinée dans des pages sans date. On étend `serpSearch` d'un troisième paramètre optionnel — `{ vertical: 'news', freshness: 'week' }` → `tbm=nws&tbs=qdr:w` — générique, sans toucher aux appels de la prospection. La date vient de Google, l'étage 1 devient fiable.

Périmètre et plafond, confirmés sans changement : **tous les projets `projectStatus = 'active'`**, personnels comme clients ; **3 fiches par matin au total, 2 au maximum pour un même projet**.

## Schéma

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

L'index unique `(userId, urlHash)` porte toute la règle « jamais reproposé » : une URL déjà proposée, même expirée ou rejetée, ne revient pas. Les lignes expirées **restent en base** — c'est ce qui rend la règle vraie. Une fiche ne se supprime jamais, elle change de statut.

Cycle de vie : `proposed` → `answered` (réponse écrite) → `kept` (conservation volontaire) ; sinon `expired` le soir même, en silence. « Passer » écrit `rejected` sans rien demander.

Au passage : `projectId` (nullable) sur `saved_articles`, la dette de l'état constaté.

## Le pipeline

```
server/services/reading/
├── queries.ts     ← génération et persistance des requêtes de veille par projet
├── source.ts      ← exécution SERP actualités + canonicalisation d'URL + hachage
├── triage.ts      ← LE TRI (deux étages) — l'étage 1 est pur et testé isolément
├── card.ts        ← lecture de l'article + rédaction de la fiche
├── runner.ts      ← runReadingRoom(userId, today) : orchestration, plafonds, best-effort
└── reading.test.ts
```

### queries.ts — les requêtes de veille

Pour chaque projet actif, 3 à 6 requêtes composées sur `smart` à partir de l'ADN de marque du projet, des entrées du fil `cap`, du secteur et du `statusNote`. Persistées dans `reading_queries`, **régénérées au maximum une fois par semaine** : des requêtes stables donnent une veille stable, et elles doivent pouvoir être corrigées à la main. Les requêtes visent l'actualité, pas la documentation — formulations datées et sectorielles plutôt que termes génériques de l'ADN.

### source.ts — le sourcing

`serpSearch` gagne un troisième paramètre optionnel décrit en Décision 4. Pour chaque requête active : exécution, puis canonicalisation de l'URL (retrait des paramètres de suivi) et hachage. Le service reste générique : aucune spécialisation « lecture » dans `serp.ts`.

### triage.ts — la pièce critique

**Étage 1 — déterministe, pur, sans modèle, testé :**

- fraîcheur : rien de plus vieux que 7 jours, la date venant de la verticale actualités ;
- `urlHash` déjà présent en base → écarté sans appel modèle ;
- domaines exclus (agrégateurs, sites de contenu automatique) — liste en constante, commentée ;
- canonicalisation d'URL avant hachage ;
- dédoublonnage par titre normalisé, pas seulement par URL.

**Étage 2 — un appel `smart` par projet.** Le modèle reçoit l'ADN de marque, le fil `cap` et **toute la liste des survivants** du projet. Il ne juge pas si l'article est bon : il juge une seule chose — **« cette personne, avec cette marque, a-t-elle quelque chose de non-évident à en dire ? »** — et note les candidats les uns contre les autres. Sortie : `{ url, score 0-1, rationale }` par candidat.

- Seuil de rétention **strict : 0,7**. En dessous, on jette.
- **Le nombre de fiches retenues est ce qui reste après le seuil — jamais un quota à remplir.**
- Tri final par score décroissant, plafonné à 3, avec au plus 2 fiches pour un même projet.

### card.ts — la fiche

Pour les retenus seulement, afin de ne pas scraper le bruit :

1. `scrapeAsMarkdown(url)` pour lire le contenu réel. **Si le scrape échoue, aucune fiche n'est écrite** : juger un titre produit des fiches creuses.
2. Rédaction sur `smart` via `callClaudeWithContext` avec le `projectId` de la marque, ce qui injecte la voix Naya et le contexte de marque :
   - **le fait** : 2 à 3 lignes, ce qui s'est passé, sans emphase ;
   - **pourquoi cette marque** : le lien explicite avec le positionnement, appuyé sur le fil `cap` ;
   - **l'angle** : une prise possible — un terrain, pas une opinion ;
   - **la question** : une seule, précise, ouverte, appelant un avis que seule l'utilisatrice peut donner. C'est le champ le plus important ; une question générique (« qu'en penses-tu ? ») est un échec.

### runner.ts et le cron

`runReadingRoom(userId, today)` : projets actifs → requêtes → sourcing → tri → fiches → écriture. `try/catch` par utilisateur et par étape, plafond dur de requêtes SERP par jour, garde-fou de dépense de `usage.ts` — s'il est atteint, la revue s'arrête proprement. Clé Bright Data absente (`webScrapeConfigured()` / `serpConfigured()` à faux) → la revue ne tourne pas et ne réveille aucune erreur visible.

Cron **05:00 UTC** (07:00 Paris), avant l'auto-planner de 06:00, sur le motif de `scheduleWeeklyIntelligence` (`setInterval` horaire, test de l'heure UTC). Au même passage, toutes les fiches `proposed` de la veille passent en `expired`, **silencieusement**.

Endpoint `POST /api/reading/run` pour déclencher à la demande (développement et rattrapage).

## L'insertion dans Naya

**Le contexte.** Une Section 8 dans `buildNayaContext`, à côté de la Section 7 : « la revue du jour ». Elle injecte les fiches du jour du projet concerné — le fait, l'angle, et l'avis de l'utilisatrice s'il est écrit. Un seul point de branchement : le compagnon, les recommandations contextuelles et la génération de contenu en héritent d'un coup. C'est ce qui permet à Naya de dire « il y a un angle LinkedIn à prendre sur ce qui vient de se passer sur ton marché » sans que ce soit écrit en dur nulle part.

**Le Reading Hub.** Une section « Ce matin » en tête de la page existante — pas une page de plus, le reste (articles sauvegardés à la main) inchangé. 0 à 3 fiches, chacune portant la pastille de sa marque : le fait, l'enjeu, l'angle, puis **la question en évidence** et un champ de réponse ouvert, pas replié derrière un clic. Actions : répondre · garder · passer. « Passer » ne demande aucune justification et n'affiche aucune conséquence. Matin vide : « Rien qui mérite ton avis ce matin. » Point — aucune excuse, aucun bouton pour en chercher plus.

Le bouton **« fais-moi un brouillon » n'existe pas tant que `userAnswer` est vide**. Le brouillon part de la réponse de l'utilisatrice, jamais de la fiche seule : ce qu'elle publie reste sa voix. « En faire un post » crée une ligne `content` liée au projet, brouillon en `body`.

La réponse est envoyée à `extractToMemory` avec `subjectProjectId` = la marque de la fiche. `sourceType` gagne la valeur `"reading"` — modification d'une union TypeScript, sans migration, la valeur n'étant pas persistée.

**Le dashboard.** Une ligne sobre quand il y a quelque chose — « 2 choses à lire sur ton marché » — qui mène au Reading Hub. Rien du tout les matins vides : ni carte vide, ni « 0 ». Un déclencheur qui s'affiche quand il n'a rien à dire devient du bruit.

## Garde-fous

- **Trois fiches par jour maximum, tous projets confondus**, deux au plus pour un même projet. Le plafond est une constante, pas un réglage utilisateur.
- **Zéro fiche est une sortie normale et valide.** Si rien ne passe le seuil, la revue est vide et le dit sereinement. Interdit de compléter avec le moins mauvais pour atteindre trois : une mauvaise fiche coûte plus cher que pas de fiche.
- **Les fiches non traitées expirent en silence le soir.** Aucun report, aucun cumul, aucune pile. Seule une action volontaire (« garder ») conserve une fiche.
- **Aucun compteur, aucune série, aucun badge, aucune relance, aucun taux de traitement.** Jamais de « tu n'as pas réagi depuis X jours ». C'est le garde-fou explicite d'`ARCHI-TRIANGULATION-MOTEUR.md` : la voix Naya ne culpabilise pas.
- **Naya n'écrit pas l'avis.** Elle donne le fait, l'enjeu, un angle et une question. Le brouillon n'existe qu'après la réponse.
- **Best-effort de bout en bout.** Une source qui échoue, un scrape qui rate, un modèle qui répond mal : la revue se dégrade, elle ne casse rien.
- **Coût borné.** Seuls les projets actifs sont veillés, plafond dur de requêtes SERP par jour, garde-fou de dépense de `usage.ts`.

> Le réflexe à combattre pendant l'implémentation : « il n'y a qu'une fiche aujourd'hui, baissons le seuil ». Non. Une revue vide est un bon jour de veille où il ne s'est rien passé. C'est le seul moyen que les fiches restent crédibles.

## Critères d'acceptation

- [ ] `npm run build` et `npx vitest run` verts, les 1325 tests existants inchangés.
- [ ] Migration générée, relue à la main, appliquée sur dev.
- [ ] L'étage 1 du tri est **pur** et testé : fraîcheur, doublon d'URL, doublon de titre, canonicalisation, domaine exclu.
- [ ] Quand aucun candidat ne passe le seuil, la revue rend **zéro fiche** — et rien dans le code ne peut abaisser le seuil pour en produire.
- [ ] Plafond de 3 fiches, maximum 2 par projet.
- [ ] Une URL déjà proposée un jour précédent, même expirée, n'est **jamais** reproposée.
- [ ] Un scrape en échec ne produit pas de fiche.
- [ ] Les fiches `proposed` de la veille passent en `expired` sans notification ni report.
- [ ] Aucun compteur, aucune série, aucune relance nulle part dans l'interface.
- [ ] Le bouton « brouillon » n'existe pas tant que `userAnswer` est vide.
- [ ] Une réponse crée une entrée mémoire sur le bon projet dans le fil `cap` ; un échec d'extraction ne casse rien.
- [ ] Les fiches du jour apparaissent dans `buildNayaContext` ; les expirées non.
- [ ] Clé Bright Data absente → la revue ne tourne pas et ne réveille aucune erreur visible.
- [ ] Les requêtes de veille sont visibles et éditables par l'utilisateur.
- [ ] Le dashboard n'affiche rien les matins vides.

## Risques et inconnues

**La forme de la réponse « actualités » de Bright Data.** Le parseur actuel lit `body.organic` (`serp.ts:39`) ; la verticale `tbm=nws` en `parsed_light` renvoie vraisemblablement une autre clé. **À vérifier contre l'API réelle en tout premier dans l'implémentation.** Si la forme ne convient pas, le repli est la recherche web classique, sans rien changer d'autre à la conception — le reste du pipeline ne dépend pas de la verticale.

**La qualité de la question.** C'est le champ qui décide de l'usage réel, et aucun test automatique ne peut le juger. Il faut une semaine de vraies fiches avant de figer le prompt de `card.ts`.

**Le seuil de 0,7.** Valeur de départ, avec un tri comparatif dont la calibration diffère de celle d'un jugement absolu. Il se règle après observation, jamais pour remplir une revue vide.

## Migration

Procédure de `MIGRATIONS.md` : `drizzle-kit generate`, relecture du SQL à la main, `migrate` sur dev. Jamais de `db:push`. L'application en production est une étape manuelle et décidée, sauvegarde Neon avant, sortie sous les yeux.
