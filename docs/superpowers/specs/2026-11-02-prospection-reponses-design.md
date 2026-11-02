# Chantier 2 — Réponses, boîte unique et délais comptés depuis l'événement

Date : 2026-11-02 · Statut : brouillon à valider par Jeanne
Chantier 2 sur 4 du plan validé le 2026-10-30 (voir chantier 1 : merge 58b56d8).

## 1. Intention

Aujourd'hui Jeanne prospecte avec Lemlist : quand un prospect répond, elle le voit dans la boîte
de réception Lemlist, lui répond depuis Lemlist, et la réponse part sur le canal où il a écrit
(email ou LinkedIn). Naya doit faire exactement la même chose, pour qu'elle puisse quitter Lemlist.

Le pourquoi : une séquence qui continue d'écrire à quelqu'un qui a répondu est l'erreur la plus
coûteuse de la prospection (elle grille le prospect et l'image de l'agence). Et tant que les
réponses vivent ailleurs, Naya ne sait pas ce qui marche.

Agacement Lemlist à ne pas reproduire : un message parti 1 seconde après l'acceptation d'une
invitation alors que l'étape disait « 2 jours après ». Dans Naya, un délai lié à un événement
compte **depuis l'événement**.

## 2. Objectifs

1. **Tout passe par Unipile, pour les deux canaux.** Jeanne relie son LinkedIn et son Gmail à
   Naya via Unipile (déjà payé par Jeanne, déjà intégré pour LinkedIn).
2. **Naya envoie elle-même** les étapes email (depuis le vrai Gmail de Jeanne) et LinkedIn
   (invitations + messages), au rythme décrit en §5.
3. **Naya détecte toute seule** les réponses (email et LinkedIn) et les acceptations d'invitation.
4. **Une réponse sort le prospect de la campagne** immédiatement, tous canaux confondus.
5. **Boîte « Réponses » unique dans Naya** : Jeanne lit la conversation, Naya propose une
   réponse, Jeanne l'ajuste et l'envoie ; elle part sur le canal du prospect, dans le même fil.
6. **Une action dans la journée de Jeanne** pour chaque réponse à traiter, et le point du jour
   dit combien de réponses attendent.
7. **Les réponses automatiques ne comptent pas** : absence (la relance est décalée après la date
   de retour), accusé de réception (ignoré).
8. **Délais depuis l'événement** pour les étapes conditionnées à l'acceptation d'invitation.

## 3. Non-objectifs

- Sourcing quotidien autonome (chantier 3) et lien contenu / prospects tièdes (chantier 4).
- Un client mail complet : Naya ne montre que les fils liés à un prospect en campagne (ou déjà
  dans la boîte), jamais les autres emails de Jeanne.
- WhatsApp, Instagram et les autres messageries Unipile.
- Tests A/B, statistiques de campagne avancées.

## 4. Anti-objectifs (échec même si « ça marche »)

