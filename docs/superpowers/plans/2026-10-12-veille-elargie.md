# Veille élargie — plan d'implémentation

> Exécution : inline (superpowers:executing-plans), TDD à chaque tâche, relecture indépendante de la branche à la fin. Jeanne a demandé d'aller au bout sans validation intermédiaire.

**Objectif :** quatre routines hebdomadaires de veille (concurrents, voix du client, SERP, GEO) branchées sur le moteur de routines, alimentées par une liste suivie proposée par Naya et validée par l'utilisatrice, qui produisent des constats injectés dans le contexte de Naya et visibles sur une page « Veille ».

**Spec :** `docs/superpowers/specs/2026-10-12-veille-elargie-design.md`

## Contraintes globales

- Aucun texte en dur dans le JSX (cliquet `jsx-guard`) ; clés FR et EN (`veille.*`) toujours ensemble.
- `npx tsc --noEmit` à zéro erreur ; suite complète verte avant fusion.
- Migration générée par `drizzle-kit generate`, relue, appliquée sur dev uniquement.
- Toute dépense passe par `gardeDepense` (accès, budget) et est imputée (`recordSpend`).
- Aucune donnée personnelle stockée : verbatims anonymisés, pas de nombre d'abonnés comparé.

## Review Focus

1. Un utilisateur sans aucun élément suivi ne déclenche aucun appel payant (ni au déploiement, ni à l'ouverture de la page).
2. Premier passage d'une routine : bilan, pas une avalanche de « changements ».
3. Un fournisseur en panne (HTTP 401, zone absente, clé OpenAI absente) → erreur lisible, aucune notification quotidienne.
4. Accès d'un autre utilisateur à un projet, un élément ou un constat → 404.
5. Détection de citation GEO : accents, casse, nom court ambigu (mot entier), domaine dans les sources.

## Fichiers

- `shared/schema.ts` : `veilleItems`, `veilleReleves`, `veilleConstats` + types.
- `migrations/0024_*.sql`.
- `server/storage.ts` (+ `account-reset-plan.ts`) : CRUD veille.
- `server/services/veille/` :
  - `types.ts` : types, constantes (plafonds, kinds, coûts).
  - `texte.ts` : normalisation, empreinte, domaine d'une URL, anonymisation (pur).
  - `items.ts` : validation des corps, dédoublonnage, lecture de la proposition IA (pur).
  - `geo-analyse.ts` : analyse d'une réponse d'IA et comparaison (pur).
  - `serp-positions.ts` : positions et comparaison (pur).
  - `concurrents-analyse.ts` : engagement Instagram, lecture du résumé d'offre (pur).
  - `voc-analyse.ts` : lecture des constats VoC (pur).
  - `contexte.ts` : `blocVeille` (pur).
  - `moteurs-ia.ts` : OpenAI Responses + Perplexity, lecture des réponses (fetch injectable).
  - `collecte.ts` : lecture de page imputée (`lirePage`), recherche (`chercher`).
  - `garde.ts` (dans `routines/`) : `gardeDepense`, partagé avec le sourcing.
  - `executeurs.ts` : `executerConcurrents`, `executerVoixClient`, `executerSerp`, `executerGeo` (dépendances injectables) + `routineVeillePour`.
  - `proposer.ts` : proposition de la liste.
- `server/services/routines/ordonnanceur.ts` : enregistrement des 4 kinds.
- `server/routes-veille.ts` (+ enregistrement dans `routes.ts`).
- `server/services/naya-context.ts` : bloc veille.
- Client : `client/src/pages/veille.tsx`, `client/src/components/veille/*`, `RoutineCard` générique, route dans `App.tsx`, entrée `sidebar.tsx`, locales.

## Tâches

### Tâche 1 — Schéma, migration, stockage
Tables de la spec ; index `(userId, projectId, kind, cle)` sur les relevés, `(userId, projectId, createdAt)` sur les constats, `(projectId, type)` sur les items. Stockage : `getVeilleItems(userId, projectId)`, `getVeilleItem(id, userId)`, `createVeilleItems(rows)`, `updateVeilleItem(id, userId, patch)`, `deleteVeilleItem(id, userId)`, `getDernierReleve(userId, projectId, kind, cle)`, `getRelevesParCles(userId, projectId, kind, cles[])`, `addVeilleReleves(rows)`, `getDerniersRelevesParKind(userId, projectId, kind)` (le plus récent par clé), `addVeilleConstats(rows)`, `getVeilleConstats(userId, projectId, {limite, depuis?, statuts?})`, `updateVeilleConstat(id, userId, patch)`. Reset de compte : les trois tables. Test : plan de reset à jour (test existant).

### Tâche 2 — Fonctions pures
TDD sur `texte.ts`, `items.ts`, `geo-analyse.ts`, `serp-positions.ts`, `concurrents-analyse.ts`, `voc-analyse.ts`, `contexte.ts` (cas listés dans la spec, section Tests).

### Tâche 3 — Fournisseurs
`moteurs-ia.ts` : `moteursConfigures()`, `interrogerMoteur(moteur, prompt, {fetch})` → `{texte, citations[]}` ; `lireReponseOpenAI(json)`, `lireReponsePerplexity(json)` purs et testés. `collecte.ts` : `lirePage(userId, url)` impute `SCRAPE_COST_EUR` quand l'appel a eu lieu. `usage.ts` : `SCRAPE_COST_EUR`, `GEO_COST_EUR`.

### Tâche 4 — Garde et exécuteurs
`gardeDepense(routine, deps)` → `ResultatPassage | null` (projet absent → désactiver ; accès ; budget). Le sourcing l'utilise pour accès et budget. Exécuteurs avec `deps` injectables (`storage`, `chercher`, `lirePage`, `interroger`, `ia`, `instagram`) ; tests par exécuteur (aucun suivi → rien, premier passage → bilan, changement → constat + notifier, panne → erreur sans notifier, plafonds). Enregistrement dans `REGISTRE`.

### Tâche 5 — Proposition de la liste
`proposerListe(userId, projectId, deps)` : garde, ancrage SERP (2 requêtes si configuré), appel IA `callClaudeWithContext`, `lireProposition`, dédoublonnage, plafonds, enregistrement. Tests avec deps injectées.

### Tâche 6 — Routes
`routes-veille.ts` selon la spec. Suivre un élément → `ensureRoutine(routineVeillePour(...))` du kind correspondant, actif (et réactive si en pause ? non : on respecte une pause choisie ; création seulement). Tests de routes (supertest/mocks comme les routes existantes).

### Tâche 7 — Contexte
`buildNayaContext` : bloc veille via `storage.getVeilleConstats` (30 j, 8 max, statuts nouveau/vu), y compris en mode tiers. Test.

### Tâche 8 — Interface
`RoutineCard` générique (props : url de base, textes) ; `SourcingAutoCard` le réutilise sans changer son comportement. Page `/veille` : liste, routines, constats, tableaux. Locales FR/EN. Entrée sidebar. Tests de locales et cliquet verts.

### Tâche 9 — Vérification, relecture, fusion
Suite complète + `tsc`, migration dev, relecture indépendante (agent), corrections Critical/Important avec tests, fusion locale dans `main`.
