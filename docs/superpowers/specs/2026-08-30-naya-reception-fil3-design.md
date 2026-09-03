# Fil 3 — La réception propre (LOT 3A) — design

**Date :** 2026-08-30
**Brief source :** `BRIEF-PHASE-3-RECEPTION-ARBITRAGE.md` §3 (LOT 3A)
**Documents de référence :** `ARCHI-TRIANGULATION-MOTEUR.md` §2-3, `SCHEMA-TRIANGULATION.md` blocs C / C bis / D.2, `STRATEGIE-DONNEES-ET-POSITIONNEMENT.md` §2 et §4
**Périmètre :** LOT 3A uniquement. **Ni 3B ni 3C** — leurs points d'arrêt (§4.0, §5.0) attendent une validation humaine.

## Ce qu'on construit

Naya doit mesurer la réception réelle d'un contenu **contre l'intention** de ce contenu. Des saves élevés sur un post d'awareness = succès ; les mêmes saves sur un post de conversion qui n'a rien converti = échec. C'est la triangulation Fil 1 × Fil 3 rendue concrète.

Ce lot livre le roc : le schéma, le port d'ingestion avec son unique adaptateur manuel, la fonction de score pure, et le branchement mémoire. Il doit être **utilisable dès aujourd'hui**, sans dépendre d'aucune permission réseau.

## La contrainte structurante (§0.1 du brief)

Les « saves » ne sont récupérables sur **aucun** réseau connecté aujourd'hui : Instagram exige `instagram_business_manage_insights` (non demandé, tour d'App Review supplémentaire), TikTok n'expose aucune lecture de métriques, LinkedIn n'a pas d'équivalent sur les posts personnels.

**Conséquence non négociable : l'ingestion est un port, jamais un appel direct.** L'adaptateur manuel est le seul de ce lot. Les adaptateurs réseau viendront derrière le même port sans rien réécrire ailleurs. Aucune ligne de ce lot ne dépend d'une permission Meta.

## État vérifié du code (30 août 2026)

Vérifié par lecture directe, pas repris du brief :

| | |
| --- | --- |
| Phase 1 | `server/services/ai/` — `router.ts`, `registry.ts`, `invocation-log.ts`, `types.ts` (`TaskKind`) ✓ |
| Phase 2 | `server/services/memory/` — `extract.ts`, `retrieve.ts`, `embed.ts`, `brand-resolve.ts` ✓ |
| `memory_entries` | colonnes `fil`, `entryType`, `content`, `embedding` (1536), `salience`, `supersededAt` ✓ |
| Sentiment | `sentimentAnalysisService` exporté depuis `server/services/sentiment-analysis.ts` ✓ |
| `content` | a `projectId`, `goal` (NOT NULL), `publishedAt`. **Pas de `intent`** ✓ |
| `projects` | **pas de** `attributionWindowDays` ✓ |
| Tables Phase 3 | **aucune** ✓ |
| CSV | `parseCsv` réutilisable dans `server/services/csv.ts` ✓ |

**⚠️ Écart avec le brief — la procédure de migration.** Le brief annonce `drizzle-kit generate` → relecture → `migrate`. Il n'existe dans ce dépôt **ni script `migrate` ni runner `migrate()`** : `package.json` n'a que `db:push`, et les migrations `0001`→`0004` du dossier `migrations/` ont été appliquées à la main. La procédure retenue est donc : `drizzle-kit generate`, **relecture du SQL généré**, puis application manuelle — sur dev-local pour ce lot, sur la production au moment du merge. `db:push` reste interdit en production.

## Décisions de conception à valider

Le brief donne les règles, pas les valeurs. Ces choix sont des **défauts révisables**, pas des vérités — chacun est isolé pour pouvoir bouger sans toucher au reste.

### D1 — Les taux de référence du score

Tout se normalise par `reach` : `saveRate = saves / reach`, etc. Un taux brut n'est pas un score ; il faut le comparer à un « bon » taux. Sous-score saturant : `min(1, taux / référence)`.

| Signal | Référence (« bon » taux) |
| --- | --- |
| saves | 0,020 |
| partages | 0,010 |
| commentaires | 0,010 |
| conversions | 0,005 |

Ces valeurs vivent dans **une seule constante exportée** du module de score, documentées comme révisables.

### D2 — Les poids par intention

| Intention | saves | partages | commentaires | conversion |
| --- | --- | --- | --- | --- |
| `awareness` | 0,25 | **0,60** | 0,15 | **ignorée (0)** |
| `consideration` | **0,45** | 0,20 | **0,35** | 0 |
| `conversion` | 0,15 | 0,05 | 0,10 | **0,70** |

Conforme au brief : awareness → partages dominent, saves en bonus, conversion ignorée ; consideration → saves et commentaires dominent ; conversion → la conversion domine.

