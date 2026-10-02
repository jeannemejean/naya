# Rejeter une campagne générée, par marque — conception

**Date :** 2 octobre 2026
**Sous-projet 3 sur 3** de la demande d'origine (liens entre marques · saisie manuelle · rejet du généré). Les deux premiers sont livrés et déployés : voir `2026-09-30-naya-liens-entre-marques-design.md` et `2026-10-01-naya-saisie-manuelle-design.md`.

> Demande d'origine, dans les mots de l'utilisatrice : « je veux pouvoir dire : non, tu vois la campagne qui a été générée pour Jeanne, je veux pas ça ».

## Ce qu'on construit

Écarter une campagne générée, depuis n'importe quel état, en disant éventuellement pourquoi — et faire en sorte que **Naya s'en souvienne** et ne repropose pas le même angle pour cette marque.

## Ce qu'on ne construit pas, et pourquoi

**Pas de régénération immédiate.** L'utilisatrice a écarté « elle me propose autre chose » : le rejet retire, il ne relance pas. Elle regénérera quand elle voudra, et la préférence sera là.

**Pas de branchement de la génération de campagne sur `buildNayaContext`.** Écarté délibérément. `generateCampaignStrategy` appelle le modèle en direct (`server/services/openai.ts`, via `callClaudeDetailed` à la ligne 1248) et ne lit donc aujourd'hui **aucune** mémoire de marque — elle reçoit l'ADN explicite, le contexte de semaine et l'articulation. La brancher sur le contexte Naya ferait entrer d'un coup toute la mémoire (`cap`, `founder`, `reception`, `savoir`) dans un chemin soigneusement réglé, de façon peu prévisible.

**C'est un chantier à part, et la question qu'il pose mérite d'être posée pour elle-même : « la génération de campagne devrait-elle lire la mémoire de marque ? »** La glisser dans une fonctionnalité de rejet serait la trancher sans la poser.

**Pas de table dédiée aux rejets.** `memoryEntries` est déjà la bonne forme, et en créer une seconde ferait deux sources de vérité — le défaut nommé dans le chantier précédent.

## État constaté

Vérifié dans le dépôt et dans la base de production au moment d'écrire, pas supposé. Les références sont données par **fichier + symbole** plutôt que par numéro de ligne : la revue du chantier précédent a constaté que les numéros de ligne d'un spec dérivent de quinze lignes en deux jours.

| Élément | Emplacement | État |
|---|---|---|
| Suppression d'une campagne | `server/routes.ts` → `DELETE /api/campaigns/:id` | Existe |
| Cascade de suppression | `server/storage.ts` → `deleteCampaign` | Cascade les campagnes de **prospection** dans les deux sens. **Rien sur `content` ni `tasks`.** |
| Bouton « Écarter » | `client/src/pages/campaigns.tsx` → `handleDiscard` / `deleteMutation` | Existe, mais **uniquement dans le panneau d'aperçu**, avant lancement |
| `content.campaign_id` → `campaigns.id` | contrainte `content_campaign_id_campaigns_id_fk` | **`NO ACTION`** (vérifié en production) |
| `tasks.campaign_id` → `campaigns.id` | contrainte `tasks_campaign_id_campaigns_id_fk` | **`NO ACTION`** (vérifié en production) |
| `campaigns.articule_avec_campaign_id` | contrainte homonyme | `SET NULL` (vérifié en production) |
| Retour sur un contenu régénéré | `server/routes.ts` → `POST /api/content/:id/regenerate` | Existe : `feedback` injecté dans le prompt, **jeté après usage** |
| Mémoire de marque | `shared/schema.ts` → `memoryEntries` (ligne 1884) | Existe : fil `cap`/`founder`/`reception`, `entryType` `fait`/`décision`/`préférence`/`observation`, `projectId`, `embedding`, `salience`, **`supersededAt` (« périmé = invalidé, pas supprimé »)** |
| Lecture de la mémoire par le contexte | `server/services/naya-context.ts` → section 7 (ligne 186) | Existe, récupération sémantique × fraîcheur × salience |
| Génération de campagne ↔ mémoire | `server/services/openai.ts` → `generateCampaignStrategy` | **Aucun lien.** C'est le fait central de ce chantier |
| Rattrapage d'embeddings | `server/services/memory/backfill.ts` → `backfillBusinessMemory` | Existe mais **n'est appelé de nulle part** : outil de migration ponctuel, pas un mécanisme qui tourne |
| `embedText` | `server/services/memory/embed.ts` (ligne 19) | Rend `number[] | null` — peut échouer |

