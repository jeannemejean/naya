# Capter le résultat — la notification de fin de tâche — design

**Date :** 2026-09-07
**Origine :** Jeanne — « envoyer une notification quand l'heure de fin de tâche approche, pour dire : est-ce que tu as terminé ? viens la cocher, c'est important pour que Naya comprenne. »
**Périmètre :** iOS uniquement. Rien pour Android tant que Jeanne n'y est pas.

## Le problème, chiffré

En production, aujourd'hui :

| Signal | Lignes |
| --- | --- |
| Tâches | 58 |
| Tâches cochées | **0** |
| `actual_duration` renseignée | **0** |
| Retours de fin de journée | **0** |
| Entrées mémoire du fil `reception` | **0** |

Naya n'a **aucune trace de ce qui a été fait**. `duration-calibration.ts` et `behavior-patterns.ts` — les deux services censés apprendre du rythme de l'utilisatrice — tournent sur un ensemble vide depuis l'origine et renvoient `{}`. Le tampon de respiration est figé à 10 min et le restera : il exige 5 retours sur 14 jours pour bouger.

`STRATEGIE-DONNEES-ET-POSITIONNEMENT.md` §2 le dit sans détour : sans variable de sortie, aucun modèle ne pourra jamais être entraîné, et le compteur ne commence à tourner que le jour où on capte le résultat.

## Les trois causes, dites par Jeanne

Interrogée sur ce qui se passe quand elle ne coche pas, elle a retenu **trois** causes sur quatre :

1. **Elle oublie sur le moment.** → il faut un signal.
2. **Cocher ne lui apporte rien.** → aucun signal ne réglera ça ; un rappel sur un geste vide est du harcèlement.
3. **Elle n'est pas dans l'app à ce moment-là.** → il faut pouvoir répondre **sans ouvrir Naya**.

Non retenue : « la réalité ne colle pas à la case ». Le binaire fait / pas fait lui convient — c'est une simplification importante, elle évite d'inventer un vocabulaire d'états intermédiaires.

Ces trois causes commandent le design entier. Une notification classique ne traite que la première, **aggrave** la troisième si elle oblige à ouvrir l'app, et ne fait rien pour la deuxième.

## Décisions actées avec Jeanne

1. **Une notification par tâche, à son heure de fin.** Fidélité maximale. Le risque de saturation (7-8 par jour) a été explicitement présenté et assumé ; la soupape du §6 existe pour ça.
2. **Réponse depuis la notification, sans ouvrir l'app.** Deux boutons : **Fait** / **Pas fait**.
3. **Pas de bouton « Reporter à demain ».** Voir §5.
4. **Retour immédiat : ce que Naya vient de comprendre.** Une phrase courte, ou le silence.
5. **Soupape à 3** notifications sans réponse consécutives.

## L'inconnue à lever AVANT tout code

Il existe deux façons de faire arriver une notification à l'heure :

| | Push serveur | **Notification locale programmée** |
| --- | --- | --- |
| Jeton push | requis | non |
| Worker serveur | requis | non |
| Configuration APNs | requise | **non** |
| Hors ligne | non | oui |
| Précision horaire | dépend du réseau | exacte |

Pour une alarme à une heure **connue d'avance**, la locale est structurellement la bonne réponse : l'app connaît le plan du jour, elle peut poser les alarmes elle-même.

**Mais `expo-notifications` est absent de `mobile/` — retiré volontairement.** Il ajoutait l'entitlement `aps-environment` *même une fois sorti des `plugins`*, et le profil de signature n'avait pas la capacité Push : c'est ce qui a fait échouer les builds #5 à #9 (voir la saga documentée dans la mémoire du projet). **On ne sait pas si l'usage purement local en est exempt.**

### La seconde inconnue, du même ordre

Tout le design repose sur « répondre **sans ouvrir l'app** ». Sur iOS, une action de notification réveille l'app en arrière-plan pour traiter la réponse — mais le comportement diffère selon que l'app est en arrière-plan ou **complètement fermée**, et c'est précisément l'état où Jeanne sera : elle n'est pas dans Naya, c'est la cause n°3.

Si la réponse ne remonte pas quand l'app est fermée, la promesse tombe et il faut la remplacer par une file locale qui se vide à la prochaine ouverture — un design différent, à connaître **avant** et non après.

