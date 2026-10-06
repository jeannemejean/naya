# Refuser un post, expliquer pourquoi, le remplacer si besoin — conception

**Date :** 6 octobre 2026

> Demande : « je vais aussi pouvoir refuser des posts sur les réseaux sociaux et expliquer pourquoi, et comme ça il me les supprime et il m'en crée d'autres s'il faut ».
> Choix : remplacement **au choix à chaque refus**, case « Remplace-le par un autre post » cochée par défaut.

## Ce qu'on construit

- Bouton **« Refuser »** sur la carte d'un post du calendrier de contenu (`client/src/pages/content-calendar.tsx`, `ContentCard`). Les posts de campagne y figurent ; la page campagne n'affiche pas les posts un par un.
- Fenêtre de refus : raisons propres aux posts, champ **« Explique à Naya pourquoi »**, case **« Remplace-le par un autre post »** (cochée par défaut).
- **Apprentissage par marque** : préférence dans la mémoire (`fil: "cap"`, `entryType: "préférence"`, `projectId` du post) — le même rangement que le refus de campagne, relu par `preferencesDeLaMarque` (génération de campagne) et par `buildNayaContext` (fil `cap` scopé à la marque).
- **Suppression** du post refusé (rien d'externe à annuler : la publication est directe à l'échéance).
- **Remplacement optionnel** : nouveau post généré, même réseau, marque, campagne, date prévue, type, pilier, objectif, compte social ; **`autoPost: false`** (jamais publié seul).

## Ce qu'on ne construit pas

- Pas de refus d'un post **publié ou en cours de publication** (409).
- Pas de validation « prêt à publier » (chantier distinct).
- Pas de refus groupé.

## État constaté

| Élément | Emplacement | État |
|---|---|---|
| Table `content` | `shared/schema.ts` | `projectId`, `campaignId`, `socialAccountId`, `platform`, `contentType`, `pillar`, `goal`, `intent`, `status`, `contentStatus`, `scheduledFor`, `publishedAt`, `autoPost` (défaut true), `postStatus` (pending/uploading/processing/posting/posted/failed), `mediaIds` |
| Publié ? | `server/services/campaign-reject/rejeter.ts` → `contenuEstPublie` | `publishedAt`, `postStatus === "posted"` ou `contentStatus === "published"` |
| Préférences de marque | `campaign-reject/preferences.ts` → `preferencesDeLaMarque`, `formaterPreferences` | fil `cap`, `préférence`, par `projectId`, plafond 8 |
| Suppression | `storage.deleteContent(id)` | Cascade `content_reception` |
| Régénération existante | `POST /api/content/:id/regenerate` | Retour non mémorisé (inchangé par ce chantier) |
| Carte du post | `content-calendar.tsx` → `ContentCard` | Actions : modifier, réception, régénérer, supprimer |

## Conception

### Raisons
`wrong_tone` (pas le bon ton), `wrong_angle` (mauvais angle), `not_for_brand` (pas pour cette marque), `too_many` (trop de posts), `inaccurate` (inexact), `other` (autre).

### `POST /api/content/:id/refuser`
Corps `{ reason, freeText?, remplacer?: boolean }` (`remplacer` défaut `true`).

Service `refuserPost` (dépendances injectées) :
1. Lire le post ; 404 si absent / autre compte ; 400 id non numérique.
2. Publié (`contenuEstPublie`) ou en cours (`postStatus` ∈ uploading, processing, posting) → `deja_publie` (409), aucune écriture.
3. Souvenir (best-effort) si explication non vide **ou** raison ≠ `other` : `fil "cap"`, `préférence`, `projectId` du post (null accepté), salience 0.8, embedding best-effort. Texte : `Post refusé (<réseau>, <pilier>) « <titre 80 car.> » — <raison lisible>[ : <explication 1500 car.>]`.
4. Si `remplacer` : générer (voir plus bas) ; si succès, créer le nouveau post (champs repris + `title`/`body` générés, `status: "draft"`, `contentStatus: "idea"`, `autoPost: false`, `postStatus: "pending"`).
5. Supprimer le post refusé (toujours, une fois les étapes précédentes tentées).
6. Réponse `{ refuse: true, remplacement: <post> | null, raison?: "generation_failed" }` (`raison` seulement si `remplacer` et échec).

### Génération
`genererPostRemplacement` : `callClaudeWithContext` (`projectId` du post, modèle rapide), message : le post refusé (réseau, type, pilier, objectif, titre, extrait 1200 car.), raison lisible, explication, préférences de la marque (`formaterPreferences(preferencesDeLaMarque(...))`), consigne : un post **prêt à publier** pour ce réseau, même objectif, en évitant ce qui a été refusé ; JSON `{ title, body }`. Validation pure (`title`/`body` non vides, title ≤ 200, body ≤ 5000). Garde de langue (`imposerLangueDuCompte` sur un objet `{ title, description: body }` puis recopie). Ne lève jamais.

### Client
`RefusPostModal` (nouveau composant) : raisons, explication, case remplacer ; bouton « Refuser » / « Refuser et remplacer » selon la case ; libellé d'attente « Naya rédige un autre post… » ; le texte est conservé si la requête échoue. Bouton « Refuser » sur `ContentCard`, masqué si le post est publié ou en cours. Toasts : « Post refusé. » / « Remplacé par « … » » / « Post refusé. Naya n'a pas pu en proposer un autre pour l'instant. » / « Ce post est déjà publié. » (409) / « Le refus a échoué. Réessaie. ». Invalidation des requêtes dont la clé commence par `/api/content` et `/api/campaigns`.

## Tests
- Pur : raisons, libellés, texte du souvenir (avec/sans explication, troncatures), « publié ou en cours », validation du remplacement.
- Génération : JSON valide → post ; invalide / levée → null ; le prompt contient raison, explication, préférences.
- Service : autre compte → introuvable sans écriture ; publié → `deja_publie` sans écriture ; souvenir `cap` avec `projectId` ; `remplacer: false` → pas de génération, suppression ; succès → création avec `autoPost: false` et champs repris, puis suppression ; échec génération → suppression + `generation_failed` ; échec souvenir non bloquant.
- Route : 400 id, 400 raison, 400 `remplacer` non booléen, 404, 409, 200.
- Aucun test contre la production.