### Le défaut latent, et quand il mord

Supprimer une campagne qui a produit du contenu **ou** des tâches échoue sur une violation de contrainte, et l'endpoint rend un **500 « Failed to delete campaign »**. Une campagne lancée crée les deux.

Vérifié sur la production : les deux campagnes existantes (`De Stratège à Scène` sur *Jeanne Mejean - Personal Branding*, `Make Brands Unmistakable` sur *Agence JMD*) sont en `draft`, 0 tâche, 0 contenu — donc supprimables **aujourd'hui**. Le défaut mord au premier lancement.

## Décisions

### Décision 1 — Le rejet écrit une préférence dans la mémoire de la marque

Fil `cap`, `entryType: "préférence"`, `projectId` de la marque. Pas de table nouvelle, pas de marqueur à inventer.

Le mécanisme existant fournit gratuitement ce qu'il faut : `supersededAt` pour invalider sans détruire, `salience` pour ordonner, l'embedding pour la pertinence sémantique ailleurs.

### Décision 2 — La génération reçoit « les préférences de la marque », pas « les rejets »

`generateCampaignStrategy` gagne un champ dédié, sur le motif exact de `articulation` au chantier précédent — et pour la raison qui y est écrite : « `weekContext` décrit la semaine de l'utilisatrice ; y mélanger l'articulation brouillerait les deux. D'où le champ dédié. »

Le champ est alimenté par une requête sur `memoryEntries` : fil `cap`, `projectId` de la marque, `supersededAt IS NULL`, `entryType = "préférence"`. Ordonné par `salience` décroissante puis récence. **Plafonné**, et le journal annonce le **compte réel** écarté quand le plafond mord — jamais une approximation.

**Pourquoi « préférences » et non « rejets » :** si l'utilisatrice a exprimé une préférence par un autre chemin, la génération devrait l'honorer aussi. Le rejet est une façon d'en déposer une, pas une catégorie à part.

### Décision 3 — Seul le non-publié part avec la campagne

Choisi explicitement contre trois alternatives, dont « Naya me dit ce qu'elle va emporter » (une décision à chaque rejet) et « tout part » (irréversible).

**On garde un contenu dès qu'UN SEUL de ces signaux est allumé :** `publishedAt` non nul, **ou** `postStatus = 'posted'`, **ou** `contentStatus = 'published'`.
**On garde une tâche si `completed` est vrai.**

Les gardés sont **détachés** : `campaignId` passé à `null`. Tout le reste est supprimé.

**Pourquoi quatre signaux et pas un :** `content` porte `status`, `contentStatus`, `publishedAt` et `postStatus`, et ils peuvent se contredire — une carte glissée en « publié » dans le pipeline sans jamais partir sur une plateforme, ou l'inverse. Le sens prudent est le bon : **le coût de garder quelque chose en trop est de l'encombrement ; le coût de supprimer quelque chose de publié est de falsifier l'historique de l'utilisatrice.**

Le détachement est aussi ce qui **répare** la violation de clé étrangère au lieu de la contourner.

### Décision 4 — La raison est facultative, et l'écran dit ce que ça coûte

Pas de rejet bloqué faute de rédaction. Mais quand le champ est vide, **aucune préférence n'est écrite**, et l'écran l'énonce : « sans raison, Naya ne pourra pas l'éviter la prochaine fois. »

Écarté : « Naya devine la raison toute seule » — elle écrirait dans la mémoire de marque une supposition présentée comme la préférence de l'utilisatrice. C'est le défaut que ce dépôt corrige partout.

Soit elle apprend, soit elle dit qu'elle n'apprend rien. Jamais de demi-mesure silencieuse.

### Décision 5 — Les articulations rompues sont annoncées avant le rejet

