# L'agent de Naya : omniscient et capable d'agir

Date : 2026-11-02 · Statut : validé par Jeanne le 2026-11-02

## 1. Intention

Le petit agent sur le côté de Naya (le « companion », web et mobile) est **le pont entre
l'intelligence de Naya et Jeanne**. Il doit :

1. **tout savoir** de ce qui est dans Naya, et le retrouver exactement quand on le lui demande ;
2. **agir** dans Naya à la place de Jeanne : tout ce qu'elle fait à la main, elle doit pouvoir
   le lui demander ;
3. **prendre des notes** : ranger au bon endroit ce qu'elle lui dit, pour que Naya s'en serve.

Le déclencheur : la semaine dernière, Jeanne a répondu dans une tâche sur la redéfinition d'un
service de l'agence. Elle retravaille l'étape 2 et demande à l'agent de lui rappeler sa réponse.
L'agent en est incapable. Sa réponse est pourtant dans Naya.

Pourquoi l'agent ne peut pas aujourd'hui (constaté dans le code, `server/services/companion.ts`
et `POST /api/companion/chat`) : il ne reçoit qu'un résumé (5 tâches du jour, 10 tâches à venir,
10 derniers messages, un résumé business, la mémoire générale via `buildNayaContext`). Il ne voit
ni les livrables (`livrables`), ni les réponses écrites dans les tâches (`task_workspace_entries`),
ni les conversations anciennes, et il ne peut rien chercher. Côté actions, il a une liste fixe
d'une quinzaine de gestes, exécutés par le navigateur (`useActionExecutor` dans
`NayaCompanion.tsx`).

## 2. Objectifs

1. **Retrouver n'importe quoi** dans les données de Jeanne, avec la source : « Le 27 octobre,
   dans la tâche “Redéfinir l'offre Accompagnement”, tu as écrit : … ».
2. **Agir partout** : tâches, projets, jalons, notes, livrables, campagnes de contenu et de
   prospection, prospects, réglages — au moins tout ce que l'interface permet.
3. **Ranger les informations** que Jeanne lui confie (note, fait, décision, préférence), dans le
   bon projet, de façon que le reste de Naya les utilise (mémoire existante).
4. **Même agent sur le web et sur le mobile**.
5. **Répondre vite** : une question simple ne doit pas prendre plus de quelques secondes.

## 3. Non-objectifs

- Ce chantier ne refait pas l'interface du companion (bulle, panneau) au-delà de ce qu'il faut
  pour montrer les recherches, les propositions de changement et le bouton « Annuler ».
- Pas d'accès à l'extérieur de Naya par l'agent (web, boîte mail, LinkedIn) : il voit ce que
  Naya contient, y compris les réponses de prospects que le chantier 2 range dans Naya.
- Pas de nouvelle mémoire parallèle : on s'appuie sur `memory_entries` et sur les tables
  existantes.

## 4. Anti-objectifs

- L'agent invente une réponse au lieu de dire « je ne trouve pas ». Toute réponse sur le passé
  cite sa source ; sans source trouvée, il le dit.
- L'agent voit ou modifie les données d'un autre utilisateur.
- Un gros changement part sans l'accord de Jeanne.
- Un petit changement ne peut pas être annulé.
- L'agent envoie quelque chose vers l'extérieur (message à un prospect, publication, campagne)
  sans validation explicite.

## 5. Décisions prises avec Jeanne

- **Omniscient** : il sait tout ce qui est dans Naya.
- **Ligne de partage des actions** (validée par Jeanne) :
  - **Il agit tout de suite**, pour les petits gestes réversibles : créer une tâche ou une note,
    cocher une tâche, déplacer une tâche, ranger une information dans un projet. Il dit ce qu'il a
    fait, avec un bouton **« Annuler »**.
  - **Il montre d'abord et attend le OK** pour : tout ce qui touche plusieurs éléments à la fois
    (décaler une semaine, réorganiser un projet), toute suppression, tout ce qui part vers
    l'extérieur (message à un prospect, publication, lancement de campagne), les changements de
    réglages. Il présente la liste précise des changements ; Jeanne valide ou ajuste.
- **Même agent sur web et mobile** (*mon choix, accepté*).

## 6. Le comment

### 6.1 Principe : des outils plutôt qu'un gros résumé

