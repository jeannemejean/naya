# BRIEF — Phase 3 : la réception réelle et le moteur d'arbitrage

> À exécuter par Claude Code **dans le repo NayaVision-29**, après les Phases 1 et 2 (en prod).
> Lis ce fichier en entier, puis `ARCHI-TRIANGULATION-MOTEUR.md` (§2 et §3), `SCHEMA-TRIANGULATION.md` (Blocs C, C bis, D.2) et `STRATEGIE-DONNEES-ET-POSITIONNEMENT.md` (§2 et §4) avant d'écrire une ligne.
> Cette phase se découpe en **trois lots livrables séparément**. Ne les fusionne pas en une seule branche.

---

## 0. Contexte — état réel du code (vérifié le 30 août 2026)

Ce qui existe déjà et sur quoi tu t'appuies :

- **Phase 1** — `server/services/ai/` : providers (anthropic, openai), `router.ts` (par `TaskKind`), `registry.ts`, `invocation-log.ts`. La table `ai_invocations` porte déjà `projectId`.
- **Phase 2** — `memory_entries` + pgvector (index HNSW, vecteurs 1536), `memory/extract.ts` (extraction en deux temps, `superseded_at`), `memory/retrieve.ts` (somme pondérée normalisée, demi-vies 180 / 45 / 10 j, K = 3 / 4 / 5), branchée dans `naya-context.ts` section 7, `memory/brand-resolve.ts` pour la marque-sujet.
- **Sentiment** — `server/services/sentiment-analysis.ts` expose `sentimentAnalysisService`. **Réutilise-le**, ne le réécris pas.
- **Migrations** — `drizzle-kit generate` → relecture du SQL → `migrate`. `db:push` est **interdit en prod**, autorisé sur dev-local.
- **Tests** — vitest, ~48 fichiers. La discipline du repo est : toute logique de décision est extraite dans une fonction **pure**, testée isolément.

Ce qui n'existe pas (vérifié par grep sur `shared/schema.ts`, `server/`, `client/`) :

- Aucune table de la Phase 3 : `content_reception`, `brand_conversions`, `conversion_attributions`, `competitors`, `competitor_reception`, `arbitration_log`.
- `content` n'a **pas** de champ `intent`. ⚠️ Ne confonds pas avec `content.goal`, qui existe déjà, est requis et libre : ce n'est **pas** l'intention au sens de la triangulation. Ajoute `intent`, ne recycle pas `goal`.
- `projects` n'a pas `attributionWindowDays`. `brand_dna` n'a ni `version` ni `supersededAt`.
- Aucun service d'arbitrage.

Pièges connus :

- `server/services/social-integrations.ts` expose `getInstagramAnalytics` / `getLinkedInAnalytics`. Ce sont des **agrégats de compte** bâtis sur `like_count` / `comments_count`, jamais persistés, jamais rattachés à un contenu. **C'est de la vanité au sens de la spec : ne les branche pas sur `content_reception`.** Laisse-les en place pour la page Analytics existante, et ignore-les.
- `META_COMPLIANCE.md` décrit l'ancien flux Facebook Login. Le code en prod utilise l'Instagram API with Instagram Login. **Le doc et le code ont divergé : fie-toi au code.**

### 0.1 Le blocage à connaître avant de concevoir

**Les « saves » ne sont récupérables sur aucun réseau connecté aujourd'hui.**

- Instagram : `server/services/social-oauth.ts:28` demande `instagram_business_basic` + `instagram_business_content_publish`. Les insights par média (`saved`, `reach`, `shares`) exigent `instagram_business_manage_insights`, non demandé — donc un tour d'App Review supplémentaire.
- TikTok : scopes `user.info.basic`, `video.publish`, `video.upload`. Aucune lecture de métriques.
- LinkedIn : `r_organization_social` donne des statistiques de page organisation ; rien d'équivalent aux saves sur les posts personnels.

**Conséquence d'architecture, non négociable : l'ingestion est un port, jamais un appel direct.** Le Fil 3 doit être entièrement construit, testé et **utilisable dès aujourd'hui** avec un adaptateur manuel (saisie + import CSV). Les adaptateurs réseau viendront plus tard derrière le même port, sans rien réécrire ailleurs. **Aucun lot de cette phase ne doit dépendre d'une permission Meta pour être mergé.**