`articuleAvecCampaignId` est en `SET NULL` : rien ne casse techniquement. Mais si la campagne d'une autre marque pointe vers celle qu'on rejette, son articulation disparaît **en silence**, et Naya lui reposera la question (le booléen `articulationIndependante` reste faux, donc l'état redevient « pas encore décidé »).

La confirmation nomme la campagne et sa marque : « la campagne « X » sur Agence JMD est articulée avec celle-ci — en la rejetant, cette articulation disparaît. » Une requête (`WHERE articule_avec_campaign_id = <id>`), une phrase.

### Décision 6 — Une seule transaction, et l'embedding en dehors

Ordre : détacher les gardés → supprimer les non-gardés → écrire la préférence → supprimer la campagne. Une seule `db.transaction`. Si quoi que ce soit échoue, rien ne s'est passé — l'utilisatrice réessaie, elle ne nettoie pas.

**L'embedding est calculé AVANT d'ouvrir la transaction.** Tenir une transaction ouverte pendant un appel réseau est une faute ; et `embedText` peut échouer.

### Décision 7 — La limite de l'embedding est énoncée, pas cachée

Si `embedText` rend `null`, la préférence est **quand même écrite** et **atteint le champ dédié** de la Décision 2 — donc elle agit bien sur la génération de campagne, qui filtre par fil et par marque sans embedding.

Mais elle reste **invisible à la récupération sémantique**, donc à `buildNayaContext`, donc à tous les autres appels de Naya. L'en-tête de `server/services/result-capture/observation-writer.ts` documente déjà ce piège : la requête trie `embedding IS NULL` en dernier et le plafond les coupe. Et **rien ne la rattrapera jamais** : `backfillBusinessMemory` n'est appelé de nulle part.

C'est une limite réelle. Elle est écrite ici pour que personne ne croie l'inverse dans six mois.

## Découpage en fichiers

- `server/services/campaign-reject/rejeter.ts` (créer) — la règle du publié (pure), la sélection des gardés et des partants (pure), l'orchestration transactionnelle.
- `server/services/campaign-reject/preferences.ts` (créer) — la requête des préférences d'une marque et leur formatage pour le prompt. Fonction de formatage **pure**, sur le motif de `formaterArticulation`.
- `server/routes.ts` (modifier) — `POST /api/campaigns/:id/reject`, et `GET /api/campaigns/:id/reject-preview` pour ce que la confirmation annonce.
- `server/services/openai.ts` (modifier) — `generateCampaignStrategy` reçoit et injecte les préférences.
- `client/src/pages/campaigns.tsx` (modifier) — le geste disponible depuis tout état, et la confirmation.

Aucune migration : aucune colonne nouvelle.

## Critères d'acceptation

1. Rejeter une campagne sans contenu ni tâche la supprime, depuis n'importe quel état.
2. Rejeter une campagne **lancée** réussit — le défaut de clé étrangère ne se produit plus.
3. Un contenu avec `publishedAt` non nul **survit** au rejet, détaché (`campaignId` à `null`).
4. Idem pour `postStatus = 'posted'` et pour `contentStatus = 'published'`, chacun vérifié **séparément**.
5. Une tâche `completed` survit, détachée ; une tâche non faite part.
6. Un brouillon non publié part.
7. Avec une raison, une entrée `memoryEntries` est écrite : fil `cap`, `entryType = "préférence"`, bon `projectId`.
8. **Sans raison, aucune entrée n'est écrite**, et l'écran énonce la conséquence.
9. `generateCampaignStrategy` reçoit les préférences de la marque et son prompt les contient.
10. Les préférences d'une **autre** marque n'entrent jamais dans le prompt de celle-ci.
11. Une préférence `supersededAt` non nul n'entre pas dans le prompt.
12. Le plafond des préférences journalise le **compte réel** écarté.
13. La confirmation annonce les articulations qui seront rompues, avec le nom de la campagne et de sa marque.
14. Un échec en cours de rejet ne laisse **rien** de modifié : ni contenu détaché, ni préférence écrite, ni campagne supprimée.
15. Un échec de l'embedding n'empêche pas l'écriture de la préférence.
16. Aucun test n'exécute de requête réelle : `./db` est moqué partout.

## Ce que ce chantier ne couvre pas

- **La génération de campagne ne lit toujours pas la mémoire de marque**, seulement le champ dédié des préférences. La question « devrait-elle la lire ? » reste ouverte et mérite son propre chantier.
- **Les préférences écrites sans embedding ne sont pas rattrapables** (Décision 7). Rendre `backfillBusinessMemory` appelable serait un chantier d'une heure, utile au-delà de celui-ci.
- Le rejet ne se propage **pas** aux marques liées : une préférence est propre à sa marque. Cohérent avec le principe du chantier des liens — l'absence de lien est une interdiction, et un lien déclaré sert à articuler, pas à transférer des préférences.
- `POST /api/campaigns` et son `PATCH` font toujours un spread brut de `req.body` (faille latente documentée au chantier précédent). Ce chantier ne les touche pas.
- Les trois chemins de programmation sans détection de collision (`cross-post`, `launch`, `regenerate-content`) restent sans détection.
