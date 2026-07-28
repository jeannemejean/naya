# Garde d'idempotence des envois de prospection — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aucun prospect ne peut recevoir deux fois le message d'une même étape de séquence, quel que soit le scénario (crash, seconde instance, re-lancement de campagne).

**Architecture :** une table `outreach_step_sends` avec contrainte d'unicité sur `(lead_id, campaign_id, step_order)` sert de réservation. Le worker doit obtenir la réservation avant tout appel à SendGrid ou Unipile ; une réservation refusée fait avancer la séquence sans rien envoyer. La discipline « pas d'envoi sans réservation » est encapsulée dans une fonction d'ordre supérieur `sendOnce`, pure de toute dépendance DB, pour qu'aucun chemin d'envoi ne puisse l'oublier.

**Tech Stack :** TypeScript, Drizzle ORM, PostgreSQL (Neon), Vitest, Express.

**Spec :** `docs/superpowers/specs/2026-07-28-naya-prospection-idempotence-design.md`

## Global Constraints

- Commentaires et messages de commit en **français**. Code (identifiants, types) en anglais, comme le reste du repo.
- **Ne jamais lancer `npm install`** sur ce repo : il élague des paquets et crée des dossiers `"* 2"`. Utiliser uniquement `npx tsc`, `npx vitest`, `npm run build`.
- Migration **additive uniquement**, appliquée via l'outil **Neon MCP** sur la branche dev `br-divine-base-anmsv1nj` **et** sur la production `br-floral-wave-ane2h3l1`, **avant** tout push (il n'y a pas de `db:push` au déploiement Railway).
- `run_sql` du MCP Neon n'accepte **qu'une seule commande par appel** ; DDL idempotente (`IF NOT EXISTS`).
- Le kill-switch `PROSPECTION_SENDING_ENABLED`, la fenêtre horaire et les plafonds quotidiens (`PROSPECTION_DAILY_CAP`, `LINKEDIN_DAILY_CAP`) ne doivent **pas** changer de comportement.
- Ce plan **n'active pas** l'envoi. `PROSPECTION_SENDING_ENABLED` reste non posé sur Railway.

## File Structure

| Fichier | Rôle |
|---|---|
| `shared/schema.ts` (modifier) | Table `outreachStepSends` + types inférés. |
| `server/services/prospection-idempotence.ts` (créer) | `sendOnce` : protocole réserver → envoyer → marquer/libérer. Aucune dépendance DB, testable avec des faux. |
| `server/services/prospection-idempotence.test.ts` (créer) | Tests unitaires des quatre issues du protocole. |
| `server/storage.ts` (modifier) | `claimStepSend` / `markStepSendSent` / `releaseStepSend` + suppression dans les deux cascades. |
| `server/services/prospection-sender.ts` (modifier) | Câblage : email, LinkedIn envoyé, LinkedIn brouillon. |
| `server/services/prospection-sender.test.ts` (modifier) | Tests d'intégration du worker (mocks storage). |
| `server/services/account-reset-plan.ts` (modifier) | Déclarer la table dans `ACCOUNT_RESET_PLAN`. |

---

### Task 1 : Schéma — table `outreach_step_sends`

**Files:**
- Modify: `shared/schema.ts` (juste après le bloc `leadStepMessages`, ~ligne 1443)

**Interfaces:**
- Produces: table `outreachStepSends`, types `OutreachStepSend` / `InsertOutreachStepSend`.

- [ ] **Step 1 : Ajouter la table après `leadStepMessages` et ses types**

Insérer juste après le bloc `export type InsertLeadStepMessage = ...` :

