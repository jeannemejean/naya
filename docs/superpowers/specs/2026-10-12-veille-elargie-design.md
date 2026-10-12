# Veille élargie — conception

**Date :** 12 octobre 2026 · Sous-projet 4 du découpage « Acquisition 360 digitale »

> Demande : « passe au sous-projet 4, la veille élargie ». Choix : **D, les quatre veilles dans ce
> sous-projet, livrées l'une après l'autre**, « fais tout sans avoir besoin de ma validation ».

## Ce que dit le dossier 360 (pages 5-6, 10, 17)

La veille n'est pas un audit ponctuel : c'est un flux continu qui alimente les angles, les sujets,
les objections et la riposte. Chaque signal a son rythme et sa finalité :

| Signal | Rythme (dossier) | Ce que ça alimente |
|---|---|---|
| Concurrents (contenus forts, offres, actualité) | chaque matin ou lundi | angles, formats, riposte, offre |
| Voix du client (avis, Reddit, forums) | hebdo | objections, vocabulaire réel, bénéfices attendus, sujets |
| Recherche SERP (positions) | hebdo | mots-clés à capter, pression concurrentielle |
| Réponses des IA (GEO) | hebdo | la marque est-elle citée, à côté de qui, sur quelles sources |

Trois règles du dossier sont reprises telles quelles :

