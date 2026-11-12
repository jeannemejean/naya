# Le fil conducteur : des objectifs aux tâches du jour

Statut : brouillon, à valider par Jeanne.
Date : 10 novembre 2026.

## Pourquoi

Jeanne construit Naya pour **transformer ses objectifs en tâches à faire chaque jour**. Elle le dit simplement : il lui arrive de perdre la motivation, et avec elle le fil conducteur de ce qu'elle fait. Naya doit tenir ce fil à sa place.

Aujourd'hui, ce travail de « pilotage » est fait à l'extérieur de Naya, par une tâche programmée Claude (« Consolidation pilotage », 9 h 04). Elle lit une base Notion que Jeanne n'ouvre plus jamais. Direction voulue : **l'intelligence de Naya fait ce travail elle-même**. Naya appelle Claude en interne. Pas de Notion, et aucun assistant extérieur (Claude Desktop, ChatGPT) ne vient lire ou écrire dans Naya.

## Ce que Jeanne a dit (ses mots, reformulés au plus près)

- Un objectif ne s'atteint pas avec une tâche isolée. C'est de la gestion de projet : **une suite de tâches forme une grosse étape, et les étapes successives mènent à l'objectif**.
- Les étapes dépendent de la marque, de l'utilisatrice et de ce qu'elle fait déjà (une campagne lancée ou non, etc.). Naya doit être **sur mesure**, jamais un modèle générique.
- **Naya propose les grosses étapes. Jeanne valide ou ajuste.**
- Naya doit **se nourrir de tout ce que Jeanne lui a donné** : stratégie, fondations, documents, identité de marque, veille, mesures.
- Ne pas réduire la conquête de clients à l'emailing. **La présence sur les réseaux sociaux compte autant.** Quand aucune campagne de contenu n'est en cours, **Naya propose elle-même des posts** pour garder le rythme.
- Ce qui lui sert le matin : son planning et **les tâches à faire en premier** pour mettre toutes les chances de son côté.

## État actuel (lecture du code du 10 nov. 2026)

**Ce qui existe déjà**
- Des objectifs par projet (`project_goals`), avec une urgence calculée (`goal-urgency.ts`).
- Des jalons enchaînés qui se débloquent l'un après l'autre (`project_milestones`, `milestone_triggers`, statuts `locked`, `unlocked` et `active`). Jamais de tâche sur un jalon `locked` (règle de `CLAUDE.md`).
- `tasks.goalId` et `tasks.milestoneId`.
- Un planificateur quotidien (`auto-planner.ts` → `generateDailyTasks`) qui reçoit `buildNayaContext` : identité de marque, objectifs, jalons, fondations, savoir, mémoire, mesures et énergie.
- Le mot du matin (`/api/tasks/daily-brief`) et la page Aujourd'hui.
- La reprise des tâches non faites, qui stocke déjà une raison par tâche.

**Où le fil casse**
1. **Le « pourquoi » est perdu.** L'IA renvoie `focus` et `reasoning`, que le planificateur ignore. Aucun écran ne montre à quoi sert une tâche.
2. **Le rattachement est approximatif.** Sans `goalIndex`, la tâche prend par défaut le premier objectif (`auto-planner.ts:479`).
3. **L'avancement est faussé.** Les tâches de contenu, de prospection et de campagne n'ont jamais de `goalId`. L'objectif de visibilité paraît donc à zéro.
4. **Aucune étape intermédiaire n'est reliée au jour.** Les jalons ne structurent pas le planning comme une suite de tâches vers une grosse étape.
5. **Aucune détection d'objectif oublié.**
6. **Les réseaux sociaux peuvent disparaître.** Depuis le 9 oct. 2026, le contenu ne vient que du calendrier éditorial (`filtre-taches-generees.ts`). Sans campagne ni post prévu : aucune tâche de présence, et aucune cadence minimale.
7. **Le mot du matin ne voit que le projet filtré** dans la barre latérale.
8. **Les tâches générées sont pensées pour une semaine** mais posées sur un seul jour.

## Ce qu'on construit

### 1. Trois niveaux reliés : objectif → étapes → tâches
- Chaque objectif actif a **une suite d'étapes ordonnées** (les « grosses tâches »). On s'appuie sur les jalons existants plutôt que de créer un concept parallèle, sauf si la lecture du code montre que c'est impossible proprement (voir « Laissé au constructeur »).
- Chaque tâche de travail (générée, de campagne, de contenu, de prospection) est rattachée à **une étape**, donc à **un objectif**. Le rattachement est explicite. On supprime le repli sur le premier objectif : une tâche qu'on ne sait pas rattacher reste sans objectif, et Naya le signale.
- L'avancement d'une étape se mesure en tâches faites sur tâches prévues. Celui d'un objectif se mesure par ses étapes franchies, et par sa valeur cible quand il en a une (mesures).