```typescript
// Réservation d'envoi (garde d'idempotence). Une ligne = « l'étape N de la campagne C
// a été prise en charge pour le prospect L ». La contrainte d'unicité est le verrou :
// le worker ne peut appeler SendGrid/Unipile qu'après avoir inséré sa ligne.
//
// Pourquoi (lead, campagne, RANG) et pas step_id : `replaceSequenceSteps` et
// `saveSequencePlan` suppriment et recréent TOUTES les lignes de campaign_sequence_steps
// à chaque modification de séquence. Une clé sur step_id serait vidée à la première
// retouche, et un re-lancement renverrait tout.
//
// Une ligne restée en `claimed` est la trace d'un envoi dont l'issue est inconnue
// (crash entre l'appel au fournisseur et son enregistrement) : elle n'est jamais rejouée.
export const outreachStepSends = pgTable("outreach_step_sends", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  campaignId: integer("campaign_id").notNull().references(() => prospectionCampaigns.id),
  stepOrder: integer("step_order").notNull(),        // rang de l'étape (1 = première)
  userId: varchar("user_id").notNull().references(() => users.id),
  channel: text("channel").notNull(),                // email | linkedin
  status: text("status").notNull().default("claimed"), // claimed | sent | draft
  claimedAt: timestamp("claimed_at").defaultNow(),
  sentAt: timestamp("sent_at"),
}, (t) => ({
  uniqLeadCampaignStep: uniqueIndex("outreach_step_sends_lead_campaign_step_uq")
    .on(t.leadId, t.campaignId, t.stepOrder),
}));

export type OutreachStepSend = typeof outreachStepSends.$inferSelect;
export type InsertOutreachStepSend = typeof outreachStepSends.$inferInsert;
```

Aucune clé étrangère vers `campaign_sequence_steps` : c'est précisément le lien qu'on refuse.

- [ ] **Step 2 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie (code de retour 0).

- [ ] **Step 3 : Commit**

```bash
git add shared/schema.ts
git commit -m "feat(idempotence): schéma — table outreach_step_sends"
```

---

### Task 2 : Protocole pur `sendOnce`

**Files:**
- Create: `server/services/prospection-idempotence.ts`
- Test: `server/services/prospection-idempotence.test.ts`

**Interfaces:**
- Consumes: rien (aucune dépendance).
- Produces:
  - `interface StepSendKey { leadId: number; campaignId: number; stepOrder: number; userId: string; channel: "email" | "linkedin" }`
  - `interface ClaimStore { claim(key: StepSendKey): Promise<boolean>; markSent(key: StepSendKey, status: "sent" | "draft"): Promise<void>; release(key: StepSendKey): Promise<void> }`
  - `type SendAttempt = () => Promise<{ ok: boolean; status?: "sent" | "draft" }>`
  - `type GuardResult = { action: "sent"; status: "sent" | "draft" } | { action: "skipped" } | { action: "failed" }`
  - `sendOnce(store: ClaimStore, key: StepSendKey, attempt: SendAttempt): Promise<GuardResult>`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `server/services/prospection-idempotence.test.ts` :

```typescript
import { describe, it, expect, vi } from "vitest";
import { sendOnce, type ClaimStore, type StepSendKey } from "./prospection-idempotence";

const key: StepSendKey = { leadId: 1, campaignId: 10, stepOrder: 2, userId: "u1", channel: "email" };

function fakeStore(claimResult: boolean): ClaimStore & {
  claim: ReturnType<typeof vi.fn>; markSent: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(claimResult),
    markSent: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("sendOnce", () => {
  it("réservation refusée : n'envoie RIEN et renvoie skipped", async () => {
    const store = fakeStore(false);
    const attempt = vi.fn();

    const result = await sendOnce(store, key, attempt as any);

    expect(attempt).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "skipped" });
    expect(store.markSent).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });

  it("réservation obtenue + envoi réussi : marque la réservation envoyée", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: true, status: "sent" });

    const result = await sendOnce(store, key, attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(store.markSent).toHaveBeenCalledWith(key, "sent");
    expect(store.release).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "sent", status: "sent" });
  });

  it("brouillon : marque la réservation en draft", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: true, status: "draft" });

    const result = await sendOnce(store, key, attempt);

    expect(store.markSent).toHaveBeenCalledWith(key, "draft");
    expect(result).toEqual({ action: "sent", status: "draft" });
  });

  it("échec franc du fournisseur : libère la réservation pour permettre un retry", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockResolvedValue({ ok: false });

    const result = await sendOnce(store, key, attempt);

    expect(store.release).toHaveBeenCalledWith(key);
    expect(store.markSent).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "failed" });
  });

  it("exception pendant l'envoi : NE libère PAS (issue inconnue) et propage", async () => {
    const store = fakeStore(true);
    const attempt = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(sendOnce(store, key, attempt)).rejects.toThrow("ECONNRESET");

    expect(store.release).not.toHaveBeenCalled();
    expect(store.markSent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run server/services/prospection-idempotence.test.ts`
