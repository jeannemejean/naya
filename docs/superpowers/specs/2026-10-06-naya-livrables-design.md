# Livrables de tâche — conception (étape 1 : déposer et conserver)

**Date :** 6 octobre 2026
**Étape 1 sur 3** de l'approche A validée le 6 octobre :
1. **Déposer et conserver** — ce document.
2. Naya annonce le livrable attendu à la génération, et la zone de dépôt s'y adapte.
3. Naya enchaîne : le dépôt génère ou débloque la tâche suivante, qui réutilise ce qui a été déposé.

> Demande d'origine, dans les mots de l'utilisatrice : « quand j'ai ce genre de tâches où on me demande de produire quelque chose, il faut qu'au moment où je clique sur la tâche, je puisse rentrer dans le système les informations ou les choses qu'on m'a demandées. Par exemple uploader les photos avec chacune une petite description. L'objectif c'est que ce que je donne à Naya soit ensuite conservé quelque part ou placé à un autre endroit pour servir à mes projets — il faut toujours que ce que Naya me demande ait une utilité. »
>
> Exemple déclencheur : « Photographier 3 détails de ton environnement créatif + annoter chacun avec une observation ».

## Ce qu'on construit

Dans l'espace de travail d'une tâche, une section **« Ce que tu as produit »** où l'on dépose du texte, des photos/vidéos (chacune avec sa description), des fichiers et des liens. Chaque dépôt est **rangé là où il sert** : médiathèque (matière pour les posts), mémoire de Naya (elle te connaît mieux), projet (onglet « Livrables »).

Utilités retenues par l'utilisatrice, toutes les quatre : matière pour les posts · Naya me connaît mieux · rangé dans le projet · Naya enchaîne la suite (cette dernière = étape 3).

## Ce qu'on ne construit pas, et pourquoi

- **Pas de déclaration du livrable attendu par le générateur.** C'est l'étape 2. En attendant, une tâche de production est repérée à son verbe (voir « Repérage »).
- **Pas d'enchaînement automatique vers une tâche suivante.** Étape 3.
- **Pas d'extraction du contenu des fichiers** (texte d'un PDF vers la mémoire). Le fichier est rangé, pas lu. Un chantier à part si le besoin se confirme.
- **Pas de blocage.** Cocher une tâche sans dépôt reste possible (« Fait hors Naya ») — décision de l'utilisatrice : « Naya demande, sans bloquer ».
- **Pas de rattrapage par tâche planifiée (worker).** Le rattrapage mémoire est paresseux (voir « Erreurs »). `backfillBusinessMemory` existe mais n'est appelé de nulle part ; on ne s'appuie pas dessus.

## État constaté

Références par **fichier + symbole** (les numéros de ligne dérivent).

| Élément | Emplacement | État |
|---|---|---|
| Ouverture d'une tâche | `client/src/components/task-workspace.tsx` → `TaskWorkspace` (Sheet), ouvert depuis `planning.tsx` (`setWorkspaceTask`) et `todays-tasks.tsx` | Existe. **Texte seul**, aucun upload |
| Entrées de travail | `shared/schema.ts` → `taskWorkspaceEntries` ; `POST /api/tasks/:id/workspace` | Existe, liée à la tâche, **sans média** |
| Upload média | `POST /api/media/upload-url` → `server/services/r2-storage.ts` → `createUploadUrl` (URL présignée PUT, 1 h) | Existe, **`image/*` et `video/*` seulement** |
| Médiathèque | `shared/schema.ts` → `mediaLibrary` ; `POST /api/media-library` | Existe. `alt`, `tags`, `folder`. **Ni `projectId` ni `taskId`** |
| Réutilisation d'une photo dans un post | `content.mediaIds` / `content.mediaUrl` ; `SocialComposer.tsx`, `content-calendar.tsx` | Existe : une photo de la médiathèque est déjà proposable dans un post |
| Stockage R2 | `server/services/r2-storage.ts` | **Un seul bucket, servi publiquement** (`R2_PUBLIC_BASE_URL`) : tout objet est lisible par qui connaît son URL |
| Dépôt en mémoire | `server/services/memory/deposer-dossier.ts` → `deposerDossier` | Existe : découpe, embedding best-effort, écrit dans `memory_entries` fil `savoir`, `entryType` `fait`, avec `projectId` |
| Mémoire relue par l'IA | `server/services/naya-context.ts` → `buildNayaContext` → `retrieveMemories` | Existe : le fil `savoir` est injecté dans chaque appel IA |
| Péremption mémoire | `memoryEntries.supersededAt` | Existe : « périmé = invalidé, pas supprimé » |
| Terminer une tâche | `POST /api/tasks/:id/complete` ; appels dans `todays-tasks.tsx`, `planning.tsx`, `projects.tsx` | Existe |
| Page projet | `client/src/pages/project/ProjectPage.tsx` | Existe, à onglets/panneaux |
| Livrable attendu sur une tâche | — | **N'existe pas** (aucun champ, aucune sortie du générateur) |