- Un prospect qui a répondu reçoit encore un message automatique, sur n'importe quel canal.
- Un message part quelques secondes après un événement alors qu'un délai était prévu.
- Naya affiche, stocke ou analyse un email personnel de Jeanne sans rapport avec un prospect.
- Le compte LinkedIn de Jeanne se fait restreindre parce que Naya a dépassé ses limites.
- Une réponse automatique d'absence sort le prospect de la campagne (faux positif), ou une vraie
  réponse est classée « automatique » et le prospect reçoit la relance (faux négatif — le pire des
  deux : en cas de doute, on considère que c'est une vraie réponse).

## 5. Décisions prises avec Jeanne

- **LinkedIn branché directement** (lecture + envoi) via Unipile. Pas de copier-coller. Le panneau
  « LinkedIn à envoyer » du chantier 1 reste uniquement comme solution de repli (compte non relié
  ou déconnecté).
- **Rythme LinkedIn** : environ un envoi toutes les 20 minutes, entre 8 h et 18 h (heure de
  Jeanne), avec de temps en temps une pause d'1 à 2 heures pour paraître naturel.
- **Les limites existantes de Naya restent la règle** (`prospection-linkedin-guard.ts`) : montée
  progressive de 5 à 15 actions LinkedIn par jour, 80 par semaine glissante, arrêt total sur
  signal de restriction. Les 20 minutes règlent l'espacement, pas le volume.
- **Gmail via Unipile**, avec l'application OAuth d'Unipile (pas de vérification Google ni d'audit
  de sécurité payant à faire côté Naya).
- **Ordre de mise en route** : Jeanne pose `UNIPILE_API_KEY` et `UNIPILE_DSN` sur Railway
  maintenant (inerte tant qu'aucun compte n'est relié), mais ne relie son LinkedIn dans Naya
  qu'une fois ce chantier en ligne.

## 6. Le comment

### 6.1 Connexions

- **LinkedIn** : existe déjà (`generateConnectLink`, `compteUnipile`, `linkedinUnipileAccountId`,
  périmètre utilisateur / projet client dans `connexions/`).
- **Gmail** : même mécanique, lien hébergé Unipile avec le fournisseur Google, nouvel identifiant
  de compte stocké à côté de `linkedinUnipileAccountId` (même logique de périmètre projet client).
  L'écran de connexions affiche les deux, avec leur état (relié, déconnecté, à reconnecter).
- Webhook « statut de compte » d'Unipile : un compte déconnecté ou en erreur met en pause
  l'envoi sur ce canal et le signale à Jeanne dans son point du jour (pas d'échec silencieux).

### 6.2 Envoi des emails par Gmail

- Si un Gmail est relié pour le périmètre, les étapes email partent par Unipile
  (`POST /api/v1/emails`) depuis cette boîte ; sinon, SendGrid comme aujourd'hui (repli).
- Suivi des ouvertures et clics : `tracking_options` d'Unipile + webhook de suivi, qui alimentent
  les mêmes champs que le webhook SendGrid (`openedAt`, `clickedAt`), pour que les conditions
  `if_opened` / `if_clicked` continuent de marcher.
- **Désinscription** : SendGrid gérait le lien ; par Gmail, Naya doit fournir son propre lien de
  désinscription (page publique Naya, jeton signé par lead) et l'en-tête `List-Unsubscribe`.
  Le clic met l'état à `unsubscribed` (définitif, comme au chantier 1).
- Les garde-fous du chantier 1 restent : plafond quotidien email, écart de 3 à 8 min entre deux
  emails, idempotence des étapes (`outreach_step_sends`).
- On conserve l'identifiant Unipile de chaque email envoyé (`provider_id`) : il sert à rattacher
  les réponses au bon fil et à répondre dedans (`reply_to`).

### 6.3 Rythme LinkedIn

- Espacement entre deux actions LinkedIn d'un même compte : environ 20 minutes, avec un aléa
  (*mon choix : 15 à 25 minutes*), à la place des 3 à 7 minutes actuelles
  (`LINKEDIN_MIN_DELAY_BASE_MS` / `_JITTER_MS`).
- Fenêtre : 8 h – 18 h, jours ouvrés, fuseau de Jeanne (*mon choix : pas le week-end*).
- Pauses : *mon choix* — après un envoi, environ 1 fois sur 6, la prochaine action est repoussée
  de 60 à 120 minutes. Tiré au hasard de façon déterministe par compte et par jour pour rester
  testable.
- Volume : inchangé, borné par la garde (5 → 15 / jour, 80 / semaine).
- *Mon choix* — articulation avec l'existant (`prospection-sender.ts`) : pour LinkedIn, la fenêtre
  8 h – 18 h **remplace** les heures de travail (`workDayStartMin`/`EndMin`) et les sessions de
  prospection (`isWithinAnySession`), pour ne pas cumuler des fenêtres qui réduiraient l'envoi à
  presque rien. Les heures où le prospect est joignable (`isTargetReachableAt`) restent : elles
  choisissent **quel** prospect passer en premier, pas si on envoie. Le poller
  (`linkedin-sync.ts`) garde son propre espacement, plus large, et ne réutilise plus les
  constantes d'envoi.