Expected: FAIL — `Failed to resolve import "./prospection-idempotence"`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `server/services/prospection-idempotence.ts` :

```typescript
/**
 * Garde d'idempotence des envois de séquence.
 *
 * Règle unique : on n'appelle JAMAIS un fournisseur (SendGrid, Unipile) sans avoir
 * d'abord obtenu la réservation de l'étape. `sendOnce` encapsule ce protocole pour
 * qu'aucun chemin d'envoi ne puisse l'oublier.
 *
 * Distinction volontaire entre les deux façons d'échouer :
 *  - le fournisseur répond en erreur → on SAIT que rien n'est parti → on libère, retry.
 *  - une exception est levée (réseau coupé, DB indisponible) → on ne sait PAS si le
 *    message est parti → on GARDE la réservation → il ne repartira jamais.
 *    C'est la décision produit « dans le doute, ne jamais renvoyer ».
 */

export interface StepSendKey {
  leadId: number;
  campaignId: number;
  stepOrder: number; // rang de l'étape (1 = première)
  userId: string;
  channel: "email" | "linkedin";
}

export interface ClaimStore {
  /** Insère la réservation. `true` si elle est obtenue, `false` si elle existe déjà. */
  claim(key: StepSendKey): Promise<boolean>;
  markSent(key: StepSendKey, status: "sent" | "draft"): Promise<void>;
  release(key: StepSendKey): Promise<void>;
}

/** L'envoi réel. `ok: false` = le fournisseur a refusé, rien n'est parti. */
export type SendAttempt = () => Promise<{ ok: boolean; status?: "sent" | "draft" }>;

export type GuardResult =
  | { action: "sent"; status: "sent" | "draft" }
  | { action: "skipped" } // déjà réservée : la séquence doit avancer sans envoyer
  | { action: "failed" }; // échec franc : ne pas avancer, retry au prochain tick

export async function sendOnce(
  store: ClaimStore,
  key: StepSendKey,
  attempt: SendAttempt,
): Promise<GuardResult> {
  const claimed = await store.claim(key);
  if (!claimed) return { action: "skipped" };

  // À partir d'ici la réservation est détenue : toute sortie doit la marquer ou la libérer,
  // SAUF sur exception (issue inconnue → on la garde volontairement).
  const outcome = await attempt();
  if (!outcome.ok) {
    await store.release(key);
    return { action: "failed" };
  }
  const status = outcome.status || "sent";
  await store.markSent(key, status);
  return { action: "sent", status };
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

Run: `npx vitest run server/services/prospection-idempotence.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/services/prospection-idempotence.ts server/services/prospection-idempotence.test.ts
git commit -m "feat(idempotence): protocole pur sendOnce (réserver, envoyer, marquer ou libérer)"
```

---

### Task 3 : Storage — réserver, marquer, libérer

**Files:**
- Modify: `server/storage.ts` (imports ~ligne 129, interface `IStorage` ~ligne 308, implémentation avant `async createOutreachMessage` ~ligne 1450)

**Interfaces:**
- Consumes: `outreachStepSends` (Task 1), `StepSendKey` (Task 2).
- Produces sur `IStorage` et `DatabaseStorage` :
  - `claimStepSend(key: StepSendKey): Promise<boolean>`
  - `markStepSendSent(key: StepSendKey, status: "sent" | "draft"): Promise<void>`
  - `releaseStepSend(key: StepSendKey): Promise<void>`

- [ ] **Step 1 : Ajouter les imports**

Dans l'import groupé depuis `@shared/schema` (celui qui contient déjà `leadStepMessages`, ~ligne 129), ajouter `outreachStepSends`.

Ajouter en tête de fichier, près des autres imports de services :

```typescript
import type { StepSendKey } from "./services/prospection-idempotence";
```

- [ ] **Step 2 : Déclarer les méthodes dans l'interface `IStorage`**

Juste après la ligne `createOutreachMessage(message: InsertOutreachMessage): Promise<OutreachMessage>;` :

```typescript
  // Garde d'idempotence des envois de séquence (cf. services/prospection-idempotence.ts)
  claimStepSend(key: StepSendKey): Promise<boolean>;
  markStepSendSent(key: StepSendKey, status: "sent" | "draft"): Promise<void>;
  releaseStepSend(key: StepSendKey): Promise<void>;
