# Mesure — design

> Sous-projet 6 du chantier *Acquisition 360 digitale* (dossier JMD : arbre de KPI p. 4, mesure p. 15, routines p. 17, « MER et CAC nouveaux clients dans un Sheet » au stade démarrage p. 18).
> Choix de Jeanne : **option A** (saisie et import CSV seulement, aucun connecteur), puis « vas-y sans t'arrêter ». Design présenté en conversation et accepté. Arbitrages pris sans elle en fin de document.

## Intention

Chaque projet tient un **registre mensuel** (CA, nouveaux clients, dépenses marketing par canal). Naya en tire les deux chiffres que les plateformes ne peuvent pas gonfler — **MER** et **CAC nouveaux clients** — plus le panier moyen, la part du CA venant des nouveaux clients et la marge contributive, avec leur évolution. Un **bilan mensuel** en routine dit ce qui a bougé et la décision à prendre, chiffre à l'appui. Les indicateurs des Fondations peuvent se remplir tout seuls à partir du registre.

## Constat (code au 13/10/2026)

- `brand_conversions` : conversions saisies à la main (type, valeur), attribuées aux contenus. Pas de dépense, pas de « nouveau client », pas de vue mensuelle.
- Les KPI des Fondations sont saisis à la main (`fondations.kpiReleves`).
- Le moteur de routines n'a que les cadences quotidienne et hebdomadaire.

## Données

Table `mesures_mensuelles` (une ligne par projet et par mois) :

| colonne | type | rôle |
|---|---|---|
| `id` | serial | |
| `userId` | varchar → users | |
| `projectId` | integer, sans FK (nettoyage explicite, comme la veille) | |
| `mois` | text `YYYY-MM` | |
| `ca` | double, null | chiffre d'affaires total du mois |
| `caNouveaux` | double, null | part venant des nouveaux clients |
| `nouveauxClients` | integer, null | |
| `commandes` | integer, null | ventes ou commandes |
| `coutsVariables` | double, null | produits, livraison, commissions |
| `depenses` | jsonb, défaut `{}` | `{ [canal]: montant }` |
| `source` | text | `manuel` · `import` |
| `bilan` | text, null | dernier bilan écrit par Naya |
| `bilanLe` | timestamp, null | |
| `createdAt`, `updatedAt` | timestamp | |

