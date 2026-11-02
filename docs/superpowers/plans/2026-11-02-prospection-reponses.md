# Chantier 2 — Réponses, boîte unique, délais depuis l'événement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naya branche Gmail et LinkedIn via Unipile, envoie les étapes depuis ces comptes au rythme décidé, détecte seule réponses et acceptations, sort le prospect de la campagne, et offre une boîte « Réponses » d'où Jeanne répond sur le canal du prospect.

**Architecture:** Toute la logique de décision est en fonctions pures testées (tri des messages, rattachement, moteur de séquence, rythme LinkedIn, public de campagne). Les effets (Unipile, base) passent par des modules à dépendances injectées, sur le modèle de `prospection-linkedin-manuel.ts`. Un seul point d'entrée réseau entrant : `POST /api/unipile/webhook`.

**Tech Stack:** Express + Drizzle (Neon Postgres) + vitest côté serveur ; React + TanStack Query + i18n (`client/src/locales/fr.ts`, `en.ts`) côté client ; API Unipile (`UNIPILE_DSN`, `UNIPILE_API_KEY`).

**Spec:** `docs/superpowers/specs/2026-11-02-prospection-reponses-design.md` (approuvé par Jeanne le 2026-11-02). Le lire avant toute tâche.

## Global Constraints

- `npx tsc --noEmit` : zéro erreur à la fin de chaque tâche.
- `npx vitest run` : aucune nouvelle régression (2 échecs préexistants et datés dans `server/services/auto-planner-start.test.ts`, hors périmètre).
- Jamais `drizzle-kit push` / `npm run db:push:dev`. Migration : `npx drizzle-kit generate`, relire le SQL ligne par ligne, appliquer **uniquement sur dev-local**. La prod se fait à la main par Jeanne, sauvegarde Neon avant (`MIGRATIONS.md`).
- Aucun test n'appelle Unipile, SendGrid ou la base de prod : tout est mocké / injecté.
- Ne jamais pousser sur `main` (déploiement Railway) sans l'accord explicite de Jeanne.
- Textes d'interface en français et anglais, clés sous `outreach.reponses.*` / `outreach.*`.
- Ne jamais journaliser le contenu d'un message (ni corps ni objet) — seulement des identifiants.
- Valeurs fixées par la spec : rythme LinkedIn 15–25 min ; fenêtre LinkedIn 8 h–18 h, lundi–vendredi, fuseau de l'utilisatrice ; pause 60–120 min environ 1 envoi sur 6 ; attente d'acceptation 14 jours ; écart minimum après un événement 2 h ; absence sans date → 7 jours ; tâche de réponse 10 min ; limites de la garde inchangées (5 → 15 / jour, 80 / semaine).
- Kill-switch `PROSPECTION_SENDING_ENABLED` : bloque tout envoi (y compris les réponses manuelles et Gmail) ; ne bloque jamais la réception par webhook.

## Review Focus