```

- [ ] **Step 3 : Implémenter dans `DatabaseStorage`, juste avant `async createOutreachMessage`**

```typescript
  // ─── Garde d'idempotence des envois de séquence ────────────────────────────
  // Le verrou est la contrainte d'unicité (lead_id, campaign_id, step_order) :
  // c'est Postgres qui arbitre, donc la garantie tient même avec deux instances.

  private stepSendWhere(key: StepSendKey) {
    return and(
      eq(outreachStepSends.leadId, key.leadId),
      eq(outreachStepSends.campaignId, key.campaignId),
      eq(outreachStepSends.stepOrder, key.stepOrder),
    );
  }

  async claimStepSend(key: StepSendKey): Promise<boolean> {
    const rows = await db.insert(outreachStepSends)
      .values({
        leadId: key.leadId,
        campaignId: key.campaignId,
        stepOrder: key.stepOrder,
        userId: key.userId,
        channel: key.channel,
        status: "claimed",
      })
      .onConflictDoNothing({
        target: [outreachStepSends.leadId, outreachStepSends.campaignId, outreachStepSends.stepOrder],
      })
      .returning({ id: outreachStepSends.id });
    return rows.length > 0; // 0 ligne = réservation déjà détenue
  }

  async markStepSendSent(key: StepSendKey, status: "sent" | "draft"): Promise<void> {
    await db.update(outreachStepSends)
      .set({ status, sentAt: new Date() })
      .where(this.stepSendWhere(key));
  }

  async releaseStepSend(key: StepSendKey): Promise<void> {
    await db.delete(outreachStepSends).where(this.stepSendWhere(key));
  }
```

- [ ] **Step 4 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 5 : Commit**

```bash
git add server/storage.ts
git commit -m "feat(idempotence): storage — claimStepSend / markStepSendSent / releaseStepSend"
```

---

### Task 4 : Câblage du worker — canal email

**Files:**
- Modify: `server/services/prospection-sender.ts` (imports en tête ; bloc email lignes ~229-261)
- Test: `server/services/prospection-sender.test.ts`

**Interfaces:**
- Consumes: `sendOnce`, `ClaimStore`, `StepSendKey` (Task 2) ; `storage.claimStepSend` / `markStepSendSent` / `releaseStepSend` (Task 3).
- Produces: constante interne `claimStore` réutilisée par la Task 5.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `server/services/prospection-sender.test.ts`, ajouter les trois méthodes au mock de storage (bloc `vi.mock("../storage", ...)` en tête de fichier) :

```typescript
    claimStepSend: vi.fn(),
    markStepSendSent: vi.fn(),
    releaseStepSend: vi.fn(),
```

Dans le `beforeEach` de `describe("runProspectionSender — worker loop (intégration)")`, après `vi.clearAllMocks()`, poser le comportement par défaut (réservation obtenue) pour que les tests existants continuent de passer :

```typescript
    (storage.claimStepSend as any).mockResolvedValue(true);
    (storage.markStepSendSent as any).mockResolvedValue(undefined);
    (storage.releaseStepSend as any).mockResolvedValue(undefined);