1. **Une liste fixe**, versionnée, de comptes, requêtes et prompts suivis : les relevés sont comparables d'une semaine à l'autre.
2. **Pas de fichiers de personnes.** Seulement des données agrégées (positions, contenu d'une page, citations). Les verbatims de clients sont anonymisés (aucun pseudo, aucun nom).
3. **Lecture large, écriture étroite.** La veille lit et propose ; elle ne publie rien, n'envoie rien.

## Principes propres à Naya

- **Sur-mesure par utilisateur** (pas le playbook de l'agence) : la liste suivie est dérivée du projet de chaque utilisateur.
- **Naya propose, l'utilisatrice valide** (même principe que les preuves) : Naya pré-remplit la liste ; seuls les éléments **suivis** sont relevés.
- **Budget** : 2 € par mois et par utilisateur, propriétaire jamais bloquée. Toute la veille est hebdomadaire, plafonnée, et impute ses coûts (y compris la lecture de pages Bright Data, aujourd'hui non imputée).
- **Rien d'activé sans geste** : une routine de veille n'existe et ne tourne que si au moins un élément de son type est suivi.

## Architecture

```
veille_items (la liste suivie, par projet)
      │  proposés par Naya (IA + 2 recherches Google), validés par l'utilisatrice
      ▼
4 routines hebdomadaires (moteur de routines existant), une par projet et par type
  veille_concurrents · veille_voix_client · veille_serp · veille_geo
      │  relevés bruts comparables  → veille_releves (instantanés, dédoublonnage d'URL)
      │  ce qui a changé / ce qui compte → veille_constats
      ▼
- contexte de Naya (bloc « Veille » court, dans buildNayaContext, y compris mode tiers)
- notification du compagnon quand il y a du nouveau
- page « Veille » : liste suivie, routines, constats, tableaux GEO et SERP
```

### Données

- `veille_items` : `id, userId, projectId, type, libelle, valeur (jsonb), statut, source, createdAt, updatedAt`.
  - `type` : `marque` (la marque de l'utilisatrice : nom, site, variantes) · `concurrent` (nom, site, instagram, variantes) · `requete_voc` (requête Google, ex. `site:reddit.com …`) · `mot_cle` (requête dont on suit la position) · `prompt_geo` (question posée aux IA).
  - `statut` : `propose` · `suivi` · `ecarte`. `source` : `naya` · `manuel`.
  - Unicité logique par (projet, type, libellé normalisé) : vérifiée au code (dédoublonnage des propositions).
- `veille_releves` : `id, userId, projectId, kind, cle, donnees (jsonb), createdAt`. `cle` identifie ce qui est comparé : `url:<hash>` (page déjà lue), `site:<itemId>` (contenu du site concurrent), `serp:<itemId>`, `geo:<moteur>:<itemId>`, `actu:<hash>`. Index (userId, projectId, kind, cle).
- `veille_constats` : `id, userId, projectId, kind, type, titre, texte, preuve (jsonb : url, extrait, source), statut, createdAt`.
  - `type` : `objection` · `vocabulaire` · `attente` · `sujet` (voix du client) · `offre_concurrent` · `actu_concurrent` · `contenu_fort` (concurrents) · `position` · `bilan_serp` (SERP) · `citation_geo` · `source_geo` · `bilan_geo` (GEO).
  - `statut` : `nouveau` · `vu` · `ecarte`.
- La table `competitors` existante (jamais remplie) n'est pas réutilisée : elle ne couvre qu'un des cinq types. Elle reste en l'état.

### Plafonds (constantes, un passage par semaine)

| Routine | Plafond par passage | Coût estimé |
|---|---|---|
| concurrents | 5 concurrents · 1 page de site + 1 recherche actualités chacun · Instagram si configuré · 1 appel IA seulement si une page a changé | ~0,02 € |
| voix du client | 6 requêtes · 8 pages neuves lues · 1 appel IA de synthèse | ~0,03 € |
| SERP | 15 mots-clés · 1 recherche chacun · aucun appel IA | ~0,02 € |
| GEO | 8 prompts × moteurs configurés (≤ 2) | ~0,03 € par réponse |

Coûts imputés : recherche SERP (existant), lecture de page (`SCRAPE_COST_EUR`, nouveau, même tarif que la SERP), réponse d'IA GEO (`GEO_COST_EUR` = 0,03 €, estimation prudente), appels Claude (existant).

### Les quatre routines

Toutes : `cadence = hebdomadaire`, `heureUtc = 5`, cible `{ projectId }`, `cibleCle = project:<id>`. Avant toute dépense, un garde commun (`gardeDepense`) vérifie : projet existant et à l'utilisatrice (sinon routine désactivée), accès actif (`hasNayaAccess`), budget (`isAiBlocked`). Aucun élément suivi du type → `rien_a_faire`, sans dépense.

**1. `veille_concurrents`.** Pour chaque concurrent suivi :
- lit la page du site (`scrapeAsMarkdown`) ; compare à l'instantané précédent (`site:<itemId>`) avec une empreinte du texte normalisé. Premier passage : instantané seul. Page changée : un appel IA résume ce qui a changé côté offre, prix, promotion, positionnement ; s'il n'y a rien de commercial, aucun constat (`offre_concurrent`) ;
- cherche l'actualité de la semaine (`"<nom>"`, verticale actualités) ; chaque article jamais vu → constat `actu_concurrent` (titre + lien), sans IA ;
- si un compte Instagram est renseigné et que le jeu de données Instagram est configuré : lit le profil, calcule le taux d'engagement normalisé des posts récents, et signale ceux à plus de deux fois la médiane du compte (`contenu_fort`). Données agrégées seulement, jamais de nombre d'abonnés comparé.

**2. `veille_voix_client`.** Pour les requêtes suivies : recherche Google, garde les pages jamais lues (empreinte d'URL), en lit au plus 8, puis un appel IA en extrait des constats `objection` / `vocabulaire` / `attente` / `sujet`, chacun avec un verbatim court **anonymisé** et l'URL. Un nettoyage pur retire pseudos (`u/…`, `@…`) et adresses mail des verbatims. Dédoublonnage contre les constats existants (texte normalisé).

**3. `veille_serp`.** Pour chaque mot-clé suivi : une recherche (pays et langue `fr`), positions (1-10) de la marque et des concurrents (par domaine). Comparaison à l'instantané précédent : la marque gagne ou perd au moins 3 places, entre ou sort du top 10 ; un concurrent entre dans le top 3 → constat `position`. Premier passage : un constat `bilan_serp` (« présente sur X des N requêtes »). Les annonces payantes ne sont pas relevées (non fournies par le format de résultats actuel).

**4. `veille_geo`.** Pour chaque prompt suivi et chaque moteur configuré :
- **OpenAI** (`OPENAI_API_KEY`, déjà présente pour les embeddings) : API Responses avec l'outil de recherche web ; texte de la réponse + URLs citées ;
- **Perplexity** (`PERPLEXITY_API_KEY`, optionnelle) : `sonar` ; texte + citations ;
- analyse pure : la marque est-elle citée (nom, variantes, domaine), à quelle position parmi la marque et les concurrents, quels concurrents sont cités, quelles sources (domaines) ;
- comparaison au relevé précédent du même prompt et moteur : marque nouvellement citée ou plus citée, concurrent nouvellement cité → `citation_geo` ;
- sur l'ensemble du passage : les domaines cités dans des réponses où un concurrent apparaît et pas la marque → un constat `source_geo` (« sources à travailler ») ; premier passage → `bilan_geo` (« citée dans X des N réponses »).
- Aucun moteur configuré → `erreur` lisible, sans notification (problème de plateforme).

**Notification :** un passage qui produit au moins un constat notifie une phrase de résumé (« Veille concurrents : 2 nouveautés »). Une panne de fournisseur ne notifie pas (journalisée, comme le sourcing).

### Proposition de la liste

`POST /api/veille/:projectId/proposer` : si Bright Data est configuré, deux recherches Google (catégorie et offre du projet) servent d'ancrage ; un appel IA (contexte complet du projet) renvoie un JSON `{ marque, concurrents[], requetes_voc[], mots_cles[], prompts_geo[] }`. Les propositions sont dédoublonnées contre l'existant (libellé normalisé, écartés compris : un élément écarté n'est jamais reproposé) et enregistrées en `propose`, plafonnées : 1 marque, 5 concurrents, 6 requêtes, 15 mots-clés, 8 prompts. Garde accès et budget avant l'appel.

### Routes (`server/routes-veille.ts`)

- `GET /api/veille/:projectId` → `{ items, routines (4, avec derniers passages), constats (30 derniers non écartés), tableaux: { geo, serp } }`.
- `POST /api/veille/:projectId/proposer`.
- `POST /api/veille/:projectId/items` (ajout manuel, `suivi`), `PATCH /api/veille/items/:id` (statut, libellé, valeur), `DELETE /api/veille/items/:id`.
- Passer un élément en `suivi` assure la routine du type (active). Plus aucun élément suivi du type → la routine reste, et passe `rien_a_faire`.
- `PATCH /api/veille/:projectId/routines/:kind` (actif) · `POST /api/veille/:projectId/routines/:kind/run` (409 si déjà en cours).
- `PATCH /api/veille/constats/:id` (statut).
- Tout est vérifié : projet à l'utilisatrice, élément à l'utilisatrice. Validation pure des corps.

### Contexte de Naya

`buildNayaContext` ajoute un bloc **« Veille du marché »** : au plus 8 constats `nouveau` ou `vu` des 30 derniers jours du projet, groupés (voix du client d'abord), une ligne chacun, avec la consigne « appuie-toi dessus quand c'est pertinent ; n'invente rien au-delà ». Présent aussi en mode `tiers` (prospection) : les objections et le vocabulaire réels servent les messages ; aucun élément personnel n'y figure. Formatage pur et testé (`blocVeille`).

### Page « Veille »

Route `/veille`, entrée dans la barre latérale (icône radar). Pour le projet actif (sinon invitation à choisir un projet) :
1. En-tête : à quoi sert la veille, bouton « Naya propose ma liste ».
2. La liste, par type : éléments proposés (Suivre / Écarter), suivis (Retirer), ajout manuel.
3. Quatre cartes de routine (composant générique tiré de `SourcingAutoCard`) : actif, « Lancer maintenant », dernier passage, prochain passage.
4. Constats récents : type, texte, lien source, « Vu » / « Écarter ».
5. Tableaux : GEO (prompt × moteur : citée oui/non, concurrents cités) et SERP (mot-clé : position de la marque, évolution).

Textes en FR et EN (`veille.*`), aucun texte en dur (cliquet `jsx-guard`).

## Erreurs

- Fournisseur en panne (toutes les recherches ou toutes les lectures échouent) → `erreur`, résumé neutre, pas de notification, raison journalisée.
- Échec partiel (un concurrent, une page) → ignoré, compté dans `details`.
- Réponse IA illisible → aucun constat, passage `erreur` si c'était la seule étape utile.
- Le reset de compte supprime les trois nouvelles tables.

## Hors périmètre

- Bibliothèque de publicités Meta et TikTok Creative Center (pas d'accès stable sans jeu de données dédié ; à ajouter comme source du type `concurrent`).
- Prix sur Google Shopping et marketplaces.
- Annonces payantes dans la SERP.
- Presse et opportunités PR (la salle de lecture couvre l'actualité).
- Transformer un constat en contenu d'un geste (le contexte de Naya suffit pour commencer).
- Mode agence.

## Migration et déploiement

- `drizzle-kit generate`, relecture du SQL (création de trois tables, rien d'autre), migration sur la branche de dev uniquement.
- Prod : migration manuelle par Jeanne après sauvegarde, puis push.
- Au déploiement, **aucune dépense nouvelle** : les routines de veille n'existent qu'après qu'un élément a été suivi.

## Tests

- **Purs :** analyse GEO (citation, variantes, accents, domaine, position, concurrents, sources) ; comparaison GEO ; positions SERP et comparaison ; empreinte et changement de page ; anonymisation des verbatims ; lecture des réponses IA (constats VoC, résumé d'offre, proposition de liste) ; dédoublonnage ; validation des corps ; `blocVeille` ; taux d'engagement et contenus forts ; lecture des réponses OpenAI et Perplexity.
- **Exécuteurs** (dépendances injectées) : garde (accès, budget, projet absent → désactivation) ; aucun élément suivi → aucune dépense ; premier passage → bilan ; changement → constat + notification ; panne → erreur sans notification ; plafonds respectés.
- **Routes :** propriété du projet et des éléments, suivi d'un élément → routine assurée, 409 sur passage en cours.
- **Contexte :** le bloc apparaît, y compris en mode tiers, et pas au-delà de 8 lignes.
