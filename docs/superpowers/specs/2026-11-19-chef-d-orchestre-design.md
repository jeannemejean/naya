# Le chef d'orchestre du planning — conception

19 nov. 2026. Demande de Jeanne : que chaque entité de Naya (atelier de contenu, campagnes,
prospection, appels d'offres, tâches tirées des objectifs) « s'organise mutuellement » et se place
dans le calendrier de façon logique et intelligente, en s'inspirant de la gestion de portefeuille de
projets. Jeanne a délégué toutes les décisions (« je te laisse prendre toutes ces décisions »).

## Pourquoi

L'objectif final de Naya : une fois en place, elle fait tourner l'entreprise seule ; l'utilisatrice
valide et apporte le personnel (photos, textes, messages écrits à la main). Un rappel qui n'atterrit
pas au bon moment dans le calendrier ne sert à rien (Jeanne a arrêté la routine Notion pour ça).

Constat du 19 nov. (production + lecture du code) :

- Six placeurs indépendants (auto-planner, generate-*, rebalance, rebalance-week, campagnes,
  reprise), réparés après coup par `fixOverlappingTasks` → `retasserJours` → `repackDay`.
- `repackDay` ne regarde jamais la valeur : quand une journée déborde, part au lendemain ce qui est
  **le plus tard dans la journée**. En cascade, chaque matin.
- Seul le contenu respecte ses échéances (`echeanceTache`, `echeanceAtelier`). Le `dueDate` des
  autres tâches est ignoré : une tâche « sous 2 jours » a glissé jusqu'au 7 décembre.
- Le vieux retard n'est jamais trié : 36 tâches générées mi-octobre, échéance dépassée d'un mois,
  occupent les trois semaines à venir. La reprise ne voit que les tâches dont la DATE PLANIFIÉE est
  passée ; une tâche repoussée sans fin vers l'avant n'est jamais « en retard », donc jamais revue.

Ce que font les grandes organisations et les agendas automatiques (Motion, Reclaim, Sunsama,
Morgen) : échéances dures posées d'abord et rétro-planifiées ; le reste classé par valeur et
urgence ; jamais de report silencieux et sans fin ; le vieux retard est déclassé ou proposé à
l'abandon (Morgen : « after a long period of being overdue, tasks will not be prioritized ») ;
capacité gardée avec une marge ; budgets de temps par flux ; revue hebdomadaire.

## Le principe

Un seul langage commun pour toutes les entités : chaque tâche a une **contrainte** (une échéance,
dure ou souple, ou aucune) et un **rang** (ce qui passe d'abord quand il n'y a pas la place). Le
placement arbitre avec ce langage, quelle que soit l'entité qui a créé la tâche. Naya tranche seule ;
tout ce qu'elle change est journalisé et annulable (mécanisme de la reprise, « Ce que j'ai repris »).

## Étape 1 (ce chantier) — le langage commun et l'arbitrage

### 1. La contrainte d'une tâche (module pur `server/services/orchestre/contrainte.ts`)

`contrainteDe(tache, { aujourdhui, jourPost? })` → `{ echeance: "YYYY-MM-DD" | null, durete: "dure" | "souple" | null }`

Échéances **dures** (une date extérieure qui ne se négocie pas) :
- étape de production d'un post : `echeanceTache(titre, jourPost)` (existant) ;
- atelier / validation : `echeanceAtelier` (existant) ;
- relance de prospect (`source = "relance_prospect"`) : son jour planifié (la date promise) ;
- clôture du vendredi (`source = "fil_cloture"`) : son jour de création, le vendredi ;
- toute tâche portant `actionData.echeanceDure` (YYYY-MM-DD) : prévu pour les jalons d'appels
  d'offres (étape 2).

Échéance **souple** : le `dueDate` de la tâche (jour à Paris), s'il n'est pas dépassé de plus de
`PEREMPTION_JOURS = 14` jours. Au-delà, la tâche n'a plus d'échéance utile : elle n'est plus
prioritaire, elle va au tri du vivier (§3). Décision : 14 jours, assez pour une semaine chargée,
assez court pour que le planning ne se bouche pas un mois.

### 2. Qui garde sa place quand la journée déborde (`retasserJours` / `repackDay`)

- Les échéances DURES de §1 alimentent le mécanisme existant `repackDayAvecEcheances` (une tâche
  dont l'échéance tombe avant le jour suivant n'est jamais reportée ; si elle ne tient pas, elle
  est « forcée »). Aujourd'hui il ne reçoit que les échéances du contenu ; il reçoit désormais
  toutes les dures. Les échéances SOUPLES passent devant par le rang, sans forcer (décision prise
  en construisant : forcer une échéance souple créerait des chevauchements pour une date
  négociable).