**Conséquence : la première tâche du plan n'est pas du code, c'est un build jetable** qui répond aux **deux** questions — l'entitlement, et la remontée d'une réponse app fermée. Si le local passe sans capacité Push et que les réponses remontent, tout le chantier APNs disparaît. Sinon, il faut une session interactive de Jeanne pour créer un profil avec la capacité Push — je ne peux pas le faire à sa place —, et on l'organise avant d'écrire la feature.

Écrire la feature avant de lever ces deux points, c'est risquer de reconstruire la saga des builds **et** de découvrir à la fin que la promesse centrale ne tient pas.

## Réponses aux deux inconnues

Spike du 2026-09-07, branche `capter-le-resultat`, dépôt `mobile/` commits `d3034ad` et `476960a`.
Harnais jetable, aucun code de feature.

### Question A — l'entitlement : **non, l'usage local n'en est pas exempt**

`expo install expo-notifications` n'ajoute **aucune** entrée dans les `plugins` d'`app.json` —
vérifié, la liste est inchangée. Le paquet est une dépendance seule, exactement la configuration
des builds #5 à #9. Cela n'a rien changé : build production `e5fb4117-85c1-4fb9-89f1-0fe72b4f02d6`,
statut `ERRORED`, code `XCODE_BUILD_ERROR` :

```
Provisioning profile "*[expo] app.hellonaya.naya AppStore 2026-06-22T18:44:56.383Z"
  doesn't support the Push Notifications capability.  (in target 'Naya')
  doesn't include the aps-environment entitlement.    (in target 'Naya')
```

iOS accorde `aps-environment` au niveau de l'**App ID**. Il ne distingue pas « programmer une
alarme locale » de « recevoir du push distant » : la présence du module suffit.

Le build **simulateur** (`ddcaee70`), lui, passe, et ses entitlements sont vides — mais ce n'est
pas une contradiction et pas une preuve : un build simulateur ne passe pas par le provisioning.
Seul le build signé tranche.

**Ce que la réponse ne remet PAS en cause.** Le design reste intact : notification locale
programmée, pas de jeton push, pas de worker serveur, pas de configuration APNs, fonctionne hors
ligne. Le coût est une opération de signature **unique** — activer la capacité Push Notifications
sur l'App ID puis régénérer le profil (`npx eas-cli credentials` en mode interactif, qui exige une
authentification Apple). Ce n'est pas le chantier APNs redouté au §« L'inconnue à lever ».

### Question A — suite : **levée le 2026-09-07 au soir**

`npx eas-cli credentials` en interactif (session Apple de Jeanne, seule à pouvoir la mener) a
régénéré le profil de provisioning avec la capacité Push. Le build production
`2064f081-731f-4b3a-9609-70617755a6d7` (buildNumber 23) **passe** — celui qui, deux heures plus
tôt et sur le même code, échouait sur `aps-environment`. Aucune clé APNs n'a été créée : le menu
« Push Notifications » d'EAS concerne le push distant, dont ce design n'a pas besoin.

Coût final de l'entitlement : une opération de signature unique. Le chantier APNs redouté
n'existe pas.

### Question B — la réponse app fermée : **OUI**

Testé sur l'iPhone de Jeanne, build TestFlight 23, app **complètement fermée** (balayée hors du
sélecteur d'apps, pas seulement en arrière-plan). Appui long sur la notification de l'écran
verrouillé, bouton « Fait ». L'app n'a pas été ouverte.

Trace relevée sur `/api/mobile-crash` :

```
at     : 2026-09-07T19:47:31.747Z
message: [spike-notif] réponse reçue (app fermée, au démarrage)
stack  : {"action":"spike_fait","at":"2026-09-07T19:47:28.079Z"}
rejoué : None
```

Lecture : geste à 19:47:28 ; iOS relance l'app **en tâche de fond**, sans rien afficher ; la
réponse en attente est lue au démarrage et postée 3,6 s plus tard. `rejoué: None` = envoyée en
direct, et non rattrapée au lancement suivant par le motif persiste-puis-rejoue.

La branche qui a produit la trace est `getLastNotificationResponseAsync()` — celle du démarrage,
pas le listener live. C'est la confirmation que le processus était bien **terminé** : c'est
précisément pourquoi l'écoute avait été placée à la racine et non dans l'écran Profil, qui n'est
jamais monté dans ce cas.

**Conséquence : le design tient intégralement.** Notification locale programmée, deux actions
`opensAppToForeground: false`, réponse sans ouvrir l'app, aucune file locale de repli à inventer.
Les tâches 6 et 7 du plan se font telles qu'écrites.

Réserve honnête : le journal seul ne distingue pas un réveil en tâche de fond d'une ouverture
manuelle — c'est le témoignage de Jeanne (« je n'ai pas ouvert l'app ») qui ferme ce point.