- **Les réponses que Jeanne écrit elle-même** depuis la boîte partent tout de suite, sans attendre
  le rythme (c'est une conversation, pas de la prospection) ; elles sont comptées dans le budget
  de la garde mais jamais bloquées par lui, sauf restriction du compte (arrêt total).

### 6.4 Réception : webhooks Unipile

- Une route publique `/api/unipile/webhook`, authentifiée par un en-tête secret propre à Naya
  (configuré à la création du webhook), qui répond 200 en moins de 30 s et traite ensuite.
- Webhooks enregistrés : messagerie (`message_received`), emails reçus (`mail_received`),
  nouvelles relations (`new_relation`), suivi email, statut des comptes.
- **Idempotent** : Unipile renvoie jusqu'à 5 fois ; chaque message est traité une seule fois
  (identifiant de message unique en base).
- Le poller actuel (`linkedin-sync.ts`) devient un filet de secours pour les acceptations, plus
  espacé, toujours dans le budget de la garde.

### 6.5 Rattacher un message à un prospect

- On retrouve l'utilisatrice et le périmètre par l'`account_id` Unipile.
- **LinkedIn** : par l'identifiant LinkedIn interne de l'expéditeur
  (`sender.attendee_provider_id`), comparé à celui du lead. On mémorise cet identifiant sur le
  lead au moment de l'invitation (`resolveProviderId` le calcule déjà) ; repli sur l'identifiant
  public de l'URL de profil.
- Un message dont l'expéditeur est Jeanne elle-même (`account_info.user_id` =
  `sender.attendee_provider_id`) n'est **pas** une réponse. Il est ajouté au fil s'il existe
  (elle a pu répondre depuis son téléphone : Naya le voit et clôt l'action). Cas important :
  une invitation acceptée avec note crée une conversation qui ne contient que le message de
  Jeanne — ce n'est pas une réponse.
- **Email** : d'abord par le fil (réponse à un email envoyé par Naya, via son `provider_id` /
  en-têtes de réponse), sinon par l'adresse de l'expéditeur = email du lead (minuscules, espaces
  retirés), limité aux leads de Jeanne.
- *Mon choix* : le rattachement ne vise que les leads **déjà contactés par Naya** (au moins un
  message de séquence réellement envoyé) ou qui ont déjà une conversation dans la boîte. Un lead
  seulement identifié ou archivé ne déclenche rien.
- **Aucun lead trouvé** : le message est ignoré et rien n'est stocké (anti-objectif « emails
  personnels »).

### 6.6 Trier : vraie réponse, absence, accusé de réception

Fonction pure, testée sur des exemples réels français et anglais :

