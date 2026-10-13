# Simplifier Naya : tout ce qui concerne un projet, dans le projet — design

> Retour de Jeanne (13 oct. 2026) : trop d'onglets (Veille, Mesure, Savoir, Fondations…), il faut aller choisir le projet ailleurs pour remplir les Fondations du même projet, on ne peut rien écrire soi-même dans une partie vide (« si je clique dessus, il se passe rien »), et Naya devrait comprendre les données toute seule plutôt que de tout faire saisir.
> Choix de Jeanne : **A** (Fondations, Veille, Mesure deviennent des onglets de la page projet ; Savoir reste dans la barre, il n'est que pour elle), **A** (une partie vide est remplie par Naya à la première ouverture ; on corrige en cliquant sur le texte), **C** (Mesure : une phrase à Naya, et le formulaire reste), partie 1 du design validée, puis « continue jusqu'à la fin » avec les bonnes pratiques d'UI et d'UX.

## Intention

Un projet = un endroit. On choisit un projet, et tout ce qui le concerne est là, en onglets ; on passe d'un projet à l'autre sans quitter l'onglet. Chaque partie se remplit sans effort (Naya propose d'elle-même, on dit ses chiffres en une phrase) et se corrige d'un clic sur le texte. La barre latérale perd trois entrées.

## Principes d'UX appliqués

1. **Un endroit par objet** : ce qui appartient à un projet vit dans sa page.
2. **L'état est dans l'URL** (`/projects/7?onglet=mesure`) : le bouton Retour, un lien copié et une notification ouvrent exactement le bon écran.
3. **Cliquer fait toujours quelque chose** : tout texte modifiable s'édite au clic (survol visible : contour et crayon) ; une partie vide est une zone cliquable « Écrire moi-même », jamais un bloc inerte.
4. **Un seul geste principal par état vide** : un texte qui dit ce que Naya fera, et une action.
5. **Remplir à la place de l'utilisatrice** : Naya propose à partir de ce qu'elle sait ; on corrige plutôt que de saisir.
6. **Retour immédiat** : squelettes pendant le chargement, toast après chaque action, erreurs en clair.
7. **Accessibilité** : onglets au clavier (composant Tabs), libellés lisibles, focus visible, Échap annule une édition.

## 1. Navigation et page projet (validé)

- **Barre latérale** : Fondations, Veille et Mesure en sortent. Restent Tableau de bord, Planning, Analytics, Stratégie, Campagnes, Calendrier de contenu, Prospection, Projets, Savoir.
- **Page projet** `/projects/:id` à onglets : **Vue d'ensemble** (contenu actuel), **Fondations**, **Veille**, **Mesure**, et **Client** pour un projet client (connexions + rapports, retirés de la vue d'ensemble).
- **Onglet dans l'URL** : `?onglet=fondations|veille|mesure|client` ; absent ou inconnu → Vue d'ensemble ; « client » sur un projet perso → Vue d'ensemble.
- **Sélecteur de projet** : le nom du projet en en-tête est un menu ; choisir un autre projet ouvre `/projects/:autre?onglet=<le même>` (Client retombe sur Vue d'ensemble si l'autre n'est pas client).
- **Anciennes adresses** `/fondations`, `/veille`, `/mesure` : redirigent vers l'onglet du projet actif ; sans projet actif, vers `/projects`.
- **Notifications de Naya** : un message de routine porte un lien (nouvelle colonne `lien`, facultative, sur `companion_pending_messages`) ; le compagnon l'affiche en bouton « Ouvrir ». Bilan de Mesure → onglet Mesure ; rapport client prêt → onglet Client ; constats de veille → onglet Veille.

## 2. Fondations

- **Remplissage à la première ouverture** : le GET renvoie `aRemplir` (vrai si le projet n'a encore aucune fondation enregistrée). L'onglet lance alors seul la proposition, avec un état « Naya prépare tes fondations à partir de ce qu'elle sait du projet… » (squelettes). Côté serveur, `POST /proposer` avec `{ auto: true }` ne fait rien si une ligne existe déjà (aucune dépense), et pose d'abord une ligne vide avant d'appeler l'IA : même en cas d'échec, l'ouverture suivante ne repaie pas.
- **Édition au clic** : dans chaque carte, cliquer sur le contenu (ou sur la zone vide) ouvre l'édition de la section — y compris quand elle est vide. Le bouton « Modifier » disparaît ; restent « Valider » (proposition), « Reproposer », « Revenir en proposition ». Échap annule.
- **Partie vide** : zone pointillée cliquable « Écrire moi-même », et en lien secondaire « Laisser Naya proposer ».

## 3. Mesure en une phrase

- **Dans l'onglet Mesure** : un champ « Dis-moi tes chiffres du mois » (ex. « septembre : 12 000 €, 20 nouveaux clients, 2 000 € de pub Meta »). Naya en tire les champs (`POST /api/mesure/:projectId/phrase`, IA rapide, garde de dépense) et montre un aperçu ; « Enregistrer » complète le mois **sans effacer les autres champs** (seules les valeurs dites sont écrites). Rien n'est inventé : un chiffre non dit reste absent.
- **Dans le compagnon** : nouvelle action `saisir_mesure` { projectId, mois, champs } — même enregistrement (complétion) ; toast « Mesure de septembre mise à jour » avec lien vers l'onglet.
- **Enregistrement commun** : `POST /api/mesure/:projectId/mois/:mois/completer` — mêmes validations que la saisie, fusion par champ (comme l'import partiel).
- **Le rappel mensuel** dit : « Dis-moi tes chiffres de septembre (CA, nouveaux clients, dépenses), ici ou dans Mesure : je fais ton bilan. »
- **Le formulaire détaillé et l'import** restent, repliés sous « Saisie détaillée ».

## 4. Veille et Client

- **Veille** : même contenu, en onglet. Liste vide : un seul geste principal « Naya propose ma liste ».
- **Client** : les cartes Connexions et Rapports, déplacées telles quelles.

## Hors périmètre

- Refonte visuelle des autres pages (Planning, Stratégie…).
- Changer le contenu des routines.

## Tests

- Onglet lu depuis l'URL (valeurs inconnues, Client sur projet perso) ; redirections des anciennes adresses ; sélecteur conservant l'onglet.
- Proposition automatique : une seule fois, jamais si une ligne existe, ligne posée avant l'appel IA.
- Complétion de mois : champs dits seulement, validations, 404 projet d'une autre.
- Phrase → champs : nombres FR/EN, mois relatif (« le mois dernier »), canaux connus, rien d'inventé, sortie IA illisible → erreur.
- Lien des notifications : routine → message avec lien ; compagnon l'affiche.
- Locales FR/EN, cliquet jsx-guard.

## Arbitrages pris sans Jeanne

- **Proposition automatique** : un seul appel IA par projet, jamais répété (ligne posée avant l'appel).
- **Mesure par phrase** : aperçu avant enregistrement dans l'onglet ; dans le compagnon, enregistrement direct (Naya répète les chiffres compris dans sa réponse).
- **Le mois par défaut** d'une phrase sans mois est le mois écoulé.
