# Séance de redémarrage : design

Date : 25 nov. 2026. Demandé par Jeanne. Repo : naya-cadence.

## Intention

Jeanne n'a pas travaillé dans Naya depuis un moment, mais elle a avancé sur ses projets ailleurs :
- ChatGPT prépare trois actus par jour pour l'agence, et Claude les programme ;
- dans Claude, elle prépare des briefs de projets qu'elle envoie à des marques.

Elle ne veut **pas** tout faire basculer dans Naya. Ce qu'elle veut :
- que Naya **comprenne où elle en est vraiment**, projet par projet ;
- qu'elle **apprenne sa vraie façon de travailler** et lui fasse de la place dans le calendrier, par exemple 15 min chaque jour pour valider les actus, ou un atelier d'1 à 2 h de temps en temps pour les envois de projets ;
- qu'elle propose : « Tu travailles comme ça. Tu veux continuer ? Je te mets des créneaux pour ça. »

Ses mots : on « recommence » ensemble, rapidement mais très bien fait.

## Ce que c'est

Une **séance de redémarrage** dans le chat de Naya (NayaCompanion), menée par Naya.

### Déclenchement (les deux)
- **Naya la propose** quand elle détecte une absence. Aucune colonne « dernière visite » n'existe ; proxies possibles : dernière tâche cochée (`tasks.completedAt`), dernier message de chat (`companion_conversations.createdAt`), `task_schedule_events`. Seuil laissé au builder (ordre de grandeur : 7 jours).
- **Jeanne la lance** quand elle veut, depuis le chat (bouton ou phrase du type « on fait le point »).

### Déroulé
1. **Bilan silencieux d'abord.** Avant toute question, Naya rassemble ce qu'elle peut vérifier seule :
   - tâches en retard et non faites ;
   - posts prévus contre posts réellement publiés depuis la dernière activité ;
   - dernière note « Où en est ce projet ? » (`projects.statusNote`) ;
   - objectifs et jalons ;
   - créneaux réguliers existants (`recurring_rituals`).

   Elle ne demande jamais ce qu'elle sait déjà.