*Mon choix.* On ne peut pas mettre toute la base dans chaque message. L'agent reçoit un contexte
court (date, projet actif, énergie, résumé business, comme aujourd'hui) et des **outils** qu'il
appelle lui-même via l'API Claude (tool use, SDK `@anthropic-ai/sdk` déjà installé). Une boucle
côté serveur exécute les outils et renvoie les résultats jusqu'à la réponse finale.

### 6.2 Outils de lecture (« tout savoir »)

Toujours filtrés par `userId` côté serveur (jamais un paramètre fourni par le modèle).

- **`chercher`** : recherche dans tout ce que Jeanne a écrit ou reçu, par sens et par mots :
  réponses dans les tâches (`task_workspace_entries`), livrables (`livrables`), notes et captures
  (`quick_capture_entries`), mémoire (`memory_entries`), conversations avec l'agent
  (`companion_conversations`), contenus, réponses de prospects (`inbox_messages`). Filtres :
  projet, période, type de source. Chaque résultat donne : type, date, titre de la tâche ou du
  projet, extrait, identifiant pour l'ouvrir.
- **`lire`** : le contenu complet d'un élément trouvé (une réponse de tâche, un livrable, une note,
  une conversation).
- **Outils de consultation** par domaine : planning (tâches d'une période, faites ou non),
  projets et jalons, campagnes de contenu, campagnes de prospection et prospects (avec leur état
  de séquence), contenus publiés, mesures mensuelles, réglages.

*Mon choix* pour la recherche par sens : réutiliser l'indexation par embeddings déjà en place
pour `memory_entries` (`memory/embed.ts`, `memory/retrieve.ts`) et l'étendre aux réponses de
tâches, livrables, notes et conversations ; la recherche par mots (SQL) complète pour les noms
propres et les termes exacts. Les éléments existants sont indexés une fois (rattrapage), puis à
chaque création ou modification.

### 6.3 Outils d'action (« agir »)

Chaque outil d'action est classé **direct** ou **à valider**, selon §5, dans une table unique et
testée. L'exécution passe **côté serveur** (plus par le navigateur), avec les mêmes contrôles
d'accès que les routes existantes. On réutilise les fonctions de stockage et les services
existants plutôt que de dupliquer la logique des routes.

- **Direct** : créer une tâche, une note, une liste ; cocher / décocher une tâche ; déplacer une
  tâche ; ranger une information (note de projet, mémoire) ; régler l'énergie du jour.
  - Chaque action directe est **journalisée avec ce qu'il faut pour l'annuler** (l'état d'avant).
  - Le message de l'agent affiche ce qui a été fait et un bouton « Annuler » qui rejoue l'état
    d'avant. *Mon choix* : annulable pendant 24 h, et uniquement si l'élément n'a pas été
    modifié entre-temps (sinon l'agent explique pourquoi il ne peut pas annuler).
- **À valider** : décaler plusieurs tâches, réorganiser ou supprimer, créer / modifier / supprimer
  projets et jalons, campagnes, réglages, tout envoi vers l'extérieur.
  - L'agent produit une **proposition** : la liste précise des changements (avant → après), sans
    rien exécuter.
  - Jeanne clique « Valider » (tout exécuter), « Ajuster » (elle répond, l'agent refait la
    proposition) ou « Annuler ». Une proposition validée s'exécute en une fois ; si une partie
    échoue, l'agent dit exactement ce qui est passé et ce qui ne l'est pas.
  - *Mon choix* : une proposition expire si elle n'est pas validée dans l'heure, ou si les
    éléments concernés ont changé depuis.
- Les règles existantes de Naya restent valables pour l'agent (ex. jamais de tâche pour un jalon
  `locked`, voir `CLAUDE.md`). Les envois vers l'extérieur passent par les mêmes gardes que
  l'interface (interrupteur général, limites LinkedIn, etc.).

### 6.4 Prendre des notes

Quand Jeanne lui confie une information, l'agent choisit où la ranger : note dans un projet,
réponse dans une tâche, ou entrée de mémoire (fait, décision, préférence) via le mécanisme de
mémoire existant (`extractToMemory`). Il dit où il l'a rangée. Si le projet n'est pas clair, il
demande (règle déjà présente dans le companion pour la marque-sujet).

### 6.5 Conversation

- L'agent garde le fil de la conversation en cours comme aujourd'hui ; pour le passé plus ancien,
  il cherche (outil `chercher`), il ne dépend plus des 10 derniers messages.
- Il montre brièvement ce qu'il est en train de faire quand ça prend du temps (« je cherche dans
  tes tâches d'octobre… »).
- Il répond dans la voix de Naya (`CLAUDE.md`).

### 6.6 Précisions de construction (*mes choix*, après relecture)

- **Couche IA** : la boucle d'outils ne contourne pas la couche existante (`server/services/ai/`,
  `invocation-log`, quota `isAiBlocked`). On ajoute à cette couche un appel « avec outils »
  (Claude uniquement, modèle `strategic_reasoning`), journalisé et compté comme les autres appels.