Index unique `(userId, projectId, mois)`. Migration additive. Montants en euros (une seule devise dans Naya aujourd'hui).

## Catalogues

- **Canaux** (liste fermée, chacun classé acquisition ou non) : `paid_social`, `google_ads`, `influence`, `affiliation`, `pr_partenariats`, `evenements` (acquisition) ; `email_fidelisation`, `production_contenu`, `outils`, `autre` (hors acquisition).
- **Indicateurs calculés** : `ca`, `nouveaux_clients`, `depense_totale`, `mer`, `cac`, `panier_moyen`, `part_ca_nouveaux`, `marge_contributive`.

## Calculs (purs, sans IA)

- `depense_totale` = somme des dépenses ; `depense_acquisition` = somme des canaux d'acquisition. Aucun canal saisi → null (pas 0).
- `mer` = ca ÷ depense_totale ; `cac` = depense_acquisition ÷ nouveaux_clients ; `panier_moyen` = ca ÷ commandes ; `part_ca_nouveaux` = caNouveaux ÷ ca ; `marge_contributive` = ca − coutsVariables − depense_totale (null si un terme manque).
- Division par zéro ou donnée absente → null. Jamais de zéro inventé.
- Évolution : écart relatif avec le mois précédent et avec la moyenne des 3 mois précédents (ceux qui ont la valeur), null si pas de base.

## Saisie

- `validerMois(corps)` (pur) : mois `YYYY-MM` valide et pas dans le futur ; montants nombres finis ≥ 0 ou null ; `nouveauxClients` et `commandes` entiers ; dépenses : seulement les canaux du catalogue, montants ≥ 0.
- **Pré-remplissage** : `suggestionDepuisConversions(conversions, mois)` (pur) — ventes déclarées dans Conversions ce mois-là (type « vente », sans casse ni accent) : nombre et somme des valeurs. Proposé, jamais écrit seul.
- **Import** : `lireImport(texte)` (pur) — CSV ou copier-coller de tableur (séparateur tabulation, point-virgule ou virgule détecté sur l'en-tête ; virgule décimale acceptée hors séparateur virgule). En-tête obligatoire, colonnes reconnues par alias (FR/EN) ; mois au format `YYYY-MM`, `MM/YYYY` ou date complète. Rend les lignes valides et les erreurs par ligne. L'interface montre un aperçu ; l'enregistrement remplace les mois importés.

## Bilan mensuel (routine `mesure_bilan`)

- Cadence **mensuelle** (nouvelle, dans `prochainPassageApres`) : le 2 du mois, 5 h UTC.
- Créée (active) au premier mois enregistré. Une pause choisie est respectée.
- Passage :
  1. projet absent → désactiver ;
  2. mois visé = le mois précédent. Pas saisi → `rien_a_faire` **avec notification** « Saisis tes chiffres de septembre… », aucun appel ;
  3. bilan déjà écrit et données inchangées depuis → `rien_a_faire` ;
  4. garde de dépense ;
  5. un appel IA (`smart`, contexte du projet) avec le tableau des indicateurs des 6 derniers mois et les cibles des KPI validés : bilan court (ce qui a bougé, cause probable, une décision, chaque affirmation avec son chiffre ; n'invente rien) ;
  6. bilan enregistré sur la ligne du mois, notification avec un résumé calculé (pas tiré de l'IA) : « Bilan de septembre prêt : MER 3,2 (+12 %), CAC 41 € (−8 %). ».
- « Lancer maintenant » fait le bilan du mois précédent (ou rappelle qu'il manque).

## Lien avec les Fondations

- `Kpi.source` (facultatif) : un indicateur calculé du catalogue. Hors catalogue → champ retiré.
- La proposition des KPI indique `source` quand l'indicateur correspond à un calcul du registre.
- `GET /api/fondations/:projectId` renvoie `kpiAuto` : pour chaque KPI relié, la série mensuelle calculée. L'interface affiche la dernière valeur calculée et n'offre pas la saisie manuelle.

## Contexte de Naya

Section « Mesure » (pas en mode tiers) : indicateurs des 3 derniers mois saisis et le dernier bilan (tronqué). Rien si le registre est vide.

## Routes (`server/routes-mesure.ts`)

Toutes vérifient la propriété du projet (404 sinon).

- `GET /api/mesure/:projectId` → mois (24 derniers) avec indicateurs et évolutions, catalogues, routine.
- `GET /api/mesure/:projectId/suggestion?mois=YYYY-MM` → ventes déclarées ce mois-là.
- `PUT /api/mesure/:projectId/mois/:mois` → 400 si invalide ; crée la routine.
- `DELETE /api/mesure/:projectId/mois/:mois`.
- `POST /api/mesure/:projectId/import` `{ texte, confirmer? }` → aperçu ; avec `confirmer`, enregistre les lignes valides (refus si aucune) et crée la routine.
- `PATCH /api/mesure/:projectId/routine`, `POST .../routine/run`.

## Interface

Page `/mesure` (barre latérale, icône `Gauge`) : indicateurs du dernier mois et évolution ; tableau des mois (modifier, supprimer) ; formulaire du mois avec pré-remplissage depuis les ventes déclarées ; import ; routine et bilans. Mention : cohortes et LTV demandent des données client par client (connecteur), hors de cette version. Textes FR/EN `mesure.*`.

## Hors périmètre

Connecteurs (Windsor.ai, Shopify, Stripe), contrôle quotidien des dépenses, cohortes et LTV, attribution par canal, incrémentalité.

## Tests

- Purs : calculs (nulls, divisions par zéro, canaux hors acquisition), évolutions, `validerMois`, `lireImport` (séparateurs, virgule décimale, alias, formats de mois, erreurs par ligne), suggestion, `prochainPassageApres` mensuelle, résumé du bilan, bloc de contexte, `Kpi.source`.
- Routine : projet absent ; mois manquant → notification sans appel ; bilan déjà à jour → rien ; écriture ; garde.
- Routes : 404 projet d'autrui ; 400 mois invalide ou futur ; routine créée à l'enregistrement ; import aperçu puis confirmation.

## Arbitrages pris sans Jeanne

1. Registre **mensuel** plutôt que des saisies au fil de l'eau : c'est la granularité du dossier au stade démarrage, et celle d'un tableur.
2. Euros uniquement.
3. Le bilan se rattache au mois qu'il commente ; il est réécrit si les chiffres changent ensuite.
4. Cohortes et LTV absentes plutôt qu'approximées.