```

Puis ajouter ce bloc de tests à la fin du même `describe` :

```typescript
  describe("garde d'idempotence", () => {
    it("étape déjà réservée : n'envoie RIEN mais fait avancer la séquence", async () => {
      (storage.claimStepSend as any).mockResolvedValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep(), baseStep({ id: 101, stepOrder: 2, delayDays: 3 })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      // La séquence avance quand même, avec lastStepSentAt renseigné pour que
      // l'étape suivante respecte son délai au lieu de partir dans la foulée.
      const advance = (storage.updateLeadSequenceState as any).mock.calls.at(-1);
      expect(advance[1]).toMatchObject({ currentStep: 1 });
      expect(advance[1].lastStepSentAt).toBeInstanceOf(Date);
    });

    it("échec franc de SendGrid : libère la réservation et n'avance pas", async () => {
      fetchMock.mockResolvedValue({ ok: false });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(storage.releaseStepSend).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("envoi réussi : réserve AVANT d'appeler SendGrid puis marque la réservation", async () => {
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(storage.claimStepSend).toHaveBeenCalledWith({
        leadId: 1, campaignId: 10, stepOrder: 1, userId: "u1", channel: "email",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
    });

    it("kill-switch désactivé : aucune réservation n'est prise", async () => {
      process.env.PROSPECTION_SENDING_ENABLED = "false";
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);

      await runProspectionSender();

      expect(storage.claimStepSend).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `npx vitest run server/services/prospection-sender.test.ts`
Expected: FAIL — les nouveaux tests échouent (`storage.claimStepSend` jamais appelé, `fetchMock` appelé alors qu'il ne devrait pas).

- [ ] **Step 3 : Câbler le canal email**

Dans `server/services/prospection-sender.ts`, ajouter aux imports en tête :

```typescript
import { sendOnce, type ClaimStore, type StepSendKey } from "./prospection-idempotence";
```

Ajouter, juste après la déclaration `const DAY_ABBRS = [...]` :

```typescript
// Adaptateur du protocole d'idempotence sur le storage. Le worker ne parle jamais
// directement aux trois méthodes : il passe par `sendOnce`, qui garantit l'ordre
// réserver → envoyer → marquer/libérer.
const claimStore: ClaimStore = {
  claim: (key) => storage.claimStepSend(key),
  markSent: (key, status) => storage.markStepSendSent(key, status),
  release: (key) => storage.releaseStepSend(key),
};
```

Puis, dans `runProspectionSender`, juste après `const step = steps[decision.index];` et la résolution du `lead` (après le bloc `if (!lead) { ... }`), ajouter la clé de réservation :

```typescript
        // Clé de réservation : le RANG de l'étape, stable à travers les rééditions
        // de séquence (replaceSequenceSteps recrée les lignes et change leurs ids).
        const sendKey: StepSendKey = {
          leadId: lead.id,
          campaignId: state.campaignId,
          stepOrder: decision.index + 1,
          userId: state.userId,
          channel: step.channel === "email" ? "email" : "linkedin",
        };
```

Remplacer le bloc d'envoi email (depuis `const ok = await sendEmail({` jusqu'à `sentCount.set(state.userId, (sentCount.get(state.userId) || 0) + 1);` inclus) par :

```typescript
          // Réservation AVANT tout appel à SendGrid. Réservation refusée = l'étape est
          // déjà partie (ou son sort est inconnu) : on n'envoie rien et on laisse la
          // séquence avancer plus bas.
          const outcome = await sendOnce(claimStore, sendKey, async () => {
            const ok = await sendEmail({
              apiKey: sender.apiKey, fromEmail: sender.fromEmail, fromName: sender.fromName, footerAddress,
              to: lead.email!, toName: lead.name || "", subject, body, leadId: lead.id,
            });
            if (!ok) return { ok: false };
            await storage.createOutreachMessage({
              userId: state.userId, leadId: lead.id, platform: "email",
              messageType: `step_${decision.index + 1}`, subject, body, sentAt: new Date(),
            } as any);
            return { ok: true, status: "sent" as const };
          });
          if (outcome.action === "failed") {
            console.error(`[ProspectionSender] échec envoi lead ${lead.id} — retry au prochain tick`);
            continue; // on n'avance pas → retry
          }
          if (outcome.action === "skipped") {
            console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà envoyée au lead ${lead.id} — avancement sans envoi`);
          } else {
            sentCount.set(state.userId, (sentCount.get(state.userId) || 0) + 1);
          }
```

Le calcul de `footerAddress` reste où il est, juste au-dessus. Supprimer l'ancien bloc `if (!ok) { ... }` devenu redondant.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run: `npx vitest run server/services/prospection-sender.test.ts`
Expected: PASS — tous les tests, anciens et nouveaux.

- [ ] **Step 5 : Commit**

```bash
git add server/services/prospection-sender.ts server/services/prospection-sender.test.ts
git commit -m "feat(idempotence): worker — réservation avant tout envoi email"
```

---

### Task 5 : Câblage du worker — canal LinkedIn (envoi et brouillon)

**Files:**
- Modify: `server/services/prospection-sender.ts` (bloc LinkedIn, lignes ~262-293 avant modification)
- Test: `server/services/prospection-sender.test.ts`

**Interfaces:**
- Consumes: `claimStore`, `sendKey` (Task 4).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans le `describe("garde d'idempotence")` créé en Task 4 :

```typescript
    it("LinkedIn envoyé : réserve puis marque la réservation en sent", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.claimStepSend).toHaveBeenCalledWith(expect.objectContaining({ channel: "linkedin", stepOrder: 1 }));
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
    });

    it("LinkedIn déjà réservé : ne rappelle pas Unipile", async () => {
      (storage.claimStepSend as any).mockResolvedValue(false);
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      expect((storage.updateLeadSequenceState as any).mock.calls.at(-1)[1]).toMatchObject({ currentStep: 1 });
    });

    it("brouillon LinkedIn (compte non connecté) : réserve et marque en draft", async () => {
      (linkedinConfigured as any).mockReturnValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.createOutreachMessage).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "draft");
    });
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run: `npx vitest run server/services/prospection-sender.test.ts -t "LinkedIn"`
Expected: FAIL — `storage.markStepSendSent` jamais appelé.

- [ ] **Step 3 : Câbler le canal LinkedIn**

Remplacer le corps du `else` (canal LinkedIn) par :

```typescript
        } else {
          // LinkedIn : auto-envoi via Unipile depuis le compte de l'utilisateur, SI configuré.
          const liAccountId = prefs?.linkedinUnipileAccountId?.trim();
          if (linkedinConfigured() && liAccountId && lead.linkedinUrl) {
            // Plafond quotidien BAS (limites LinkedIn → éviter toute restriction du compte).
            if (!liSentCount.has(state.userId)) {
              liSentCount.set(
                state.userId,
                await storage.countOutreachSentSince(state.userId, new Date(Date.now() - 86400000), "linkedin").catch(() => 0),
              );
            }
            if ((liSentCount.get(state.userId) || 0) >= LINKEDIN_DAILY_CAP) {
              continue; // plafond LinkedIn atteint → retry plus tard (nextRunAt inchangé)
            }
            const outcome = await sendOnce(claimStore, sendKey, async () => {
              const result = await sendLinkedInStep({ accountId: liAccountId, linkedinUrl: lead.linkedinUrl!, text: body });
              if (!result.ok) return { ok: false };
              await storage.createOutreachMessage({
                userId: state.userId, leadId: lead.id, platform: "linkedin",
                messageType: `step_${decision.index + 1}_${result.action}`, subject: null, body, sentAt: new Date(),
              } as any);
              return { ok: true, status: "sent" as const };
            });
            if (outcome.action === "failed") {
              console.error(`[ProspectionSender] LinkedIn lead ${lead.id} échec — retry au prochain tick`);
              continue; // on n'avance pas → retry
            }
            if (outcome.action === "skipped") {
              console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà envoyée au lead ${lead.id} (LinkedIn) — avancement sans envoi`);
            } else {
              liSentCount.set(state.userId, (liSentCount.get(state.userId) || 0) + 1);
            }
          } else {
            // Non configuré (ou lead sans URL LinkedIn) → brouillon à envoyer manuellement.
            // Le brouillon réserve lui aussi : une étape ne produit qu'UNE seule sortie,
            // jamais trois brouillons identiques pour le même prospect.
            const outcome = await sendOnce(claimStore, sendKey, async () => {
              await storage.createOutreachMessage({
                userId: state.userId, leadId: lead.id, platform: "linkedin",
                messageType: `step_${decision.index + 1}`, subject: null, body, sentAt: null,
              } as any);
              return { ok: true, status: "draft" as const };
            });
            if (outcome.action === "skipped") {
              console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà traitée pour le lead ${lead.id} — pas de nouveau brouillon`);
            }
          }
        }
```

- [ ] **Step 4 : Lancer toute la suite et vérifier qu'elle passe**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tous les fichiers de test passent ; `tsc` sans sortie.

- [ ] **Step 5 : Commit**

```bash
git add server/services/prospection-sender.ts server/services/prospection-sender.test.ts
git commit -m "feat(idempotence): worker — réservation sur le canal LinkedIn (envoi et brouillon)"
```

---

### Task 6 : Cascades — suppression de campagne et reset de compte

**Files:**
- Modify: `server/services/account-reset-plan.ts` (phase 4, ~ligne 65)
- Modify: `server/storage.ts` (`deleteProspectionCampaign` ~ligne 1100 ; `resetUserOnboardingState` phase 4 ~ligne 1932)

**Interfaces:**
- Consumes: `outreachStepSends` (Task 1).

- [ ] **Step 1 : Constater l'échec du garde-fou**

Run: `npx vitest run server/services/account-reset-plan.test.ts`
Expected: FAIL — `outreach_step_sends.lead_id → leads` et `outreach_step_sends.campaign_id → prospection_campaigns` signalés comme références non couvertes (`users` n'est pas supprimée par le reset, donc `user_id` ne l'est pas). C'est le rôle de ce test : attraper une table enfant oubliée avant la prod.

- [ ] **Step 2 : Déclarer la table dans le plan de reset**

Dans `ACCOUNT_RESET_PLAN`, phase 4 (enfants de `leads`), **avant** `{ table: "leads", mode: "delete" }` et avant `prospection_campaigns` :

```typescript
  { table: "outreach_step_sends", mode: "delete", note: "réservations d'envoi (garde d'idempotence)" },
```

À placer juste après la ligne `{ table: "lead_step_messages", ... }`.

- [ ] **Step 3 : Refléter le plan dans `resetUserOnboardingState`**

Dans `server/storage.ts`, phase 4 du reset, juste après la suppression de `leadStepMessages` et avant celle de `leadSequenceState` :

```typescript
      await tx.delete(outreachStepSends).where(eq(outreachStepSends.userId, userId)); // réservations d'envoi
```

- [ ] **Step 4 : Vérifier que le garde-fou repasse**

Run: `npx vitest run server/services/account-reset-plan.test.ts`
Expected: PASS.

- [ ] **Step 5 : Ajouter la suppression à la cascade de campagne**

Dans `storage.deleteProspectionCampaign`, à l'intérieur de la transaction, juste après la suppression de `leadSequenceState` :

```typescript
      // Réservations d'envoi de cette campagne (FK campaign_id, pas de cascade)
      await tx.delete(outreachStepSends).where(eq(outreachStepSends.campaignId, id));
```

Sans cette ligne, supprimer une campagne qui a déjà envoyé une étape échoue en violation de clé étrangère (500), exactement comme le bug corrigé par le commit `aee0772`.

- [ ] **Step 6 : Vérifier la compilation et la suite complète**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` sans sortie ; tous les tests passent.

- [ ] **Step 7 : Commit**

```bash
git add server/storage.ts server/services/account-reset-plan.ts
git commit -m "fix(idempotence): inclure outreach_step_sends dans les cascades campagne et reset"
```

---

### Task 7 : Migration Neon (dev + production)

**Files:**
- Aucun fichier du repo. Migration appliquée via l'outil **Neon MCP**, projet `dawn-waterfall-68860472`.

**Interfaces:**
- Consumes: le schéma de la Task 1.

⚠️ `run_sql` du MCP n'accepte **qu'une seule commande par appel**. Les trois commandes ci-dessous sont donc à passer une par une, DDL idempotente.

- [ ] **Step 1 : Appliquer sur la branche dev `br-divine-base-anmsv1nj`**

Commande 1 :
```sql
CREATE TABLE IF NOT EXISTS outreach_step_sends (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id),
  campaign_id integer NOT NULL REFERENCES prospection_campaigns(id),
  step_order integer NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id),
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  claimed_at timestamp DEFAULT now(),
  sent_at timestamp
);
```

Commande 2 :
```sql
CREATE UNIQUE INDEX IF NOT EXISTS outreach_step_sends_lead_campaign_step_uq
  ON outreach_step_sends (lead_id, campaign_id, step_order);
