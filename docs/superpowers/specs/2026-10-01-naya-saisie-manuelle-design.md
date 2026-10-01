# Saisie manuelle de posts par marque — conception

**Date :** 1er octobre 2026
**Sous-projet 2 sur 3** de la demande d'origine (saisie manuelle · liens entre marques · curation du généré). Le sous-projet « liens entre marques » est livré ; voir `2026-09-30-naya-liens-entre-marques-design.md`.

## Ce qu'on construit

Un endroit où l'utilisatrice colle un texte libre contenant plusieurs posts — typiquement un calendrier de contenu qu'elle a écrit ailleurs — et où Naya le découpe en entrées du calendrier éditorial, par marque.

## Ce qu'on ne construit pas, et pourquoi

**Pas de campagne à la main.** Écarté par l'utilisatrice pendant la conception, en connaissance des trois alternatives proposées (contenant minimal, contenant complétable par Naya, formulaire complet). Ses posts se rattachent à la marque, pas à un contenant. Conséquence directe : `POST /api/campaigns` n'est pas sur le chemin de ce chantier, et la faille de spread brut qu'il porte **reste ouverte et hors périmètre** (voir « Ce que ce chantier ne couvre pas »).

**Pas d'apprentissage.** Le texte collé est une **source** : il produit des posts, puis son travail est fini. Il n'entre pas dans la mémoire de marque, n'est pas conservé comme matière de référence, et n'influence pas les générations ultérieures. Choisi explicitement contre trois alternatives, dont « elle découpe ET elle apprend ».

**Pas de validation avant écriture.** Les posts sont créés directement. L'utilisatrice a écarté « elle propose un découpage, tu tranches » — le motif qu'elle a pourtant retenu deux fois ailleurs — au motif que valider vingt posts un par un n'est pas de l'aide. **Cette décision déplace toute la charge de l'honnêteté sur le reçu** (Décision 4) : sans validation, la seule protection contre un mauvais découpage est qu'il soit visible.

**Pas de nouvelle vue.** Les posts sans date sont visibles dans la colonne « Idée » de l'onglet Pipeline, qui ne filtre pas sur la date.

## État constaté

Vérifié dans le dépôt au moment d'écrire, et non supposé :

| Élément | Emplacement | État |
|---|---|---|
| Création d'un post à la main | `client/src/pages/content-calendar.tsx:667` (`handleCreatePost`) | Existe : titre, corps, plateforme, type, pilier, objectif, date |
| Réserve des posts non datés | `content-calendar.tsx:1642` | Existe : le pipeline filtre sur `contentStatus`, pas sur la date |
| Vue calendrier | `content-calendar.tsx:648` | Écarte les contenus sans `scheduledFor` — attendu |
| Précédent d'import collé | `server/routes.ts:6843` (`/api/content/reception/import`) | Existe, onglets « manuel » / « CSV » en `content-calendar.tsx:1452` |
| Enregistrement des champs devinés | `shared/schema.ts` → `content.deducedFields` | Existe, trois états documentés (`null` / `[]` / `[...]`) |
| Filtrage par marque | `content-calendar.tsx:214` et `server/routes.ts:6595` | Existe de bout en bout |
| Pilier vide | `content-calendar.tsx:900`, `:758` | Sans danger : ne s'affiche pas si vide ; la seule exigence de non-vide porte sur le bouton « générer avec l'IA », pas sur l'enregistrement |
| Plafond de chargement | `server/storage.ts` → `getContent(userId, limit = 50, …)` | **Défaut** : `ORDER BY created_at DESC LIMIT 50`, et la page ne passe aucune limite |
| Détection de collision | `server/services/brand-links/collision.ts:102` | Prend **un** contenu, rend **une** collision |

## Décisions

### Décision 1 — Un seul appel modèle sur tout le texte

`CLAUDE_MODELS.smart`. La date du jour est injectée dans le prompt.

Contre l'alternative « segmenter puis qualifier, un appel par post » : vingt posts feraient vingt-et-un appels, et chaque post serait jugé sans voir les autres — or les dates d'un calendrier de contenu sont relatives entre elles (« puis le jeudi suivant »). Le modèle doit voir l'ensemble.

