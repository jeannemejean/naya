# Fondations et plan d'acquisition — design

> Sous-projet 5 du chantier *Acquisition 360 digitale* (dossier JMD, octobre 2026, étape 0 p. 4, stack par maturité p. 18, roadmap p. 19), plus le « plan d'acquisition par projet » prévu au sous-projet 2 et jamais construit.
> Demande de Jeanne : options A et D, « fais tout sans validation, va jusqu'au bout ». Les arbitrages pris sans elle sont listés à la fin.

## Intention

Avant le premier euro, chaque projet a un socle explicite et validé :

1. **Offre d'entrée** : ce qui fait passer un inconnu à l'achat avec un risque perçu faible.
2. **Motivations d'achat** : trois à cinq raisons d'acheter. Chacune porte son angle créatif, ses accroches, ses preuves, ses objections et ses formats : c'est la **matrice créative** (angles × formats × accroches × preuves).
3. **Arbre de KPI** : les indicateurs qui comptent pour CE business, rangés par étage (business, système, canal, créa), avec une fréquence et une cible. Les valeurs sont saisies à la main en attendant le sous-projet 6.
4. **Plan d'acquisition** : quelles briques du dossier s'appliquent maintenant, plus tard ou pas du tout à ce business, pourquoi, et la première action. Le stade de maturité (démarrage, croissance, scale) est déduit.

Naya propose, l'utilisatrice corrige et valide. **Seules les sections validées** orientent ensuite Naya : elles entrent dans son contexte, donc dans tout ce qu'elle écrit (contenus, campagnes, tâches, prospection). Chaque contenu est étiqueté par motivation et par format, pour lire plus tard ce qui marche.

Sur-mesure (mémoire `feedback_naya_bespoke_per_user`) : rien n'est plaqué. Une céramiste n'a ni MER ni SEA ; Naya le dit dans le plan (« sans objet », avec la raison) au lieu de remplir des cases.

## Constat (code au 13/10/2026)

- `brand_dna.offers` (texte libre), `target_personas.motivations` (liste libre), `campaigns.kpis` (JSON libre), `project_goals.target_value` : des morceaux, rien de relié, rien de validé comme socle.
- Aucun contenu n'est rattaché à un angle. `content.pillar` est un pilier éditorial, pas une raison d'acheter.
- Le moteur de routines (`REGISTRE`, `ensureRoutine`, `gardeDepense`) et la carte `RoutineCard` sont prêts à accueillir une nouvelle routine.
- La bibliothèque de preuves (`project_proofs`, statut `validated`) existe : la matrice s'appuie dessus.

## Données

### Table `fondations` (une ligne par projet)

| colonne | type | rôle |
|---|---|---|
| `id` | serial | |
| `userId` | varchar → users | propriétaire |
| `projectId` | integer, sans FK (comme la veille : nettoyage explicite) | |
| `offre` | jsonb | `{ nom, description, prix?, pourquoi, existe }` |
| `motivations` | jsonb | `[{ cle, nom, description, angle, accroches[], preuves[], objections[], formats[] }]` |
| `kpis` | jsonb | `[{ cle, nom, etage, definition, frequence, cible? }]` |
| `plan` | jsonb | `{ maturite, resume, briques: [{ cle, statut, raison, action }] }` |
| `kpiReleves` | jsonb, défaut `{}` | `{ [cleKpi]: [{ date, valeur }] }`, 24 relevés max par KPI |
| `statuts` | jsonb, défaut `{}` | `{ offre, motivations, kpis, plan }` ∈ `vide` · `propose` · `valide` |
| `createdAt`, `updatedAt` | timestamp | |

Index unique `(userId, projectId)`.

### Colonnes ajoutées à `content`

- `angle` (text, null) : `cle` d'une motivation, ou `aucun` quand le contenu ne relève d'aucune (pour ne pas le réétiqueter chaque jour).
- `formatCreatif` (text, null) : un des formats créatifs.
- `etiquetage` (text, null) : `naya` ou `utilisatrice`. Une étiquette posée par l'utilisatrice n'est jamais écrasée.

Migration additive uniquement.

## Catalogues (constantes, `server/services/fondations/catalogues.ts`)

