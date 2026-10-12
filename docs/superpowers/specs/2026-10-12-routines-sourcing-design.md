# Routines de Naya et sourcing régulier des prospects — conception

**Date :** 12 octobre 2026

> Demande : « en fonction de l'objectif de cette prospection, Bright Data doit ajouter régulièrement des prospects et ça n'est pas fait. » Puis le dossier *Acquisition 360 digitale* (JMD, octobre 2026) : la couche de pilotage repose sur des **routines planifiées** qui tournent seules et livrent un résultat court.
> Sous-projets 2 (moteur de routines) et 3 (sourcing en routine) du chantier Acquisition 360. Jeanne a demandé d'enchaîner sans arrêt : les arbitrages pris sans elle sont listés à la fin.

## Constat (code au 12/10/2026)

- **Aucune tâche planifiée ne source de prospects.**
  - `sourcerCampagne` n'est appelé que par deux routes (clic dans « Trouver des prospects »).
  - Les workers de `server/index.ts` (auto-planner, rollover, lecture, envoi, synchro LinkedIn…) sont codés en dur, globaux, sans notion de routine par projet.
- **Les erreurs Bright Data sont muettes.**
  - `serpSearch` renvoie `[]` sur une erreur HTTP, une erreur de parsing ou une exception.
  - `sourcerJusquaCible` avale aussi les rejets.
  - Une clé ou une zone erronée apparaît comme « 0 prospect », sans erreur, mais chaque appel est facturé et compté.
- **Ce qui existe et suffit** :
  - le calcul du besoin (`cibleDeCampagne` : cible tirée des objectifs et du rythme, moins la réserve déjà importée) ;
  - les requêtes dérivées de l'objectif de la campagne (`generateLeadCriteria`) ;
  - le plafond de 30 appels SERP par passage ;
  - la déduplication ;
  - l'enrichissement complet (`enrichProspects` : audit, qualification, brief, premières touches) ;
  - la validation humaine avant tout envoi.

## Ce qu'on construit

### 1. Moteur de routines (générique, par utilisatrice et par projet)

- **Table `routines`**

  | Champ | Contenu |
  |---|---|
  | `id` | identifiant |
  | `userId` | propriétaire |
  | `projectId` | nullable |
  | `kind` | type de routine (ex. `sourcing_prospects`) |
  | `cible` | jsonb, ex. `{ campaignId }` |
  | `cadence` | `quotidienne` ou `hebdomadaire` |
  | `heureUtc` | entier 0-23 |
  | `actif` | booléen, défaut `true` |
  | `prochainPassage` | horodatage |
  | `dernierPassage` | horodatage |
  | `derniereErreur` | texte, nullable |

  Contrainte : unique `(userId, kind, cible)`.
- **Table `routine_runs`**

  | Champ | Contenu |
  |---|---|
  | `id`, `routineId`, `userId` | identifiants |
  | `debut`, `fin` | horodatages |
  | `statut` | `ok`, `rien_a_faire` ou `erreur` |
  | `resume` | une phrase lisible |
  | `details` | jsonb |

- **Registre des types**, dans `server/services/routines/registre.ts` :
  - chaque type déclare `executer(routine) → { statut, resume, details, notifier }` ;
  - le premier type est `sourcing_prospects`. Les routines du dossier 360 (veille, voix du client, GEO…) s'y ajouteront.
- **Ordonnanceur** (`scheduleRoutines`, toutes les 15 minutes) :
  1. Il prend les routines `actif` dont `prochainPassage ≤ maintenant` (au plus 20 par tour).
  2. Avant d'exécuter, il **avance `prochainPassage`** (verrou par mise à jour conditionnelle). Deux instances ne peuvent pas lancer le même passage.
  3. Il exécute les routines une par une. Une erreur ne bloque pas les autres : elle est consignée dans le passage et dans `derniereErreur`.
  4. Si le type le demande (`notifier`), il écrit un message dans `companion_pending_messages` (`triggerType: "routine"`). Seulement quand il se passe quelque chose : des prospects ajoutés, ou une erreur.
- **Calcul pur** `prochainPassageApres(cadence, heureUtc, maintenant)`, testé.

### 2. Routine `sourcing_prospects` (une par campagne de prospection)