L'injection de la date du jour vient d'un défaut constaté en exécution réelle sur la revue du matin : sans ancre temporelle, un modèle date les contenus de façon arbitraire.

Le prompt ordonne d'**extraire, pas de réécrire**.

### Décision 2 — Le modèle rend `null` ; le serveur enregistre ce qu'il a comblé

Le modèle rend par post : `titre`, `corps`, et `plateforme` / `type` / `pilier` / `objectif` / `date` **ou `null`** quand le texte ne les dit pas. Il ne déclare jamais ses propres déductions.

C'est le serveur qui constate les `null`, applique le remplissage ci-dessous, et écrit la liste des champs comblés dans `deducedFields`.

**Pourquoi ce sens et pas l'autre :** un garde qui rapporte sur lui-même rapporte faux. C'est le défaut exact corrigé dans le chantier précédent, où un plafond journalisait un nombre inventé. Un modèle à qui l'on demande « quels champs as-tu devinés ? » répond une opinion ; un serveur qui compare ce qu'il a reçu à ce qu'il a écrit énonce un fait.

| Champ | Si absent du texte | Inscrit dans `deducedFields` |
|---|---|---|
| `platform` | la plateforme la plus fréquente parmi les contenus existants de cette marque ; `linkedin` si la marque n'a aucun contenu ou en cas d'égalité | oui |
| `contentType` | `post` | oui |
| `pillar` | chaîne vide — **aucun pilier n'est inventé** | non : rien n'a été deviné |
| `goal` | chaîne vide | non |
| `scheduledFor` | `null` — le post part en réserve | non |