---

## 1. Découpage — trois lots, trois branches

| Lot | Contenu | Dépend de |
|-----|---------|-----------|
| **3A — le roc** | Schéma de réception, `intent` sur les contenus, port d'ingestion + adaptateur manuel, score réception-contre-intention, tables concurrents (schéma seul) | — |
| **3B — l'attribution** | Conversions par marque, crédit multi-touch, fenêtre par marque | 3A |
| **3C — l'arbitrage** | Le moteur, la politique centralisée, le journal, le branchement | 3A (lit 3B s'il existe) |

Pour chaque lot : une branche, une **spec** puis un **plan** dans `docs/superpowers/`, exécution tâche par tâche, revue avant merge. C'est la méthode du repo — applique-la, n'improvise pas un autre process.

**Ne commence pas 3B ou 3C tant que 3A n'est pas mergé.**

---

## 2. Garde-fous transversaux (non négociables)

- **Best-effort partout.** Ni l'ingestion, ni le scoring, ni la journalisation d'arbitrage ne doivent bloquer ou faire échouer un appel IA ou une action utilisateur.
- **Jamais les likes.** On mesure saves, sentiment, conversion — et en **taux normalisés**, jamais en valeurs brutes. Si `reach` manque, on ne fabrique pas un taux : on renvoie `null`.
- **Jamais de last-touch.** Une conversion est créditée à la *fenêtre* de contenus qui l'a précédée, pondérée. Écris-le en commentaire dans le code de l'attribution, comme l'exige la spec.
- **Jamais de scoreboard.** Toute sortie destinée à l'utilisateur se formule comme un apprentissage, jamais comme une comparaison démoralisante. La voix Naya prime sur la métrique.
- **L'incertitude est un état légitime.** L'arbitre doit pouvoir répondre « je manque de donnée de réception sur cette marque » plutôt que d'inventer. Ce n'est pas un cas d'erreur, c'est une sortie valide.
- **Compatibilité ascendante de `buildNayaContext()`.** Tout nouveau paramètre est optionnel. Aucun site d'appel existant ne doit être modifié.
- **Coût maîtrisé.** Tout appel modèle passe par le routeur Phase 1 ; classification et extraction sur `fast`.
- **Vérifier aussi ce qui ne devrait PAS bouger.** Voir un chiffre changer ne prouve pas qu'un
  calcul est juste — seulement qu'il produit quelque chose. Toute vérification en direct doit
  inclure au moins un cas dont la valeur doit rester inchangée. (Leçon du lot 3B : un zéro
  fabriqué faisait bouger le score exactement comme un vrai signal.)
- **« Non mesuré » n'est jamais « mesuré à zéro ».** Aucun `|| 0`, aucun `?? 0`, aucun
  `coalesce(…, 0)` sur un champ de mesure. Le `null` se porte jusqu'au bout. Rattrapé quatre
  fois sur les lots 3A et 3B — c'est la règle centrale du Fil 3.
- **Migrations.** `drizzle-kit generate`, relecture du SQL généré, `migrate`. Jamais de `db:push` en prod.
- **RGPD.** Les signaux de réception et les données concurrents portent de la donnée d'audience : prévois la rétention des signaux bruts et l'anonymisation des agrégats concurrents dès le schéma.

---

## 3. LOT 3A — La réception propre

### 3A.1 Schéma

Suis `SCHEMA-TRIANGULATION.md` Blocs C et C bis. Points d'attention :

- Sur `content` : ajoute `intent: text("intent")` — `"awareness" | "consideration" | "conversion"`. `publishedAt` et `projectId` **existent déjà**, ne les redéclare pas.
- Sur `projects` : ajoute `attributionWindowDays: integer().default(30)` — la fenêtre est **par marque** (décision actée).
- Crée `content_reception` avec `receivedVsIntentScore`.
- Crée `competitors` et `competitor_reception` **maintenant, sans aucune ingestion** — décision actée pour éviter une migration de plus. `isActive` par défaut `false`.
- **Ne crée pas** `brand_conversions`, `conversion_attributions` ni `arbitration_log` dans ce lot.