### 2. Naya propose les étapes, Jeanne valide
- Pour un objectif sans étapes, ou dont les étapes sont toutes franchies, Naya **propose une suite de 3 à 6 étapes**. Elle les fonde sur le contexte complet : marque, fondations, savoir, mémoire, campagnes en cours, prospection, mesures, contenus déjà publiés. Elle explique en une phrase pourquoi chaque étape.
- La proposition s'affiche pour validation avec trois gestes : **Valider**, **Ajuster** (renommer, réordonner, supprimer, ajouter) et **Refaire**. Rien n'est créé avant validation. Même principe que les propositions de l'agent.
- Les étapes suivent l'état réel : si une campagne de prospection est déjà lancée, l'étape « lancer la prospection » est notée en cours, pas proposée à nouveau.

### 3. Le matin : d'abord ce qui compte le plus
- La journée s'ouvre sur **les 2 ou 3 tâches les plus importantes**. Pour chacune, on affiche l'étape et l'objectif qu'elle sert, une phrase « pourquoi », et l'avancement de l'étape (exemple : « Étape : être visible sur LinkedIn, 3 tâches sur 7 faites. Objectif : 3 nouveaux clients d'ici fin décembre »).
- Le « pourquoi » est **stocké avec la tâche** au moment où elle est créée, puis affiché sur la page Aujourd'hui, dans le mot du matin et sur mobile.
- Le mot du matin couvre **tous les objectifs actifs**, pas seulement le projet filtré dans la barre latérale.
- L'ordre de priorité dépend de l'urgence de l'objectif, de la position dans la chaîne d'étapes (débloquer la suite) et des échéances proches (jalons, dates limites d'appels d'offres, relances prévues). L'énergie du jour reste prise en compte.

### 4. Le fil ne se perd pas
- **Objectif oublié** : si un objectif actif n'a eu aucune tâche faite depuis 7 jours, Naya le signale le matin et propose une tâche courte pour reprendre.
- **Jour de moins bien** (énergie basse) : Naya propose une version allégée qui garde au moins une tâche par objectif prioritaire.
- **Si rien ne cloche** : une seule phrase, sans liste.

### 5. Présence sur les réseaux, pas seulement l'emailing
- Naya équilibre les canaux selon la stratégie de l'utilisatrice (`platformPriority`, `contentPillars`, `contentBandwidth`, objectifs de visibilité).
- **Cadence minimale de présence** : si aucune publication n'est prévue ou faite depuis N jours (N dérivé de la bande passante de contenu de l'utilisatrice), Naya **propose des posts**. Elle les fonde sur l'identité, les piliers, la veille et l'actualité de l'agence, et les envoie dans l'atelier de contenu existant, où Jeanne valide comme d'habitude. Rien n'est publié sans validation.
- Ces propositions n'annulent pas la décision du 9 oct. 2026 : le générateur générique ne crée toujours pas de tâches de contenu en vrac. C'est un circuit dédié qui propose des posts à l'atelier.

### 6. Fin de la consolidation extérieure (voir section 8)
- Quand le matin de Naya couvre ce que faisait la tâche programmée « Consolidation pilotage » (9 h 04), on arrête cette tâche. La base Pilotage dans Notion n'est plus alimentée.