`deducedFields` vaut `[]` quand rien n'a été comblé, ce qui correspond à l'état déjà documenté sur la colonne (« routage effectué, RIEN n'a été déduit »).

**Changement de portée de la colonne, à acter :** son commentaire la décrit aujourd'hui comme propre au routage depuis une tâche. Elle devient « champs que Naya a déduits au lieu de les recevoir de l'utilisatrice », quelle que soit l'origine. Le commentaire doit être mis à jour dans le même chantier, sinon il devient faux.

### Décision 3 — Une date n'est posée que si le texte nomme un jour résoluble

« Lundi 6 octobre » donne une date. « Semaine du 12 » n'en donne pas : le post part en réserve, et l'expression reste dans son corps puisque le corps est le texte de l'utilisatrice.

Conforme au choix explicite « les posts sans date restent sans date », et au principe que ce dépôt applique partout : une absence d'information reste une absence, jamais une valeur devinée présentée comme une mesure.

### Décision 4 — La mesure de couverture

Après découpage, le serveur compare la somme des longueurs de `titre` + `corps` de chaque post extrait à la longueur du texte collé, et le reçu l'énonce : « 14 posts créés, couvrant environ 85 % de ton texte. »

Le pourcentage affiché est borné à 100. Le ratio brut est journalisé : un ratio nettement supérieur à 1 signifie que le modèle a réécrit au lieu d'extraire, information utile au débogage et invisible autrement.

**Cette mesure est la contrepartie de l'absence de validation.** Un découpage qui rate quatre posts sur dix-huit ne produit aucune erreur : il produit un résultat silencieusement appauvri — la classe de défaut que les deux chantiers précédents ont rencontrée quatre fois, et que ni 1325 ni 1524 tests verts n'ont vue. La couverture ne corrige pas le découpage ; elle le rend visible.

### Décision 5 — Recoller ne duplique pas

Un post dont le titre normalisé existe déjà dans cette marque est ignoré, et le reçu le dit : « 2 posts déjà présents, ignorés. » La déduplication s'applique aussi à l'intérieur d'un même lot.

Réutilise `normalizeTitle` de `server/services/reading/url.ts`, écrit pour la revue du matin.

Couvre le double-clic, et le cas réel : modifier son calendrier et le recoller.

**Le prix, énoncé :** deux posts volontairement homonymes dans la même marque sont impossibles — le second est refusé. Le reçu le dit, donc l'utilisatrice peut renommer. Pas de fenêtre de temps : un titre déjà présent est déjà présent.

### Décision 6 — Écriture en une transaction

`db.transaction`, motif utilisé à neuf endroits du dépôt dont `server/services/reading/queries.ts:197`.

Un échec au dixième post ne laisse pas les neuf premiers dans le calendrier. L'utilisatrice recolle ; elle ne nettoie pas.

Les posts sont créés en `status: 'draft'`, `contentStatus: 'idea'`, avec le `projectId` de la marque sélectionnée.

### Décision 7 — Le reçu n'est pas une notification

Le dialogue d'import reste ouvert et affiche le reçu en place ; l'utilisatrice le ferme.

**Contrainte, pas préférence :** `TOAST_LIMIT = 1` dans `client/src/hooks/use-toast.ts` — un second toast écrase le premier. Le reçu porte quatre faits (posts créés, couverture, ignorés, recoupements) et n'y tiendrait pas.

Le reçu est un constat ponctuel, pas un compteur qui s'accumule : il ne contrevient pas à l'interdiction des compteurs et des rappels.

### Décision 8 — La collision se contrôle une fois pour tout le lot

Un collage crée plusieurs contenus datés d'un coup — exactement la forme qui échappe à l'alerte existante.

`detecterCollisionLot` est ajoutée à `server/services/brand-links/collision.ts`. Les deux parties communes avec `detecterCollision` — la recherche des liens à audiences recoupées et la requête des contenus voisins — sont **extraites** en fonctions partagées plutôt que dupliquées. La preuve que l'extraction n'a rien cassé : les tests existants de `detecterCollision` passent sans être modifiés.

La fenêtre couvre l'amplitude du lot. Les plafonds existants s'appliquent (`MAX_CONTENUS_COMPARES = 12`) et un plafond symétrique de 12 borne les posts du lot présentés au modèle. **Quand un plafond mord, le journal dit ce qui a été écarté — pas un nombre inventé.**

Un appel, pas vingt. Contre l'alternative « un contrôle par post », écartée pour la même raison que sur le lancement de campagne : 10 à 16 appels modèle par geste.

Best-effort de bout en bout : un échec de la détection ne fait jamais échouer l'import. Les posts sont déjà écrits.

**Couverture après ce chantier :** l'alerte s'exécute sur trois chemins d'écriture de `scheduledFor` sur six — `POST /api/content`, `PATCH /api/content/:id`, et le nouvel import. Elle ne s'exécute toujours pas sur `POST /api/content/cross-post`, `POST /api/campaigns/:id/launch` ni `POST /api/campaigns/:id/regenerate-content`.

### Décision 9 — Les deux couples prompt/parseur sont vérifiés contre le vrai modèle avant fusion

Ce chantier crée deux couples : l'extraction des posts, et le verdict de collision en lot. Chacun est exécuté une fois contre le vrai modèle, sur un texte réel, avant la fusion.

**Pourquoi c'est une tâche et non un espoir :** dans le chantier précédent, un prompt qui présentait ses éléments sous la forme `[1] Titre` a fait répondre `"[1]"` à un parseur qui exigeait un entier. Une collision correctement détectée a été jetée en silence, avec 1524 tests verts, dont un test correct affirmant que le parseur rejette un identifiant non numérique. Le prompt fabriquait exactement le format que son parseur refusait. Aucun test unitaire ne peut trouver ça.

### Décision 10 — Le plafond de chargement cesse d'être silencieux

Hors de la demande d'origine, inclus sur arbitrage explicite de l'utilisatrice.

`getContent` rend au maximum 50 lignes, les plus récemment créées, et la page n'envoie aucune limite. Coller 20 posts dans une marque qui en compte 40 fait disparaître de la vue 20 posts anciens — **dont des contenus programmés pour les semaines à venir.** Ils restent en base ; la page ne les montre plus ; rien ne le dit.

Correction : la page demande une limite explicite de 200, le serveur la valide, et **si le serveur rend exactement 200, la page l'énonce en une ligne.** Un plafond qui s'annonce n'est plus un plafond silencieux.

C'est la seule façon dont cette fonctionnalité peut faire perdre du travail déjà fait.

## L'endpoint

`POST /api/content/import`, corps `{ projectId, text }`.

- `projectId` validé et possédé par l'utilisatrice — 404 si absent ou non possédé, jamais 403 (motif du dépôt : ne pas révéler l'existence).
- `text` non vide, **40 000 caractères au maximum**. Au-delà : 400, avec un message nommant la limite et la longueur du texte reçu, pour que l'utilisatrice sache de combien couper.
- `isAiBlocked` consulté comme sur tout chemin consommant un appel modèle.

