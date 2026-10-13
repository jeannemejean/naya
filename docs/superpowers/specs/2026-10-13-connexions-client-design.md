# Connexions par client — design (sous-projet 7a)

> Sous-projet 7 du chantier *Acquisition 360 digitale* (dossier JMD : « pour un vrai mode agence, des connexions séparées par client et des rapports à envoyer au client »), découpé en **7a connexions par client** (ce document) et **7b rapports client**.
> Choix de Jeanne : **A** (elle seule travaille dans Naya ; le client ne s'y connecte jamais), **A** (Naya publie sur les réseaux du client et prospecte depuis son adresse), approche 1 (connexions rattachées au projet) et découpage 7a puis 7b, puis « continue jusqu'au bout ne me demande pas ». Arbitrages pris sans elle en fin de document.

## Intention

Un projet **client** (`projects.projectKind = 'client'`) a ses propres connexions : comptes sociaux, adresse d'envoi des e-mails de prospection, compte LinkedIn. Il n'utilise **que** celles-là. Un projet perso, ou rien (pas de projet), utilise les connexions de l'utilisatrice, exactement comme aujourd'hui.

**Règle de sécurité :** au moment de publier ou d'envoyer, le serveur vérifie que la connexion appartient au périmètre du post ou de la campagne. Sinon, rien ne part, l'erreur est visible. Jamais de repli sur une autre connexion, jamais de devinette.

## Constat (code au 13/10/2026)

- `social_accounts` : clé implicite `(userId, platform)`, premier trouvé. L'OAuth met à jour « l'Instagram de l'utilisatrice » ; un deuxième compte remplace le premier. Le `state` OAuth n'est pas vérifié.
- Publication (`social-publisher.ts`, `/api/content/:id/publish`, `/api/social/post`, programmation via `compteDuPost`) : compte lié au post, sinon le premier compte actif de la plateforme.
- Prospection : expéditeur e-mail, clé SendGrid, adresse postale et compte LinkedIn Unipile sur `user_preferences`. `prospection-sender.ts` et `linkedin-sync.ts` ignorent le projet de la campagne ; la signature (`founderName`) vient du profil de l'utilisatrice.
- La rédaction des messages (`sequence-message.ts`) utilise déjà le projet de la campagne pour le contexte.
- `prospection_campaigns.projectId` existe mais le formulaire d'Outreach ne l'envoie pas.
- Le budget LinkedIn (`linkedin_send_attempts`) est compté par utilisatrice.
- Prod au 13/10 : aucun projet client, aucune campagne rattachée à un projet client. La règle ne change rien à l'existant.

## Périmètre d'une connexion

`porteeDe(projet)` (pur) : projet client → son id ; projet perso, absent ou inconnu → `null` (périmètre de l'utilisatrice).

Toutes les résolutions passent par ce périmètre :
- **post** : `content.projectId` ;
- **campagne** (et ses leads) : `prospection_campaigns.projectId`.

## Données (migration additive)

- `social_accounts.project_id` integer, null = compte de l'utilisatrice. Pas de FK (nettoyage explicite). Index `(user_id, project_id, platform)`.
- `linkedin_send_attempts.project_id` integer, null = compte LinkedIn de l'utilisatrice. Le budget et la montée en charge LinkedIn se comptent par compte, donc par périmètre.
- Nouvelle table `connexions_projet` (une ligne par projet client) :

| colonne | type | rôle |
|---|---|---|
| `id` | serial | |
| `userId` | varchar → users | |
| `projectId` | integer, sans FK | |
| `senderEmail`, `senderName` | text, null | expéditeur des e-mails ; `senderName` sert aussi de **signature** des messages du client |
| `sendgridApiKey` | text, null, chiffré (`encryptToken`) | clé SendGrid du client, sinon clé partagée de l'app |
| `senderAddress`, `senderCity`, `senderCountry` | text, null | adresse postale (pied de mail, vérification SendGrid) |
| `linkedinUnipileAccountId` | text, null | |
| `linkedinAccountConnectedAt`, `linkedinRestrictedAt` | timestamp, null | |
| `linkedinRestrictedReason` | text, null | |
| `createdAt`, `updatedAt` | timestamp | |

Index unique `(userId, projectId)`.

## Résolution (module `server/services/connexions/`)

- `portee.ts` (pur) :
  - `porteeDe(projet)` ;
  - `dansPortee(compte, portee)` : `(compte.projectId ?? null) === portee` ;
  - `choisirCompte(comptes, post, portee)` : compte lié au post s'il est dans le périmètre ; lié mais hors périmètre ou introuvable → `{ erreur: "compte_hors_projet" }` ; sinon premier compte actif de la plateforme **dans le périmètre** ; aucun → `{ erreur: "compte_absent" }`.
  - `identiteEnvoi(portee, prefs, connexion)` : périmètre utilisatrice → champs de `user_preferences` (comportement actuel) ; périmètre client → champs de `connexions_projet` seulement, jamais ceux de l'utilisatrice. Rend `{ email, linkedin, signature }`, chaque partie à null si absente.
- `resolution.ts` : `identiteCampagne(userId, campaignId)` charge campagne → projet → périmètre → préférences ou connexion. Utilisé par l'envoi, la synchro LinkedIn et l'aperçu (même signature à l'aperçu et à l'envoi : le message mis en cache est réutilisé tel quel).

## Réseaux sociaux

- **Connexion** : `GET /api/social/oauth/:platform/url?projectId=N` (projet de l'utilisatrice et client, sinon 404 / 409 `projet_perso`). Le projet est gardé en session avec le `state`. Le callback **vérifie le `state`** quand la session en porte un (refus sinon), puis range le compte dans le périmètre (`getSocialAccountByPlatform(userId, platform, projectId)`), et redirige vers `/projects/N` au lieu de `/settings`.
- **Listes** : `GET /api/social/accounts?projectId=N` et `GET /api/social/status?projectId=N` renvoient le périmètre du projet (sans paramètre : l'utilisatrice, comme aujourd'hui). La liste historique `GET /api/social-accounts` ne renvoie que les comptes de l'utilisatrice.
- **Déconnexion** : `DELETE /api/social/disconnect/:platform?projectId=N`, dans le périmètre. La suppression d'un compte détache d'abord les posts qui le visaient (`content.socialAccountId` → null) au lieu d'échouer.
- **Publication** : `social-publisher` (publication et fin de traitement vidéo), `/api/content/:id/publish`, `/api/social/post` et la programmation (`compteDuPost` reçoit les comptes du périmètre et ne remplace plus un compte lié introuvable) passent par `choisirCompte`. Erreur → `postStatus: failed`, `lastError` = le code.
- **Publication croisée** : un compte cible hors du périmètre du projet → 400 `compte_hors_projet`.
- Le composeur (`SocialComposer`) demande les comptes du projet sélectionné.

## Prospection

- **Envoi** (`prospection-sender.ts`) : pour chaque étape due, `identiteCampagne`.
  - E-mail : expéditeur et clé du périmètre ; absent → l'étape attend, comme aujourd'hui sans adresse.
  - LinkedIn : compte Unipile, date de connexion, restriction et historique d'envois **du périmètre** ; une restriction détectée est enregistrée dans le périmètre.
  - Signature : périmètre client → `senderName` de la connexion ; absent → l'étape attend (jamais la signature de l'utilisatrice sur un message du client).
- **Synchro LinkedIn** (`linkedin-sync.ts`) : même résolution par lead (via sa campagne).
- **Aperçu** (`routes.ts`, aperçu de campagne) et pipeline : même signature que l'envoi.
- **Campagne** : le formulaire propose le projet (par défaut le projet actif). `POST` vérifie que le projet est à l'utilisatrice. Changer le projet d'une campagne qui a des séquences en cours → 409 `campagne_en_cours`.
- **Unipile** : le lien de connexion d'un projet porte le nom `<userId>:projet:<id>` ; la synchro d'un projet ne prend que le compte de ce nom. La synchro de l'utilisatrice ne prend plus « le seul compte présent » s'il porte un nom de projet.

## Routes par projet (`server/routes-connexions.ts`)

Toutes : projet de l'utilisatrice sinon 404 ; projet perso → 409 `projet_perso`.
- `GET /api/projects/:id/connexions` : réseaux (statut par plateforme, comptes), e-mail (champs, `hasOwnKey`, statut de vérification SendGrid), LinkedIn (configuré, connecté, restreint).
- `PUT /api/projects/:id/connexions/email` : mêmes règles que `PUT /api/prospection/sender` (clé chiffrée, vide = effacée, absente = inchangée ; demande de vérification automatique quand l'adresse est complète).
- `POST /api/projects/:id/connexions/email/verify`.
- `POST /api/projects/:id/connexions/linkedin/lien`, `POST …/linkedin/sync`, `POST …/linkedin/lever-restriction`, `DELETE …/linkedin`.

## Interface

- Page projet, projets client seulement : carte **Connexions du client** — réseaux (connecter / déconnecter), expéditeur e-mail et signature, LinkedIn (connecter, vérifier, lever une restriction). Une phrase dit la règle : « Ce projet publie et prospecte uniquement avec ces connexions. »
- Formulaire de campagne : sélecteur de projet.
- Locales FR/EN (`connexions.*`), cliquet jsx-guard respecté.

## Suppression et remise à zéro

- `deleteProject` : détache les posts des comptes du projet, supprime ces comptes, la ligne `connexions_projet` et les tentatives LinkedIn du projet.
- Plan de remise à zéro du compte : supprime `connexions_projet` et les comptes sociaux rattachés à un projet (les comptes de l'utilisatrice restent, comme aujourd'hui).

## Tests

- **Purs** : `porteeDe`, `dansPortee`, `choisirCompte` (lié dans/hors périmètre, aucun compte, compte d'un autre périmètre de même plateforme jamais pris), `identiteEnvoi` (client sans champ → null partout, jamais les champs de l'utilisatrice), `compteDuPost` sans remplacement d'un compte lié.
- **Publication** : un post de projet client sans compte client → échec `compte_absent`, alors que l'utilisatrice a un compte de la plateforme.
- **Envoi** : campagne client → expéditeur, compte LinkedIn et signature du client ; client sans adresse → rien envoyé ; campagne perso → inchangé ; historique LinkedIn lu par périmètre.
- **Routes** : 404 sur le projet d'une autre, 409 sur un projet perso, clé jamais renvoyée, OAuth `state` différent → refus, projet en session → compte rangé dans le projet.
- **Remise à zéro** : plan mis à jour (test existant).

## Hors périmètre

- Rapports client (7b).
- Accès du client à Naya.
- Plafond e-mail quotidien par client (reste par utilisatrice).

## Arbitrages pris sans Jeanne

- **Clé SendGrid partagée** autorisée pour un client (c'est la plomberie de l'app, pas une connexion de Jeanne) ; l'adresse d'envoi, elle, est toujours celle du client.
- **Plafond e-mail** : reste commun à toute l'activité de l'utilisatrice (prudence de délivrabilité), à revoir si un client prospecte beaucoup.
- **Passer un projet de client à perso** (ou l'inverse) est permis ; ses connexions client restent rangées mais ne servent plus. La carte le dit.
- **Signature obligatoire** pour un client : sans `senderName`, rien ne part.