- **Formats créatifs** (dossier p. 7, plus deux formats utiles hors vidéo) : `face_camera`, `demonstration`, `avant_apres`, `comparatif`, `coulisses`, `temoignage`, `conseil`, `histoire`.
- **Étages de KPI** : `business`, `systeme`, `canal`, `crea`. **Fréquences** : `quotidien`, `hebdo`, `mensuel`.
- **Briques du plan**, par moteur :
  - *création de demande* : `organique_social`, `createurs_ugc`, `paid_social`, `pr_partenariats`, `communaute` ;
  - *captation* : `seo`, `sea`, `geo`, `marketplaces`, `affiliation` ;
  - *socle* : `veille`, `prospection_directe` (B2B : propre à Naya), `conversion`, `data_tracking`, `crm_retention`, `mesure`.
  - Chaque brique connaît la page de Naya qui la sert quand il y en a une : `veille` et `geo` → `/veille`, `seo` → `/veille` (positions Google), `prospection_directe` → `/prospection`, `organique_social` → `/content`.
- **Statuts de brique** : `maintenant`, `plus_tard`, `sans_objet`. **Maturité** : `demarrage`, `croissance`, `scale`.

## Proposition (`proposer.ts`)

`proposerFondations(userId, projectId, sections?, deps)` :

1. Projet introuvable → `introuvable`. Garde (`gardeDepense`) → `refus` avec la raison.
2. Sections demandées : celles passées, sinon toutes celles qui ne sont pas `valide`. Aucune → `rien` (rien à proposer, aucun appel).
3. Un seul appel IA (modèle `smart`, avec le contexte complet du projet via `callClaudeWithContext` : ADN, personas, objectifs, veille). Le prompt contient : les catalogues, les preuves validées du projet (libellé + résultat, client non nommé s'il n'est pas citable), et les sections déjà validées (à respecter, pas à refaire).
4. Lecture tolérante du JSON (`lireProposition`, pure) puis `validerSection` sur chaque section : tout ce qui sort des catalogues ou des plafonds est retiré, jamais deviné.
5. Les sections lues et non vides sont écrites avec le statut `propose`. Une section validée n'est remplacée que si elle a été explicitement demandée. Rien de lisible → `vide`.

Plafonds : 5 motivations, 5 accroches, 5 preuves, 5 objections, 4 formats par motivation, 12 KPI, une entrée par brique du catalogue.

## Validation et édition

- `validerSection(section, valeur)` (pure) : nettoie et valide une section envoyée par l'interface ou lue de l'IA. Rend `{ ok, valeur }` ou `{ ok: false, erreur }`.
  - Les `cle` de motivation sont dérivées du nom (slug), dédoublonnées ; les formats hors catalogue sont retirés.
  - Les KPI : nom obligatoire, étage et fréquence du catalogue, `cle` dérivée.
  - Le plan : seules les briques du catalogue, chaque brique au plus une fois ; maturité du catalogue.
- Modifier une section la garde dans son statut. Valider fait passer à `valide`. « Revenir en proposition » est possible.
- **Valider les motivations crée la routine d'étiquetage** (active, idempotent, une pause choisie est respectée).
- Retirer une motivation : les contenus déjà étiquetés avec cette `cle` gardent leur étiquette (historique), affichés « angle retiré ».

## Contexte de Naya

Nouvelle section « Fondations validées » dans `buildNayaContext`, seulement pour les sections `valide` :

- offre d'entrée ;
- motivations : nom, angle, accroches, preuves, objections, formats ;
- consigne : « Quand tu proposes un contenu, pars d'une de ces motivations et varie-les. N'invente pas de preuve au-delà de celles-ci. » ;
- KPI (noms et cibles) et briques `maintenant` du plan : **pas en mode tiers** (message à un inconnu). En mode tiers : offre d'entrée et motivations seulement.

Bloc construit par une fonction pure `blocFondations(fondations, { tiers })`, plafonné en longueur.

## Étiquetage des contenus (routine `fondations_etiquetage`)

