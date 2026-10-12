# Messages de prospection qui sonnent juste — conception

**Date :** 12 octobre 2026

> Demande : « je déteste les messages de prospection dans Naya, ils ne sont pas naturels, c'est comme si Naya n'avait aucune idée des meilleures pratiques en prospection. » Exemple fourni : séquence pour une Brand Director parfum, quatre fois la même question abstraite (« héritage et renouveau »), jamais de présentation, un mail lyrique sans rien de concret, une relance qui avoue le tracking, un message LinkedIn à quelqu'un qui n'a pas accepté l'invitation.
> Choix validés : **bibliothèque de preuves pré-remplie par Naya et validée par l'utilisatrice** ; **approche « stratège puis rédacteur » + apprentissage par les corrections**.
> Sous-projet 1 sur 7 du chantier « Acquisition 360 » (dossier `Acquisition-360-digitale-JMD.pdf`). Le sourcing régulier par Bright Data est le sous-projet 3, hors de cette spec.

## Constat (code au 12/10/2026)

- **Deux générateurs, deux doctrines contradictoires.**
  - `generateChannelMessage` (`server/services/prospection-pipeline.ts`) interdit de finir sur une question ouverte.
  - `buildStepPrompt` (`server/services/sequence-message.ts`), qui écrit ce qui part réellement, exige « Termine par UNE seule question ouverte et sincère » après acceptation, une « question ouverte » dans l'email, et un ton « curieux, jamais commercial ». C'est l'origine des questions d'interview et de l'absence de présentation.
- **Rien de concret à offrir.** Il n'existe aucune donnée de réalisations, cas ou preuves, et le prompt interdit (à raison) d'inventer une ressource. Naya compense par du lyrisme.
- **Le plan de séquence est aveugle.** `generateSequencePlan` (`sequence-plan.ts`) ne voit ni l'objectif (`campaignBrief`) ni l'offre, utilise l'ADN global et non celui du projet, et compose librement les conditions. Résultat : un message LinkedIn peut cibler une personne non connectée, et des branches reposent sur l'ouverture des mails, une donnée peu fiable depuis le pré-chargement des images (Apple MPP).
- **Le contexte est pollué.** `callClaudeWithContext` injecte la voix d'assistante (`NAYA_SYSTEM_VOICE`, « tu »), l'énergie du jour, la revue du jour, et la consigne de génération de tâches de `buildNayaContext`.
- **Le contrôle qualité n'est pas branché.** `prospection-message-quality.ts` n'est importé que par ses tests.
- **L'audit est sans marque.** `generateAudit` appelle `callClaude` (sans ADN de marque).
- **Ce qu'on garde :**
  - le rôle d'étape LinkedIn (`roleEtapeLinkedin`) ;
  - l'anti-doublon (`premierConflit`, `tropProche`) ;
  - le cache `lead_step_messages` avec respect des éditions manuelles ;
  - la validation humaine (`validatedAt`) avant enrôlement.

## Ce qu'on construit

### 1. Bibliothèque de preuves (par projet)

**Table `project_proofs`**

| Champ | Contenu |
|---|---|
| Identifiants | `id`, `userId`, `projectId` |
| `clientLabel` | Nom du client ou type de client |
| `citable` | booléen, défaut `false` |
| `whatWasDone` | 1-2 phrases |
| `result` | phrase, chiffre si connu |
| `url` | facultatif |
| `mediaId` | facultatif, réf. médiathèque |
| `tags` | texte[] : secteurs, problèmes résolus |
| `status` | `proposed`, `validated` ou `archived` |
| `source` | `manual`, `site`, `post` ou `document` |
| Horodatage | `createdAt`, `updatedAt` |

