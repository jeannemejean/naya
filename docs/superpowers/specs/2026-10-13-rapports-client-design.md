# Rapports client — design (sous-projet 7b)

> Sous-projet 7 du chantier *Acquisition 360 digitale* (dossier JMD : « des rapports à envoyer au client »), seconde moitié après **7a connexions par client**.
> Choix de Jeanne : le client ne se connecte jamais à Naya (**A**) ; il reçoit le rapport par **lien privé** et en **PDF** (**A et B**) ; « rien ne part sans ta validation ». Puis « continue jusqu'au bout ne me demande pas ». Arbitrages pris sans elle en fin de document.

## Intention

Chaque mois, pour un projet **client**, Naya prépare un **rapport** : les chiffres du mois, ce qui a été publié et ce qui a marché, l'avancée de la prospection, les faits marquants de la veille, et les prochaines étapes. Jeanne le relit, le corrige, puis le **publie** : le client l'ouvre par un lien privé, sans compte, et peut l'enregistrer en PDF. Jeanne peut couper le lien à tout moment.

## Constat (code au 13/10/2026)

- Les données existent par projet : registre mensuel et indicateurs (`mesure`), contenus publiés et scores de réception, campagnes et messages de prospection, constats de veille, fondations.
- Aucune page n'est accessible sans compte, à part les pages légales (`/privacy`, `/terms`, `/data-deletion`).
- Le moteur de routines a une cadence mensuelle (le 2 du mois pour le bilan).

## Données (migration additive)

Table `rapports_client` (un rapport par projet et par mois) :