**Le cas littéral de la spec est vérifiable arithmétiquement :** un post `conversion` avec des saves excellents (sous-score 1), commentaires et partages excellents (1), et **zéro conversion** obtient `0,70×0 + 0,15×1 + 0,05×1 + 0,10×1 = 0,30`. Score bas. C'est le test exigé.

### D3 — La confiance

`confidence` ∈ [0,1] mesure à quel point on peut se fier au score, indépendamment de sa valeur :

- `min(1, reach / 500)` — un post vu 40 fois ne dit rien de fiable ;
- × un facteur de complétude : 1,0 si tous les signaux utiles à cette intention sont présents, réduit proportionnellement pour chaque signal manquant (`null`, pas 0 — un compteur à zéro est une information, un compteur absent n'en est pas une).

### D4 — Le sentiment module, il ne décide pas

Quand `sentimentScore` (−1..1) est présent, le score final est multiplié par `1 + 0,10 × sentiment`, puis borné à [0,1]. Un accueil hostile abîme un bon score de 10 % au plus ; il ne le renverse pas. Absent → aucun effet, et la complétude baisse.

### D5 — Pas de sentiment automatique dans ce lot **(hypothèse)**

Le brief impose de réutiliser `sentimentAnalysisService`, mais l'écran de saisie qu'il décrit (§3A.4) ne collecte que saves / partages / commentaires / portée — **aucun texte de commentaire**. Sans texte, rien à analyser.

Retenu : l'adaptateur manuel accepte un `sentimentScore` **optionnel** saisi ou importé, et **ne calcule aucun sentiment**. `sentimentAnalysisService` reste intact pour un futur adaptateur réseau qui, lui, récupérera les commentaires. Fabriquer un sentiment à partir d'un simple compteur serait inventer de la donnée — précisément ce que le brief interdit.

### D6 — La clé d'idempotence de l'import **(hypothèse)**

Le brief exige qu'un même fichier rejoué ne double pas les signaux, sans dire sur quoi dédupliquer.

Retenu : **UNIQUE (`content_id`, `platform`, `measured_at`)**, avec `measured_at` normalisé au **jour** (minuit UTC) pour toute ingestion manuelle ou CSV. Un import est un `upsert` : rejouer le même fichier écrase les mêmes lignes. Un CSV sans colonne de date prend le **jour de l'import**, ce qui rend l'idempotence vraie dans la journée mais pas au-delà — une mesure du lendemain est une nouvelle mesure, ce qui est le comportement correct.

### D7 — RGPD : pas de donnée personnelle par construction **(hypothèse)**

Le brief demande de prévoir rétention et anonymisation « dès le schéma ». Plutôt qu'une colonne de rétention inutilisée, le choix retenu est de rendre le schéma **incapable** de porter de la donnée personnelle :

- `content_reception` ne stocke que des **compteurs agrégés** et un score. Aucune identité, aucun texte d'audience, aucun identifiant de commentateur.
- `competitor_reception` ne stocke que des **taux normalisés** (`engagementRate`) et un sentiment agrégé — jamais de valeurs brutes, jamais d'auteur.
- **Contrainte pour les futurs adaptateurs réseau**, écrite dans le commentaire du schéma : un adaptateur peut lire des commentaires pour en dériver un sentiment agrégé, mais ne doit **jamais** persister le texte ni l'auteur.

Si tu veux une rétention datée explicite, c'est une colonne à ajouter — dis-le et je la mets.

## Architecture

```
server/services/reception/
├── types.ts            ← ReceptionSignal + interface ReceptionSource (LE PORT)
├── score.ts            ← receivedVsIntentScore — PUR, aucune base, aucun modèle
├── ingest.ts           ← normalise, calcule, écrit content_reception, pousse en mémoire
├── sources/manual.ts   ← saisie + CSV — le SEUL adaptateur du lot
├── sources/instagram.ts← squelette ; lève une erreur nommant la permission manquante
├── score.test.ts
└── ingest.test.ts
```

Le port est une interface étroite : une source sait produire des `ReceptionSignal[]`, rien d'autre. `ingest.ts` ne connaît que le port — jamais Instagram, jamais un CSV.

### Le schéma

Sur `content` : `intent: text("intent")` — `"awareness" | "consideration" | "conversion"`, nullable. `publishedAt` et `projectId` existent déjà, on ne les redéclare pas. **Ne pas recycler `goal`**, qui est un champ libre requis et n'est pas l'intention au sens de la triangulation.

Sur `projects` : `attributionWindowDays: integer().default(30)` — la fenêtre est par marque. Créée dans ce lot, **consommée par 3B**.

Nouvelles tables, conformes à `SCHEMA-TRIANGULATION.md` C.2 et C bis : `content_reception` (avec `receivedVsIntentScore`), `competitors` et `competitor_reception` (`isActive` défaut `false`, **aucune ingestion**).

**Explicitement pas dans ce lot :** `brand_conversions`, `conversion_attributions`, `arbitration_log`.

### Où l'intention est renseignée

- **Formulaire de création de contenu** : un sélecteur à trois valeurs, non requis.
- **Génération IA** : le modèle la déduit du contexte ; si sa réponse ne contient pas d'intention exploitable, on écrit `null`.

**Jamais une valeur devinée.** Un contenu sans intention est simplement exclu du scoring — c'est une sortie légitime, pas un défaut.

### Le branchement mémoire

Chaque signal ingéré écrit **directement** une entrée `memory_entries` : `fil = "reception"`, `entryType = "signal_reception"`, `projectId` = la marque du contenu (**connue**, jamais devinée — aucune question de marque ici).

On ne passe **pas** par `extractToMemory` : il n'y a rien à extraire d'un signal chiffré. L'entrée est rédigée, embeddée via `embedText`, et écrite en best-effort. `salience` = la `confidence` du score quand elle existe, sinon le défaut 0,5.

Le commentaire du schéma qui liste `fait | décision | préférence | observation` est un commentaire, pas une contrainte : `signal_reception` s'y ajoute.

### L'interface

Une saisie de réception par contenu publié, depuis le calendrier de contenu : saves, partages, commentaires, portée, date de mesure. Plus un import CSV pour rattraper l'historique, avec les erreurs de format **reportées ligne par ligne**.

**Pas de tableau de bord de vanité.** Ce que l'écran restitue, c'est **le score contre l'intention et sa raison** — jamais des chiffres bruts empilés, jamais de likes.

## Garde-fous appliqués à ce lot

- **Best-effort partout.** Ni l'ingestion, ni le scoring, ni l'écriture mémoire ne peuvent faire échouer une action utilisateur.
- **Jamais les likes.** Aucun champ, aucune sortie.
- **Jamais de valeur brute en sortie utilisateur.** Taux normalisés uniquement.
- **`reach` manquant ou nul → `null`**, jamais `0`. On ne fabrique pas un taux.
- **Jamais de scoreboard.** Toute restitution se formule comme un apprentissage.
- **L'incertitude est légitime** : score `null` + `confidence` 0 + une `rationale` qui dit pourquoi.
- **Coût maîtrisé** : ce lot ne fait **aucun appel modèle**, sauf l'embedding de l'entrée mémoire (déjà routé par la Phase 2).
- **Rétrocompatibilité** : aucun site d'appel existant modifié ; `intent` est nullable ; la page Analytics existante n'est pas touchée.
- **`getInstagramAnalytics` / `getLinkedInAnalytics` sont de la vanité** au sens de la spec : on les laisse en place pour la page Analytics et on ne les branche **pas** sur `content_reception`.

## Tests

Fonctions pures d'abord, comme l'exige la discipline du dépôt :

- `receivedVsIntentScore` — les quatre cas du brief : awareness bien reçu ; consideration bien reçu ; **`conversion` avec saves élevés et zéro conversion → score bas** ; `reach` manquant → `null` et `confidence` 0. Plus : `intent` null → `null` ; sentiment négatif qui dégrade sans renverser ; bornes [0,1].
- Parsing/validation CSV — colonnes manquantes, valeurs non numériques, `content_id` inconnu, erreurs reportées **ligne par ligne**.
- Idempotence de l'import — rejouer le même fichier ne crée aucune ligne supplémentaire.
- L'adaptateur Instagram lève bien une erreur nommant `instagram_business_manage_insights`.

Les enveloppes DB et les composants React restent non testés unitairement, conformément à la convention du dépôt.

## Critères d'acceptation (§3A.6 du brief)

- [ ] `npm run build` et `npx vitest run` verts, tests existants inchangés.
- [ ] Migration générée, relue, appliquée sur dev. `content.intent`, `projects.attribution_window_days`, `content_reception`, `competitors`, `competitor_reception` existent.
- [ ] `receivedVsIntentScore` testé sur les quatre cas, dont le cas conversion/saves élevés → score bas.
- [ ] Import CSV : une ligne par contenu, erreurs ligne par ligne, import idempotent.
- [ ] L'adaptateur Instagram n'est atteignable par aucun chemin par défaut et son erreur nomme la permission manquante.
- [ ] Chaque signal ingéré produit une entrée `memory_entries` `fil=reception` sur la bonne marque ; une ingestion qui échoue ne casse aucune action utilisateur.
- [ ] Aucune sortie utilisateur n'affiche de likes.

## Hors périmètre

Aucune ingestion réseau réelle. Aucune ingestion concurrent (tables seules). Pas de `brand_conversions` / `conversion_attributions` / `arbitration_log`. Pas de refonte de la page Analytics. Pas de migration de `business_memory` vers `memory_entries`. Le prompt d'extraction figé (`DECISIONS-MEMOIRE-IA.md` §7) n'est pas touché.