1. **Compte Gmail pris pour le compte LinkedIn (ou l'inverse)** : `compteUnipile` trouve un compte par son `name`, identique pour les deux canaux. Sans filtre par type, la synchro LinkedIn peut stocker l'id du Gmail. Attendu : chaque synchro filtre par type de compte (test en Tâche 6).
2. **Étape « Connecté » qui arrête la séquence** : `routes.ts` (PATCH lead, liste `ENGAGED`) traite le stade `connected` comme une réponse. Une acceptation d'invitation n'est pas une réponse. Attendu : `connected` retiré de `ENGAGED` (test en Tâche 9).
3. **Webhook rejoué** (Unipile réessaie jusqu'à 5 fois) : attendu, une seule tâche, un seul message stocké, aucun double arrêt (test en Tâche 8).
4. **Message envoyé par Jeanne depuis son téléphone** (expéditeur = elle-même) et invitation acceptée avec note (fil qui ne contient que son message) : attendu, jamais une réponse (test en Tâche 8).
5. **Webhook Unipile sans en-tête `Content-Type: application/json`** : le `express.json()` global ne le lirait pas, corps vide. Attendu : la route lit le corps quel que soit le type (test en Tâche 8).

---

## Fichiers

Créer :
- `server/services/reponses/tri.ts` (+ `.test.ts`) — classer un message entrant.
- `server/services/reponses/rattachement.ts` (+ `.test.ts`) — retrouver le lead d'un message.
- `server/services/reponses/ingestion.ts` (+ `.test.ts`) — traiter un événement Unipile (deps injectées).
- `server/services/reponses/envoi-reponse.ts` (+ `.test.ts`) — envoyer la réponse de Jeanne (deps injectées).
- `server/services/reponses/proposition.ts` — réponse proposée par l'IA.
- `server/services/linkedin-rythme.ts` (+ `.test.ts`) — espacement, pauses, fenêtre LinkedIn.
- `server/services/campagne-public.ts` (+ `.test.ts`) — règle froid / relations.
- `server/services/unipile-mail.ts` (+ `.test.ts`) — envoi Gmail, réponse dans un fil, webhooks.
- `server/services/desinscription.ts` (+ `.test.ts`) — jeton et lien de désinscription.
- `server/routes-reponses.ts` (+ `.test.ts`) — webhook, boîte, invitation acceptée, désinscription.
- `client/src/pages/outreach/ReponsesTab.tsx`, `ConversationView.tsx`, `useReponses.ts`.

Modifier : `shared/schema.ts`, `server/storage.ts`, `server/services/sequence-engine.ts`, `server/services/sequence-signals.ts`, `server/services/prospection-sender.ts`, `server/services/linkedin.ts`, `server/services/linkedin-sync.ts`, `server/services/connexions/portee.ts`, `server/services/connexions/unipile.ts`, `server/services/prospection-enrolement.ts`, `server/routes.ts`, `server/routes-connexions.ts`, `server/index.ts`, `client/src/pages/outreach/OutreachHome.tsx`, `LeadDetail.tsx`, `LinkedInAEnvoyer.tsx`, `dialogs/CampaignForm.tsx`, `ProspectsTab.tsx`, locales, `MIGRATIONS.md`.

---

### Task 1: Schéma et migration

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/00XX_*.sql` (généré)
- Modify: `MIGRATIONS.md`

**Interfaces — Produces:**
- `prospectionCampaigns.audience: text("audience").notNull().default("froid")` — `"froid" | "relations"`.
- `userPreferences.emailUnipileAccountId: text`, `userPreferences.emailAccountConnectedAt: timestamp` ; mêmes colonnes sur `connexionsProjet`.
- `leads.linkedinProviderId: text` (identifiant LinkedIn interne), `leads.relationVerifieeAt: timestamp` (vérification du public faite), `leads.exclusionRaison: text`.
- `outreachMessages.providerMessageId: text`, `outreachMessages.providerThreadId: text`.
- `leadSequenceState.delayAnchorAt: timestamp` — point de départ du délai de l'étape courante (null = `lastStepSentAt ?? enrolledAt`). Commentaire des statuts complété : `excluded_audience` (définitif).
- Table `inboxConversations` : `id serial`, `userId varchar notNull`, `projectId integer null`, `leadId integer notNull`, `channel text notNull` (`"email" | "linkedin"`), `unipileAccountId text notNull`, `providerChatId text` (chat LinkedIn ou fil Gmail), `statut text notNull default "a_traiter"` (`"a_traiter" | "traitee"`), `nonLu boolean notNull default true`, `taskId integer null`, `etatAvantReponse jsonb null` (`{status, currentStep, nextRunAt, delayAnchorAt}`), `lastMessageAt timestamp`, `createdAt`. Index unique `(leadId, channel)`.
- Table `inboxMessages` : `id serial`, `conversationId integer notNull`, `providerMessageId text notNull` **unique**, `sens text notNull` (`"entrant" | "sortant"`), `nature text notNull` (`"reponse" | "absence" | "accuse" | "nous"`), `subject text`, `body text notNull`, `sentAt timestamp notNull`, `createdAt`.
- Types exportés `InboxConversation`, `InboxMessage`, `InsertInboxConversation`, `InsertInboxMessage`.

- [ ] **Step 1:** Ajouter les colonnes et tables ci-dessus dans `shared/schema.ts`, au style du fichier (commentaires courts en français).
- [ ] **Step 2:** `npx drizzle-kit generate` puis relire le SQL : uniquement des `ADD COLUMN` et `CREATE TABLE` / `CREATE UNIQUE INDEX`. **Aucun `DROP`, aucun `ALTER ... TYPE`.** Sinon, arrêter et corriger le schéma.
- [ ] **Step 3:** Appliquer sur dev-local uniquement (`npm run db:migrate` avec `DATABASE_URL` de dev-local), sortie sous les yeux.
- [ ] **Step 4:** Ajouter dans `MIGRATIONS.md` une section « Chantier 2 — à appliquer en prod à la main » avec le nom du fichier et la liste des objets créés.
- [ ] **Step 5:** `npx tsc --noEmit` → 0 erreur.
- [ ] **Step 6:** Commit `feat(chantier2): schéma boîte de réponses, public de campagne, Gmail Unipile`.

---

### Task 2: Moteur — délais depuis l'événement

**Files:**
- Modify: `server/services/sequence-signals.ts`, `server/services/sequence-engine.ts`, `server/services/prospection-sender.ts` (appels), `server/services/prospection-linkedin-manuel.ts` (appels)
- Test: `server/services/sequence-engine.test.ts`

**Interfaces — Produces:**
- `LeadSignals` gagne `inviteAcceptedAt: Date | null` (`deriveSignals` le remplit depuis `lead.linkedinConnectedAt`).
- `export const INVITE_ACCEPT_WAIT_DAYS = 14;` `export const EVENT_MIN_GAP_MS = 2 * 3_600_000;`
- `decideNextStep(currentStep: number, steps: EngineStep[], signals: LeadSignals, timing: { anchorAt: Date; now: Date }): Decision` — remplace le paramètre `daysSinceLastSend`.
- `Decision` : `{ action: "skip"; index: number; newAnchorAt?: Date }` ; `{ action: "wait"; until: Date | null }` ; `send` / `done` inchangés.
- `planAfterStep(...)` renvoie en plus `delayAnchorAt: now`.

Règles (spec §6.9) :
- étape `if_invite_accepted` non acceptée : `wait` tant que `now < anchorAt + 14 j` ; ensuite `skip` avec `newAnchorAt = anchorAt + 14 j`.
- étape `if_invite_accepted` acceptée : prête quand `now ≥ max(anchorAt + délai, inviteAcceptedAt + délai, inviteAcceptedAt + 2 h)`.
- étape `if_invite_not_accepted` : avant `anchorAt + 14 j`, si pas encore acceptée → `wait` ; si acceptée → `skip` ; après → délai depuis `anchorAt + 14 j` si l'étape précédente a expiré (le `newAnchorAt` fourni le gère).
- autres conditions : inchangées (délai depuis `anchorAt`).

- [ ] **Step 1: Tests qui échouent**, dans `sequence-engine.test.ts` :
  - `acceptée au jour 3 avec délai 2 j → wait jusqu'au jour 5, jamais envoyé au jour 3` (le bug Lemlist).
  - `délai 0 après acceptation → wait jusqu'à acceptation + 2 h`.
  - `non acceptée au jour 13 → wait ; au jour 14 → skip avec newAnchorAt = invitation + 14 j`.
  - `if_invite_not_accepted délai 3 j après expiration → envoyé au jour 17, pas avant`.
  - `étape always après une étape if_invite_accepted en attente → rien ne part (séquentiel)`.
  - `planAfterStep pose delayAnchorAt = now`.
  - les tests existants adaptés à la nouvelle signature passent toujours.
- [ ] **Step 2:** `npx vitest run server/services/sequence-engine.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter dans `sequence-engine.ts`. Dans le sender, `anchorAt = state.delayAnchorAt ?? state.lastStepSentAt ?? state.enrolledAt` ; sur `skip` avec `newAnchorAt`, persister `delayAnchorAt` en même temps que `currentStep` et l'utiliser pour la décision suivante du même passage ; sur `wait` avec `until`, poser `nextRunAt = until`.
- [ ] **Step 4:** `npx vitest run server/services/sequence-engine.test.ts server/services/prospection-sender.test.ts server/services/prospection-linkedin-manuel.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(chantier2): délais comptés depuis l'acceptation d'invitation`.

---

### Task 3: Rythme LinkedIn

**Files:**
- Create: `server/services/linkedin-rythme.ts`, `server/services/linkedin-rythme.test.ts`
- Modify: `server/services/prospection-sender.ts`, `server/services/linkedin-sync.ts`

**Interfaces — Produces:**
- `export const LINKEDIN_FENETRE = { startMin: 8 * 60, endMin: 18 * 60, workDays: new Set(["mon","tue","wed","thu","fri"]) };`
- `export function linkedinGapMs(lastSentAt: Date, accountKey: string): number` — déterministe (graine = `accountKey` + `lastSentAt.getTime()`) : 15–25 min ; avec une probabilité ≈ 1/6, plus 60–120 min de pause.
- Dans `prospection-sender.ts`, les constantes `LINKEDIN_MIN_DELAY_BASE_MS` / `_JITTER_MS` sont **renommées** `LINKEDIN_SYNC_MIN_DELAY_BASE_MS` / `_JITTER_MS` (mêmes valeurs) et ne servent plus qu'au poller.

- [ ] **Step 1: Tests qui échouent** :
  - `linkedinGapMs est toujours ≥ 15 min et ≤ 25 + 120 min`.
  - `sur 600 graines, entre 10 % et 25 % comportent une pause ≥ 60 min`.
  - `même entrée → même résultat`.
  - test sender : `étape LinkedIn à 8 h 30 un mardi avec heures de travail 9 h–18 h → tentée` ; `à 18 h 05 → non tentée` ; `samedi → non tentée` ; `une étape email à 8 h 30 → non tentée (fenêtre de travail inchangée pour l'email)`.
  - test sender : `les sessions de prospection ne bloquent plus LinkedIn`.
- [ ] **Step 2:** Lancer → FAIL.
- [ ] **Step 3:** Dans le sender, déplacer la vérification de fenêtre après la décision d'étape : email → fenêtre de travail actuelle ; LinkedIn → `LINKEDIN_FENETRE` dans le fuseau de l'utilisatrice. Supprimer pour LinkedIn l'appel à `sessionsDe` / `isWithinAnySession` (garder `isTargetReachableAt`). Passer à `decideLinkedInAction` `workDayStartMin/EndMin/workDays` de `LINKEDIN_FENETRE` et `minDelayMs = linkedinGapMs(dernière tentative du compte, cleCompte)` (0 si aucune). Le poller utilise les constantes renommées.
- [ ] **Step 4:** `npx vitest run server/services/linkedin-rythme.test.ts server/services/prospection-sender.test.ts server/services/linkedin-sync.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(chantier2): rythme LinkedIn 20 min, 8 h-18 h, pauses`.

---

### Task 4: Public de la campagne (froid / relations)

**Files:**
- Create: `server/services/campagne-public.ts`, `.test.ts`
- Modify: `server/services/prospection-sender.ts`, `server/services/prospection-enrolement.ts`, `server/storage.ts`, `client/src/pages/outreach/dialogs/CampaignForm.tsx`, `client/src/pages/outreach/ProspectsTab.tsx` (`STATUS_META`), `LeadDetail.tsx`, locales

**Interfaces — Produces:**
- `export type PublicCampagne = "froid" | "relations";`
- `export function decisionPublic(audience: PublicCampagne, enRelation: boolean): "continuer" | "exclure"`.
- `export const RAISON_EXCLUSION = { froid: "deja_en_relation", relations: "pas_en_relation" } as const;`
- `storage.excludeLeadFromCampaign(leadId: number, raison: string): Promise<void>` — état `excluded_audience`, `nextRunAt null`, `leads.exclusionRaison = raison`.
- `storage.markRelationVerifiee(leadId: number, enRelation: boolean, relations: boolean): Promise<void>` — pose `relationVerifieeAt = now` ; pour une campagne relations en relation, pose `linkedinConnectedAt = coalesce(linkedinConnectedAt, now)`.

- [ ] **Step 1: Tests qui échouent** :
  - `decisionPublic("froid", true) === "exclure"`, `("froid", false) === "continuer"`, `("relations", false) === "exclure"`, `("relations", true) === "continuer"`.
  - sender : `campagne froide, currentStep 0, prospect déjà en relation → aucun envoi, excludeLeadFromCampaign(…, "deja_en_relation"), une tentative LinkedIn comptée`.
  - sender : `relationVerifieeAt déjà posé → pas de nouvelle vérification`.
  - sender : `compte LinkedIn non relié ou lead sans URL → pas de vérification, la séquence continue`.
  - sender : `vérification en erreur (ok:false) → rien n'est envoyé, réessai au prochain passage (jamais d'exclusion sur une erreur)`.
  - enrôlement : `excluded_audience` fait partie des états définitifs.
- [ ] **Step 2:** Lancer → FAIL.
- [ ] **Step 3:** Dans le sender, avant toute génération, si `state.currentStep === 0 && !lead.relationVerifieeAt && identite.linkedin && lead.linkedinUrl` : garde `decideLinkedInAction` (même budget), `checkConnection`, enregistrer la tentative (`recordLinkedInSendAttempt(…, ok, "verif_relation" si erreur)`), signal de restriction traité comme pour un envoi, puis `decisionPublic`. Campagne : `campaign.audience ?? "froid"`.
- [ ] **Step 4:** Client : sélecteur « À qui s'adresse cette campagne ? » (À froid : jamais tes relations LinkedIn / Tes relations LinkedIn) dans `CampaignForm`, défaut froid ; `STATUS_META.excluded_audience` = « Retiré (public) » ; la fiche (`LeadDetail`) affiche « Déjà dans tes relations, retiré de la campagne à froid » ou « Pas dans tes relations, retiré de la campagne relations » selon `exclusionRaison`.
- [ ] **Step 5:** `npx vitest run` (fichiers concernés) → PASS ; `npx tsc --noEmit` → 0.
- [ ] **Step 6:** Commit `feat(chantier2): public de campagne, à froid exclut les relations`.

---

### Task 5: Client Unipile — email et réponses

**Files:**
- Create: `server/services/unipile-mail.ts`, `.test.ts`
- Modify: `server/services/linkedin.ts`

**Interfaces — Produces:**
- `linkedin.ts` : `generateConnectLink(nom: string, providers: ("LINKEDIN" | "GOOGLE")[] = ["LINKEDIN"])` ; `export function unipileHeaders(extra?)` et `export const unipileDsn` exportés pour réutilisation ; `sendLinkedInStep` renvoie aussi `providerId?: string` (le résoudre une fois pour le stocker dans `leads.linkedinProviderId`).
- `unipile-mail.ts` :
  - `sendEmailUnipile(o: { accountId: string; to: string; toName: string; subject: string; body: string; replyToProviderId?: string; trackingLabel?: string; headers?: Record<string,string> }): Promise<{ ok: boolean; providerId?: string; threadId?: string; error?: string }>` — `POST /api/v1/emails`, `tracking_options: { opens: true, links: true, label }` si `trackingLabel`.
  - `sendLinkedInChatMessage(o: { accountId: string; chatId: string; text: string }): Promise<{ ok: boolean; messageId?: string; error?: string }>` — `POST /api/v1/chats/{chatId}/messages`.
  - `ensureWebhooks(baseUrl: string, secret: string): Promise<void>` — liste `GET /api/v1/webhooks`, crée ceux qui manquent pour les sources `messaging`, `email`, `email_tracking`, `users` (new_relation), `account_status`, avec `request_url = baseUrl + "/api/unipile/webhook"` et `headers: [{ key: "Content-Type", value: "application/json" }, { key: "Unipile-Auth", value: secret }]`. Idempotent ; n'échoue jamais (journalise).
  - `subjectReponse(sujet: string): string` — préfixe `"Re: "` sauf si déjà `Re:` / `RE:` / `Re :`.

- [ ] **Step 1: Tests qui échouent** (avec `fetch` mocké via `vi.stubGlobal`) : forme du corps envoyé par `sendEmailUnipile` (avec et sans `reply_to`) ; `subjectReponse("Re: Bonjour") === "Re: Bonjour"`, `subjectReponse("Bonjour") === "Re: Bonjour"` ; `ensureWebhooks` ne recrée pas un webhook existant ; une réponse HTTP 500 → `{ ok: false }`, jamais d'exception.
- [ ] **Step 2:** Lancer → FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(chantier2): client Unipile email, chat et webhooks`.

---

### Task 6: Connexion Gmail et filtre par type de compte

**Files:**
- Modify: `server/services/connexions/unipile.ts` (+ test), `server/services/connexions/portee.ts` (+ test), `server/routes.ts` (routes `/api/prospection/linkedin/*`), `server/routes-connexions.ts`, l'écran de connexions côté client existant (là où LinkedIn est relié), locales

**Interfaces — Produces:**
- `compteUnipile(accounts, userId, projectId, type: "LINKEDIN" | "GOOGLE_OAUTH")` — filtre par `type` en plus du nom.
- `IdentiteEnvoi.email` gagne `unipileAccountId: string | null` (depuis `emailUnipileAccountId`).
- Routes : `GET /api/prospection/gmail/status`, `POST /api/prospection/gmail/connect-link`, `POST /api/prospection/gmail/sync`, `DELETE /api/prospection/gmail` ; équivalents projet `/api/projects/:id/connexions/gmail/{lien,sync}` et `DELETE`.
- Au `sync` Gmail, si `prospectionSenderEmail` est vide, le remplir avec l'adresse du compte Unipile.

- [ ] **Step 1: Tests qui échouent** : `compteUnipile` ignore un compte Google du même nom quand on demande LinkedIn (et inversement) ; `identiteEnvoi` expose `email.unipileAccountId` pour l'utilisatrice et pour un projet client, sans jamais mélanger les deux.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; les synchros LinkedIn existantes passent `"LINKEDIN"`. Côté client, une ligne « Gmail » à côté de « LinkedIn » (Relier / Relié / Délier), même composant.
- [ ] **Step 4:** PASS + `tsc` 0. **Step 5:** Commit `feat(chantier2): relier Gmail via Unipile`.

---

### Task 7: Envoi des étapes email par Gmail + désinscription

**Files:**
- Create: `server/services/desinscription.ts`, `.test.ts`
- Modify: `server/services/prospection-sender.ts` (+ test), `server/routes-reponses.ts` (route publique), `server/storage.ts`

**Interfaces — Produces:**
- `jetonDesinscription(leadId: number): string` / `leadDuJeton(jeton: string): number | null` — HMAC-SHA256 avec `process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET`, comparaison à temps constant.
- `lienDesinscription(leadId: number): string` = `${process.env.APP_URL}/desinscription/${jeton}`.
- Routes publiques (sans `isAuthenticated`) : `GET /desinscription/:jeton` (page simple : « Se désinscrire » + bouton), `POST /desinscription/:jeton` → état `unsubscribed` (définitif, comme au chantier 1). Un GET ne désinscrit jamais (les antivirus suivent les liens).
- `storage.setOutreachProviderIds(outreachId: number, providerMessageId: string | null, providerThreadId: string | null)`.
- Libellé de suivi : `trackingLabel = "lead:{leadId}:step:{n}"`.

- [ ] **Step 1: Tests qui échouent** : jeton aller-retour ; jeton modifié → null ; sender : `Gmail relié → sendEmailUnipile appelé, SendGrid non appelé, corps contient le lien de désinscription, en-têtes List-Unsubscribe et List-Unsubscribe-Post présents, providerId stocké` ; `Gmail non relié → SendGrid comme avant` ; `kill-switch coupé → aucun envoi` ; les plafonds et l'écart email du chantier 1 s'appliquent aux deux chemins.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (`resolveSenderConfig` devient un choix entre `{ via: "unipile", accountId, … }` et `{ via: "sendgrid", … }`). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(chantier2): emails de prospection envoyés depuis Gmail`.

---

### Task 8: Réception — tri, rattachement, ingestion, webhook

**Files:**
- Create: `server/services/reponses/tri.ts`, `rattachement.ts`, `ingestion.ts` (+ tests), `server/routes-reponses.ts` (+ test)
- Modify: `server/storage.ts`, `server/index.ts`, `server/services/prospection-sender.ts` (stocker `linkedinProviderId` après un envoi réussi)

**Interfaces — Produces:**
- `tri.ts` : `classerMessage(m: { subject?: string | null; body: string; headers?: Record<string, string> }, now: Date): { nature: "reponse" | "absence" | "accuse"; retourLe: Date | null; desinscription: boolean }`.
  - Absence / accusé uniquement si signal clair : en-têtes `Auto-Submitted` ≠ `no`, `X-Autoreply`, `X-Autorespond`, `Precedence: auto_reply|bulk|junk` ; ou formules : absent(e) du bureau, en congé(s), je suis absent, out of office, OOO, automatic reply, réponse automatique, accusé de réception, nous avons bien reçu. **Tout le reste → `reponse`.**
  - `retourLe` : dates FR / EN (« jusqu'au 12 novembre », « de retour le 12/11 », « back on November 12 », « until 12 Nov ») → lendemain ouvré ; aucune date → `now + 7 j`.
  - `desinscription` : « désinscri », « ne plus recevoir », « retirez-moi », « unsubscribe », « remove me », « stop » seul sur sa ligne.
- `rattachement.ts` : `rattacherLead(evt: EvenementNormalise, deps: { leadParProviderId; leadParPublicId; leadParFil; leadContacteParEmail }): Promise<{ leadId: number } | null>` — ordre : fil (`providerThreadId`) → providerId LinkedIn → identifiant public → email (minuscules, sans espaces, **uniquement les leads ayant au moins un `outreach_messages.sentAt` non nul** ou une conversation existante).
- `ingestion.ts` : `normaliser(payload: any): EvenementNormalise | null` et `traiterEvenement(evt: EvenementNormalise, deps: DepsIngestion): Promise<void>` avec
  - `EvenementNormalise` = `{ kind: "message" | "mail" | "relation" | "suivi" | "compte"; accountId: string; providerMessageId?; chatId?; threadId?; fromSelf: boolean; senderProviderId?; senderPublicId?; senderEmail?; subject?; body?; headers?; sentAt: Date; suivi?: "ouvert" | "clic"; label?; statutCompte? }`. `fromSelf` (LinkedIn) = `account_info.user_id === sender.attendee_provider_id` ; (mail) = expéditeur = adresse du compte.
  - Comportements :
    - compte inconnu ou aucun lead → rien n'est stocké ;
    - `providerMessageId` déjà présent dans `inbox_messages` → rien (idempotence) ;
    - `reponse` → `etatAvantReponse` sauvegardé, état `stopped_replied` + `repliedAt`, brouillons LinkedIn en attente supprimés, `responseReceived` / `responseDate` sur le dernier message envoyé, stade → `in_discussion` s'il est avant dans `STAGES`, conversation `a_traiter` + `nonLu`, tâche créée si la conversation n'en a pas d'ouverte (`title` « Répondre à {nom} ({entreprise}) — {LinkedIn|email} », `type: "outreach"`, `category: "conversion"`, `leadId`, `projectId`, `scheduledDate` = aujourd'hui dans le fuseau de l'utilisatrice, `estimatedDuration: 10`, `source: "reponse_prospect"`), `markFeedbackReplied` ;
    - `desinscription` → en plus, état `unsubscribed` ;
    - `absence` → message stocké, `nextRunAt = retourLe` si état `active`, pas de tâche ;
    - `accuse` → message stocké, rien d'autre ;
    - `fromSelf` → stocké seulement si la conversation existe ; si plus récent que le dernier entrant : conversation `traitee`, tâche cochée ;
    - `relation` → `linkedinConnectedAt = least(existant, sentAt)` ; jamais de changement de stade ;
    - `suivi` → `openedAt` / `clickedAt` du message identifié par `label` ;
    - `compte` en erreur / déconnecté → identifiant du compte retiré de la connexion (utilisatrice ou projet), envoi en pause sur ce canal, rien de silencieux (le point du jour le dira, Tâche 11).
  - Réception **jamais** coupée par `PROSPECTION_SENDING_ENABLED`.
- Route `POST /api/unipile/webhook` dans `routes-reponses.ts` : 401 si `req.get("Unipile-Auth") !== process.env.UNIPILE_WEBHOOK_SECRET` (et 503 si le secret n'est pas configuré) ; répond `200` immédiatement puis `traiterEvenement` (erreurs journalisées). Dans `server/index.ts`, avant `express.json()` global : `app.use("/api/unipile/webhook", express.json({ type: () => true, limit: "2mb" }))`.
- Au démarrage (`server/index.ts`), si Unipile configuré et `UNIPILE_WEBHOOK_SECRET` + `APP_URL` présents : `ensureWebhooks(APP_URL, secret)`.

- [ ] **Step 1: Tests `tri.test.ts`** (cas réels FR et EN) : « Je suis absente du bureau jusqu'au 12 novembre » → `absence`, retour le 13 novembre (ouvré) ; « Merci, pas intéressée » → `reponse` ; « Merci pour votre message, nous avons bien reçu votre demande » + en-tête `Auto-Submitted: auto-replied` → `accuse` ; « Out of office, back Monday » sans date exploitable → `absence`, `now + 7 j` ; « Stop » → `reponse` + `desinscription` ; message ambigu (« Je reviens vers vous ») → `reponse`.
- [ ] **Step 2: Tests `rattachement.test.ts`** : priorité fil > providerId > publicId > email ; email d'un lead jamais contacté → null ; email avec majuscules / espaces → trouvé.
- [ ] **Step 3: Tests `ingestion.test.ts`** (deps mockées) : réponse LinkedIn → arrêt + tâche + conversation ; **même événement deux fois → une tâche, un message** ; `fromSelf` sans conversation → rien ; fil avec seulement le message de Jeanne (acceptation avec note) → aucun arrêt ; deuxième réponse avant que Jeanne réponde → pas de seconde tâche ; absence → `nextRunAt` décalé, état toujours `active` ; `new_relation` avec date plus récente que l'existante → date existante gardée ; compte inconnu → aucune écriture.
- [ ] **Step 4: Tests `routes-reponses.test.ts`** : mauvais secret → 401 ; bon secret, corps envoyé en `text/plain` → 200 et `traiterEvenement` appelé avec le corps lu.
- [ ] **Step 5:** FAIL → implémenter → PASS.
- [ ] **Step 6:** Commit `feat(chantier2): détection des réponses et acceptations via webhooks Unipile`.

---

### Task 9: Invitation acceptée à la main + stade « Connecté »

**Files:**
- Modify: `server/routes.ts` (liste `ENGAGED`), `server/routes-reponses.ts` (+ test), `client/src/pages/outreach/LeadDetail.tsx`, `LinkedInAEnvoyer.tsx`, `useOutreach.ts`, locales

**Interfaces — Produces:**
- `POST /api/leads/:id/invitation-acceptee` → vérifie le propriétaire, `linkedinConnectedAt = least(existant, now)`, renvoie `{ linkedinConnectedAt }`.
- `ENGAGED = ['in_discussion', 'proposal_sent', 'signed']` (le stade `connected` n'arrête plus la séquence).

- [ ] **Step 1: Tests** : lead d'un autre utilisateur → 404 ; date déjà plus ancienne → inchangée ; PATCH stade `connected` → séquence toujours `active`.
- [ ] **Step 2:** FAIL → implémenter (bouton « Invitation acceptée » sur la fiche et dans le panneau de repli, masqué si déjà acceptée) → PASS.
- [ ] **Step 3:** Commit `feat(chantier2): marquer une invitation acceptée à la main`.

---

### Task 10: Boîte « Réponses » — API, réponse proposée, envoi

**Files:**
- Create: `server/services/reponses/envoi-reponse.ts` (+ test), `server/services/reponses/proposition.ts`
- Modify: `server/routes-reponses.ts` (+ test), `server/storage.ts`

**Interfaces — Produces:**
- `GET /api/reponses?projectId=&statut=` → `[{ id, leadId, leadName, company, channel, statut, nonLu, extrait, lastMessageAt, projectId }]`, non traitées d'abord puis par date décroissante.
- `GET /api/reponses/compte` → `{ aTraiter: number }`.
- `GET /api/reponses/:id` → `{ conversation, lead, campagne, messages: [...] }` où `messages` fusionne les `outreach_messages` envoyés au lead et les `inbox_messages`, triés par date ; marque `nonLu = false`.
- `POST /api/reponses/:id/proposition` → `{ texte }` — `proposition.ts` : `proposerReponse(userId, conversationId): Promise<string>` via `callClaude` + `buildNayaContext`, avec le fil, la campagne (offre, angle, instructions) et l'identité du périmètre (`identite.signature` pour un projet client). Langue du prospect, voix de Jeanne, court, aucun envoi.
- `POST /api/reponses/:id/envoyer` `{ texte }` → `envoyerReponse(conversationId, userId, texte, deps): Promise<{ ok: true } | { ok: false; raison: "envoi_coupe" | "compte_restreint" | "compte_absent" | "echec" }>` :
  - kill-switch → `envoi_coupe` ;
  - LinkedIn : restriction → `compte_restreint` ; sinon `sendLinkedInChatMessage` sur `providerChatId`, puis `recordLinkedInSendAttempt` (compté, jamais refusé par les plafonds) ;
  - email : `sendEmailUnipile` avec `replyToProviderId` = dernier message entrant, `subjectReponse(sujet)` ;
  - succès : message `sortant`/`nous` stocké, conversation `traitee`, tâche cochée.
- `POST /api/reponses/:id/traitee` → conversation `traitee`, tâche cochée.
- `POST /api/reponses/:id/pas-une-reponse` → état restauré depuis `etatAvantReponse` (statut, currentStep, delayAnchorAt ; `nextRunAt = max(ancien, now)`), conversation `traitee`, tâche supprimée, dernier message entrant requalifié `accuse`.
- Toutes les routes vérifient que la conversation appartient à `req.userId` (404 sinon).

- [ ] **Step 1: Tests `envoi-reponse.test.ts`** : kill-switch coupé → `envoi_coupe`, rien envoyé ; LinkedIn restreint → `compte_restreint` ; plafond hebdomadaire atteint → envoyé quand même et compté ; email → `reply_to` = dernier entrant, objet « Re: … » ; succès → conversation `traitee` et tâche cochée.
- [ ] **Step 2: Tests `routes-reponses.test.ts`** : conversation d'un autre utilisateur → 404 sur chaque route ; `pas-une-reponse` remet l'état sauvegardé.
- [ ] **Step 3:** FAIL → implémenter → PASS.
- [ ] **Step 4:** Commit `feat(chantier2): API de la boîte de réponses`.

---

### Task 11: Boîte « Réponses » — interface et point du jour

**Files:**
- Create: `client/src/pages/outreach/ReponsesTab.tsx`, `ConversationView.tsx`, `useReponses.ts`
- Modify: `client/src/pages/outreach/OutreachHome.tsx`, `server/routes.ts` (`/api/tasks/daily-brief`), locales `fr.ts` / `en.ts`

**Interfaces — Consumes:** routes de la Tâche 10.

- [ ] **Step 1:** Onglet « Réponses » dans `OutreachHome` (à côté de Campagnes / Pipeline) avec pastille `aTraiter`, rafraîchie toutes les 60 s. Filtre par projet quand l'utilisatrice en a.
- [ ] **Step 2:** `ReponsesTab` : liste (prospect, entreprise, icône du canal, extrait, date relative, gras si non lu). `ConversationView` : fil complet (messages de séquence et réponses, les absences / accusés affichés en discret), fiche courte du prospect, zone de réponse préremplie par « Proposer une réponse », boutons « Envoyer », « Marquer comme traité », « Ce n'était pas une vraie réponse ». Messages d'erreur clairs pour chaque `raison` de la Tâche 10.
- [ ] **Step 3:** Ouvrir une tâche `source = "reponse_prospect"` depuis la journée mène à la conversation (`/outreach?onglet=reponses&conversation={id}`, via `tasks.leadId` → conversation `a_traiter` du lead).
- [ ] **Step 4:** Point du jour : ajouter au contexte du brief « {n} réponse(s) de prospects attendent » si `aTraiter > 0`, et « Ton {Gmail|LinkedIn} est déconnecté de Naya : les envois sur ce canal sont en pause » si un compte a été retiré par la Tâche 8.
- [ ] **Step 5:** `npx tsc --noEmit` → 0 ; vérification à l'œil en local (`npm run dev`) avec des conversations de test insérées **sur dev-local uniquement** ; captures d'écran à montrer à Jeanne.
- [ ] **Step 6:** Commit `feat(chantier2): boîte Réponses et point du jour`.

---

### Task 12: Vérification finale et passation

- [ ] **Step 1:** `npx tsc --noEmit` → 0 ; `npx vitest run` → seuls les 2 échecs préexistants.
- [ ] **Step 2:** Revue de toute la branche (superpowers:requesting-code-review), avec les 5 points de la Review Focus.
- [ ] **Step 3:** Rédiger pour Jeanne, sans pousser :
  - les variables à poser sur Railway : `UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_WEBHOOK_SECRET` (valeur aléatoire), `APP_URL` si absente ;
  - la migration prod à appliquer à la main (sauvegarde Neon d'abord) ;
  - l'ordre : migration → déploiement → relier Gmail → vérifier qu'une réponse de test arrive dans la boîte → relier LinkedIn.
- [ ] **Step 4:** Mettre à jour la mémoire `project_naya_prospection_chantiers.md` (chantier 2 codé, en attente de déploiement).