- **Création.** À la création d'une campagne, et pour les campagnes existantes au premier tour de l'ordonnanceur (`assurerRoutinesSourcing`) : une routine quotidienne, `heureUtc = 5` (avant la journée de l'utilisatrice), **active par défaut**. C'est la demande de Jeanne.
- **Passage :**
  1. Campagne absente, pas à l'utilisatrice, ou au statut différent de `active` → `rien_a_faire` (« campagne en pause »).
  2. `sourcerCampagne(userId, campaign)` : besoin calculé, requêtes dérivées de l'objectif, plafond de 30 appels. Une réserve suffisante → `rien_a_faire`.
  3. **Enrichissement automatique** des prospects neufs de cette campagne (`identified`, `enriched = false`), au plus `campaign.prospectsPerDay` (3 par défaut) par passage, seulement si le plan le permet (`hasEnrichmentAccess`). Cela produit l'audit, le brief et les premières touches. **L'envoi reste soumis à la validation de l'utilisatrice.** Un refus d'accès (plan ou limite LinkedIn hebdomadaire) n'est pas une erreur : le résumé le dit.
  4. Résumé : « 6 prospects ajoutés, 3 préparés à valider » ; notifier si au moins un prospect a été ajouté.
- **Coûts bornés :**
  - un passage par jour et par campagne ;
  - 30 appels SERP au plus par passage ;
  - un enrichissement plafonné par `prospectsPerDay` et par la limite LinkedIn hebdomadaire existante.

### 3. Les erreurs Bright Data ne sont plus muettes

- `serp.ts` gagne `serpSearchStrict`, qui **lève** une erreur sur un HTTP non OK, un JSON illisible ou une exception réseau, avec le code HTTP. `serpSearch` reste le même pour les autres appelants, mais journalise désormais l'erreur (`console.warn`).
- `sourcerCampagne` passe par `serpSearchStrict` et compte les échecs : `ResultatSourcingCampagne.erreursRecherche`, plus la dernière erreur lue.
- Si tous les appels d'un passage ont échoué, le passage est en `erreur` : « Bright Data a refusé toutes les recherches (HTTP 401) : vérifie la clé ou la zone SERP ». Les routes manuelles existantes renvoient aussi `erreursRecherche`, et la fenêtre affiche l'erreur au lieu de « 0 prospect ».

### 4. Interface

- Dans l'onglet Prospects d'une campagne, une carte **« Sourcing automatique »** :
  - l'interrupteur actif / en pause ;
  - le dernier passage (date + résumé) ;
  - la dernière erreur s'il y en a une ;
  - « Lancer maintenant », qui exécute la routine tout de suite via la même fonction.
- Routes :
  - `GET /api/prospection/campaigns/:id/routine` → `{ routine, derniersPassages }` ;
  - `PATCH /api/prospection/campaigns/:id/routine` `{ actif }` ;
  - `POST /api/prospection/campaigns/:id/routine/run`.

  Toutes vérifient la propriété de la campagne.

## Hors périmètre

- Les autres routines du dossier 360 : veille concurrentielle, voix du client, GEO, bilan mensuel. Le registre est prêt pour elles.
- Le mode agence (plusieurs clients).
- L'envoi automatique sans validation.

## Migration et déploiement

- Migration selon la procédure du projet : `drizzle-kit generate`, relecture du SQL, migration sur la branche de dev uniquement.
- **Au déploiement, la routine s'active pour les campagnes actives : Bright Data et Claude seront appelés chaque jour pour elles.** À signaler à Jeanne avant le push.

## Tests

- **Purs :**
  - `prochainPassageApres` : quotidienne et hebdomadaire, heure passée ou non, changement de jour ;
  - le résumé d'un passage de sourcing ;
  - la décision « tous les appels ont échoué → erreur ».
- **Routine** (storage, sourcing et enrichissement mockés) :
  - campagne en pause → `rien_a_faire`, aucun appel ;
  - réserve suffisante → `rien_a_faire` ;
  - import puis enrichissement plafonné à `prospectsPerDay` ;
  - plan sans enrichissement → import seul, résumé explicite ;
  - toutes les recherches en erreur → `erreur` + message lisible.
- **Ordonnanceur** : une routine due est exécutée une fois, `prochainPassage` est avancé avant l'exécution, et l'erreur d'une routine n'empêche pas la suivante.
- **Routes** : 404 sur la campagne d'une autre utilisatrice.