## Expérience

### Dans la tâche
Sous la zone de texte de `TaskWorkspace`, une section **« Ce que tu as produit »** avec quatre boutons : **Texte · Photo/vidéo · Fichier · Lien**.

- **Photo/vidéo** : sélection multiple ; chaque élément apparaît en vignette avec un champ **Description** dessous.
- **Fichier** : ligne avec nom du fichier + champ **Note** facultatif.
- **Lien** : URL + champ **Note** facultatif.
- **Texte** : bloc libre, distinct des notes de travail (ex. le pitch, la liste de prospects).
- Chaque livrable déposé reste listé dans la tâche, modifiable et supprimable.

### En cochant
Si la tâche est **de production** (voir « Repérage ») et qu'**aucun livrable** n'y est déposé, cocher ouvre la tâche directement sur la section, avec une phrase du type : « Tu as photographié tes 3 détails ? Dépose-les ici, ils serviront à tes posts. » Deux sorties : **Déposer**, ou **« Fait hors Naya »** qui coche la tâche sans rien demander de plus. Pour les autres tâches, cocher reste instantané.

### Dans le projet
`ProjectPage` gagne un onglet **« Livrables »** : tout ce qui a été déposé pour ce projet, du plus récent au plus ancien, avec la tâche d'origine.

**Tâche sans projet :** le livrable est rattaché à la **marque active** au moment du dépôt (validé). Sans marque active non plus : `projectId` null, le livrable reste visible dans la tâche.

## Repérage d'une tâche de production (étape 1 seulement)

Fonction pure partagée `estTacheDeProduction(titre)` : vrai si le titre commence (après espaces/ponctuation) par un verbe de production — photographier, filmer, enregistrer, rédiger, écrire, lister, créer, concevoir, préparer, dessiner, monter, capturer, noter, documenter, compiler, collecter, rassembler (et formes « Rédige », « Liste »… à l'impératif tutoyé).

Exemples attendus : « Photographier 3 détails… » → vrai ; « Rédiger ton pitch » → vrai ; « Appeler Marie » → faux ; « Réunion client » → faux ; « Ostéopathes Mr Darcy » → faux.

Remplacée à l'étape 2 par le livrable déclaré.

## Données

### Nouvelle table `livrables`
Une ligne par élément déposé.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | serial PK | |
| `userId` | varchar FK `users.id`, not null | propriétaire |
| `taskId` | integer FK `tasks.id`, **ON DELETE SET NULL** | tâche d'origine ; le livrable survit à la tâche |
| `projectId` | integer FK `projects.id`, **ON DELETE SET NULL** | rangement |
| `kind` | text not null | `texte` · `media` · `fichier` · `lien` |
| `content` | text | description, note ou texte |
| `url` | text | URL du lien, ou clé/URL de l'objet stocké |
| `mediaId` | integer FK `media_library.id`, **ON DELETE SET NULL** | pour `media` |
| `fileName`, `mimeType`, `size` | text / text / integer | pour `media` et `fichier` |
| `memoryEntryIds` | jsonb `number[]` default `[]` | souvenirs créés, pour les périmer |
| `memoirePending` | boolean default false | dépôt mémoire à rattraper |
| `createdAt`, `updatedAt` | timestamp | |

### Changement sur `media_library`
Ajout de `projectId` integer nullable FK `projects.id` ON DELETE SET NULL.

### Migration
Écrite via `npx drizzle-kit generate`, **relue à la main**, montrée à l'utilisatrice, appliquée par `npm run db:migrate` avec sauvegarde Neon prise avant (procédure `MIGRATIONS.md`). Jamais `db:push` sur la prod. Doit être reflétée dans `server/services/account-reset-plan.ts` (`livrables` supprimés au reset ; le test `account-reset-plan.test.ts` l'exige).

## Rangement

| Type | Stockage | Médiathèque | Mémoire |
|---|---|---|---|
| `media` | R2 public (existant) | **Oui** : ligne `media_library` avec `alt` = description, `projectId`, `folder` = `livrables` | Description → `deposerDossier` |
| `texte` | — | Non | Texte → `deposerDossier` |
| `lien` | — | Non | Note → `deposerDossier` si non vide (un lien seul ne crée pas de souvenir) |
| `fichier` | **R2 privé** (nouveau) | Non | Note → `deposerDossier` si non vide |