- Quotidienne, 5 h UTC, une par projet (`cibleCle` `project:<id>`), créée quand les motivations sont validées.
- Passage :
  1. projet absent → désactiver ; motivations non validées → `rien_a_faire` ;
  2. contenus du projet des 60 derniers jours sans `angle`, 25 au plus ; aucun → `rien_a_faire`, **aucun appel** ;
  3. garde de dépense ;
  4. un appel IA (`fast`) : pour chaque contenu (titre + 600 premiers caractères), la motivation et le format, ou `aucun` ;
  5. écriture `angle`, `formatCreatif`, `etiquetage = naya`, sans toucher une étiquette `utilisatrice` (condition dans la requête) ;
  6. résumé : « 12 contenus étiquetés : 5 Efficacité prouvée, 4 Rituel plaisir, 3 hors motivations ». Pas de notification (rien d'urgent).
- Une réponse IA illisible → `erreur`, rien n'est écrit.

## Lecture : couverture des angles

Pure (`couverture(motivations, contenus, scores)`), sur 90 jours : par motivation, nombre de contenus, nombre publiés, score moyen de réception (`content_reception.receivedVsIntentScore`) quand il existe, sinon rien (jamais 0 inventé). Plus une ligne « hors motivations » et une ligne « pas encore étiqueté ». Une motivation sans aucun contenu est signalée (« angle jamais exploité »).

L'utilisatrice peut corriger l'étiquette d'un contenu : `etiquetage = utilisatrice`.

## Routes (`server/routes-fondations.ts`)

Toutes vérifient que le projet ou le contenu appartient à l'utilisatrice (404 sinon).

- `GET /api/fondations/:projectId` → fondations (ou sections vides), catalogues, routine d'étiquetage, couverture, derniers contenus étiquetés (20).
- `POST /api/fondations/:projectId/proposer` `{ sections? }` → 409 refus, 422 vide, 200 `{ fondations }`.
- `PUT /api/fondations/:projectId/sections/:section` `{ valeur?, statut? }` → 400 si invalide.
- `POST /api/fondations/:projectId/kpis/:cle/releves` `{ valeur, date? }` → 404 si le KPI n'existe pas, 400 si la valeur n'est pas un nombre fini.
- `PATCH /api/fondations/:projectId/routine` `{ actif }` et `POST .../routine/run` (même contrat que la veille).
- `PATCH /api/fondations/contenus/:id` `{ angle, formatCreatif }` → angle parmi les motivations validées ou `aucun`, format du catalogue ou null.

## Interface

- Page `/fondations` (entrée de barre latérale, icône `Layers`), projet actif comme la veille.
- En-tête : « Naya propose mes fondations » (ou « Reproposer les sections non validées »).
- Quatre cartes, chacune avec son statut, Modifier, Valider : offre d'entrée ; motivations et matrice ; arbre de KPI (par étage, dernier relevé, saisie d'une valeur) ; plan d'acquisition (maturité, briques par statut, lien vers la page qui sert la brique).
- Une carte « Couverture des angles » : routine d'étiquetage (`RoutineCard`), tableau par motivation, derniers contenus étiquetés avec correction.
- Textes FR et EN (`fondations.*`), aucun texte en dur (cliquet `jsx-guard`).

## Hors périmètre

- Calcul automatique des KPI (MER, CAC, LTV) : sous-projet 6 (agrégateur). Ici, saisie manuelle.
- Revue créative hebdomadaire (gagnants et perdants par angle) : option C, non retenue. La couverture en est la première brique.
- Création automatique des routines des briques du plan : le plan renvoie vers la page de la brique, l'utilisatrice active (dépense).
- Landings par angle et séquences CRM par motivation.
- Tracking et consentement (fondation n°4 du dossier) : rien à piloter dans Naya aujourd'hui ; la brique `data_tracking` du plan le signale.

## Tests

- **Purs** : `validerSection` (chaque section, formats hors catalogue retirés, clés dédoublonnées, briques inconnues retirées, plafonds) ; `lireProposition` (JSON entouré de texte, sections manquantes) ; `blocFondations` (rien de validé → vide, tiers sans KPI ni plan) ; `couverture` (pas de score inventé, angle retiré, jamais exploité) ; `lireEtiquettes` (ids inconnus ignorés, motivation inconnue → ignorée).
- **Proposition** (deps injectées) : refus, sections validées préservées, seulement les sections demandées, `vide`, `rien`.
- **Routine** : projet absent → désactiver ; motivations non validées → rien ; aucun contenu → aucun appel ; étiquetage écrit ; IA illisible → erreur sans écriture.
- **Routes** : 404 sur le projet d'une autre ; 400 section invalide ; validation des motivations → routine créée ; relevé sur KPI inconnu → 404 ; étiquette manuelle → `utilisatrice`.
- **Contexte** : section présente si validée, absente sinon ; tiers sans KPI ni plan.

## Arbitrages pris sans Jeanne

1. Une seule table JSON par projet plutôt que quatre tables : les sections sont lues et écrites en bloc, jamais interrogées champ par champ.
2. La matrice créative est portée par chaque motivation (angle, accroches, preuves, formats) plutôt qu'une grille séparée : c'est ce que le dossier décrit (« angles = les motivations »).
3. KPI saisis à la main ; le calcul vient avec le sous-projet 6.
4. Étiquetage par une routine quotidienne en lot plutôt qu'au moment de chaque génération : un seul point d'entrée, un appel pour 25 contenus, aucun générateur existant modifié.
5. Le plan ne crée aucune routine : il renvoie vers la page où on l'active, pour que toute dépense reste un choix.
6. Deux formats ajoutés au dossier (`conseil`, `histoire`) : les formats du dossier sont tous vidéo, beaucoup d'utilisatrices de Naya écrivent.
