# Fondations et plan d'acquisition — plan d'implémentation

> Exécution : inline (superpowers:executing-plans), TDD à chaque tâche, relecture indépendante de la branche à la fin. Jeanne a demandé d'aller au bout sans validation intermédiaire.

**Objectif :** une table `fondations` par projet (offre d'entrée, motivations et matrice, arbre de KPI, plan d'acquisition), proposée par Naya et validée par l'utilisatrice, injectée dans le contexte de Naya ; étiquetage des contenus par motivation et format via une routine quotidienne ; page « Fondations ».

**Spec :** `docs/superpowers/specs/2026-10-13-fondations-design.md`

## Contraintes globales

- Aucun texte en dur dans le JSX (cliquet `jsx-guard`) ; clés FR et EN (`fondations.*`) toujours ensemble.
- `npx tsc --noEmit` à zéro erreur ; suite complète verte avant fusion.
- Migration générée par `drizzle-kit generate`, relue, appliquée sur dev uniquement. Additive.
- Toute dépense passe par `gardeDepense`. Aucun appel IA quand il n'y a rien à faire.
- Seules les sections `valide` sortent dans le contexte ; en mode tiers, ni KPI ni plan.

## Review Focus

1. Une étiquette posée par l'utilisatrice n'est jamais écrasée par la routine (condition dans la requête, pas seulement dans le code appelant).
2. Reproposer ne remplace jamais une section validée qui n'a pas été explicitement demandée.
3. Une sortie IA hors catalogue (format, brique, étage) est retirée, jamais conservée ni devinée.
4. Accès au projet ou au contenu d'une autre utilisatrice → 404, y compris l'étiquetage manuel.
5. La couverture n'invente jamais un score de réception (absence ≠ 0).

## Fichiers

- `shared/schema.ts` : table `fondations`, colonnes `content.angle`, `content.formatCreatif`, `content.etiquetage`.
- `migrations/0025_*.sql`.
- `server/storage.ts` (+ `account-reset-plan.ts`, `deleteProject`) : `getFondations`, `upsertFondations`, `getContenusAEtiqueter`, `etiqueterContenus`, `getContenusEtiquetes`, `getScoresReception`, `etiqueterContenuManuel`.
- `server/services/fondations/` :
  - `catalogues.ts` : formats, étages, fréquences, briques, statuts, maturités, `KIND_ETIQUETAGE`.
  - `sections.ts` : `slug`, `validerSection`, `lireProposition`, `statutsDe` (pur).
  - `contexte.ts` : `blocFondations` (pur).
  - `couverture.ts` : `couverture` (pur).
  - `etiquetage.ts` : `lireEtiquettes` (pur), `executerEtiquetage(routine, deps)`, `routineEtiquetagePour`.
  - `proposer.ts` : `proposerFondations(userId, projectId, sections, deps)`.
  - `deps.ts` : dépendances réelles, `EXECUTEURS_FONDATIONS`.
- `server/services/routines/ordonnanceur.ts` : `...EXECUTEURS_FONDATIONS`.
- `server/routes-fondations.ts` (+ enregistrement dans `routes.ts`).
- `server/services/naya-context.ts` : section fondations.
- Client : `client/src/pages/fondations.tsx`, `client/src/components/fondations/*`, route `App.tsx`, entrée `sidebar.tsx`, locales.

## Tâches

### Tâche 1 — Schéma, migration, stockage
Table et colonnes de la spec ; migration générée et relue ; méthodes de stockage ; reset de compte et suppression de projet. Test : plan de reset (existant) vert.

### Tâche 2 — Fonctions pures
TDD sur `sections.ts`, `contexte.ts`, `couverture.ts`, `lireEtiquettes`.

### Tâche 3 — Proposition
`proposerFondations` avec deps injectées : introuvable, refus, `rien`, sections validées préservées, seulement les sections demandées, `vide`, écriture `propose`.

### Tâche 4 — Routine d'étiquetage
`executerEtiquetage` : projet absent → désactiver ; motivations non validées → rien ; aucun contenu → aucun appel ; garde ; écriture ; IA illisible → erreur. Enregistrement dans `REGISTRE`.

### Tâche 5 — Routes
`routes-fondations.ts` selon la spec, tests de routes (mocks comme `routes-veille.test.ts`).

### Tâche 6 — Contexte
`buildNayaContext` : section fondations (validées seulement, tiers restreint). Test.

### Tâche 7 — Interface
Page `/fondations`, composants par carte, locales FR/EN, sidebar. Tests de locales et cliquet verts.

### Tâche 8 — Vérification, relecture, fusion
Suite complète + `tsc` + build, migration dev, relecture indépendante (agent), corrections Critical/Important avec tests, fusion locale dans `main`.