1. Signaux techniques d'email automatique (en-têtes `Auto-Submitted`, `X-Autoreply`,
   `Precedence: auto_reply`…) et formules typiques (« absent·e du bureau », « out of office »,
   « réponse automatique », « je suis en congé jusqu'au… »).
2. Si c'est une **absence** : on cherche une date de retour. La prochaine étape est repoussée au
   lendemain ouvré de cette date (*mon choix : 7 jours si aucune date n'est trouvée*). Le prospect
   reste en campagne. L'absence est visible dans sa fiche mais ne crée pas d'action.
3. Si c'est un **accusé de réception** automatique : ignoré, visible dans la fiche seulement.
4. **Tout le reste, et tout cas douteux, est une vraie réponse.** Un « non merci » ou un
   « stop » est une vraie réponse (sortie de campagne) ; *mon choix* : un message contenant une
   demande explicite de désinscription passe aussi l'état à `unsubscribed`.

L'IA n'est utilisée qu'en appoint pour extraire une date de retour ambiguë, jamais pour décider
seule qu'une réponse est automatique.

### 6.7 Ce qui se passe quand un prospect répond

- État de séquence → `stopped_replied`, `repliedAt` = date du message. Toutes les étapes à venir,
  sur tous les canaux, sont annulées ; un brouillon LinkedIn en attente est retiré du panneau de
  repli.
- Le message d'outreach concerné passe `responseReceived = true`, `responseDate`.
- *Mon choix* : l'étape du lead dans le pipeline passe à « en discussion » si elle était avant
  (jamais de retour en arrière).
- Une **tâche** est créée dans la journée de Jeanne : « Répondre à {Prénom Nom} ({entreprise}) —
  {LinkedIn | email} », type `outreach`, liée au lead (`tasks.leadId`), prévue aujourd'hui, courte
  (*mon choix : 10 min*). Elle s'ouvre directement sur la conversation. Elle se coche toute seule
  quand Jeanne répond (depuis Naya ou depuis son téléphone).
- Plusieurs messages du même prospect avant qu'elle réponde = une seule tâche.
- Le point du jour (brief existant) mentionne : « N réponses de prospects attendent ».

### 6.8 La boîte « Réponses »

- Un onglet dans la prospection, avec un compteur de non-lus.
- Liste des conversations (prospect, entreprise, canal, extrait, date), non traitées en premier.
- Vue d'une conversation : tout le fil (messages de la séquence + réponses), la fiche du prospect
  à côté (signal, entreprise, campagne).
- **Réponse proposée par Naya**, dans la voix de Jeanne et avec le contexte de la campagne, que
  Jeanne modifie librement avant d'envoyer. Rien ne part sans son clic « Envoyer ».
- Envoi sur le canal du prospect : LinkedIn → message dans la même conversation Unipile ;
  email → réponse dans le même fil Gmail (`reply_to` + objet « Re: … »).
- Actions : « Envoyer », « Marquer comme traité » (sans répondre), et « Ce n'était pas une
  vraie réponse » (corrige un faux positif : remet le prospect en campagne là où il en était).

### 6.9 Délais comptés depuis l'événement

Aujourd'hui, le délai d'une étape court depuis le dernier envoi (`decideNextStep`). Pour une
étape `if_invite_accepted` avec délai de 2 jours, si l'invitation est acceptée au bout de 3 jours,
le message partirait immédiatement — le défaut de Lemlist. Changement :

- Une étape `if_invite_accepted` **attend l'acceptation**, puis son délai court **depuis
  l'acceptation** (`leads.linkedinConnectedAt`).
- Si l'invitation n'est pas acceptée après une durée d'attente (*mon choix : 14 jours*), l'étape
  est sautée et la branche `if_invite_not_accepted` prend le relais.
- Date d'acceptation : l'heure du webhook `new_relation` (Unipile peut le recevoir jusqu'à 8 h
  après l'acceptation réelle ; on accepte cet écart, il ne peut que retarder, jamais avancer).
- **Bouton « Invitation acceptée »** sur la fiche du prospect (et dans le panneau de repli) pour
  le marquer à la main ; si Unipile le voit ensuite, la date la plus ancienne gagne.
- *Mon choix* — comportement précis, sur le modèle de Lemlist (séquence linéaire) :
  - pendant l'attente, **les étapes suivantes attendent aussi** (rien ne part en parallèle) ;
  - après expiration des 14 jours, le délai de l'étape `if_invite_not_accepted` court **depuis
    l'expiration** ;
  - prospect déjà en relation : voir « Public de la campagne » ci-dessous ;
  - le délai effectif est le plus tardif entre « depuis l'acceptation » et « depuis le dernier
    envoi » ;
  - les leads déjà en séquence au moment du déploiement suivent les nouvelles règles à partir de
    leur prochaine étape, sans rattrapage.
- **Public de la campagne** (décidé par Jeanne le 2026-11-02) : chaque campagne de prospection
  dit si elle vise des prospects **à froid** (valeur par défaut) ou **ses relations LinkedIn**
  existantes. Nouveau champ sur `prospection_campaigns`, choisi à la création, modifiable.
  - **Campagne à froid : un prospect ne doit jamais faire partie des relations de Jeanne.**
    Avant la toute première étape (quel que soit le canal), si le compte LinkedIn est relié et
    que le lead a une URL de profil, Naya vérifie le degré de relation (la consultation de profil
    que fait déjà `resolveProviderId`, comptée dans le budget de la garde). Déjà en relation →
    rien n'est envoyé, le lead sort de la campagne (nouvel état de séquence définitif, par ex.
    `excluded_connection`), et sa fiche l'explique (« déjà dans tes relations, retiré de la
    campagne à froid »). Même règle si l'information arrive plus tard (un message LinkedIn
    révèle qu'ils étaient déjà en relation avant l'invitation). Le sourcing du chantier 3 devra
    les écarter en amont.
  - **Campagne « relations »** : les prospects sont déjà en relation ; les étapes d'invitation sont
    sautées, la relation compte comme acceptée dès l'enrôlement (`linkedinConnectedAt` rempli à
    ce moment), les messages partent directement. Un prospect qui n'est **pas** en relation sort de
    cette campagne de la même façon (*mon choix*, par symétrie).