**Règles**
- Seules les preuves `validated` sont lues par la prospection.
- Si `citable = false`, le nom du client n'est jamais écrit : seul le type de client l'est.
- Aucun lien hors de `url` (ou des consignes de l'utilisatrice) ne peut apparaître dans un message.

**Pré-remplissage**
- Route `POST /api/projects/:id/proofs/suggest`. Elle lit :
  - le site du projet (Web Unlocker existant, `brightdata-enrich.ts`) ;
  - les posts publiés (`content`) ;
  - les documents déposés (mémoire « savoir »).
- Elle crée des preuves `proposed`, dédoublonnées sur `clientLabel` + `whatWasDone`. Jamais de validation automatique.
- **Échec d'une source :** on continue avec les autres. On ne renvoie une erreur que si toutes ont échoué.

**Routes CRUD** : `GET/POST/PATCH/DELETE /api/projects/:id/proofs`, avec propriété vérifiée (404 sinon).

**Interface**
- Section « Preuves » dans le projet, à côté de l'ADN de marque : liste, ajout, validation en un clic des propositions, édition, archivage.
- Rappel sur la page Prospection quand le projet a moins de 2 preuves validées.

### 2. Doctrine de prospection

**Module pur `server/services/prospection/doctrine.ts`**
- Exporte les règles en texte (bloc de prompt unique) et les constantes vérifiables : limites de longueur par rôle, tics interdits, motifs de question de réflexion, motifs de tracking avoué.
- **Seule source de règles pour tous les rédacteurs.** Les règles en dur de `buildStepPrompt` et `generateChannelMessage` sont supprimées.

**Règles**
1. **Déclencheur réel.** Le premier contact s'appuie sur un fait nommé et vérifiable (le déclencheur du brief).
2. **Qui écrit.** Au plus tard au premier vrai message (après acceptation, ou premier email), une ligne : qui, ce qu'elle fait, pour qui.
3. **Donner avant de demander.** Une preuve, une idée précise pour cette marque, ou une observation utile. Jamais de travail de réflexion demandé.
4. **Demande facile.** Une question fermée ou d'intérêt (« je vous l'envoie ? »). Les questions ouvertes de réflexion sont interdites.
5. **Longueurs.**

   | Rôle | Limite |
   |---|---|
   | Note d'invitation | ≤ 300 caractères, ou absente |
   | Message LinkedIn | ≤ 300 caractères |
   | Email | 50-120 mots |
   | Objet | 2-5 mots, factuel |

6. **Relance.** Un nouvel angle ou une nouvelle preuve. Jamais « je reviens vers vous », jamais d'allusion à une ouverture ou un clic.
7. **Clôture.** On ferme la porte proprement, sans culpabiliser.
8. **Style.**
   - Interdits :
     - la flatterie vague et le lyrisme ;
     - la liste de tics IA ;
     - les tirets ;
     - les adjectifs accordés au genre de l'expéditrice ;
     - les placeholders.
   - Signature : prénom (+ projet pour l'email). Pas de slogan sauf s'il figure dans les consignes.

**Hiérarchie** : consignes de l'utilisatrice (globales + campagne + consignes apprises validées) > doctrine. Les règles de sécurité (pas d'invention, pas de placeholder, pas de lien non fourni) ne sont jamais levées.

### 3. Structures de séquence

**Module pur `server/services/prospection/sequence-structures.ts`**

Trois structures définies dans le code :

| Structure | Branche principale | Autre branche |
|---|---|---|
| `linkedin_first` | J0 invitation (`always`) → J+2 message avec preuve (`if_invite_accepted`) → J+6 relance angle neuf → J+12 clôture | Si invitation non acceptée et email connu : J+5 email (`if_invite_not_accepted`) → J+11 relance email → J+18 clôture email |
| `email_first` | J0 email → J+4 relance angle neuf → J+9 relance preuve → J+16 clôture | — |
| `linkedin_only` | Invitation → message (`if_invite_accepted`) → relance → clôture | — |

**Choix de la structure** : selon `campaign.channel` (`linkedin`, `email`, `both`), puis par prospect selon les données. Pas d'email connu → branche email ignorée. Pas d'URL LinkedIn → `email_first`.

**Garanties testées**
- Aucune étape LinkedIn hors invitation sans `if_invite_accepted` en amont.
- Aucune étape email sans adresse.
- 5 touches au plus par branche.
- Aucune condition `if_opened`, `if_not_opened` ou `if_clicked`.