Où l'`intent` est renseigné : à la création d'un contenu (formulaire) et à la génération IA d'un contenu (le modèle le déduit du contexte). Défaut si inconnu : `null`, jamais une valeur devinée — un contenu sans intention est simplement exclu du scoring.

### 3A.2 Le port d'ingestion

```
server/services/reception/
├── types.ts           ← ReceptionSignal + interface ReceptionSource (le port)
├── sources/manual.ts  ← saisie utilisateur + import CSV — le SEUL adaptateur de ce lot
├── sources/instagram.ts ← squelette + garde de permission explicite ; jamais appelé sans flag env
├── ingest.ts          ← normalise, calcule les taux, écrit content_reception
├── score.ts           ← receivedVsIntentScore — PUR, testable sans base
└── reception.test.ts
```

L'adaptateur Instagram est un squelette documenté qui **lève une erreur explicite** nommant la permission manquante (`instagram_business_manage_insights`). Il ne doit jamais être atteint par un chemin par défaut.

### 3A.3 `receivedVsIntentScore` — la règle

Fonction **pure**, la pièce la plus importante du lot. C'est la triangulation Fil 1 × Fil 3 matérialisée.

Entrées : `intent`, `saves`, `shares`, `comments`, `reach`, `sentimentScore`, `conversionsInWindow` (0 tant que 3B n'existe pas).

Règles :
- Tout se normalise par `reach`. Si `reach` est absent ou nul → renvoie `null` **et** une `confidence` nulle. Pas `0`, jamais.
- `awareness` : portée et partages dominent, saves en bonus, conversion **ignorée**.
- `consideration` : saves et commentaires dominent.
- `conversion` : la conversion domine. **Des saves élevés sans conversion donnent un score bas** — c'est l'exemple littéral de la spec, écris-en le test.
- Sortie : `{ score: number | null, confidence: number, rationale: string }`.

### 3A.4 Interface minimale

Une saisie de réception par contenu publié, depuis le calendrier de contenu : saves, partages, commentaires, portée — plus un import CSV pour rattraper l'historique. **Pas de tableau de bord de vanité.** Ce que l'écran restitue, c'est le score contre l'intention et sa raison, pas des chiffres bruts empilés.

### 3A.5 Branchement mémoire

Chaque signal ingéré écrit **directement** une entrée `memory_entries` avec `fil = "reception"` et `entryType = "signal_reception"`, `projectId` = la marque du contenu — elle est **connue**, pas devinée : aucune question de marque à poser ici (`BRIEF-FIX-ROUTAGE-MARQUE.md` ne s'applique qu'au texte libre).

⚠️ Ne passe pas par `extractToMemory` : il n'y a rien à extraire d'un signal chiffré. Écris l'entrée toi-même, embeddée, best-effort. Le commentaire du schéma liste `fait | décision | préférence | observation` — ajoute `signal_reception`, c'est un commentaire, pas une contrainte.

### 3A.6 Critères d'acceptation 3A

- [ ] `npm run build` et `npx vitest run` verts, tests existants inchangés.
- [ ] Migration générée, relue, appliquée sur dev. `content.intent`, `projects.attribution_window_days`, `content_reception`, `competitors`, `competitor_reception` existent.
- [ ] `receivedVsIntentScore` testé sur les quatre cas : awareness bien reçu, consideration bien reçu, **conversion avec saves élevés et zéro conversion → score bas**, `reach` manquant → `null`.
- [ ] Import CSV : une ligne par contenu, erreurs de format reportées ligne par ligne, import idempotent (rejouer le même fichier ne double pas les signaux).
- [ ] L'adaptateur Instagram n'est atteignable par aucun chemin par défaut et son erreur nomme la permission manquante.
- [ ] Chaque signal ingéré produit une entrée `memory_entries` `fil=reception` sur la bonne marque, et une ingestion qui échoue ne casse aucune action utilisateur.
- [ ] Aucune sortie utilisateur n'affiche de likes.

---

## 4. LOT 3B — L'attribution

### 4.0 ⚠️ DÉCISION À VALIDER AVANT DE CODER

`ARCHI-TRIANGULATION-MOTEUR.md` le dit : le modèle d'attribution est l'une des deux décisions qui font ou défont le moat, et un agent ne doit pas l'improviser.

**Arrête-toi ici.** Produis d'abord une note courte comparant deux schémas de pondération multi-touch :

1. **linéaire uniforme** — chaque contenu de la fenêtre reçoit `1/n` ;
2. **décroissance exponentielle vers la conversion** — le contenu le plus proche pèse le plus, demi-vie ≈ fenêtre / 3.

Pour chacun : un tableau chiffré sur un exemple concret à cinq contenus dans une fenêtre de 30 jours, et ce que le choix change dans les recommandations que Naya produira. **Attends ma validation avant d'écrire le code.**

Si je ne réponds pas : implémente la décroissance exponentielle, somme des poids strictement égale à 1, et documente le choix comme un défaut révisable — jamais comme une vérité.

### 4.1 Schéma et moteur

- `brand_conversions` et `conversion_attributions` selon `SCHEMA-TRIANGULATION.md` §C.3.
- `attributionWindowDays` est **figé sur la ligne de conversion** au moment du calcul (la fenêtre de la marque peut changer plus tard ; l'historique ne doit pas bouger rétroactivement).
- Le calcul du crédit vit dans une fonction **pure** `attribute(conversion, contentsInWindow, policy)` → `{ contentId, creditWeight }[]`, testable sans base, avec un invariant testé : **la somme des poids d'une conversion vaut exactement 1**.
- **En tête du fichier, en commentaire** : l'interdit de last-touch et sa raison, comme l'exige la spec.
- Recalcul **idempotent** : rejouer l'attribution d'une conversion remplace ses lignes, n'en ajoute pas.
- Une conversion sans aucun contenu dans sa fenêtre est valide : elle existe, elle n'est créditée à personne. Ne force pas un rattachement.

### 4.2 Saisie

Une conversion se déclare à la main (type, valeur, date, marque). Pas de connecteur Stripe dans ce lot — le port existe, l'adaptateur viendra.

### 4.3 Boucle vers 3A

Une fois 3B en place, `receivedVsIntentScore` reçoit son `conversionsInWindow` réel. Vérifie que le score des contenus `conversion` bouge, et **recalcule les scores existants** une fois, par script idempotent.

### 4.4 Critères d'acceptation 3B

- [ ] Note de décision produite et validée avant tout code.
- [ ] `attribute()` pure et testée ; somme des poids = 1 sur tous les cas ; fenêtre vide gérée.
- [ ] Fenêtre figée sur la conversion : modifier `projects.attribution_window_days` ne change aucune attribution passée.
- [ ] Recalcul idempotent vérifié par test.
- [ ] Aucun chemin de code ne peut produire une attribution last-touch — et le commentaire l'explique.
- [ ] Les scores 3A intègrent les conversions et ont été recalculés une fois.

---

## 5. LOT 3C — Le moteur d'arbitrage

> ⚠️ **CE PARAGRAPHE EST REMPLACÉ.** Voir `BRIEF-PHASE-3-LOT-3C-REVISE.md` (1er septembre 2026) :
> 3C est coupé en **3C-1 — l'arbitre observateur** (détecte et journalise les conflits, ne tranche pas,
> constructible tout de suite) et **3C-2 — la politique** (ouverte seulement après 30 conflits réels
> journalisés sur au moins 2 marques). Le point d'arrêt §5.0 ci-dessous est **annulé** : il n'y a pas
> de politique de pondération à concevoir dans le premier lot. Ce qui suit reste utile comme intention
> d'ensemble et comme spécification de 3C-2.

C'est l'invention. Un composant dédié — **pas un gros prompt**.

### 5.0 ⚠️ DÉCISION À VALIDER AVANT DE CODER

La politique de pondération est la seconde décision qui fait ou défait le moat.

**Arrête-toi ici.** Produis d'abord :

1. une **table de politique explicite** : contexte de décision (génération de contenu, génération de tâches, choix de campagne) × poids de chaque fil × règle de départage ;
2. **trois cas de conflit réels** tirés des données présentes en base — un cas où le cap contredit la réception, un cas où le fondateur contredit le cap, un cas où la donnée manque — et ce que la politique proposée trancherait pour chacun.

**Attends ma validation.** Ne code pas la politique avant.

### 5.1 Architecture

```
server/services/arbitration/
├── policy.ts        ← LA politique, centralisée, lisible, modifiable en un seul endroit
├── conflict.ts      ← détection de conflit entre fils — PUR
├── arbiter.ts       ← arbitrate(input) → { decision, dominantFil, rationale, confidence, filsConsulted }
└── arbitration.test.ts
```

Plus la table `arbitration_log` (`SCHEMA-TRIANGULATION.md` §D.2).

`arbitrate()` :
1. récupère les slivers pertinents par fil via `retrieveMemories(userId, projectId, focusText)` ;
2. y ajoute les signaux de réception mesurés de la marque (3A) et, s'ils existent, les conversions attribuées (3B) ;
3. détecte les conflits via `conflict.ts` ;
4. applique `policy.ts` et tranche ;
5. journalise dans `arbitration_log` (best-effort) et renvoie la décision **avec sa raison**.

**Règle absolue : aucun poids, aucune priorité entre fils ne vit ailleurs que dans `policy.ts`.** Si tu te surprends à écrire « privilégie la réception » dans un prompt, c'est une régression — la spec l'interdit explicitement.

### 5.2 Branchement

- Ne branche pas partout d'un coup. **Commence par la génération de contenu** : c'est le seul endroit où les trois fils se contredisent vraiment.
- L'arbitre s'exécute **avant** la génération ; son verdict est injecté dans le contexte comme une section dédiée, distincte des mémoires brutes. Documente ce choix dans la spec plutôt que de le noyer dans le code.
- Si `confidence` est sous le seuil, l'arbitre le dit — et Naya le dit à l'utilisateur, avec ses mots. Pas de décision présentée comme sûre quand elle ne l'est pas.

### 5.3 Interdits

- Pas de politique de pondération dans un prompt.
- L'arbitre ne fabrique jamais de donnée de réception manquante, ne l'estime pas, ne l'extrapole pas.
- Pas de « ce post a converti X » : le crédit est toujours une fraction de fenêtre.

### 5.4 Critères d'acceptation 3C

- [ ] Table de politique et trois cas de conflit validés avant tout code.
- [ ] `conflict.ts` et la politique testés comme fonctions pures, sans base ni modèle.
- [ ] Une décision sans donnée de réception renvoie `confidence` bas **et** un `rationale` qui le dit — c'est un test, pas une intention.
- [ ] Chaque arbitrage écrit une ligne `arbitration_log` avec `dominantFil` et `rationale`, et un échec d'écriture ne bloque rien.
- [ ] `grep` : aucun poids de fil hors de `policy.ts`.
- [ ] Génération de contenu branchée ; aucun autre point d'appel modifié.
- [ ] `buildNayaContext()` reste rétrocompatible.

---

## 6. Ce que ce brief NE demande PAS

- ❌ Aucune ingestion réseau réelle (bloquée par les permissions — cf. §0.1).
- ❌ Aucune ingestion concurrent : les tables seulement.
- ❌ Pas de Phase 4 (ADN vivant, détection d'écart) ni de Phase 5 (modèle maison).
- ❌ Ne touche pas au prompt d'extraction figé (`DECISIONS-MEMOIRE-IA.md` §7).
- ❌ Ne refonds pas la page Analytics existante.
- ❌ Ne migre pas `business_memory` vers `memory_entries` — c'est un autre chantier.

---

## 7. Definition of Done

Naya mesure la réception réelle de ses contenus **contre leur intention**, crédite les conversions à la fenêtre qui les a précédées et non au dernier post, et arbitre les trois fils dans un composant unique, lisible, testé et journalisé — capable de dire qu'il ne sait pas. Le Fil 3 fonctionne sans dépendre d'une permission Meta. Le NCE cesse d'être un empileur de contexte.

> ⚠️ Les deux points d'arrêt (§4.0 et §5.0) ne sont pas des formalités. Si tu les franchis sans validation, le lot est à refaire.