- Le minimum : une étape envoyée suite à un événement ne part jamais moins de quelques heures
  après celui-ci, même avec un délai de 0 (*mon choix : 2 h*, pour qu'aucun message ne parte
  « 1 seconde après »).

## 7. Contraintes

- Prod : Express + Drizzle + Neon partagé, Railway (push sur main = déploiement). Les nouvelles
  tables et colonnes passent par une **migration manuelle**, décidée avec Jeanne, après une
  sauvegarde Neon, selon `MIGRATIONS.md`. Jamais de `drizzle-kit push` sur la prod.
- `npx tsc --noEmit` reste à zéro erreur ; tests vitest pour toute la logique pure
  (tri, rattachement, moteur, rythme).
- Ne jamais tester une fonction qui envoie quelque chose via la file globale de prod. Les tests
  d'envoi réel se font avec un compte Unipile de test ou des mocks.
- Ne pas pousser pendant qu'un travail long de Naya tourne ; demander à Jeanne avant.
- Kill-switch (*mon choix*) : `PROSPECTION_SENDING_ENABLED` coupe **tout** ce qui envoie, y
  compris l'envoi par Gmail et les réponses écrites à la main depuis la boîte (le bouton
  « Envoyer » explique alors pourquoi il est indisponible). La réception par webhooks, elle,
  continue même quand l'envoi est coupé (sinon une réponse pourrait être manquée) ; le poller,
  qui interroge LinkedIn activement, reste coupé comme aujourd'hui.
- Mode agence (*mon choix*) : une réponse sur une campagne d'un projet client arrive dans la
  boîte de Jeanne, filtrable par projet ; la tâche est créée dans la journée de Jeanne, liée à
  ce projet ; la réponse proposée est écrite dans l'identité du projet (signature, voix) et part
  du compte relié à ce projet.
- Tout est par utilisateur et par périmètre (projet client en mode agence) ; aucune route ne
  renvoie la conversation d'un autre utilisateur.
- Interface en français (et anglais), clés i18n sous `outreach:`.

## 8. Laissé au constructeur

- Le schéma exact des tables de conversations / messages et des colonnes ajoutées.
- La mise en page de la boîte de réponses, dans le style actuel de la prospection.
- Le prompt de proposition de réponse (en réutilisant le contexte de campagne et la voix existants).
- Le découpage en étapes du plan d'implémentation et l'ordre de livraison, avec une contrainte :
  la détection des réponses LinkedIn doit être en ligne **avant** que l'envoi LinkedIn
  automatique puisse partir pour de vrai.