Réponse : les posts créés, le nombre d'ignorés, le pourcentage de couverture, et les recoupements détectés.

La détection de collision s'exécute **avant** la réponse, pour que le reçu la porte : l'endpoint coûte donc deux appels modèle, l'extraction puis le verdict de lot. Son échec est absorbé (Décision 8) et la réponse part sans recoupements plutôt que de faire échouer l'import.

## Découpage en fichiers

- `server/services/content-import/parse.ts` — le prompt, le parseur de la sortie du modèle, la mesure de couverture, le relevé des champs comblés, la résolution des dates. **Fonctions pures**, testables sans base ni modèle.
- `server/services/content-import/import.ts` — l'orchestration : appel modèle, déduplication, écriture transactionnelle.
- `server/services/brand-links/collision.ts` — `detecterCollisionLot` et les deux extractions partagées.
- `client/src/components/content/import-calendrier.tsx` — le dialogue, son onglet et son reçu.

## Critères d'acceptation

1. Coller un texte contenant plusieurs posts crée une entrée par post dans la marque sélectionnée.
2. Un post dont le texte nomme un jour résoluble porte cette date ; tout autre post est créé sans date et apparaît dans la colonne « Idée ».
3. « Semaine du 12 » ne produit **aucune** date.
4. Aucun pilier n'est inventé : absent du texte, il reste vide, et n'apparaît pas dans `deducedFields`.
5. `deducedFields` contient exactement les champs que le serveur a comblés, et `[]` quand il n'a rien comblé.
6. Le reçu énonce le nombre de posts créés, le pourcentage de couverture, et le nombre d'ignorés.
7. Recoller le même texte ne crée aucun doublon, et le reçu le dit.
8. Un texte de plus de 40 000 caractères est refusé avec un message nommant la limite et la longueur reçue.
9. Un échec en cours d'écriture ne laisse aucun post créé.
10. Les posts datés du lot sont comparés une fois aux contenus programmés des marques liées à audiences recoupées ; un échec de cette comparaison ne fait pas échouer l'import.
11. Les tests existants de `detecterCollision` passent sans modification après l'extraction des fonctions partagées.
12. La page demande 200 contenus et énonce le plafond quand il mord.
13. Aucun test n'exécute de requête réelle : `./db` est moqué partout.

## Ce que ce chantier ne couvre pas

- **`POST /api/campaigns` et `PATCH /api/campaigns/:id` font un spread brut de `req.body`**, rendant `articuleAvecCampaignId` écrivable par le client vers n'importe quelle campagne, y compris d'une autre utilisatrice. Aujourd'hui sans conséquence : aucun code ne lit cette colonne au-delà de ce que le serveur recalcule lui-même (vérifié : seule écriture en `server/routes.ts:9994`, aucune lecture). **À fermer avant tout chantier qui la lira.** Hors périmètre ici parce que la campagne à la main a été écartée.
- Les trois chemins de programmation sans détection de collision (`cross-post`, `launch`, `regenerate-content`) restent sans détection. Dimensionné en sous-projet.
- La curation du généré — rejeter ou supprimer une campagne générée pour une marque — est le sous-projet 3, non traité ici.
- `server/routes.ts.bak` est suivi par git : 283 Ko de copie morte datée du 27 mars 2026, qui pollue toute recherche dans le dépôt. Sans rapport avec ce chantier, à supprimer un jour.
