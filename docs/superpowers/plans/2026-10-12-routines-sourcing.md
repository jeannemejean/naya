# Routines et sourcing régulier — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal :** un moteur de routines planifiées par utilisatrice, et une première routine qui ajoute chaque jour des prospects à chaque campagne active (Bright Data), puis en prépare quelques-uns à valider.

**Architecture :**
- Deux tables, `routines` et `routine_runs`.
- Un registre de types de routines.
- Un ordonnanceur toutes les 15 min, avec un verrou par mise à jour conditionnelle.
- Le sourcing réutilise `sourcerCampagne` et `enrichProspects`.
- `serpSearchStrict` rend les erreurs Bright Data visibles.

**Spec :** `docs/superpowers/specs/2026-10-12-routines-sourcing-design.md`

## Global Constraints

- Migrations : `drizzle-kit generate`, relecture du SQL, migration sur la branche de dev uniquement. Jamais `push`. Aucun `git push`.
- La validation humaine avant envoi est inchangée. La routine n'enrôle jamais un prospect.
- Coûts : un passage par jour et par campagne, 30 appels SERP au plus par passage, enrichissement ≤ `prospectsPerDay`.
- Textes d'interface en `t()`, FR et EN. `tsc` à zéro, suite verte.

## Review Focus

1. **Deux instances de serveur prennent la même routine due.** Un seul passage doit avoir lieu.
2. **La campagne est supprimée ou passe en pause après la création de sa routine.** Résultat attendu : `rien_a_faire`, aucun appel.
3. **La clé Bright Data est absente.** Aucun appel ; le passage dit pourquoi, sans erreur en boucle.
4. **Le plan n'inclut pas l'enrichissement.** Import seul, sans erreur.
5. **Une routine lève une exception.** La suivante s'exécute quand même ; `prochainPassage` est déjà avancé.

### Task 1 : schéma, migration, stockage
- `routines` (unique userId+kind+cibleCle) et `routine_runs`, avec leurs méthodes de stockage.
- Le reset du compte supprime aussi ces lignes.

### Task 2 : calculs purs (`server/services/routines/temps.ts`, `server/services/routines/sourcing-resume.ts`)
- `prochainPassageApres(cadence, heureUtc, maintenant)`.
- `resumeSourcing(r)`.
- `rechercheEnPanne(appels, erreurs)`.

### Task 3 : erreurs Bright Data visibles
- `serpSearchStrict` (lève avec le code HTTP).
- `serpSearch` journalise.
- `sourcerCampagne` renvoie `erreursRecherche` et `derniereErreurRecherche`.

### Task 4 : routine `sourcing_prospects` (`server/services/routines/sourcing.ts`)
- campagne absente ou en pause → `rien_a_faire` ;
- réserve suffisante → `rien_a_faire` ;
- import puis enrichissement plafonné ;
- plan sans enrichissement → import seul ;
- recherche en panne → `erreur`.

### Task 5 : ordonnanceur (`server/services/routines/ordonnanceur.ts`)
- `executerRoutinesDues(maintenant, deps)` : verrou, isolation des erreurs, notification companion.
- `assurerRoutinesSourcing()`.
- Création de la routine à la création d'une campagne.
- `scheduleRoutines()` dans `server/index.ts`.

### Task 6 : routes et interface
- `GET`/`PATCH /api/prospection/campaigns/:id/routine` et `POST …/routine/run`.
- Carte « Sourcing automatique » dans l'onglet Prospects.
- Affichage de `erreursRecherche` dans la fenêtre de sourcing manuel.

### Task 7 : vérification et relecture de branche