Le titre passé à `deposerDossier` est construit depuis la tâche : `Livrable — <titre de la tâche>`, pour que chaque souvenir dise de quoi il parle.

### Modifier
Nouveau contenu → les `memoryEntryIds` existants reçoivent `supersededAt = now()`, puis nouveau dépôt ; `memoryEntryIds` remplacé. Pour `media`, `media_library.alt` est mis à jour.

### Supprimer
Souvenirs périmés (`supersededAt`). Pour `media` : la ligne `media_library` et l'objet R2 sont supprimés **sauf si un contenu les référence** (`content.mediaIds` contient l'id, ou `content.mediaUrl` = l'URL) — dans ce cas ils restent. Pour `fichier` : objet R2 privé supprimé.

## Stockage privé des fichiers

Le bucket actuel est public. Les fichiers (devis, documents de travail) ne doivent pas l'être.

- Nouveau bucket R2 **privé**, sans domaine public, désigné par `R2_PRIVATE_BUCKET` (mêmes identifiants R2).
- Upload : URL présignée PUT sur ce bucket. Lecture : `GET /api/livrables/:id/fichier` vérifie la propriété puis redirige vers une URL présignée GET de courte durée (5 min).
- Types acceptés : PDF, Word, Excel, PowerPoint, texte, CSV.
- **Tant que `R2_PRIVATE_BUCKET` n'est pas configuré**, le bouton Fichier est désactivé avec « bientôt disponible » ; aucun fichier n'est jamais rangé dans le bucket public. Création du bucket : manipulation guidée de l'utilisatrice dans Cloudflare puis variable dans Railway.

## API

| Route | Rôle |
|---|---|
| `GET /api/tasks/:id/livrables` | Livrables d'une tâche (+ rattrapage mémoire paresseux) |
| `GET /api/projects/:id/livrables` | Livrables d'un projet, récents d'abord (+ rattrapage) |
| `POST /api/livrables/upload-url` | URL présignée : `media` → bucket public (image/vidéo), `fichier` → bucket privé (503 `private_storage_not_configured` sinon) |
| `POST /api/livrables` | Crée un livrable (après upload le cas échéant) et range |
| `PATCH /api/livrables/:id` | Modifie le contenu |
| `DELETE /api/livrables/:id` | Supprime |
| `GET /api/livrables/:id/fichier` | Redirige vers une URL privée temporaire |

Toutes : `isAuthenticated`, filtrage par `userId`. Un livrable d'un autre compte → **404**.

## Erreurs

- **Upload raté** (réseau, taille) : l'élément reste affiché avec message et « Réessayer » ; la description saisie est conservée côté client ; rien n'est créé côté serveur tant que l'upload n'a pas réussi.
- **Limites** : 25 Mo par photo ou fichier, 200 Mo par vidéo, vérifiées côté client avant envoi **et** côté serveur à la création de l'URL (taille déclarée).
- **Mémoire indisponible** (écriture `memory_entries` en échec) : le livrable est créé quand même avec `memoirePending = true`. Rattrapage **paresseux** : à la lecture des livrables d'une tâche ou d'un projet, les livrables en attente sont redéposés (best-effort, sans bloquer la réponse). Un embedding raté n'est pas une erreur : `deposerDossier` écrit déjà le souvenir sans vecteur.
- **Lien invalide** : refusé à la saisie (URL http/https), et 400 côté serveur.
- **Accès** : 404 pour tout livrable d'un autre compte, y compris via `taskId`/`projectId` d'un autre compte.

## Tests

- **Repérage** : `estTacheDeProduction` sur les exemples ci-dessus.
- **Rangement** (fonction pure qui décide, à partir d'un livrable, des actions : médiathèque oui/non, mémoire oui/non) : photo → médiathèque + mémoire ; lien sans note → aucune mémoire ; fichier → pas de médiathèque.
- **Modifier** : anciens souvenirs périmés, nouveaux créés.
- **Supprimer** : média référencé par un contenu conservé ; sinon supprimé.
- **Accès entre comptes** : 404.
- **Plan de reset** : `livrables` présent dans `ACCOUNT_RESET_PLAN`, test de graphe FK vert.
- **Aucun test sur la base de production.**

## Questions ouvertes pour les étapes suivantes

- Étape 2 : forme du « livrable attendu » dans la sortie du générateur (type, quantité, destination) et adaptation de la zone de dépôt.
- Étape 3 : quelle tâche suivante générer à partir d'un dépôt, et avec quel garde-fou pour ne pas inonder le planning.
- Extraction du contenu des fichiers vers la mémoire : à décider sur besoin réel.
