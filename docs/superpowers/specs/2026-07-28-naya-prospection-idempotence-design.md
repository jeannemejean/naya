# Garde d'idempotence des envois de prospection — design

**Date :** 2026-07-28
**Statut :** validé par Jeanne, prêt pour le plan d'implémentation

## Problème

Le worker `server/services/prospection-sender.ts` envoie chaque étape de séquence en trois temps
non atomiques (lignes 249-304) :

1. envoi réel — `sendEmail` (SendGrid) ou `sendLinkedInStep` (Unipile) ;
2. journalisation — `storage.createOutreachMessage` ;
3. avancement — `storage.updateLeadSequenceState` (`currentStep + 1`, nouveau `nextRunAt`).

Tant que 3 n'a pas abouti, `nextRunAt` reste dû et `getDueEnrollments` resservira le même
enrôlement au tick suivant : **le même message repart chez le même prospect**. Le drapeau
`running` (ligne 25) ne sérialise que les ticks d'un seul processus — il ne protège ni d'un
redémarrage, ni d'une coupure DB, ni d'une seconde instance Railway.

Trois scénarios produisent aujourd'hui un doublon :

| Scénario | Mécanisme |
|---|---|
| Crash / coupure DB | Envoi parti, avancement jamais écrit → renvoi au tick suivant. |
| Deux instances | Deux workers lisent le même enrôlement dû et l'envoient chacun. |
| **Double-clic sur « Lancer la séquence »** | `storage.enrollLead` (storage.ts:1206) **remet `currentStep` à 0** pour un état existant → toute la séquence repart du début pour tous les prospects déjà contactés. |

Le troisième est le plus probable : un simple clic suffit. C'est la classe de l'incident des
14 posts LinkedIn (cf. mémoire `feedback_prod_testing_safety`), et c'est le dernier verrou
manquant avant de poser `PROSPECTION_SENDING_ENABLED=true`.

## Décisions produit (Jeanne, 2026-07-28)

| Question | Décision |
|---|---|
| Envoi parti mais non enregistré (crash) | **Ne jamais renvoyer.** L'étape est réputée envoyée, la séquence avance. |
| Re-lancement / ré-enrôlement | **Jamais deux fois la même étape**, quelle que soit la manipulation. Un re-lancement avance jusqu'aux étapes non encore envoyées. |
| Brouillons LinkedIn (compte non connecté) | **Ils réservent aussi.** Une étape ne produit qu'une seule sortie — jamais trois brouillons identiques pour le même prospect. |
| Échec franc du fournisseur (SendGrid/Unipile en erreur) | **Comportement actuel préservé** : nouvelle tentative au tick suivant. |

## Architecture

### Pourquoi une table de réservation dédiée

Trois options ont été comparées :

- **Contrainte unique sur `outreach_messages(lead_id, message_type)`** — écartée. Le
  `messageType` LinkedIn varie selon le résultat de l'envoi (`step_1_invitation` vs `step_1`,
  prospection-sender.ts:283), les brouillons y écrivent déjà des lignes à `sentAt = null`, et la
  prod peut contenir des doublons qui feraient échouer la création de l'index. Cela mélangerait
  le journal de ce qui est parti avec le verrou qui l'empêche de repartir.