```

Commande 3 :
```sql
CREATE INDEX IF NOT EXISTS idx_outreach_step_sends_user ON outreach_step_sends (user_id);
```

- [ ] **Step 2 : Vérifier le verrou EN RÉEL sur dev**

C'est la vérification que la contrainte fait bien son travail — elle remplace un test automatisé, la suite Vitest ne disposant d'aucune base.

Récupérer d'abord un couple valide :
```sql
SELECT l.id AS lead_id, l.prospection_campaign_id AS campaign_id, l.user_id
FROM leads l WHERE l.prospection_campaign_id IS NOT NULL LIMIT 1;
```

Puis, avec ces valeurs, insérer deux fois le même triplet :
```sql
INSERT INTO outreach_step_sends (lead_id, campaign_id, step_order, user_id, channel)
VALUES (<lead_id>, <campaign_id>, 999, '<user_id>', 'email');
```
Expected (1ʳᵉ fois) : succès.

Rejouer exactement la même commande.
Expected (2ᵉ fois) : erreur `duplicate key value violates unique constraint "outreach_step_sends_lead_campaign_step_uq"`. **C'est le résultat attendu** : Postgres refuse la deuxième réservation.

Nettoyer :
```sql
DELETE FROM outreach_step_sends WHERE step_order = 999;
```

- [ ] **Step 3 : Appliquer les 3 mêmes commandes sur la production `br-floral-wave-ane2h3l1`**

Mêmes commandes qu'au Step 1, branche `br-floral-wave-ane2h3l1`. La migration est additive : le code en production continue de tourner sans la voir.

- [ ] **Step 4 : Vérifier sur production**

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'outreach_step_sends') AS table_ok,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'outreach_step_sends_lead_campaign_step_uq') AS index_ok;
```
Expected: `table_ok = 1`, `index_ok = 1`.