**Rôle de l'IA.** `generateSequencePlan` est réécrit. Il reçoit la structure, l'objectif (`campaignBrief`), l'offre, la cible, l'angle et l'ADN **du projet**. Il renvoie seulement les `intention` de chaque emplacement et, au besoin, des délais ajustés dans des bornes (±50 %, minimum 1 jour entre deux touches).

**Rôles d'étape.** On étend `RoleEtapeLinkedin` à un rôle commun aux deux canaux : `invitation | premier_message | email_ouverture | relance | cloture`. Il est porté par la structure (stocké sur `campaign_sequence_steps.role`) et non plus déduit du texte. `roleEtapeLinkedin` reste la solution de repli pour les séquences anciennes sans `role`.

**Existant**
- Les séquences en place restent inchangées. Le moteur garde le support des conditions d'ouverture pour elles.
- Bouton « Reconstruire avec les nouvelles structures » sur une campagne : remplace les étapes, sans toucher les prospects déjà en cours de séquence (`lead_sequence_state` actif).

### 4. Brief stratégique par prospect

**Stockage** : colonne `leads.prospect_brief` (jsonb)

| Champ | Contenu |
|---|---|
| `declencheur` | `{ fait, source, url?, date? }` ou `null` |
| `preuveId` | id d'une preuve validée, ou `null` |
| `raison` | une phrase : pourquoi lui, pourquoi maintenant, pourquoi nous |
| `proposition` | `{ type: 'preuve' \| 'idee' \| 'echange', contenu }` |
| `angles` | une entrée par touche prévue, toutes distinctes |
| `langue` | langue du prospect |
| `registre` | `vous` ou `tu` |
| `genereLe` | date de génération |
| `edite` | booléen |

**Génération**
- Une fois par prospect, après l'enrichissement, par `server/services/prospection/brief.ts`. Elle reprend et remplace la section « angle » de l'audit.
- **Sources du déclencheur :**
  - les posts, l'activité et le site déjà enrichis ;
  - une recherche d'actualité sur l'entreprise via `serpSearch` (Google News), au plus 1 appel par prospect, compté dans `prospection_usage`.
- **Choix de la preuve** : parmi les preuves validées du projet, par l'IA, sur les tags et le contexte. `null` si aucune n'est pertinente.
- **L'audit passe à `callClaudeWithContext` épuré** (§5) pour connaître la marque.

**Sans déclencheur** : `declencheur = null`. Le prospect prend l'état « à compléter », avec la raison affichée, et aucun message n'est rédigé. Une note de l'utilisatrice sur le prospect (`leads.notes`) devient alors le déclencheur au prochain passage.

**Interface**
- Le brief s'affiche dans `LeadDetail` : déclencheur, preuve, raison, angles, en 4-5 lignes modifiables.
- Une modification met `edite = true` et invalide les messages non édités du prospect dans `lead_step_messages`.

### 5. Rédaction

- **Un seul rédacteur** : `generateStepMessage`.
  - `generateChannelMessage` est supprimé.
  - `leads.linkedinMessage` et `leads.emailMessage` sont alimentés par la première touche de chaque canal, pour que l'écran de validation actuel (`validation-messages.ts`, `LeadCard`, `LeadDetail`) continue de fonctionner.
- **Contexte de rédaction : mode « écrire à un tiers » de `buildNayaContext`.** La règle du CLAUDE.md est respectée : tout appel IA passe par `buildNayaContext`. On lui ajoute une option `{ destinataire: 'tiers' }` (`callClaudeWithContext` la transmet).
  - **Ce que contient le mode `tiers` :**
    - l'ADN du projet : nom, ce que fait la marque en une ligne, offre, voix (`brandVoiceKeywords` / `antiKeywords`), langue ;
    - l'identité de l'expéditrice (prénom, nom) ;
    - la mémoire « savoir » filtrée sur le prospect, plafonnée.
  - **Ce que le mode `tiers` retire :**
    - la voix d'assistante (`NAYA_SYSTEM_VOICE`, « tu »), remplacée par une consigne « tu écris au nom de {prénom}, à une personne qui ne la connaît pas, avec sa voix à elle » ;
    - l'énergie, la revue du jour, les objectifs et les jalons ;
    - les consignes de génération de tâches.
  - **Pourquoi** : la voix de Naya est faite pour parler à l'utilisatrice. Envoyée telle quelle, elle fuit dans des messages adressés à des inconnus. Le mode par défaut reste inchangé pour tous les autres appels.