- **Le choix de ce qui déborde se fait au rang, pas à l'heure.** `rangDe(tache, contrainte)` trie :
  échéance la plus proche d'abord (dure avant souple à date égale), puis `priority` (1 avant 2
  avant 3), puis la plus ancienne tâche planifiée. Les tâches qui tiennent gardent l'ordre de la
  journée tel qu'il était (pas de chamboulement quotidien) : on choisit d'abord QUI reste par le
  rang, puis on range ceux qui restent dans leur ordre actuel. Si ce second rangement fait déborder
  (trous mal placés), on garde le rangement par rang.
- Une échéance dure qui ne tient pas reste « forcée » (comportement existant, chevauchement
  journalisé). Une échéance souple qui ne tient pas part au lendemain comme avant : elle passera
  devant demain, puisqu'elle sera plus proche.
- Les ancres (rituels, « Publier », rendez-vous de l'agenda, tâches faites) ne bougent pas.

### 3. Le vivier : Naya trie le vieux retard (reprise)

La reprise (matin et 17 h) voit aussi les tâches **à venir** dont l'échéance souple est dépassée
de plus de 14 jours (et sans échéance dure, non faites, non archivées). Elles rejoignent les tâches
« libres » que Naya juge déjà au regard des objectifs : garder, découper, fusionner, abandonner
(archivée, annulable). Dans le même plafond `MAX_TACHES_IA = 40`, les plus anciennes d'abord.
Une tâche gardée reçoit comme nouvelle échéance souple le `auPlusTard` de Naya s'il est donné,
sinon son échéance est retirée : elle ne revient pas au tri chaque jour. Sans IA (panne) : rien
n'est archivé, tout est gardé (règle existante de `decisionParDefaut`).

### 4. Mesure

Après déploiement, sur la base de production : nombre de tâches non faites planifiées après leur
échéance (36/36 générées et 8/8 mails le 19 nov.), et date planifiée la plus lointaine des tâches
à échéance de moins d'une semaine.

### Non-buts de l'étape 1

- Pas de nouvelle colonne en base (la contrainte se calcule).
- Pas de nouvel écran ; le journal de la reprise montre déjà ce que Naya a trié.
- On ne réécrit pas les six placeurs : ils continuent de poser, l'arbitrage commun corrige.

## Étapes suivantes (conçues ici, construites après)

2. **Appels d'offres dans le calendrier** : un AO retenu crée ses jalons (go/no-go, rédaction,
   relecture, dépôt) rétro-planifiés depuis la date limite, avec `actionData.echeanceDure`.
3. **Budgets par entité et marge** : chaque semaine, une enveloppe par entité (atelier = un long
   bloc protégé, prospection = créneaux courts groupés, AO selon jalons) ; on ne remplit que 70 %
   du temps libre, le reste absorbe l'imprévu ; le temps non utilisé d'une enveloppe est réalloué.
4. **Un seul placeur** : les six placeurs passent par une même fonction de placement (rang,
   contrainte, capacité en minutes et non en nombre de tâches).
5. **Revue de la semaine** : le dimanche soir, Naya propose la semaine (enveloppes, vivier trié,
   échéances à risque) ; le matin ne fait plus que des ajustements locaux.

## Risques

- Archiver une tâche utile : seulement par la reprise (décision IA motivée, journal, annulation) ;
  jamais une échéance dure.
- Instabilité : les tâches qui tiennent gardent leur ordre ; seul ce qui déborde change.
- Valeurs fausses (`priority` de l'IA peu fiable) : le rang met l'échéance avant la priorité.

## Étapes 2 à 5 — conception détaillée (20 nov. 2026)

Jeanne : « vas-y pour les étapes suivantes ». Décisions prises seule (délégation du 19 nov.),
à partir de l'inventaire des placeurs du 20 nov. (une vingtaine de chemins écrivent une date ;
plafonds en NOMBRE de tâches incohérents : 7-8 auto-planner, 4-6 rééquilibrage, 3 campagne).

### Étape 2 — les appels d'offres posent leurs jalons

Module `server/services/orchestre/jalons-ao.ts` : `jalonsDe(ao, aujourdhui, estTravaille)` (pur)
et `synchroniserJalonsAO(userId)` (base). Clé d'une tâche : `actionData.ao = { id, jalon, partie? }`,
`source = "appel_offres"`, `taskType = "ao_jalon"`, `projectId` de l'AO, lien de l'avis en
`actionData.externalUrl`. Chaque jalon porte `actionData.echeanceDure` (§1 : il force sa place).

