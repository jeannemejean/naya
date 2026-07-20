# Stratégie données & positionnement — la couche d'intelligence de Naya

> Note de réflexion issue d'un échange stratégique (juillet 2026). Elle fixe ce qui est tranché, ce qui reste à décider, et ce qui alimente la roadmap. À relire avant de concevoir la couche « recommandation → prédiction ».

---

## 1. Le principe fondateur : le flywheel interne, pas la donnée externe

**Tranché.** La donnée qui rendrait Naya « prédictive » (quelles séquences de tâches mènent tel type de business à tel résultat) **n'existe pas dehors** sous forme exploitable :

- pas de base structurée « telle entreprise a fait ces tâches dans cet ordre → a signé 3 clients » ;
- les fondateurs qui partagent leur workflow en ligne sont un échantillon à **biais de survie** massif (ceux qui ont déjà réussi, qui communiquent, avec une version éditoriale flatteuse) ;
- la donnée est non structurée, non labellisée, et surtout **la variable de résultat est presque toujours absente** (les résultats économiques des petites structures ne sont pas publics) ;
- le lien causal est parasité par des variables non observables (réseau personnel du fondateur, capital de départ, timing de marché, capacité à convaincre).

**Conséquence :** la seule source de donnée exploitable, labellisable et défendable, c'est **Naya elle-même** — ses propres utilisateurs, leurs objectifs, les tâches faites/abandonnées, et **les résultats atteints**. C'est un flywheel : plus la base grandit, plus la couche IA devient intelligente. C'est le modèle de toutes les startups qui ont réussi une vraie couche IA (elles n'ont pas scrapé internet, elles ont créé un flywheel interne).

> Retournement clé : la donnée causale que personne ne peut acheter dehors, **Naya la fabrique dedans**, une interaction à la fois.

---

## 2. LE TROU À COMBLER MAINTENANT : capter le résultat, pas la tâche

**Le point le plus important de toute la réflexion.** Aujourd'hui Naya capte :

- l'état des tâches (fait / pas fait) ;
- le corpus d'appels IA (`ai_invocations`) ;
- la mémoire à trois fils (`memory_entries`) ;
- bientôt la réception des contenus (Phase 3).

Mais **rien ne capte le résultat au niveau de l'objectif.** « As-tu signé les 3 clients ? Encore Merci a-t-il atteint 5000 abonnés, en combien de temps ? » Sans cette **variable de sortie**, aucun modèle prédictif ne pourra jamais être entraîné — on accumulerait des années de « tâche complétée » sans jamais pouvoir les relier à un succès.

Attention à ne pas confondre : la boucle de réception (Phase 3) mesure la résonance d'un **contenu** (saves/sentiment/conversion). Ce n'est **pas** la même chose que l'atteinte d'un **objectif business** (signer, atteindre un palier). Il faut les deux.

### Action concrète (à ajouter à la roadmap, avant d'avoir des utilisateurs)

Un **suivi d'objectif dans le temps**. On a déjà `projectGoals` ; il manque le **résultat reporté et daté** qui évolue :

- l'objectif (ex. « signer 3 clients en 6 mois », « 5000 abonnés en 1 an ») avec son horizon ;
- une série de **jalons de résultat** auto-reportés : 0 → 1 → 2 → 3 clients, chacun daté ;
- à terme, chaque objectif clôturé devient un **exemple d'entraînement labellisé** : `(contexte : ce fondateur + cette marque + ces tâches faites + cette réception) → (résultat : objectif atteint / raté, en X temps)`.

C'est précisément le dataset causal introuvable dehors — généré proprement dedans. **C'est la graine de toute l'IA prédictive future de Naya.** Le compteur ne commence à tourner que le jour où on capte le résultat.

### Le mécanisme de capture (résolu) : confirmation + signaux bruts

« Ajouter une table de résultat » est la partie facile. Le vrai problème, c'est de capter le résultat **sans friction et sans biais** : un fondateur solo ne reportera pas fidèlement « signé / pas signé » chaque mois (données rares, oubliées, flatteuses). La réponse tient en deux pièces, et surtout en ce qu'on ne construit **pas** tout de suite :