### Question B — état intermédiaire au moment de la rédaction (conservé pour mémoire)

Le harnais est en place et fonctionne : `lib/spike-notifications.ts` programme une notification
locale à +60 s avec deux actions marquées `opensAppToForeground: false`, et l'écoute vit dans
`app/_layout.tsx` — **pas** dans l'écran Profil, qui n'est jamais monté quand iOS relance une app
fermée pour traiter une action ; y écouter aurait garanti un faux négatif. La trace passe par
`lib/crash.ts`, dont le motif persiste-puis-rejoue survit à la mort du process pendant le
lancement en tâche de fond.

Ce qui bloque est matériel, pas technique : répondre à B exige trois gestes dans l'interface
(autoriser les notifications, fermer l'app, appuyer sur « Fait ») et l'automatisation du clic
n'est pas disponible sur ce poste — `simctl` n'expose aucune commande d'appui et `osascript` n'a
pas l'autorisation d'accessibilité.

**Recommandation :** trancher B sur l'**iPhone réel** plutôt que sur le simulateur, une fois la
capacité Push activée pour A. Le comportement de relance après terminaison est précisément ce qui
diffère le plus entre simulateur et appareil, et c'est l'appareil qui compte.

**Tant que B n'est pas tranchée, les tâches 6 et 7 du plan restent suspendues.** Si la réponse est
« non », elles sont à repenser autour d'une file locale vidée à la prochaine ouverture.

## Architecture

### §1 — La programmation des alarmes (mobile)

L'app programme une notification locale par tâche du jour, à `scheduledEndTime`.

Elle **reprogramme** à chaque fois que le plan change — et il change souvent : re-tassage anti-chevauchement, report de fin de journée, replanification intra-journée toutes les 15 min, glisser-déposer. Le mécanisme doit être **idempotent** : recalculer l'ensemble des alarmes du jour et remplacer, jamais empiler. C'est la même discipline que `replaceConversionAttributions` du lot 3B.

Une tâche cochée par un autre chemin (web, app) voit son alarme annulée.

Pas d'alarme pour une tâche sans `scheduledEndTime`, ni pour une tâche déjà terminée, ni pour une heure déjà passée.

### §2 — La notification

Deux actions, répondables sans ouvrir l'app : **Fait** / **Pas fait**.

Le texte porte la raison, comme Jeanne l'a demandé — court, dans la voix de Naya, une constatation et non une supplique. Registre visé : « C'est comme ça que je comprends ton rythme. » Jamais de culpabilisation, jamais de compteur.

Toutes les chaînes passent par i18n, `fr.ts` **et** `en.ts` (le test de parité l'impose).

### §3 — Ce qui remonte en base, et ce qui ne remonte pas

**On écrit `completedAt`** = l'instant de la réponse. Et `completed = true` pour « Fait ».

**On n'écrit PAS `actualDuration`.** Savoir que Jeanne a répondu « fait » à l'heure de fin ne dit **rien** de l'heure à laquelle elle a commencé. La renseigner serait fabriquer une mesure à partir d'une absence — exactement l'erreur que le Fil 3 a dû rattraper **quatre fois** (score 3A, parseur CSV, frontière HTTP, couture 3A↔3B). La colonne reste vide jusqu'à ce qu'on mesure vraiment un début.

**« Pas fait » n'écrit rien de plus** qu'une trace de la réponse : la tâche reste non terminée, et `runEndOfDayRollover` la déplacera comme il le fait déjà.

**Où vit la trace des notifications.** La soupape du §6 a besoin de savoir qu'une notification a été **envoyée et laissée sans réponse** — ce qui n'est ni un « fait » ni un « pas fait ». **Absence de réponse ≠ réponse négative**, la même distinction que « non mesuré ≠ mesuré à zéro », et elle se perdra si personne ne la défend.

Retenu : une table dédiée `task_prompts` — `taskId`, `userId`, `scheduledFor`, `answeredAt` (nullable), `answer` (`done` | `not_done`, nullable). Une ligne par alarme posée. `answeredAt IS NULL` **et** `scheduledFor` dépassée = restée sans réponse. Un compteur dans les préférences serait plus court mais ne saurait pas dire *quelles* notifications ont été ignorées, ce qui interdirait tout diagnostic. Contrainte **UNIQUE (`task_id`, `scheduled_for`)** pour que la reprogrammation du §1 reste idempotente jusqu'en base.

### §4 — Le retour immédiat

Une fonction **pure** décide s'il y a quelque chose de solide à dire à partir de l'historique, et le formule. Elle renvoie `null` quand il n'y a rien — et alors la confirmation reste muette.

Registre : « tu finis tes tâches créatives plus vite que prévu le matin », « troisième fois cette semaine que l'admin déborde ». Une observation, jamais une note.

**Interdits, alignés sur le reste de Naya :** aucun compteur (« 4/6 aujourd'hui »), aucun palmarès, aucune comparaison. Le silence est une sortie valide et préférable à une banalité — c'est la même règle que le `rationale` du score de réception.

**Le seuil de « solide » vit dans une constante exportée et nommée comme un défaut révisable** — jamais dans un prompt. Retenu : **au moins 5 observations** du motif concerné avant de l'énoncer, le même ordre de grandeur que la règle d'ajustement du tampon. En dessous, silence. C'est un défaut à recalibrer sur données réelles, pas une vérité.

### §5 — Pourquoi pas de bouton « Reporter à demain »

Deux raisons, la seconde plus grave que la première.

**C'est un doublon.** `runEndOfDayRollover` déplace déjà les tâches non faites au jour ouvré suivant. Le bouton ferait ce qui se produit déjà — deux chemins pour un même résultat, qui finiront par diverger.

**C'est un euphémisme.** « Reporter à demain » sonne mieux que « Pas fait ». Placé à côté, il deviendrait la sortie confortable, et on aurait construit une machine à capter le résultat qui capte un euphémisme. La variable de sortie est tout l'objet de cette feature.

Si dans quelques semaines Jeanne constate qu'elle veut replanifier depuis la notification, ce sera un besoin **observé** et non supposé, et on l'ajoutera alors.

### §6 — La soupape

**Trois notifications consécutives sans réponse** → Naya réduit d'elle-même la fréquence et **le dit**.

Jeanne a choisi la fidélité maximale en connaissance de cause. Ce garde-fou existe pour que le jour où c'est trop, elle ajuste plutôt qu'elle coupe — parce que le jour où elle désactive les notifications de Naya, tout s'arrête d'un coup et en silence, sans qu'aucun signal ne remonte.

Trois est un seuil décidé avec elle : plus bas, il se déclenche sur une journée en réunion ; plus haut, il arrive après qu'elle ait déjà coupé.

## Ce qu'on ne construit pas

- **Aucune inférence de probabilité** à partir de signaux faibles. `STRATEGIE-DONNEES-ET-POSITIONNEMENT.md` §2 l'interdit explicitement : ce sont des activités, pas des résultats, et une probabilité fausse déclenche son propre poison.
- **Aucun `actualDuration` déduit.** Voir §3.
- **Aucun palmarès, aucun compteur** en sortie utilisateur.
- **Rien pour Android.**
- **Aucun changement du planificateur.** Cette feature observe, elle ne replanifie pas.

## Tests

Fonctions pures d'abord, conformément à la discipline du dépôt :

- La sélection des tâches à notifier et le calcul de leurs heures : une tâche sans heure de fin, une tâche déjà terminée, une heure déjà passée, un plan qui change deux fois — l'ensemble doit être idempotent.
- Le retour immédiat : renvoie `null` quand les données sont insuffisantes ; ne produit jamais de compteur ; formule une observation quand il y a matière.
- La soupape : se déclenche à trois absences **consécutives** ; une réponse remet le compteur à zéro ; une absence de réponse n'est jamais comptée comme un « pas fait ».

Les enveloppes DB, les routes et les composants React restent non testés unitairement, comme partout ailleurs dans ce dépôt.

## Critères d'acceptation

- [ ] Les **deux** inconnues — entitlement `aps-environment`, et remontée d'une réponse **app fermée** — sont levées par un build jetable **avant** toute écriture de feature, et le résultat est consigné.
- [ ] Une notification arrive à l'heure de fin d'une tâche, sur l'iPhone de Jeanne.
- [ ] « Fait » et « Pas fait » sont répondables **sans ouvrir l'app**, et la réponse arrive en base.
- [ ] `completedAt` est renseignée ; **`actualDuration` reste `null`**.
- [ ] Un changement de plan reprogramme les alarmes sans en empiler.
- [ ] Le retour immédiat se tait quand il n'a rien de solide, et ne produit jamais de compteur.
- [ ] La soupape se déclenche à trois absences consécutives et le dit.
- [ ] `npx tsc --noEmit`, `npx vitest run` et `npm run build` verts ; CI verte.
