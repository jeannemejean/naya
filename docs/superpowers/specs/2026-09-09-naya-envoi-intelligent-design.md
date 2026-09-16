# Envoi intelligent — le bon moment, pour la cible et pour le compte — design

**Date :** 2026-09-09
**Origine :** Jeanne — « il faut que Naya comprenne les restrictions et gère les flux d'envoi de manière intelligente, pour que ça ressemble le plus à un humain qui les enverrait. Et les flux dans le temps, ça permettrait aussi de toucher les cibles exactement au bon moment. »
**Périmètre :** prospection LinkedIn. Rien pour l'email dans ce lot.
**Socle :** la garde de risque livrée en amont (`server/services/prospection-linkedin-guard.ts`, commits `261835e` → `6e610ef`). Cette spec l'étend, ne la remplace pas.

## L'intuition de départ, et pourquoi elle tient

La contrainte et la valeur pointent dans la même direction. C'est rare : d'habitude on arbitre entre ce qui est prudent et ce qui marche. Ici, le comportement qui protège le compte — un rythme humain, aux heures où les gens lisent — est aussi celui qui obtient des réponses.

Ça change la nature de la brique. Ce n'est pas une couche d'évitement qu'on subit, c'est un différenciateur : les outils de séquence envoient à un horaire, Naya enverrait quand la personne est réceptive.

## Le problème, chiffré

Répartition réelle des 40 profils enrichis en production, par pays :

```
FR:16   EG:6   US:5   IN:3   GB:2   ES:2   AE:2
HK:1    KW:1   CA:1   MG:1
```

**Moins de la moitié des prospects sont en France.** Or toute la logique horaire actuelle, garde comprise, raisonne en `Europe/Paris`. Un envoi à 10 h chez l'utilisatrice arrive à 4 h du matin à Los Angeles et à 0 h 30 à Hong Kong.

Aujourd'hui, avant toute intelligence, **Naya réveille une partie de ses cibles en pleine nuit** — le pire moment pour être lue, et un motif qui ne ressemble à rien d'humain.

## Ce que les données permettent, vérifié

Interrogation de la production (clés seulement, aucune valeur personnelle lue) :

| Donnée | Disponible ? |
| --- | --- |
| `country_code` du prospect | **oui, 40/40** |
| `city` | **oui, 40/40** |
| `followers`, `connections`, `influencer` | oui |
| Tableau `activity` | oui, 33/40, 373 entrées |
| **Horodatage dans `activity`** | **non** — clés : `id, img, link, title, interaction` |
| Historique d'envois / réponses | **non** — zéro envoi en production |
| Historique d'incidents de restriction | **non** |

Conséquence directe : **le moment réceptif propre à une personne n'est pas calculable aujourd'hui.** Naya sait *avec quoi* un prospect a interagi, jamais *quand*. Ce qui est calculable, c'est son fuseau — grossier, mais immédiat et jamais faux.

## Décisions actées avec Jeanne

1. **La prudence l'emporte toujours.** Quand le meilleur moment pour une cible tombe hors de la fenêtre sûre (dimanche soir, 22 h), Naya cherche le meilleur moment *à l'intérieur* de la fenêtre, jamais en dehors. Pas de budget de risque, pas d'exception.
2. **La version 1 se fonde sur le fuseau de la cible, rien de plus.** Aucun apprentissage, aucune collecte nouvelle.
3. **Le rythme est en sessions**, comme un humain qui ouvre LinkedIn, traite quelques personnes et referme — pas un métronome.
4. **Les sessions varient chaque jour**, tirées dans la fenêtre autorisée. Personne n'ouvre LinkedIn à 10 h 02 tous les matins.

## Architecture

### §1 — Trois filtres empilés, du plus dur au plus souple

Aucun ne peut être contourné par les suivants. L'ordre est une garantie, pas une commodité.

**La fenêtre de l'utilisatrice** reste la garde existante : jours ouvrés, heures de bureau, montée en charge, plafonds quotidien et hebdomadaire glissant, pause sur restriction. **Elle n'est pas modifiée par ce lot.**

**Les heures de la cible** s'y intersectent. On ne lui écrit que pendant ses heures ouvrées à elle.

**Le rythme** s'applique en dernier, à l'intérieur de ce qui reste.

**Valeurs à poser en constantes exportées, nommées et documentées comme des défauts révisables** — pas en dur au milieu de la logique :

| Réglage | Défaut proposé | Pourquoi |
| --- | --- | --- |
| Heures ouvrées d'une cible | 9 h – 18 h locales | Même hypothèse que pour l'utilisatrice, faute de mieux. C'est une convention, pas une mesure. |
| Jours ouvrés d'une cible | lundi – vendredi | Idem. Le week-end reste exclu des deux côtés. |
| Sessions par jour | 2 à 3 | Ce que fait un humain qui prospecte : il ouvre, traite, referme. |
| Durée d'une session | 10 à 20 min | Assez pour deux ou trois actions au délai minimum existant (3 à 7 min), pas assez pour ressembler à une rafale. |

