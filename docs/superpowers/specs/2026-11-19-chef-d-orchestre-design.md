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

- Les échéances dures et souples non dépassées alimentent le mécanisme existant
  `repackDayAvecEcheances` (une tâche dont l'échéance tombe avant le jour suivant passe devant).
  Aujourd'hui il ne reçoit que les échéances du contenu ; il reçoit désormais celles de §1.
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