- AO « premier jet prêt », date limite à venir : UNE tâche « Décider : on répond à … ? » (15 min),
  échéance = le jour où il faut commencer la rédaction pour tenir (ci-dessous), au plus tôt aujourd'hui.
  C'est la validation que Naya demande ; tout le reste est préparé.
- AO « en rédaction », date limite à venir : les jalons, rétro-planifiés sur les jours travaillés
  depuis la date limite, avec UN jour travaillé de tampon (gestion par chaîne critique) :
  dépôt (30 min) = dernier jour travaillé AVANT le jour limite ; relecture et finalisation (60) le
  jour d'avant, avec les pièces administratives (60) ; rédaction du mémoire en parties de 120 min
  au plus, une par jour, les jours d'avant (MAPA 240 min, appel d'offres ouvert ou concours 480,
  autre 240) ; analyse du DCE et liste des pièces (45) le jour d'avant la première partie.
  Échéances bornées à aujourd'hui : un AO pris tard se tasse sur les jours restants, les échéances
  dures forcent leur place. Date planifiée posée = l'échéance moins un jour travaillé (borne aujourd'hui) :
  du jeu pour le re-tassage.
- Statut qui avance (déposé, gagné, perdu, écarté), date limite passée, ou décision prise (sortie de
  « premier jet prêt ») : les tâches ouvertes concernées sont archivées. Date limite qui change :
  les échéances des tâches ouvertes suivent. Une tâche déjà cochée ou archivée n'est jamais recréée.
- Appelée par la route PATCH d'un AO (puis re-tassage) et par le passage du matin, sous le même
  interrupteur que le fil (`filActifPour`).

### Étape 3 — capacité en minutes et marge de 70 %

Module `server/services/orchestre/capacite.ts` (pur). `MARGE_PLANIFIABLE = 0.7`.
`minutesPlanifiables({ disponibles, energie })` = disponibles × énergie × 0,7 ;
`minutesOccupees(taches, tampon)` = somme (durée, 30 par défaut, + tampon) des tâches non faites,
hors jalons-marqueurs ; `tachesEncorePossibles(...)` = combien de tâches de 45 min (+ tampon)
tiennent encore. L'auto-planner (génération des tâches d'objectifs) ne génère plus que dans ce
reste : il ne remplit plus une journée déjà occupée par l'atelier, les campagnes, la prospection
ou les AO. Le re-tassage, lui, garde 100 % de la journée (la marge absorbe l'imprévu).
Budgets par entité : `fluxDe(tache)` classe chaque tâche (contenu, atelier, campagne, prospection,
relances, appels d'offres, objectifs, rituels, autre) ; le budget des objectifs = ce qui reste
après les flux à échéance dure dans les 70 %. La réservation de blocs par flux et le regroupement
des créneaux courts de prospection sont reportés (pas de besoin observé).

### Étape 4 — un seul arbitre

Réécrire les vingt chemins est un risque sans gain : ils posent, l'arbitre commun
(`fixOverlappingTasks` → `retasserJours` → rang) décide. Ce qui manquait : les chemins qui
écrivaient une date SANS repasser par l'arbitre (génération de la semaine, rééquilibrage d'un
jour, report groupé, tâches d'un objectif, réponses de prospects, redéploiement de campagne,
création par `creerTache`). Ils appellent désormais le re-tassage après écriture, et l'auto-planner
utilise la capacité en minutes (§3) au lieu du nombre de tâches.

### Étape 5 — la revue de la semaine

Dimanche à 18 h (Paris), `revueDeLaSemaine(userId)` : jalons d'AO synchronisés, tri du vivier
(reprise), ateliers de la semaine posés, re-tassage des deux semaines à venir, puis le bilan
de la semaine journalisé. Le bilan est CALCULÉ à la demande (pur, `bilanSemaine(taches, capacite)`,
route `GET /api/orchestre/semaine`), jamais stocké : il est toujours à jour, et aucune migration
n'est nécessaire. Il donne les minutes par flux contre la capacité de chaque jour et les échéances
dures à risque (tâche planifiée après son échéance, ou journée chargée au-delà de sa capacité).
Le matin ne fait ensuite que des ajustements locaux. Pas de nouvel écran : le bilan est lisible par
l'API et l'agent ; un écran viendra si Jeanne le demande.