- **Le prompt d'étape** contient :
  - la doctrine et le rôle de l'étape ;
  - le brief, l'angle de cette touche et la preuve résolue (texte + lien si fourni, nom selon `citable`) ;
  - les messages antérieurs ;
  - les consignes (globales, campagne, apprises) ;
  - les exemples appris (§7).
- **Inchangés** : modèle `CLAUDE_MODELS.smart`, cache, respect des éditions, `tropProche`.

### 6. Contrôle qualité

**Couche 1 : code** (`server/services/prospection/qualite.ts`, pur). Elle étend `prospection-message-quality.ts` avec :
- la longueur selon le rôle ;
- les tics interdits ;
- les questions de réflexion ;
- le tracking avoué ;
- un lien absent de la preuve ou des consignes ;
- les placeholders, les tirets, le genre (et l'incohérence de genre sur le lot) ;
- l'absence du nom de l'entreprise du prospect dans la première touche.

Elle renvoie une liste de défauts avec un libellé lisible.

**Couche 2 : relecture IA** (modèle léger, `CLAUDE_MODELS.fast`). Elle reçoit le message, le brief, le rôle et la doctrine, et renvoie un JSON `{ ok, defauts: [{ code, raison }] }` sur cinq questions :
1. On comprend qui écrit et pourquoi ?
2. Le déclencheur est-il utilisé ?
3. La première phrase est-elle réservée à ce prospect ?
4. Le ton est-il humain ?
5. La demande est-elle facile ?

Une réponse illisible vaut `ok` avec une trace en log : la relecture ne bloque jamais sur sa propre panne.

**Boucle**
1. Rédaction, puis couche 1, puis couche 2.
2. En cas d'échec : une réécriture avec les raisons injectées.
3. En cas de nouvel échec : le message est mis en cache avec `lead_step_messages.qualite = 'a_revoir'` et `defauts` (jsonb).
4. Le moteur d'envoi (`prospection-sender.ts`) **n'envoie jamais** un message `a_revoir` non édité. Il saute le prospect pour ce passage et le log.

**Édition manuelle** : `edited = true` lève le blocage. Les défauts de la couche 1 sont recalculés et affichés en avertissement seulement.

**Interface** : badge « À revoir » avec les raisons sur le message dans `LeadDetail` et la file de validation, avec les actions « Régénérer » et « Envoyer quand même ».

**Suivi** : chaque défaut est compté par campagne et par code (table `prospection_message_feedback`, §7, action `controle`).

### 7. Apprentissage par les corrections

**Table `prospection_message_feedback`**

| Champ | Contenu |
|---|---|
| Identifiants | `id`, `userId`, `projectId`, `campaignId`, `leadId`, `stepId` |
| `role` | rôle de l'étape |
| `action` | `valide_tel_quel`, `modifie`, `ecarte` ou `controle` |
| `original` | texte proposé par Naya |
| `final` | texte retenu |
| `raison` | `trop_long`, `pas_mon_ton`, `faux`, `hors_sujet`, `autre` + texte libre |
| `defauts` | jsonb |
| `aRepondu` | booléen, nul par défaut |
| `createdAt` | horodatage |

**Écritures**
- Validation d'un prospect : `valide_tel_quel` ou `modifie` pour chaque message, en comparant avec la version générée.
- Bouton « Écarter ce message » : `ecarte` + raison en un clic.
- `aRepondu` est mis à jour quand une réponse est détectée : synchro LinkedIn (`linkedin-sync.ts`) et réponses email existantes.

**Exemples de style**
- À chaque rédaction, jusqu'à 4 exemples `final` du **même projet** et du **même rôle**.
- Priorité : `aRepondu = true`, puis `modifie`, puis les messages collés par l'utilisatrice, puis `valide_tel_quel`, les plus récents d'abord.
- Ils sont injectés comme « exemples de la façon d'écrire de {prénom} », jamais à recopier.

**Messages collés**
- Dans le projet, l'utilisatrice peut coller des messages qui ont marché, avec le rôle choisi.
- Ils sont stockés comme feedback `modifie` sans `original` et comptent comme des exemples validés.

**Consignes apprises**
- Après 10 nouvelles lignes `modifie` ou `ecarte` sur un projet, Naya extrait de 1 à 5 règles explicites à partir des paires original/final et des raisons.
- Elles sont stockées dans `prospection_learned_rules` (`projectId`, `texte`, `statut` : `proposee | acceptee | refusee`, `sourceIds`).
- Elles sont proposées à l'utilisatrice (carte sur la page Prospection). Seules les règles `acceptee` entrent dans le bloc « consignes ». Elles sont modifiables et supprimables.

**Cloisonnement** : toutes les lectures filtrent sur `userId` et `projectId`. Aucun exemple ni aucune règle ne passe d'un projet à l'autre.

## Hors périmètre

- Sourcing automatique et régulier des prospects (sous-projet 3, avec le moteur de routines du sous-projet 2).
- Envoi LinkedIn automatique : inchangé. Naya prépare, l'utilisatrice valide.
- Réutilisation des preuves par les contenus, les landings et le GEO (sous-projets suivants). La table est conçue pour, rien de plus.

## Migration et déploiement

- Migration selon la procédure du projet (CLAUDE.md, `MIGRATIONS.md`) :
  - `npx drizzle-kit generate` ;
  - relecture du SQL ligne par ligne ;
  - `npm run db:migrate` sur la branche Neon de dev.
  - **Jamais `drizzle-kit push`.** L'application en production est une étape manuelle, décidée avec Jeanne, avec une sauvegarde Neon prise avant.
- Contenu de la migration :
  - nouvelles tables `project_proofs`, `prospection_message_feedback`, `prospection_learned_rules` ;
  - nouvelles colonnes `leads.prospect_brief`, `campaign_sequence_steps.role`, `lead_step_messages.qualite`, `lead_step_messages.defauts`.
  - Toutes sont nullables ou ont une valeur par défaut, sans réécriture des données existantes.
- Les messages déjà en cache ne sont pas régénérés automatiquement. Ceux non édités le seront au prochain aperçu ou envoi si leur prospect reçoit un brief.
- Aucun push sur `main` sans accord explicite : un push redéploie la production et interrompt les travaux de fond.
- **Ne jamais tester la rédaction ou l'envoi contre la base de production.** Tests unitaires et branche Neon de dev uniquement.

## Tests

- **Purs (vitest)** :
  - `doctrine` : constantes et rendu du bloc ;
  - `sequence-structures` : toutes les garanties ci-dessus, choix de structure selon canal et données ;
  - `qualite` couche 1 : un cas positif et un cas négatif par défaut, dont les phrases de la séquence « Sneha » comme cas négatifs de référence ;
  - sélection des exemples (priorités, cloisonnement projet) ;
  - résolution de la preuve selon `citable`.
- **Contexte** : `buildNayaContext` en mode `tiers` ne contient ni `NAYA_SYSTEM_VOICE`, ni énergie, ni consigne de tâches, mais contient bien l'ADN du projet. Le mode par défaut est inchangé (test de non-régression).
- **Prompts** : `buildStepPrompt` contient la doctrine, l'angle de la touche, la preuve résolue et les exemples, et ne contient pas les textes exclus (voix d'assistante, énergie, consignes de tâches).
- **Moteur** : un message `a_revoir` non édité n'est jamais envoyé ; un message édité l'est.
- **Routes** : propriété vérifiée sur les preuves et les règles apprises (404 pour un autre utilisateur).