---

### Task 8 : Vérification finale et déploiement

**Files:**
- Aucun fichier modifié.

- [ ] **Step 1 : Suite complète, types et build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tous les tests passent (411 existants + 12 nouveaux) ; aucune sortie de `tsc` ; build terminé sans erreur.

- [ ] **Step 2 : Vérifier que la migration de la Task 7 est bien appliquée en production**

La Task 7 doit être terminée **avant** ce push : sans la table, le worker lèverait une exception à chaque étape due.

- [ ] **Step 3 : Déployer**

```bash
git push origin main
```

- [ ] **Step 4 : Vérifier le déploiement**

```bash
gh api repos/jeannemejean/naya/commits/$(git rev-parse HEAD)/status --jq '.state'
curl -s https://www.hellonaya.app/api/health
```
Expected: `success`, puis `{"status":"ok","db":"connected",…}`.

- [ ] **Step 5 : Confirmer que le worker reste inerte**

`PROSPECTION_SENDING_ENABLED` n'est toujours pas posé sur Railway : les logs doivent continuer d'afficher `DRY-RUN` s'il y a des étapes dues, et aucune ligne ne doit apparaître dans `outreach_step_sends` en production.

```sql
SELECT count(*) FROM outreach_step_sends;
```
Expected: `0`.

