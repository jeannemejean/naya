# Naya ajuste le contenu et les campagnes depuis la conversation — conception

17 nov. 2026. Suite du correctif du 16 nov. (`fix/agent-consentement` : un « oui » écrit valide la
proposition, Naya ne peut plus annoncer fait ce qu'elle a seulement proposé).

## Pourquoi

Le 16 nov., Jeanne dit à Naya qu'il y a trop de posts préparés : les news de l'Agence JMD sortent
déjà tous les jours. Naya est d'accord, « valide » un nouveau cadre… et l'atelier ne bouge pas.
Ce n'était pas seulement le « oui » mal compris : **l'agent n'a aucun outil pour toucher aux posts
ni aux campagnes**. Il peut lire (`consulter_contenus`) mais ses outils à valider ne portent que sur
les tâches, les projets, les jalons et les mesures (`server/services/agent/outils/a-valider.ts`).

Ce que Jeanne veut, dans ses mots : quand elle dit « on baisse le rythme, j'ai déjà ça qui sort »,
Naya comprend ce que ça veut dire concrètement pour l'atelier et pour les campagnes, en discute
avec elle, puis le fait.

## État au 17 nov. (prod)

- 35 brouillons à venir d'ici fin décembre, tous `draft`, `auto_post = false`, format `feed_image` :
  19 de la campagne « Saisons, regards, désirs » (id 7, projet Agence JMD, canal réglé sur
  « 5x/semaine (3 publications grille + 2 stories) »), 16 de « Rendre mon regard visible » (id 8,
  projet Jeanne — Personal branding).
- Les posts d'une campagne sont créés **une fois**, au lancement ou par « Repenser »
  (`placerPostsCampagne`). Rien ne regénère l'atelier chaque semaine. Seul circuit qui ajoute des
  posts seul : la cadence de présence (`server/services/fil/presence.ts`), qui ne regarde que les
  comptes sociaux reliés (jeanne.mejean sur Instagram, LinkedIn de Jeanne).
- Les news JMD sont publiées par Metricool sur les comptes Instagram agencejmd et LinkedIn de
  l'agence, rédigées par une tâche ChatGPT. Ni ces comptes ni ces posts ne sont dans Naya.

## Le cadre convenu (avec Naya, le 16 nov.)

- Jeanne (personal branding) : 2 reels par semaine au plus, tournage le lundi après-midi,
  1 carrousel par semaine.
- Agence JMD : les news automatisées assurent le flux quotidien (3 posts par jour) ; dans Naya,
  seulement des posts ponctuels (projets spec, regard) pour soutenir la campagne, placés de façon
  sporadique « pour ne pas noyer le flux ».

## Ce que ça doit donner (le parcours)

1. Jeanne : « il y a trop de posts, j'ai déjà les news qui sortent tous les jours ».
2. Naya raisonne **en campagnes**, pas en posts : elle relie les posts trop nombreux à leur campagne,
   et dit ce que ça change. Par exemple : « Les news soutiennent déjà “Saisons, regards, désirs” ;
   la campagne reste valable, il lui faut seulement quelques posts ponctuels. »
3. **Avant de modifier**, elle propose de regarder les campagnes ensemble : 2 ou 3 questions par
   campagne concernée (est-elle toujours juste, faut-il la réorienter, quel rythme), pas plus.
4. Selon les réponses, une proposition validable (une carte, comme aujourd'hui), qui peut être :
   - **alléger** : supprimer les brouillons en trop (liste précise, titre et date de chacun), en
     gardant des posts répartis de façon espacée sur les semaines ;
   - **réorienter** : repenser la campagne avec une consigne issue de la conversation (nouveau
     rythme, nouvel angle). C'est exactement le bouton « Repenser » : Naya réécrit tout le plan de
     posts (décision de Jeanne, 17 nov.).
5. Jeanne valide (bouton ou « oui » écrit). Naya l'applique et dit ce qui est fait.
6. Naya **retient** le cadre (news JMD quotidiennes hors Naya, rythmes ci-dessus) pour ne pas
   reproposer un atelier plein la semaine suivante, ni relancer la cadence de présence à tort.

## Objectifs

- Deux nouveaux outils à valider pour l'agent : **supprimer des posts** et **repenser une
  campagne** (avec consigne).
- La consigne de l'agent (système) lui apprend le parcours ci-dessus : raisonner en campagnes,
  questionner avant de modifier, proposer.
- Le cadre de rythme et l'existence des news externes sont mémorisés par marque et respectés par
  l'agent, par « Repenser » (bouton compris), par les nouvelles campagnes et par la cadence de
  présence.

## Hors champ (cette version)

- Lire les news publiées via Metricool et leurs réactions (commentaires, messages, statistiques)
  pour nourrir la prospection : **chantier séparé**, rattaché au chantier Metricool du backlog.
  Ici, Naya sait seulement que les news existent, sur quels comptes, à quel rythme, pour quelle
  campagne.
- Changer la date ou le contenu d'un post isolé depuis la conversation.
- Mettre en pause ou terminer une campagne depuis la conversation.

## Anti-objectifs (ce qui serait un échec même si ça marche)

- Naya supprime ou repense sans validation explicite (carte ou « oui »).
- Naya annonce « c'est fait » alors que rien n'est appliqué (la garde du 16 nov. doit couvrir les
  nouveaux outils : participes « supprimés », « repensée »…).
- Un post publié, en cours de publication ou programmé pour publication automatique est supprimé.
- Un post supprimé laisse derrière lui ses tâches de production (tournage, montage) ou une session
  d'atelier vide dans le planning.
- Naya enchaîne cinq questions avant d'agir. Deux ou trois, puis une proposition.
- Le tri garde tous les posts en début de période et vide la fin (ou l'inverse) : les posts gardés
  doivent être répartis.

## Contraintes

- Le cadre des propositions existant (`outilAValider` dans `server/services/agent/propositions.ts`) :
  aperçu avec la liste avant → après, empreinte relue à la validation, expiration 1 h, exécution
  élément par élément avec bilan réussis / échecs.
- « Repenser » est long (trois générations IA, jusqu'à 240 s chacune) et tourne en fond
  (`lancerRepenser`, `server/services/campagne/repenser.ts`) ; il supprime tous les posts non
  publiés de la campagne et les tâches non faites, puis replace. Un déploiement pendant qu'il
  tourne le tue.
- Les règles du dépôt : `npx tsc --noEmit` à zéro, tests vitest, pas de migration sans la
  procédure de `MIGRATIONS.md`.
- Le mobile (`mobile/`) affiche les cartes de proposition : les nouveaux types de changements
  doivent s'y lire correctement.

## Décidé par Jeanne

- Les brouillons en trop sont **supprimés**, pas mis de côté.
- Réorienter une campagne = la **repenser** entièrement (comme le bouton), avec la consigne issue
  de la conversation.
- Naya propose d'abord de regarder les campagnes ensemble, avec quelques questions, avant de
  modifier.
- Les news Metricool : en contexte seulement pour cette version, lecture réelle plus tard.
- Le rythme convenu avec Naya s'applique **partout** (17 nov.) : l'agent, le bouton « Repenser »,
  les nouvelles campagnes et la cadence de présence. Sinon le tri ne tient pas : un Repenser à la
  main repartirait à 5 posts par semaine, et la présence rajouterait des posts dans les trous.

## Mes choix (à vérifier par Jeanne en lisant)

- Un post supprimable par l'agent : non publié, pas en cours de publication, `auto_post = false`.
  Sinon il est refusé dans l'aperçu avec la raison.
- Supprimer un post retire aussi ses tâches de production non faites, et la session d'atelier de
  sa semaine si elle n'a plus de post. Même logique que le refus d'un post existant
  (`server/services/refus-post/`), sans génération de remplacement.
- L'outil « repenser » rend la main tout de suite après validation (« Repenser est lancé, ça prend
  quelques minutes ») : Naya ne dit « c'est fait » qu'au sens « lancé ». Le résultat se voit dans
  la campagne, comme avec le bouton.
- Le cadre (rythmes, news externes) est enregistré **par marque (projet)**, pas un réglage unique
  pour l'utilisatrice : JMD et Jeanne n'ont pas le même rythme. Il ne faut pas écraser
  `brand_dna.content_bandwidth` (un seul champ par utilisatrice, lu par une dizaine de générateurs).
- Support : une **préférence de marque `suivre`** (`server/services/campaign-reject/preferences.ts`,
  table `memory_entries`), que la génération de campagne lit déjà (`contexteGeneration` de
  Repenser, lancement de campagne). L'outil qui l'écrit est un troisième outil à valider (« retenir
  le rythme de la marque »), ou une partie de la proposition d'allègement : au constructeur.
- La cadence de présence (`server/services/fil/presence.ts`) apprend à lire ce rythme par projet :
  le seuil de jours sans publication suit le rythme convenu, pour qu'elle ne rajoute pas de posts
  dans les trous laissés volontairement. Si le rythme a besoin d'une forme structurée lisible par
  du code (nombre de posts par semaine), la préférence la porte en plus de son texte ; une
  migration n'est faite que si c'est impossible autrement, selon `MIGRATIONS.md`.
- L'outil « repenser » de l'agent refuse, dans son aperçu, une campagne qui a un post non publié
  avec `auto_post = true`, en le nommant (Repenser le supprimerait, alors qu'il est prévu pour
  partir seul). Le bouton « Repenser » garde son comportement actuel.

## Laissé au constructeur

- Le nom et le schéma exact des deux outils, la forme des `changements` dans la carte.
- La façon de borner la consigne (« 2 ou 3 questions ») dans le prompt système.
- Les tests (au minimum : aperçu de suppression avec posts refusés, empreinte qui change entre
  aperçu et validation, repenser déjà en cours, garde « c'est fait » sur les nouveaux participes).