### 7. Ce que fait aujourd'hui la consolidation de 9 h 04 (lu dans ses consignes le 10 nov. 2026)
Elle lit Notion, Gmail, Google Agenda, lemlist, Metricool et un chemin de fer de contenus. Elle crée des « items » à traiter et envoie un message des seuls écarts :
- **Gmail** : les fils des 14 derniers jours qui attendent une réponse de Jeanne deviennent des actions (« Répondre à X », sous 2 jours).
- **Contrôle des autres tâches programmées** (veille AO, prospection, reading room) : si l'une n'a pas tourné, c'est signalé, et son minimum est fait à sa place.
- **Agenda** : un rendez-vous avec un client ou un prospect compte comme un mouvement sur le chantier concerné.
- **Création** : les posts du chemin de fer deviennent des actions ; une alerte si moins de N posts programmés dans Metricool sur 7 jours ; chaque lundi, « Encore Merci : 3 recettes de la semaine » ; la validation des lots de la Campagne 360 ; les contenus « à valider » du calendrier éditorial.
- **Chantiers bloqués** : un chantier sans mouvement depuis 15 jours est signalé.
- **Indicateurs** : prospection (envois, réponses, rendez-vous sur 4 semaines), pipeline (opportunités, relances échues, clients signés vers l'objectif « n / 2 »), audience (abonnés et posts Instagram et LinkedIn de Jeanne et de JMD, Encore Merci), appels d'offres, retards.
- **Le message** : flux en panne, incohérences, chantiers bloqués, retards, nouveaux ; « clôture du vendredi » (items ouverts depuis plus de 7 jours) ; « réconciliation du lundi ».

Plusieurs de ces sources vivent désormais dans Naya (prospection, réponses, appels d'offres, atelier de contenu, publication). D'autres non (Gmail hors prospection, agenda, Metricool, chemin de fer, Campagne 360). La liste de ce que le matin de Naya doit couvrir avant d'arrêter la consolidation est **à valider par Jeanne** (voir « Questions ouvertes »).

### Arbitrages pris (à vérifier par Jeanne)
- **Chaînes de jalons existantes** : rien n'est supprimé. Naya propose de rattacher chaque chaîne existante à l'objectif qu'elle sert (une proposition par projet). Jeanne valide. Une chaîne non rattachée reste une chaîne de projet, comme aujourd'hui. Les états `locked` actuels sont conservés.
- **Les posts proposés entrent dans la journée** : en plus de l'atelier, la journée reçoit une tâche « Valider les posts proposés » (ou « Tourner / produire X ») rattachée à l'étape de visibilité. La cadence se mesure en posts **publiés**.
- **Taille de la journée** : on ne gonfle pas le planning. Les 2 ou 3 tâches clés sont mises en avant en tête. Le défaut « tâches pensées pour une semaine posées sur un seul jour » est corrigé dans ce chantier : la génération répartit sur la semaine.
- **Historique** : pas de reclassement en masse des anciennes tâches. L'avancement compte à partir de la mise en route. La règle « objectif oublié depuis 7 jours » ne se déclenche qu'à partir du 8e jour après la mise en route.
- **Jour de moins bien** : Naya **propose** la version allégée, que Jeanne accepte d'un geste, avec annulation. C'est un gros changement de journée, donc il est proposé et non appliqué d'office.
- **Pour qui** : d'abord le compte de Jeanne, derrière un interrupteur. Les propositions d'étapes se déclenchent à la création d'un objectif, quand toutes ses étapes sont franchies, ou à la demande. Ce sont des propositions à valider, pas une génération en masse. Les plafonds de dépense IA existants s'appliquent.

### 8. Ce que le matin de Naya reprend de la consolidation (décidé par Jeanne le 12 nov. 2026)
Jeanne garde d abord trois choses (puis tout, voir plus bas) :
1. **Les mails qui attendent sa réponse.** Naya lit la boîte Gmail déjà reliée (Unipile, compte de l'agence). Les fils des 14 derniers jours dont le dernier message vient d'un humain identifiable, et pas d'elle, deviennent des tâches « Répondre à X : objet » (échéance sous 2 jours, 7 pour l'administratif), rattachées si possible au projet ou au prospect concerné. On exclut les envois automatiques, les newsletters, les notifications et les réponses de prospects, qui sont déjà dans « Réponses ». Pas de doublon d'un jour à l'autre. Une tâche cochée ne revient pas.
2. **Les chantiers sans mouvement.** Dans Naya, un « chantier » est une étape active ou un objectif actif (à défaut, un projet actif). S'il n'a eu aucune tâche faite ni aucun mouvement (tâche créée par Jeanne, contenu publié, prospect contacté, réponse reçue) depuis 15 jours, Naya le signale le matin avec son prochain pas.
3. **Les indicateurs**, calculés à partir des données de Naya :
   - prospection sur 4 semaines : messages envoyés, réponses, intéressés, rendez-vous ;
   - pipeline : opportunités en discussion, relances échues, clients signés vers l'objectif (« n / cible ») ;
   - audience : abonnés et posts publiés sur 4 semaines, par compte relié (Instagram, LinkedIn), quand l'API du réseau le permet ;
   - appels d'offres : avis à venir, premiers jets prêts sans décision, dossiers en rédaction ou déposés.

   Ils s'affichent dans Naya (au mot du matin, en une ligne courte, et en détail là où ils trouvent leur place) avec leur valeur précédente pour montrer le sens. Une source indisponible est dite, pas inventée.

**Précision de Jeanne (12 nov. 2026) : elle veut finalement TOUT reprendre.** Les quatre autres points sont traduits dans Naya, sans Notion ni outil extérieur :

4. **Le contrôle des tâches de fond de Naya.** Veille des appels d'offres, envoi de prospection, revue du matin, indexeur : si l'une n'a pas tourné à l'heure prévue, ou a échoué, le matin le dit (nom, dernier passage réussi). Naya ne refait pas leur travail à leur place : elle signale la panne.
5. **L'agenda.** Le Google Agenda déjà relié à Naya compte comme preuve de mouvement : un rendez-vous dont le titre cite un client, un prospect ou un projet fait avancer le chantier concerné. Aucune tâche n'est créée depuis l'agenda.
6. **La création, version Naya.** Le suivi porte sur ce qui vit dans Naya :
   - les posts prévus (atelier de contenu, calendrier) et publiés par les comptes reliés à Naya, avec une alerte quand rien n'est programmé sur 7 jours pour un compte actif. C'est l'équivalent de l'alerte Metricool ;
   - les rendez-vous récurrents de création que Jeanne définit (par exemple « Encore Merci : 3 recettes de la semaine » chaque lundi), en tâches récurrentes rattachées au bon projet ;
   - les validations en attente : contenus « à valider » du calendrier éditorial de Naya, lots ou phases de campagne à valider avant leur date de début.

   Le chemin de fer d'octobre et la Campagne 360 dans Notion ne sont pas repris tels quels. Leur équivalent est le calendrier et les campagnes de Naya.
7. **La clôture du vendredi et la réconciliation du lundi.**
   - **Vendredi :** la liste des tâches ouvertes depuis plus de 7 jours, à trancher (faire, déplacer, abandonner) dans un créneau court. Naya ne les clôt pas elle-même.
   - **Lundi :** pour chaque source de Naya, ce qui devrait avoir une suite et n'en a pas. Par exemple des réponses de prospects sans réponse ni tâche, des appels d'offres forts sans décision, des posts à valider sans action, des mails en attente sans tâche. Objectif : zéro chose redécouverte trop tard.

Quand ces sept points tournent dans Naya, on arrête la consolidation de 9 h 04 (`trig_01PZVRTZWoLB3PBT132EDRJs`).

## Ce qu'on ne fait pas

- Pas de connecteur ouvrant Naya à Claude Desktop ou ChatGPT.
- Pas de tableau de bord de pilotage à consulter. Le pilotage se vit dans le planning du jour.
- Pas de publication automatique. Pas de tâche sur un jalon `locked`.
- Pas de critères universels : tout est dérivé du contexte de chaque utilisatrice (règle « Naya 100 % sur mesure »).

## Ce qui serait un échec, même si ça marche techniquement

- Des « pourquoi » génériques et creux (« pour avancer ton objectif »).
- Une journée surchargée : on montre les plus importantes, on ne gonfle pas la liste.
- Des étapes plaquées d'un modèle, sans lien avec la marque ni avec ce qui est déjà en cours.
- Un planning qui ne contient plus jamais rien pour les réseaux sociaux.
- Une modification du planning de Jeanne sans qu'elle puisse annuler.

## Contraintes

- `npx tsc --noEmit` à 0 erreur ; suite vitest verte ; aucun test sur une vraie base.
- Migration éventuelle : générée, relue, appliquée en dev seulement ; en prod, à la main par Jeanne (`MIGRATIONS.md`). Jamais `drizzle-kit push`.
- Appels IA : `isAiBlocked`, `logInvocation`, `recordSpend`, contexte `buildNayaContext`, voix de Naya.
- Ne jamais lancer de tâche de fond en local sans `NAYA_SANS_TACHES_DE_FOND=1`.
- Web et mobile : le « pourquoi » et l'étape doivent apparaître sur les deux.

## Laissé au constructeur

- Réutiliser les jalons comme « étapes » ou ajouter un niveau dédié. Justifier le choix à partir du code. La préférence va à la réutilisation des jalons si elle reste propre.
- Comment rattacher automatiquement à une étape les tâches de contenu, de prospection et de campagne (par campagne → objectif, par type de canal, etc.).
- La formule exacte de priorité et la valeur de N pour la cadence de présence (dérivée du contexte).
- Où se branche la proposition d'étapes dans l'interface (page projet, mot du matin, companion).
- Le découpage en lots livrables.