- **Le signal fiable = une micro-confirmation mensuelle.** Une fois par mois, une question à trois clics : « Tu sembles à 2/3 clients signés — c'est juste ? ». C'est ça, la source de vérité de la variable de sortie. Léger, honnête, corrigeable.
- **Les signaux temporels bruts, captés dès maintenant** (horodatage de chaque interaction, nombre de reports d'une tâche, contexte de session). Cheap, best-effort, dans un journal d'événements propre. On **logge**, on ne modélise pas encore.
- **⚠️ Ce qu'on ne construit PAS maintenant : la « probabilité d'objectif » inférée des signaux faibles.** Inférer « réunion créée + proposition envoyée → probabilité de signer » réintroduit exactement le problème causal du §1 : ce sont des *activités*, pas des *résultats* (on peut tout faire et ne pas signer ; signer sans aucune trace). Une probabilité fausse déclenche son propre poison (faux insight → confiance grillée). La confirmation à trois clics suffit ; le modèle probabiliste viendra plus tard, sur données réelles, jamais comme source de vérité.

---

## 3. La séquence : recommandation d'abord, prédiction ensuite

**Tranché.** L'ordre réaliste (et suivi par Notion, Duolingo, etc.) :

- **Phase A — Recommandation.** Un moteur adossé à l'expertise (marketing/communication de Jeanne + décisions expertes fondées sur la recherche), organisé **par archétype** (type de business × profil fondateur × contexte). C'est de la **personnalisation par règles expertes + calibration**, pas du ML. Et ce n'est PAS un lot de consolation : c'est une architecture légitime et défendable, à condition d'être calibrée par la donnée interne.
- **Phase B — Prédiction.** Une fois assez de données `(contexte → résultat)` accumulées, on entraîne la vraie couche prédictive. Elle n'arrive **jamais** si la capture du résultat (§2) n'est pas conçue dès le départ.

Piège à éviter (générique 2023-2025) : « un wrapper GPT/Claude qui collecte des données pour construire l'intelligence plus tard ». Ce qui distingue Naya de ce piège est au §4.

### Les trois couches, et le garde-fou de l'âme du produit

Une manière plus fine de dire la même séquence :

- **Couche 1 — aujourd'hui : intelligence experte encodée.** Règles expertes par archétype, seedées par Jeanne. Ne s'améliore pas seule, mise à jour manuellement. Honnête sur ce qu'elle est. C'est ce qui doit **retenir les gens** pendant que la couche 2 s'accumule.
- **Couche 2 — année 1+ : empreinte comportementale par fondateur.** Modéliser *comment* tu travailles (quand tu reportes, ce qui précède un blocage, phase stratégique vs exécution). C'est la formulation « modéliser le fondateur, pas le projet » — et c'est exactement le **fil `founder`**, poussé plus loin.
- **Couche 3 — année 2 : intelligence croisée entre fondateurs similaires.** Seulement si 1 et 2 sont solides, et s'il y a assez d'utilisateurs.

**Discipline (rappel) : tu es une seule utilisatrice.** La couche 2 a besoin de mois de données par personne, la couche 3 de beaucoup d'utilisateurs. Donc on **capte le signal brut maintenant** (§2) et on **ne construit pas** le modèle comportemental tout de suite — le bâtir à vide, c'est modéliser du néant.

> ⚠️ **Garde-fou de l'âme du produit.** La couche 2 n'est pas qu'un risque « vie privée ». Un outil qui dit « tu procrastines » / « tu es en phase de blocage » peut être vécu comme de la **surveillance et du jugement** — l'exact contraire de la promesse « construire sans s'épuiser ». La frontière entre « Naya me comprend » et « Naya me surveille » est mince ; du mauvais côté, elle tue le produit. « Politique de transparence » est une étiquette, pas une solution : c'est un problème de conception à traiter sérieusement avant de modéliser le comportement.

---

## 4. Positionnement : ce que Naya fait que Notion AI ne fait pas

**La réponse anti-wrapper, à assumer.** Un wrapper (ou Notion AI, Monday AI, ClickUp AI, Copilot) répond à des questions sur ton espace de travail. Il ne **cumule pas** :

- un modèle vivant et **par marque** de ton business (fil *cap*) ;
- un modèle de **ta façon d'opérer** — rythme, énergie, habitudes (fil *founder*) ;
- la **réception réelle** de ton audience (fil *reception*) ;
- le tout **croisé par un arbitrage** pour piloter tes décisions.

Notion t'aide à **ranger** ; Naya vise à **comprendre et cumuler**. Mais sois honnête sur la nature de ça : c'est une **différenciation produit et une avance**, ce n'est PAS un moat.

Formule de positionnement candidate : **« Le premier outil qui apprend comment TU travailles, pas seulement sur quoi tu travailles. »** L'angle mort de tous les outils actuels : ils modélisent le *projet*, pas le *fondateur*. Deux réserves d'honnêteté, cela dit : (1) le « comment tu travailles » existe partiellement ailleurs (RescueTime, Motion, Reclaim modélisent déjà quand/comment tu travailles) — la vraie nouveauté, c'est de le **relier aux résultats business et au multi-marques** pour l'indé ; (2) c'est une formule à **tester sur de vrais fondateurs**, pas à proclamer (voir garde-fou âme du produit, §3).

### La vérité inconfortable sur le moat

**Aujourd'hui, Naya n'a pas de moat.** Elle a une avance (périssable) et un **coût de sortie par utilisateur** qui grandit avec l'usage — mais c'est de la rétention, pas une barrière à l'entrée. Rien n'empêche Notion ou Microsoft de construire la même architecture en 18 mois avec cent ingénieurs. « Un moteur de contexte qui compound » n'est pas un moat, c'est une ambition.

Le seul vrai moat *possible* serait un effet de réseau **entre** utilisateurs (la donnée de l'un améliore l'expérience de l'autre), et il n'existe qu'à trois conditions non réunies : l'échelle, la variable de résultat captée, un signal causal qui survit aux variables confondantes. Autrement dit, le **flywheel outcome, à l'échelle, dans plusieurs années, sans garantie.**

Conséquence stratégique : **ton unique moat *candidat* est exactement la seule chose urgente — capter le résultat (§2).** Le reste est de l'exécution + un créneau que les géants ne prioriseront pas (le fondateur indé multi-marques, francophone) — pas parce qu'ils ne peuvent pas, parce qu'ils ne voudront pas. Il faut jouer comme si Naya n'était pas défendue : vite.

### L'angle candidat : le contexte fragmenté (à construire ET à valider)

Le problème mal résolu par les outils actuels : le fondateur qui switche de projet toutes les dix minutes et **perd sa vision d'ensemble**. Naya en pose la **fondation** avec la mémoire à trois fils — mais ne pas confondre deux niveaux : avoir une *infrastructure* de mémoire n'est pas la même chose que livrer une *expérience* qui te remet en contexte opérationnel en trente secondes après deux jours d'absence. Le second reste **entièrement à construire**. Et avant d'en faire le positionnement de Naya, il reste à **valider** que c'est bien LA douleur n°1 de la cible — pour l'instant c'est une hypothèse séduisante, pas un fait. Positionnement à tester sur de vrais fondateurs, pas à proclamer.

---

## 5. Objectifs multiples : arbitrés par l'utilisateur, pas par l'algo

Cas « signer 3 clients » **et** « maximiser la notoriété ». Ce n'est pas un conflit insoluble à déléguer à un algorithme — et ce ne sont pas forcément des ennemis (la notoriété est souvent un **levier** de la signature). La règle :

- l'utilisateur déclare l'**objectif primaire** et son **horizon** ;
- l'arbitre (le moteur d'arbitrage de la triangulation) **pondère** en conséquence, en s'appuyant sur les signaux existants (`revenueUrgency`, priorité business active) ;
- Naya rend explicite l'arbitrage plutôt que de le dissimuler.

À décider plus tard : le schéma exact de pondération multi-objectif (à calibrer sur données réelles).

---

## 6. Le risque de dépendance (à assumer consciemment)

Construire la Phase A sur Claude/GPT est un **risque business** (tarifs API, concurrent natif). Ce n'est pas rédhibitoire, mais c'est une décision consciente avec mitigation :

- l'abstraction `NayaModelProvider` (Phase 1, déjà en prod) rend le modèle interchangeable ;
- la distillation d'un petit modèle maison (Phase 5) réduit la dépendance à terme ;
- le moat vit dans la couche de contexte + la donnée, pas dans le modèle.

---

## 7. Ce que ça change dans la roadmap

**À construire maintenant (justifié, avant utilisateurs externes) :**

- le **suivi d'objectif → résultat daté** (§2) — la variable de sortie du flywheel ;
- la **micro-confirmation mensuelle** à trois clics (§2) — la source de vérité du résultat, simple ;
- le **journal d'événements temporels** (horodatage, reports, contexte de session) — cheap ; mais **vérifier d'abord ce que Naya capte déjà** (`taskScheduleEvents`, timestamps de complétion) pour ne pas rebâtir.

**À NE PAS construire maintenant :**

- le **modèle comportemental / probabilité d'objectif** (couche 2) — pari année-2, inutile à vide (une seule utilisatrice), et à encadrer par le garde-fou âme du produit (§3) ;
- l'**intelligence croisée entre fondateurs** (couche 3) — nécessite l'échelle.

**Confirmés :**

- la boucle de réception (Phase 3) reste, mais capte la résonance *contenu*, distincte du résultat *objectif* ;
- séquence recommandation (règles expertes + calibration) → prédiction (une fois la donnée `contexte→résultat` accumulée) ;
- **positionnement à tester** (pas à proclamer) : « apprend comment tu travailles » / « contexte fragmenté / vision globale rendue » — à valider sur de vrais fondateurs.

---

## 8. Questions encore ouvertes (à ne pas balayer)

- **Capter le résultat sans friction** — *piste retenue* (§2) : micro-confirmation mensuelle + signaux bruts. Résiduel : calibrer la fréquence pour ne pas lasser, et éviter les faux insights.
- **Découverte client (le plus urgent après le code)** : parler à ~5 vrais fondateurs indé pour valider que le « contexte fragmenté » / « vision globale perdue » est bien LEUR douleur n°1 — pour l'instant c'est une hypothèse séduisante, probablement projetée depuis l'expérience de Jeanne.
- **Âme du produit vs surveillance** : comment modéliser le comportement (couche 2) sans que ce soit vécu comme du jugement ? Non résolu. À traiter avant de construire la couche 2.
- Le seuil « contenu spécifique à une marque » qui déclenche une question de marque (voir `BRIEF-FIX-ROUTAGE-MARQUE.md`) — à calibrer sur usage réel.
- Le format des archétypes (business × fondateur × contexte) pour la Phase A — à définir avec l'expertise de Jeanne, sans prétendre que c'est de la prédiction.

> Boussole : la donnée causale ne s'achète pas, elle se **fabrique** — une interaction, un objectif, un résultat à la fois. Tout ce qui, dans Naya, ne contribue pas à ce flywheel est secondaire.