Activer l'envoi est une décision séparée, à prendre avec Jeanne.

---

## Notes d'implémentation

**Pourquoi `sendOnce` est une fonction d'ordre supérieur.** Le verrou ne vaut que si aucun chemin ne peut l'oublier. En passant l'envoi réel *en argument*, il devient impossible d'appeler SendGrid ou Unipile sans avoir traversé la réservation : la garantie est structurelle, pas affaire de discipline.

**Pourquoi l'exception ne libère pas la réservation.** Un `fetch` qui lève ne dit pas si la requête a atteint SendGrid. Libérer rouvrirait exactement la fenêtre qu'on ferme. La réservation reste donc en `claimed` et l'étape ne repart jamais — décision produit « dans le doute, ne jamais renvoyer ». Une réponse HTTP en erreur, elle, prouve que rien n'est parti : là on libère.

**Pourquoi le rang et pas `step_id`.** `replaceSequenceSteps` (storage.ts:1152) et `saveSequencePlan` (storage.ts:1184) suppriment et recréent toutes les lignes d'étapes à chaque édition de séquence. Une clé sur `step_id` serait vidée dès la première retouche.

**Le garde-fou du reset se déclenchera.** La Task 6 commence par constater l'échec de `account-reset-plan.test.ts`. C'est voulu : ce test existe précisément pour attraper une table oubliée avant la production.

**Ce plan ne touche pas `enrollLead`.** Remettre `currentStep` à 0 au ré-enrôlement reste le comportement ; ce n'est plus dangereux, puisque les étapes déjà réservées ne peuvent plus repartir.