Ces heures sont une **convention par défaut**, pas une connaissance : Naya ne sait pas quand ses cibles travaillent réellement. Le jour où on capte leur activité (voir « ce qu'on ne construit pas »), ces bornes deviennent une mesure. En attendant, elles doivent être nommées pour qu'on sache qu'on les a choisies.

Le nombre d'actions par session n'est pas un réglage supplémentaire : il découle de la durée de session et du délai minimum entre actions déjà porté par la garde. Ne pas introduire un troisième nombre qui pourrait contredire les deux premiers.

### §2 — Déduire le fuseau d'une cible

`country_code` + `city` → fuseau IANA.

**Le cas délicat est le pays multi-fuseaux.** Les États-Unis en couvrent six ; la ville lève l'ambiguïté quand elle est reconnue, pas toujours.

Plutôt que de deviner, Naya prend **l'intersection des heures ouvrées de tous les fuseaux du pays**. Pour les États-Unis : 12 h–18 h côte est, ce qui est aussi 9 h–15 h côte ouest. Créneau étroit mais **juste où que soit la personne**. C'est le même principe que partout ailleurs dans ce dépôt : en cas d'incertitude, on restreint, on ne parie pas.

**Si l'intersection est vide**, le lead est **signalé comme non joignable dans la fenêtre**, avec sa raison. Jamais contacté au hasard, et jamais abandonné en silence — un refus muet et permanent est le défaut qu'on a corrigé la veille sur `linkedinAccountConnectedAt`.

**Si le fuseau est indéterminable**, même traitement : signalé, pas contacté. Ne pas retomber sur la fenêtre de l'utilisatrice, qui est précisément le comportement défectueux d'aujourd'hui.

### §3 — Placer les sessions là où sont les cibles

C'est le cœur du mécanisme, et ce n'était pas évident au départ.

Une session le matin ne peut pas toucher un prospect américain ; une session en fin d'après-midi ne peut pas toucher Hong Kong. **Le placement des sessions décide donc de qui est joignable ce jour-là.**

Donc l'ordre est inversé par rapport à l'intuition : Naya ne tire pas des sessions au hasard pour chercher ensuite qui peut recevoir. Elle regarde **où sont les cibles en attente**, et place ses sessions là où elles sont joignables. Seize prospects français tirent la matinée, cinq américains tirent la fin d'après-midi. L'aléa joue **à l'intérieur** de ce que les cibles permettent, pas contre.

Sans cela, les leads hors d'Europe attendraient indéfiniment qu'une session tombe au bon endroit par chance.

Modestement intelligent : aucun apprentissage, juste la géographie de la liste.

### §4 — Ce que « comprendre les restrictions » veut dire dans ce lot

Réagir, pas apprendre. La garde existante détecte un signal de restriction et met le compte en pause sans reprise automatique. Ce lot n'y ajoute rien : **apprendre des incidents exige des incidents**, et il n'y en a aucun.

## Ce qu'on ne construit pas, et ce qu'il faudrait pour l'ouvrir

- **Le moment réceptif propre à chaque personne.** Exigerait des horodatages d'activité, absents de l'enrichissement actuel — à capturer lors du sourcing si on veut l'ouvrir un jour.
- **L'apprentissage par incident** (resserrer les seuils après une restriction). Exigerait un journal d'incidents.
- **L'apprentissage par retour** (quand les gens répondent réellement). Exigerait des envois et des réponses ; les colonnes existent déjà dans `outreach_messages` (`sentAt`, `responseReceived`, `responseDate`, `openedAt`), elles sont vides.
- **Les heures d'activité réelles de l'utilisatrice.** Exigerait de tracer sa présence.

Ces quatre-là partagent la même dette : **il n'y a rien à apprendre aujourd'hui.** Les construire maintenant produirait une machine qui déduit des moments idéaux à partir de rien — l'erreur corrigée huit fois cette semaine sur le lot précédent.

## Tests

Fonctions pures d'abord, conformément à la discipline du dépôt et à celle de la garde.

- **Déduction du fuseau :** pays mono-fuseau ; pays multi-fuseaux avec ville reconnue ; pays multi-fuseaux sans ville exploitable (intersection) ; pays dont l'intersection est vide ; pays inconnu. Les deux derniers doivent **signaler**, jamais autoriser.
- **Intersection des fenêtres :** chevauchement large, chevauchement étroit (Hong Kong, côte ouest américaine), absence de chevauchement.
- **Placement des sessions :** déterministe pour une graine donnée ; deux jours consécutifs produisent des placements différents ; les sessions couvrent les fuseaux réellement présents dans la file ; une file vide ne produit aucune session.
- **Empilement :** une cible joignable chez elle mais hors de la fenêtre de l'utilisatrice est refusée. La garde n'est jamais assouplie par ce lot — un test doit le prouver en tentant de la contourner.
- **Indépendance au fuseau du runner** : la CI tourne en UTC, la machine de développement en `Europe/Paris`. Les tests doivent passer sous au moins deux fuseaux très éloignés, et un test doit tomber si l'on remplace la conversion explicite par une lecture de l'horloge du processus.

L'aléa entre par paramètre, jamais tiré à l'intérieur : c'est la condition pour que le placement des sessions soit testable.

## Critères d'acceptation

- [ ] Aucun message n'est envoyé en dehors des heures ouvrées de la cible, dans son fuseau.
- [ ] Un pays multi-fuseaux sans ville exploitable donne une fenêtre valable dans **tous** ses fuseaux.
- [ ] Un lead dont le fuseau est indéterminable, ou dont l'intersection est vide, est **signalé avec sa raison** et n'est jamais contacté.
- [ ] Les sessions sont placées en fonction des fuseaux réellement présents dans la file d'attente.
- [ ] Deux journées consécutives ne produisent pas le même découpage horaire.
- [ ] La garde existante n'est jamais assouplie : tout refus de sa part reste un refus.
- [ ] `npx tsc --noEmit -p tsconfig.json` silencieux, `npx vitest run` vert sous deux fuseaux éloignés.