- **Verrou applicatif (`pg_advisory_xact_lock`)** — écarté. Il sérialise deux workers concurrents
  mais ne survit pas au processus : le cas central (envoi réussi, crash avant l'avancement) reste
  entier.
- **Table dédiée avec contrainte d'unicité** — retenue. C'est Postgres qui arbitre, donc la
  garantie tient entre instances ; la réservation survit au crash et au ré-enrôlement ; le
  journal d'envoi (`outreach_messages`) reste séparé du verrou.

### Pourquoi la clé est le RANG de l'étape, pas son identifiant

`replaceSequenceSteps` (storage.ts:1152) et `saveSequencePlan` (storage.ts:1184) **suppriment
toutes les lignes de `campaign_sequence_steps` de la campagne et les recréent** à chaque
modification de séquence — y compris via le bouton « Générer par IA ». Les identifiants de ligne
changent donc à chaque édition.

Une clé sur `step_id` serait vidée au premier ajustement de séquence, et un re-lancement
renverrait tout : exactement ce que la décision produit interdit. La clé est donc
**`(lead_id, campaign_id, step_order)`** — « le prospect 80 a reçu l'étape 2 de la campagne 4 » —
qui survit aux rééditions.

**Contrepartie assumée :** si une étape est supprimée et qu'une étape franchement différente
prend son rang, les prospects ayant reçu l'ancienne ne recevront pas la nouvelle. Un « renvoyer
cette étape » explicite dans l'UI pourra lever ce cas plus tard — hors périmètre.

### Table `outreach_step_sends`

```
id           serial primary key
lead_id      integer not null → leads(id)
campaign_id  integer not null → prospection_campaigns(id)
step_order   integer not null              -- rang de l'étape (1 = première)
user_id      varchar not null → users(id)
channel      text not null                 -- email | linkedin
status       text not null default 'claimed'   -- claimed | sent | draft
claimed_at   timestamp default now()
sent_at      timestamp
UNIQUE (lead_id, campaign_id, step_order)
```

Pas de clé étrangère vers `campaign_sequence_steps` : c'est précisément le lien qu'on refuse,
puisque ces lignes sont recyclées à chaque édition de séquence.

`status` n'est pas lu par la décision d'envoi — l'existence de la ligne suffit à bloquer. Il sert
au diagnostic : une ligne restée en `claimed` est la trace d'un envoi dont l'issue est inconnue.

### Flux du worker

La réservation s'insère **juste avant l'envoi**, après tous les contrôles existants (fenêtre
horaire, plafonds quotidiens, génération du message) et sans en modifier aucun :

1. Tentative de réservation de `(prospect, campagne, rang)` — insertion avec `ON CONFLICT DO NOTHING`.
2. **Refusée** → l'étape est déjà partie, ou son sort est inconnu. Rien n'est envoyé ; la séquence
   avance à l'étape suivante ; une ligne de log le signale.
   L'avancement écrit aussi `lastStepSentAt = maintenant`, comme pour un envoi réel : le message
   étant réputé parti, l'étape suivante doit respecter son délai au lieu de partir dans la foulée.
   (Le commentaire « le délai court depuis le dernier envoi réel, jamais depuis un skip »
   prospection-sender.ts:184 vise les étapes **sautées par condition**, qui n'envoient rien — cas
   distinct, inchangé.)
3. **Obtenue** → envoi réel.
   - Succès : réservation passée à `sent` (ou `draft` pour un brouillon LinkedIn), écriture dans
     `outreach_messages`, avancement de l'état — comme aujourd'hui.
   - Échec franc du fournisseur : **réservation libérée** (suppression de la ligne), pas
     d'avancement, nouvelle tentative au tick suivant — comportement actuel.
4. **Crash entre 3 et la fin** → la réservation reste en `claimed`. Au redémarrage on retombe sur
   le cas 2 : jamais de renvoi.

Aucun chemin d'envoi ne peut atteindre SendGrid ou Unipile sans détenir la réservation.

### Découpage

- `server/services/prospection-idempotence.ts` — décision **pure** et testable :
  à partir du résultat de la réservation et de l'issue de l'envoi, elle dit quoi faire
  (`send` / `skip-and-advance` / `release-and-retry`). Aucune dépendance DB.
- `server/storage.ts` — `claimStepSend` (insertion `ON CONFLICT DO NOTHING`, renvoie si la
  réservation est obtenue), `markStepSendSent`, `releaseStepSend`.
- `server/services/prospection-sender.ts` — câblage : réserver, brancher les trois issues.

## Intégrations à ne pas oublier

- **`storage.deleteProspectionCampaign`** — cascade transactionnelle manuelle (les FK n'ont pas
  d'`ON DELETE CASCADE` ; c'est ce qui produisait des 500 avant le commit `aee0772`). La nouvelle
  table doit y être supprimée, sinon supprimer une campagne échoue.
- **`ACCOUNT_RESET_PLAN`** (`server/services/account-reset-plan.ts`) — le test garde-fou
  `account-reset-plan.test.ts` échouera tant que la table n'y figure pas. C'est voulu : il existe
  pour attraper une table oubliée avant la prod.
- **Migration** — additive, appliquée via Neon MCP sur la branche dev `br-divine-base-anmsv1nj`
  **et** sur la production `br-floral-wave-ane2h3l1` **avant** le push du code (pas de `db:push`
  au déploiement Railway).

## Tests

- **Unitaires (fonction pure)** : réservation obtenue → envoyer ; refusée → avancer sans envoyer ;
  envoi en échec → libérer et retenter.
- **Worker (mocks storage)** : un enrôlement dû dont l'étape est déjà réservée ne déclenche aucun
  appel d'envoi et avance quand même `currentStep` ; un envoi en échec ne laisse pas de
  réservation derrière lui.
- **Contrainte SQL** : deux réservations du même `(lead, campagne, rang)` — une seule passe.
  Vérifié **à la main sur la branche dev** au moment de la migration : la suite Vitest ne dispose
  d'aucune base, il n'existe pas de test automatisé touchant Postgres dans ce repo.
- **Non-régression** : le kill-switch `PROSPECTION_SENDING_ENABLED`, la fenêtre horaire et les
  plafonds quotidiens restent inchangés ; en dry-run, aucune réservation n'est écrite.

## Hors périmètre

- Activer `PROSPECTION_SENDING_ENABLED=true` — décision séparée, après validation de ce verrou.
- Un bouton « renvoyer cette étape » dans l'UI.
- Déplacer la génération IA après les contrôles de plafond (économie de coût, suivi séparé).
- Le nettoyage des campagnes de prospection en doublon.