| colonne | type | rôle |
|---|---|---|
| `id` | serial | |
| `userId` | varchar → users | |
| `projectId` | integer, sans FK (nettoyage explicite) | |
| `mois` | text `YYYY-MM` | mois couvert |
| `statut` | text | `brouillon` · `publie` |
| `donnees` | jsonb | chiffres calculés, figés à la préparation (jamais tirés de l'IA) |
| `sections` | jsonb | textes : `synthese`, `realise`, `resultats`, `prochainesEtapes` |
| `jeton` | text, null, unique | identifiant du lien privé (32 octets aléatoires, base64url) |
| `partageActif` | boolean, défaut false | le lien répond-il |
| `publieLe` | timestamp, null | |
| `createdAt`, `updatedAt` | timestamp | |

Index unique `(userId, projectId, mois)`.

## Assemblage des données (pur, `server/services/rapports/donnees.ts`)

`donneesRapport(entrees, mois)` rend, pour le mois visé :
- **chiffres** : les indicateurs de la page Mesure du mois (CA, nouveaux clients, dépense, MER, CAC…) et leur évolution par rapport au mois précédent ; absent si le mois n'est pas saisi ;
- **contenus** : nombre de contenus publiés dans le mois par plateforme, et les 3 meilleurs selon le score de réception (titre, plateforme, date) ;
- **prospection** : pour les campagnes du projet, messages envoyés dans le mois et prospects ayant répondu ;
- **veille** : jusqu'à 5 constats du mois (titre) ;
- **vide** : vrai si aucune de ces rubriques n'a de donnée.

Rien n'est inventé : une rubrique sans donnée est absente, jamais à zéro.

## Rédaction (`server/services/rapports/rediger.ts`)

`preparerRapport(userId, projectId, mois, deps)` :
1. projet introuvable ou perso → refus ;
2. un rapport **publié** existe pour ce mois → refus `deja_publie` (on ne réécrit pas ce que le client a peut-être lu) ;
3. assemble les données ; tout vide → `rien` (aucun appel IA) ;
4. garde de dépense ;
5. un appel IA (`smart`, contexte du projet en **mode tiers** : rien des notes privées de l'utilisatrice) : rédige les quatre sections, **au client, en le vouvoyant**, au nom de l'agence, sans jargon interne, sans mentionner Naya ; chaque chiffre cité vient des données fournies ; aucune promesse ;
6. sortie illisible → erreur ; sinon le brouillon est enregistré (créé ou remplacé s'il était encore brouillon).

## Routine mensuelle (`rapport_client`)

- Le 3 du mois, 6 h UTC (après le bilan du 2) : prépare le brouillon du mois écoulé et prévient Jeanne : « Le rapport de septembre pour {client} est prêt à relire. »
- Créée (active) quand Jeanne prépare son premier rapport pour le projet ; une pause choisie est respectée.
- Rien à faire (projet perso, rapport déjà publié ou brouillon déjà là, aucune donnée) → aucun appel IA.

## Publication et lien

- **Publier** : statut `publie`, `publieLe`, jeton créé s'il n'existe pas, `partageActif` vrai.
- **Couper le lien** : `partageActif` faux ; le lien répond « rapport indisponible ».
- **Nouveau lien** : nouveau jeton (l'ancien cesse de marcher).
- **Repasser en brouillon** pour corriger : le lien est coupé en même temps.
- **Lecture publique** : `GET /api/public/rapports/:jeton`, sans compte. Ne rend que ce qui est publié et partagé : nom du client, nom de l'agence (le nom de l'entreprise de l'utilisatrice), mois, sections, chiffres. Jamais d'identifiant interne. En-tête `X-Robots-Tag: noindex`. Jeton inconnu, coupé ou rapport en brouillon → 404 indistinct.

## Routes (`server/routes-rapports.ts`)

Toutes (sauf la lecture publique) : projet de l'utilisatrice sinon 404 ; projet perso → 409 `projet_perso`.
- `GET /api/rapports/:projectId` : la liste des rapports (mois, statut, lien) et la routine.
- `GET /api/rapports/:projectId/:mois` : un rapport.
- `POST /api/rapports/:projectId/preparer` `{ mois }` : prépare (ou refait) le brouillon.
- `PATCH /api/rapports/:projectId/:mois` `{ sections }` : modifie les textes d'un brouillon (publié → 409).
- `POST …/:mois/publier`, `POST …/:mois/depublier`, `POST …/:mois/nouveau-lien`.
- `DELETE …/:mois`.
- `PATCH /api/rapports/:projectId/routine` `{ actif }`.

## Interface

- Page projet, projets client seulement : carte **Rapports du client** : préparer le rapport d'un mois, liste des rapports avec leur état, ouvrir l'éditeur (quatre zones de texte, chiffres en lecture), publier, copier le lien, couper le lien, nouveau lien ; interrupteur de la routine mensuelle.
- Page publique `/rapport/:jeton` (hors connexion, comme les pages légales) : mise en page sobre, imprimable (styles d'impression), bouton « Enregistrer en PDF » (impression du navigateur). Langue du rapport : celle du compte.
- Locales FR/EN (`rapports.*`).

## Suppression et remise à zéro

- `deleteProject` supprime les rapports du projet (les liens cessent de marcher).
- Remise à zéro du compte : supprime `rapports_client`.

## Tests

- **Purs** : `donneesRapport` (rubriques absentes sans donnée, meilleurs contenus par score, messages du mois seulement, mois précédent pour l'évolution), validation des sections, jeton.
- **Préparation** : projet perso → refus ; publié → `deja_publie` ; aucune donnée → aucun appel ; garde ; écriture du brouillon ; IA illisible → erreur ; mode tiers demandé.
- **Routine** : rien à faire sans appel ; brouillon préparé et notification.
- **Routes** : 404 et 409, PATCH d'un publié → 409, publication et coupure du lien, lecture publique (brouillon, coupé, inconnu → 404 identique ; aucune donnée interne ; `noindex`).

## Hors périmètre

- Envoi du rapport par e-mail depuis Naya.
- Accès du client à Naya.
- Rapports pour un projet perso.
- Graphiques dans le rapport (les chiffres sont donnés en tableau).

## Arbitrages pris sans Jeanne

- **Vouvoiement** du client, au nom de l'agence (le nom de son entreprise dans Naya).
- **Mode tiers** pour la rédaction : aucune note privée de Jeanne n'entre dans un texte destiné au client.
- **Un rapport publié ne se régénère pas** : il faut le repasser en brouillon (ce qui coupe le lien), pour ne jamais changer sous les yeux du client ce qu'il a lu.
- **PDF par l'impression du navigateur** plutôt qu'une génération côté serveur : même rendu que la page, aucune dépendance nouvelle.
- **Routine le 3 du mois** : le bilan du 2 a eu lieu, et les chiffres saisis en retard comptent.