- **Livraison en deux temps** :
  1. **Lot 1** : toute la lecture (recherche + consultation, tous domaines), les gestes actuels
     du companion déplacés côté serveur avec la règle direct / à valider, l'annulation et les
     propositions, la prise de notes.
  2. **Lot 2** : la parité avec l'interface, domaine par domaine (campagnes de contenu,
     prospection, réglages, mesures…), chaque nouvel outil classé direct / à valider.
- **Annulation** : le journal garde, pour chaque action directe, la liste des lignes touchées et
  leurs champs d'avant. « Modifié entre-temps » = les champs touchés n'ont plus la valeur que
  l'action leur avait donnée. Une information rangée en mémoire s'annule en la marquant périmée
  (`supersededAt`), comme le fait déjà la mémoire. « Créer une liste » = une liste de tâches
  (`task_lists`). « Déplacer une tâche » = changer sa date / son heure, sans relancer le
  planificateur automatique.
- **Web et mobile** : les deux utilisent `POST /api/companion/chat` (web : `NayaCompanion.tsx`,
  mobile : `mobile/app/(tabs)/companion.tsx`). Les actions s'exécutent côté serveur ; la réponse
  renvoie ce qui a été fait (avec l'identifiant d'annulation) et les propositions à valider. L'ancien
  exécuteur côté navigateur est retiré du web ; l'appli mobile est mise à jour dans ce chantier.
  Une ancienne version de l'appli mobile affiche simplement le texte de la réponse.
- **Progression** : pas de streaming dans ce chantier. Le panneau affiche « Naya cherche… » pendant
  l'attente ; la réponse liste ensuite, en une ligne discrète, où l'agent a cherché.
- **Index de recherche** : si un élément n'a pas encore d'embedding (échec ou indexation en
  cours), la recherche par mots le trouve quand même. L'agent ne dit « je ne trouve pas » qu'après
  les deux recherches. Le rattrapage indexe tout l'existant une fois, par lots, en arrière-plan.
- **Réponses de prospects** : ce sont des données de tiers. Elles sont cherchables **par mots
  seulement** (pas envoyées au service d'embedding) et lisibles par l'agent.
- **Isolation** : dans Naya, chaque projet appartient à une seule utilisatrice (pas de partage) ;
  le filtrage par `userId` (et le périmètre de projet existant) suffit.

## 7. Contraintes

- Prod : Express + Drizzle + Neon, déploiement Railway au push sur `main`. Les nouvelles tables
  (journal d'actions annulables, propositions, index de recherche) passent par une migration
  manuelle décidée avec Jeanne, sauvegarde Neon avant (`MIGRATIONS.md`). Jamais `drizzle-kit push`.
- `npx tsc --noEmit` à zéro erreur ; tests vitest pour la classification des actions, le filtrage
  par utilisateur, l'annulation, l'expiration des propositions.
- Coût IA : la boucle d'outils est bornée (*mon choix : 8 appels d'outils par message au plus*) ;
  la limite mensuelle existante (`isAiBlocked`) s'applique.
- Sécurité : chaque outil vérifie que l'élément appartient à l'utilisatrice ; le modèle ne fournit
  jamais l'identifiant d'utilisatrice. Le contenu trouvé (messages de prospects, articles…) est
  traité comme de la donnée, jamais comme des instructions pour l'agent.
- Ne pas pousser pendant qu'un travail long de Naya tourne.

## 8. Laissé au constructeur

- Le découpage exact des outils de consultation et leurs schémas.
- Le stockage de l'index de recherche (colonne d'embedding sur chaque table ou table d'index
  commune) et la stratégie de rattrapage.
- La mise en forme dans le panneau (résultats cités, propositions, bouton Annuler), dans le style
  actuel du companion.
- L'ordre de livraison, avec une contrainte : la **recherche** (cas de la réponse de tâche
  retrouvée) arrive en premier, car c'est le besoin le plus immédiat de Jeanne.