2. **Projet par projet** (projets actifs d'abord, puis en pause ; ordre : priorité). Pour chacun, Naya :
   - montre en 2 ou 3 lignes ce qu'elle croit savoir ;
   - demande où Jeanne en est vraiment (réponse libre, en vocal ou à l'écrit) ;
   - pose **au plus 1 ou 2 relances ciblées** si le récit laisse un trou important. C'est rapide : pas d'interrogatoire.
3. **Changements proposés pour le projet**, en une proposition à valider (même mécanisme que les propositions actuelles, avec validation globale ou ligne par ligne) :
   - tâches déjà faites → cochées ; tâches devenues inutiles → archivées ;
   - `statusNote` réécrite à partir du récit ; `projectStatus` changé si Jeanne le dit (pause, etc.) ;
   - **créneaux réguliers** pour le travail fait hors de Naya (« 15 min chaque jour pour valider les actus ? », « 2 h tous les quinze jours pour les envois de projets ? ») ;
   - **envois aux marques** mentionnés → enregistrés avec leur date de relance ;
   - nouvelles prochaines étapes, sous forme de tâches.
4. **Fin de séance :**
   - **évaluation des réseaux** : publié ou pas par rapport à ce qui était prévu, plus les chiffres (portée, abonnés gagnés, meilleurs posts) sur la période d'absence ;
   - semaine recalée ;
   - court récap de ce que Naya a compris de sa façon de travailler.

### Interruption
La séance doit se finir d'une traite, c'est le but. Mais si un appel tombe, Naya **garde la progression** (projets déjà traités, réponses données, propositions en attente) et reprend exactement au projet suivant quand Jeanne revient. Il n'y a pas de reprise fractionnée sur plusieurs jours : une séance commencée reste proposée en tête du chat jusqu'à ce qu'elle soit finie ou abandonnée.

## Envois aux marques et relances (nouveau)

Rien n'existe pour « j'ai présenté tel projet à telle marque ». `leads` et `outreach_messages` sont pensés pour la prospection à froid et exigent une campagne ou un lead. Il faut un **suivi dédié des envois** :
- marque ;
- contact (facultatif) ;
- projet présenté, en texte libre ;
- projet Naya concerné (facultatif) ;
- canal ;
- date d'envoi ;
- statut (envoyé, relancé, réponse, accepté, refusé, sans suite) ;
- date de prochaine relance ;
- notes.

La relance devient une tâche courte le jour venu. Naya ne relance jamais à la place de Jeanne : elle lui rappelle de le faire. Les envois se créent pendant la séance de redémarrage, et aussi à tout moment depuis le chat (« j'ai envoyé le projet X à Sézane »). Une vue simple de la liste des envois, rattachée au projet de l'agence ou en page dédiée, est laissée au builder.

## Créneaux réguliers

S'appuyer sur `recurring_rituals` et `materializeRituals` (déjà placés avant la génération IA). Il manque la **fréquence « toutes les N semaines »** : l'atelier d'envois peut être bimensuel. Il faut l'ajouter. Le chat n'a aujourd'hui aucun outil pour créer un créneau régulier : l'ajouter comme outil à valider.

## Outils agent à ajouter (registre)

Tous les outils d'écriture sont **à valider**, pas directs :
- archiver une tâche ;
- écrire `statusNote` et `projectStatus` ;
- créer, modifier ou arrêter un créneau régulier ;
- créer ou mettre à jour un envoi aux marques.

Plus un outil de lecture pour l'évaluation des réseaux.

## Metricool (réponse de Jeanne : les actus sont programmées dans Metricool)
Pour l'agence, le « prévu » est dans Metricool, pas dans Naya. Naya lit Metricool par son **API officielle et documentée** (pas d'API privée) :
- posts programmés et publiés sur la période ;
- statistiques par réseau quand elles sont disponibles.

Connexion par utilisateur dans Réglages, avec jeton API et identifiants de compte et de marque Metricool. Le jeton est chiffré au repos comme les autres jetons (`token-crypto`). C'est Jeanne qui saisit le jeton, pas Claude. L'accès API dépend de l'offre Metricool : si l'API n'est pas incluse ou si le jeton est absent, l'évaluation retombe sur ce que Naya lit elle-même sur les réseaux, et le dit. Le prévu/publié combine les posts de Naya et ceux de Metricool, sans doublon.

## Réseaux : limites connues
- **Instagram :** lecture des posts et des statistiques possible avec le compte connecté. Le code des statistiques existe en partie dans `social-integrations.ts` ; la fonction meilleures heures lit déjà les médias.
- **LinkedIn profil :** l'API ne permet pas de lire tous les posts du profil personnel. Naya ne voit que ce qu'elle a publié elle-même. La page Agence JMD sera lisible quand l'accès Community Management sera accordé (demande envoyée le 24 nov.). L'évaluation le dit clairement au lieu de deviner.
- Un compte déconnecté ou expiré est signalé dans l'évaluation (« reconnecte Instagram pour voir les chiffres »). Ce n'est pas une erreur.

## Objectifs
- Après une séance, le tableau de Naya reflète la réalité : bonnes tâches, notes à jour, créneaux pour le travail fait ailleurs, envois suivis.
- Une séance avec 5 à 8 projets tient en une vingtaine de minutes environ.

## Hors périmètre
- Faire passer les actus ou les briefs dans Naya (ChatGPT et Claude restent ses outils).
- Relancer les marques automatiquement.
- Lire des réseaux par moyens non officiels (aucune API privée non documentée).

## Anti-objectifs (raté même si ça marche)
- Un questionnaire long et figé, identique pour chaque projet.
- Des changements appliqués sans validation, ou des tâches qui disparaissent sans trace (tout doit pouvoir être annulé, comme `agent_actions`).
- Naya qui demande ce qu'elle pouvait vérifier seule.
- Une évaluation des réseaux qui invente des chiffres manquants.

## Contraintes
- Textes en français, via i18n (`t()`). Garde anti-texte en dur : `client/src/locales/jsx-guard.test.ts`.
- Jamais de test qui agit vers l'extérieur via la file de prod.
- Migrations Drizzle numérotées, répétées sur une branche Neon avant la prod.
- Push sur main = déploiement : seulement avec le « oui » de Jeanne.

## Laissé au builder
- Seuil exact d'absence et forme de la proposition dans le chat.
- Stockage de la progression de séance (table dédiée ou réutilisation de `companion_conversations` / `agent_propositions` avec une expiration longue).
- Présentation de la liste des envois.
- Choix des chiffres réseaux exacts selon ce que l'API renvoie.

## Décisions prises par Claude (après relecture)
- **Une proposition groupée par projet** : nouveau type de proposition qui mélange plusieurs actions (cocher, archiver, note, statut, créneaux, envois, tâches), avec choix ligne par ligne et annulation de l'ensemble. Expiration longue (jusqu'à la fin de la séance), pas 1 h.
- **Pour tous les utilisateurs**, rien de codé en dur pour l'agence : les « envois » sont génériques (présenter quelque chose à quelqu'un, puis relancer). Activation d'abord pour Jeanne via une liste d'utilisateurs (comme FIL_CONDUCTEUR_USERS), puis ouverte.
- **Créneaux** : ajouter seulement « toutes les N semaines » (intervalle + date de départ pour compter). Pas de règle mensuelle ni « Nᵉ jour du mois » pour l'instant.
- **Relances** : matérialisées comme les créneaux réguliers, au moment où la journée est préparée (même endroit que `materializeRituals`, idempotent). Pas de nouveau job de fond. Changer la date de relance déplace la tâche non faite.
- **Début de l'absence** : l'activité la plus récente parmi les indicateurs (tâche cochée, message de chat, événement de planning).
- **« Semaine recalée »** : placer les nouveaux créneaux et tâches avec le placement existant, sans régénérer la semaine par l'IA. Cela fait partie de ce que Jeanne valide.
