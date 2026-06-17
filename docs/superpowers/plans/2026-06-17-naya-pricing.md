# Tarification & abonnement Naya — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un abonnement unique à 29 €/mois (essai 7 jours) pour accéder à Naya, via Stripe, avec gating front+back, codes d'accès testeurs, et sortie du mode waitlist.

**Architecture:** Stripe est la source de vérité ; la table `subscriptions` est un cache synchronisé par 3 canaux (webhook signé + synchro au retour de Checkout + réconciliation paresseuse). Une règle d'accès unique `hasNayaAccess()` est réutilisée côté serveur (middleware) et exposée au client via `/api/auth/user`.

**Tech Stack:** Express, React + Vite + Wouter, Drizzle ORM, PostgreSQL Neon, Stripe SDK (server), Vitest (nouveau, pour la logique pure).

**Préambule env (branche dev) :** travailler sur la branche git `pricing-subscription` et la branche Neon de dev (le `.env` local y pointe déjà). Ajouter au `.env` local : `STRIPE_SECRET_KEY` (clé **test** `sk_test_…`), `STRIPE_WEBHOOK_SECRET` (donné par `stripe listen`), `STRIPE_PRICE_ID` (prix test 29 €/mois créé au dashboard), `STRIPE_PORTAL_RETURN_URL=http://localhost:3000/settings`.

---

## Structure des fichiers

**Créés :**
- `vitest.config.ts` — config de test
- `server/services/access.ts` — règle d'accès pure + mapping statut Stripe
- `server/services/access.test.ts` — tests unitaires
- `server/services/stripe.ts` — client Stripe + helpers
- `server/services/billing.ts` — logique métier (sync, redeem)
- `server/services/billing.test.ts` — tests unitaires (validation redeem)
- `server/middleware/require-subscription.ts` — middleware de gating
- `server/scripts/set-owner-role.ts` — passe un email en `role='owner'`
- `client/src/pages/paywall.tsx` — écran d'abonnement
- `client/src/pages/welcome.tsx` — page de retour Checkout (poll d'activation)

**Modifiés :**
- `package.json` — deps `stripe`, `vitest` + scripts `test`
- `shared/schema.ts` — champ `role`, tables `subscriptions`, `access_codes`, `access_code_redemptions`, `processed_stripe_events`
- `server/storage.ts` — méthodes subscription / access-code / role
- `server/index.ts` — montage corps brut webhook avant `express.json()`
- `server/routes.ts` — routes `/api/billing/*`, `/api/stripe/webhook`, admin codes, extension `/api/auth/user`, application du middleware
- `client/src/hooks/useAuth.ts` — exposer `access`
- `client/src/App.tsx` — gating paywall + routes `/welcome`
- `client/src/pages/landing.tsx` — CTA abonnement
- `client/src/pages/settings.tsx` — bouton « Gérer mon abonnement »

---

## Task 1: Dépendances & harnais de test

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Installer les dépendances**

```bash
cd /Users/jeannemejean/Desktop/Naya-Build/NayaVision-29
npm install stripe
npm install -D vitest
```

- [ ] **Step 2: Ajouter les scripts de test à `package.json`**

Dans `"scripts"`, ajouter :
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Créer `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
```

- [ ] **Step 4: Vérifier que le runner démarre**

Run: `npx vitest run`
Expected: « No test files found » (aucun test encore) — exit 0, pas d'erreur de config.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: ajout stripe + vitest"
```

---

## Task 2: Schéma de données

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Ajouter le champ `role` à la table `users`**

Dans `export const users = pgTable("users", { ... })`, ajouter après `emailVerified` :
```ts
  role: text("role").notNull().default("user"), // 'user' | 'owner' | 'comped'
```
(Si `text` n'est pas déjà importé en haut du fichier, l'ajouter à l'import `drizzle-orm/pg-core`.)

- [ ] **Step 2: Ajouter les nouvelles tables (à la fin de la section tables)**

```ts
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status"), // trialing|active|past_due|canceled|incomplete|unpaid
  priceId: text("price_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  trialEndsAt: timestamp("trial_ends_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const accessCodes = pgTable("access_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label"),
  maxRedemptions: integer("max_redemptions"), // null = illimité
  redemptionCount: integer("redemption_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accessCodeRedemptions = pgTable("access_code_redemptions", {
  id: serial("id").primaryKey(),
  codeId: integer("code_id").notNull().references(() => accessCodes.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  redeemedAt: timestamp("redeemed_at").defaultNow(),
}, (t) => ({
  uniqueCodeUser: unique().on(t.codeId, t.userId),
}));

export const processedStripeEvents = pgTable("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: timestamp("processed_at").defaultNow(),
});
```
(Vérifier que `serial`, `integer`, `unique` sont importés depuis `drizzle-orm/pg-core` ; les ajouter à l'import si nécessaire.)

- [ ] **Step 3: Ajouter les types & insert schemas (section types en bas du fichier)**

```ts
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;
export type AccessCode = typeof accessCodes.$inferSelect;
export type InsertAccessCode = typeof accessCodes.$inferInsert;
```

- [ ] **Step 4: Appliquer le schéma sur la branche Neon de dev**

Run: `npm run db:push`
Expected: `[✓] Changes applied` (tables créées, colonne `role` ajoutée).

- [ ] **Step 5: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(db): schema abonnement, codes d'accès, role, idempotence webhooks"
```

---

## Task 3: Règle d'accès (logique pure + tests)

**Files:**
- Create: `server/services/access.ts`
- Test: `server/services/access.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// server/services/access.test.ts
import { describe, it, expect } from "vitest";
import { hasNayaAccess } from "./access";

const now = new Date("2026-06-17T12:00:00Z");
const future = new Date("2026-07-17T12:00:00Z");
const past = new Date("2026-06-10T12:00:00Z");

describe("hasNayaAccess", () => {
  it("owner a toujours accès, sans abonnement", () => {
    expect(hasNayaAccess({ role: "owner" }, null, now)).toBe(true);
  });
  it("comped a toujours accès", () => {
    expect(hasNayaAccess({ role: "comped" }, null, now)).toBe(true);
  });
  it("user sans abonnement = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, null, now)).toBe(false);
  });
  it("statut trialing = accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "trialing", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("statut active = accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "active", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("past_due avant fin de période = accès (tolérance)", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "past_due", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("past_due après fin de période = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "past_due", currentPeriodEnd: past }, now)).toBe(false);
  });
  it("canceled = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "canceled", currentPeriodEnd: future }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run server/services/access.test.ts`
Expected: FAIL (`hasNayaAccess` introuvable).

- [ ] **Step 3: Implémenter `access.ts`**

```ts
// server/services/access.ts

export type AccessUser = { role: string | null };
export type AccessSubscription = {
  status: string | null;
  currentPeriodEnd: Date | null;
} | null;

const ACTIVE_STATUSES = new Set(["trialing", "active"]);

/** Règle d'accès unique. owner/comped passent toujours ; sinon abonnement actif (avec tolérance past_due). */
export function hasNayaAccess(
  user: AccessUser,
  sub: AccessSubscription,
  now: Date = new Date(),
): boolean {
  if (user.role === "owner" || user.role === "comped") return true;
  if (!sub || !sub.status) return false;
  if (ACTIVE_STATUSES.has(sub.status)) return true;
  if (sub.status === "past_due" && sub.currentPeriodEnd && now < sub.currentPeriodEnd) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run server/services/access.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/access.ts server/services/access.test.ts
git commit -m "feat(billing): règle d'accès hasNayaAccess + tests"
```

---

## Task 4: Méthodes storage

**Files:**
- Modify: `server/storage.ts`

- [ ] **Step 1: Importer les nouvelles tables/types**

En haut de `server/storage.ts`, ajouter aux imports `@shared/schema` : `subscriptions`, `accessCodes`, `accessCodeRedemptions`, `processedStripeEvents`, et les types `Subscription`, `InsertSubscription`, `AccessCode`.

- [ ] **Step 2: Déclarer les méthodes dans `interface IStorage`**

```ts
  getSubscription(userId: string): Promise<Subscription | undefined>;
  upsertSubscription(sub: InsertSubscription): Promise<Subscription>;
  setUserRole(userId: string, role: string): Promise<void>;
  setUserRoleByEmail(email: string, role: string): Promise<boolean>;
  getAccessCodeByCode(code: string): Promise<AccessCode | undefined>;
  createAccessCode(input: { code: string; label?: string; maxRedemptions?: number | null; expiresAt?: Date | null }): Promise<AccessCode>;
  hasRedeemed(codeId: number, userId: string): Promise<boolean>;
  recordRedemption(codeId: number, userId: string): Promise<void>;
  isStripeEventProcessed(eventId: string): Promise<boolean>;
  markStripeEventProcessed(eventId: string): Promise<void>;
```

- [ ] **Step 3: Implémenter dans `class DatabaseStorage`**

```ts
  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return s;
  }

  async upsertSubscription(sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(sub.userId);
    if (existing) {
      const [updated] = await db.update(subscriptions)
        .set({ ...sub, updatedAt: new Date() })
        .where(eq(subscriptions.userId, sub.userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(subscriptions).values(sub).returning();
    return created;
  }

  async setUserRole(userId: string, role: string): Promise<void> {
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async setUserRoleByEmail(email: string, role: string): Promise<boolean> {
    const res = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.email, email));
    return (res.rowCount ?? 0) > 0;
  }

  async getAccessCodeByCode(code: string): Promise<AccessCode | undefined> {
    const [c] = await db.select().from(accessCodes).where(eq(accessCodes.code, code));
    return c;
  }

  async createAccessCode(input: { code: string; label?: string; maxRedemptions?: number | null; expiresAt?: Date | null }): Promise<AccessCode> {
    const [c] = await db.insert(accessCodes).values({
      code: input.code,
      label: input.label ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
    }).returning();
    return c;
  }

  async hasRedeemed(codeId: number, userId: string): Promise<boolean> {
    const [r] = await db.select().from(accessCodeRedemptions)
      .where(and(eq(accessCodeRedemptions.codeId, codeId), eq(accessCodeRedemptions.userId, userId)));
    return !!r;
  }

  async recordRedemption(codeId: number, userId: string): Promise<void> {
    await db.insert(accessCodeRedemptions).values({ codeId, userId });
    await db.update(accessCodes)
      .set({ redemptionCount: sql`${accessCodes.redemptionCount} + 1` })
      .where(eq(accessCodes.id, codeId));
  }

  async isStripeEventProcessed(eventId: string): Promise<boolean> {
    const [e] = await db.select().from(processedStripeEvents).where(eq(processedStripeEvents.eventId, eventId));
    return !!e;
  }

  async markStripeEventProcessed(eventId: string): Promise<void> {
    await db.insert(processedStripeEvents).values({ eventId }).onConflictDoNothing();
  }
```
(Ajouter `sql` à l'import `drizzle-orm` en haut du fichier s'il n'y est pas.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts
git commit -m "feat(storage): subscriptions, access codes, role, idempotence webhooks"
```

---

## Task 5: Client Stripe

**Files:**
- Create: `server/services/stripe.ts`

- [ ] **Step 1: Implémenter le client + helpers**

```ts
// server/services/stripe.ts
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[Stripe] STRIPE_SECRET_KEY absente — les routes billing échoueront.");
}

// Pas d'apiVersion explicite : la version est figée par la version du package `stripe`
// (lockfile). Les montées de version sont donc volontaires (bump de dépendance).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export async function getOrCreateCustomer(params: {
  existingCustomerId?: string | null;
  email: string;
  userId: string;
}): Promise<string> {
  if (params.existingCustomerId) return params.existingCustomerId;
  const customer = await stripe.customers.create({
    email: params.email,
    metadata: { nayaUserId: params.userId },
  });
  return customer.id;
}

export async function createCheckoutSession(params: {
  customerId: string;
  userId: string;
}): Promise<string> {
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: params.customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      automatic_tax: { enabled: true },
      customer_update: { address: "auto" },
      success_url: `${APP_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/paywall?canceled=1`,
      metadata: { nayaUserId: params.userId },
    },
    { idempotencyKey: `checkout-${params.userId}-${process.env.STRIPE_PRICE_ID}` },
  );
  return session.url!;
}

export async function createPortalSession(customerId: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: process.env.STRIPE_PORTAL_RETURN_URL || `${APP_URL}/settings`,
  });
  return session.url;
}

export async function fetchSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add server/services/stripe.ts
git commit -m "feat(billing): client Stripe + helpers checkout/portal"
```

---

## Task 6: Service billing (sync + redeem)

**Files:**
- Create: `server/services/billing.ts`
- Test: `server/services/billing.test.ts`

- [ ] **Step 1: Écrire les tests de validation de redeem (logique pure)**

```ts
// server/services/billing.test.ts
import { describe, it, expect } from "vitest";
import { validateAccessCode } from "./billing";

const now = new Date("2026-06-17T12:00:00Z");
const base = { id: 1, code: "BETA", label: null, redemptionCount: 0, maxRedemptions: null as number | null, expiresAt: null as Date | null, isActive: true, createdAt: now };

describe("validateAccessCode", () => {
  it("code valide", () => {
    expect(validateAccessCode(base, false, now)).toEqual({ ok: true });
  });
  it("code inexistant", () => {
    expect(validateAccessCode(undefined, false, now)).toEqual({ ok: false, reason: "invalid" });
  });
  it("code inactif", () => {
    expect(validateAccessCode({ ...base, isActive: false }, false, now)).toEqual({ ok: false, reason: "inactive" });
  });
  it("code expiré", () => {
    expect(validateAccessCode({ ...base, expiresAt: new Date("2026-06-10T00:00:00Z") }, false, now)).toEqual({ ok: false, reason: "expired" });
  });
  it("quota atteint", () => {
    expect(validateAccessCode({ ...base, maxRedemptions: 5, redemptionCount: 5 }, false, now)).toEqual({ ok: false, reason: "exhausted" });
  });
  it("déjà utilisé par ce user", () => {
    expect(validateAccessCode(base, true, now)).toEqual({ ok: false, reason: "already_redeemed" });
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run server/services/billing.test.ts`
Expected: FAIL (`validateAccessCode` introuvable).

- [ ] **Step 3: Implémenter `billing.ts`**

```ts
// server/services/billing.ts
import type Stripe from "stripe";
import { storage } from "../storage";
import type { AccessCode, InsertSubscription } from "@shared/schema";

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "inactive" | "expired" | "exhausted" | "already_redeemed" };

/** Validation pure d'un code d'accès (testable sans DB). */
export function validateAccessCode(
  code: AccessCode | undefined,
  alreadyRedeemed: boolean,
  now: Date = new Date(),
): ValidateResult {
  if (!code) return { ok: false, reason: "invalid" };
  if (!code.isActive) return { ok: false, reason: "inactive" };
  if (code.expiresAt && now >= code.expiresAt) return { ok: false, reason: "expired" };
  if (code.maxRedemptions != null && code.redemptionCount >= code.maxRedemptions) {
    return { ok: false, reason: "exhausted" };
  }
  if (alreadyRedeemed) return { ok: false, reason: "already_redeemed" };
  return { ok: true };
}

/** Redeem complet (DB). Passe le user en 'comped' si le code est valide. */
export async function redeemAccessCode(userId: string, rawCode: string): Promise<ValidateResult> {
  const code = await storage.getAccessCodeByCode(rawCode.trim());
  const already = code ? await storage.hasRedeemed(code.id, userId) : false;
  const result = validateAccessCode(code, already);
  if (!result.ok) return result;
  await storage.recordRedemption(code!.id, userId);
  await storage.setUserRole(userId, "comped");
  return { ok: true };
}

/** Convertit un objet abonnement Stripe en ligne `subscriptions` et l'upsert. */
export async function syncSubscriptionFromStripe(userId: string, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  // current_period_end est au niveau de la subscription dans les anciennes versions d'API
  // et au niveau de l'item dans les récentes — on lit les deux pour être robuste.
  const periodEndSec: number | undefined =
    (item as any)?.current_period_end ?? (sub as any).current_period_end;
  const data: InsertSubscription = {
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: periodEndSec ? new Date(periodEndSec * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  };
  await storage.upsertSubscription(data);
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run server/services/billing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/billing.ts server/services/billing.test.ts
git commit -m "feat(billing): sync abonnement Stripe + redeem code (validation testée)"
```

---

## Task 7: Webhook Stripe (corps brut + idempotence)

**Files:**
- Modify: `server/index.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Monter le corps brut AVANT `express.json()`**

Dans `server/index.ts`, juste avant la ligne `app.use(express.json());` (ligne ~20), ajouter :
```ts
// Stripe exige le corps brut pour vérifier la signature du webhook.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
```

- [ ] **Step 2: Ajouter la route webhook dans `registerRoutes` (server/routes.ts)**

Placer ce bloc tôt dans `registerRoutes` (avant les routes authentifiées), après les imports déjà présents. Ajouter en haut du fichier : `import { stripe } from "./services/stripe";` et `import { syncSubscriptionFromStripe } from "./services/billing";`.
```ts
  // ─── Stripe webhook (corps brut monté dans index.ts) ───────────────────────
  app.post("/api/stripe/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
      console.error("[Stripe] signature webhook invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotence : on ignore un event déjà traité.
    if (await storage.isStripeEventProcessed(event.id)) return res.json({ received: true });

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as any;
          const userId = session.metadata?.nayaUserId;
          if (userId && session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            await syncSubscriptionFromStripe(userId, sub);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as any;
          // Résolution du userId : metadata de la subscription, sinon metadata du customer.
          let resolvedUserId = sub.metadata?.nayaUserId as string | undefined;
          if (!resolvedUserId) {
            const customer = await stripe.customers.retrieve(sub.customer as string) as any;
            resolvedUserId = customer?.metadata?.nayaUserId;
          }
          if (resolvedUserId) await syncSubscriptionFromStripe(resolvedUserId, sub);
          break;
        }
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription as string) as any;
            let resolvedUserId = sub.metadata?.nayaUserId as string | undefined;
            if (!resolvedUserId) {
              const customer = await stripe.customers.retrieve(sub.customer as string) as any;
              resolvedUserId = customer?.metadata?.nayaUserId;
            }
            if (resolvedUserId) await syncSubscriptionFromStripe(resolvedUserId, sub);
          }
          break;
        }
      }
      await storage.markStripeEventProcessed(event.id);
      res.json({ received: true });
    } catch (err: any) {
      console.error("[Stripe] erreur traitement webhook:", err.message);
      res.status(500).json({ error: "webhook_handler_failed" });
    }
  });
```
- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts server/routes.ts
git commit -m "feat(billing): webhook Stripe signé + idempotent"
```

---

## Task 8: Routes billing + extension /api/auth/user

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Ajouter les helpers d'import en haut de routes.ts**

```ts
import { getOrCreateCustomer, createCheckoutSession, createPortalSession } from "./services/stripe";
import { redeemAccessCode } from "./services/billing";
import { hasNayaAccess } from "./services/access";
```

- [ ] **Step 2: `POST /api/billing/checkout` (authentifié)**

```ts
  app.post("/api/billing/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const existing = await storage.getSubscription(user.id);
      const customerId = await getOrCreateCustomer({
        existingCustomerId: existing?.stripeCustomerId,
        email: user.email,
        userId: user.id,
      });
      if (!existing?.stripeCustomerId) {
        await storage.upsertSubscription({ userId: user.id, stripeCustomerId: customerId });
      }
      const url = await createCheckoutSession({ customerId, userId: user.id });
      res.json({ url });
    } catch (err: any) {
      console.error("[Billing] checkout error:", err.message);
      res.status(500).json({ message: "checkout_failed" });
    }
  });
```

- [ ] **Step 3: `GET /api/billing/sync` (synchro immédiate au retour de Checkout)**

```ts
  app.get("/api/billing/sync", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await storage.getSubscription(req.userId);
      if (sub?.stripeSubscriptionId) {
        const fresh = await (await import("./services/stripe")).fetchSubscription(sub.stripeSubscriptionId);
        await (await import("./services/billing")).syncSubscriptionFromStripe(req.userId, fresh);
      } else if (sub?.stripeCustomerId) {
        // Abonnement pas encore lié localement : on cherche côté Stripe via le customer.
        const { stripe } = await import("./services/stripe");
        const list = await stripe.subscriptions.list({ customer: sub.stripeCustomerId, limit: 1 });
        if (list.data[0]) await (await import("./services/billing")).syncSubscriptionFromStripe(req.userId, list.data[0]);
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Billing] sync error:", err.message);
      res.status(500).json({ message: "sync_failed" });
    }
  });
```

- [ ] **Step 4: `POST /api/billing/portal`**

```ts
  app.post("/api/billing/portal", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await storage.getSubscription(req.userId);
      if (!sub?.stripeCustomerId) return res.status(400).json({ message: "no_customer" });
      const url = await createPortalSession(sub.stripeCustomerId);
      res.json({ url });
    } catch (err: any) {
      console.error("[Billing] portal error:", err.message);
      res.status(500).json({ message: "portal_failed" });
    }
  });
```

- [ ] **Step 5: `POST /api/billing/redeem-code`**

```ts
  app.post("/api/billing/redeem-code", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") return res.status(400).json({ message: "code_required" });
      const result = await redeemAccessCode(req.userId, code);
      if (!result.ok) return res.status(400).json({ message: result.reason });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Billing] redeem error:", err.message);
      res.status(500).json({ message: "redeem_failed" });
    }
  });
```

- [ ] **Step 6: Étendre `GET /api/auth/user` avec l'accès**

Remplacer le corps du handler existant (`server/routes.ts:849`) par :
```ts
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const sub = await storage.getSubscription(userId);
      const allowed = hasNayaAccess(user, sub ?? null);
      const { hashedPassword, ...userWithoutPassword } = user;
      res.json({
        ...userWithoutPassword,
        access: {
          allowed,
          status: sub?.status ?? null,
          trialEndsAt: sub?.trialEndsAt ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        },
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
```

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 erreur.
```bash
git add server/routes.ts
git commit -m "feat(billing): routes checkout/sync/portal/redeem + access dans /api/auth/user"
```

---

## Task 9: Middleware de gating + application

**Files:**
- Create: `server/middleware/require-subscription.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Créer le middleware**

```ts
// server/middleware/require-subscription.ts
import { storage } from "../storage";
import { hasNayaAccess } from "../services/access";

export async function requireActiveSubscription(req: any, res: any, next: any) {
  try {
    const user = await storage.getUser(req.userId);
    if (!user) return res.status(401).json({ message: "unauthenticated" });
    const sub = await storage.getSubscription(req.userId);
    if (!hasNayaAccess(user, sub ?? null)) {
      return res.status(402).json({ message: "subscription_required" });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ message: "subscription_check_failed" });
  }
}
```

- [ ] **Step 2: Appliquer aux routes de données métier**

Importer en haut de routes.ts : `import { requireActiveSubscription } from "./middleware/require-subscription";`

Appliquer le middleware **après** `isAuthenticated` sur les routes de données métier (ex. `/api/brand-dna`, `/api/projects`, `/api/tasks`, `/api/content`, `/api/planning`, `/api/campaigns`, `/api/analytics`, `/api/companion/chat`). NE PAS l'appliquer sur : `/api/auth/*`, `/api/billing/*`, `/api/stripe/webhook`, `/api/meta/*`, `/api/waitlist`, `/api/health`.

Exemple sur une route :
```ts
  app.get('/api/brand-dna', isAuthenticated, requireActiveSubscription, async (req: any, res) => {
```

- [ ] **Step 3: Typecheck + démarrage de contrôle**

Run: `npx tsc --noEmit` → 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add server/middleware/require-subscription.ts server/routes.ts
git commit -m "feat(billing): middleware requireActiveSubscription sur les routes métier"
```

---

## Task 10: Admin codes d'accès (owner only)

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Endpoint de création de code (réservé owner)**

```ts
  app.post("/api/admin/access-codes", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.userId);
      if (user?.role !== "owner") return res.status(403).json({ message: "forbidden" });
      const { code, label, maxRedemptions, expiresAt } = req.body;
      if (!code || typeof code !== "string") return res.status(400).json({ message: "code_required" });
      const created = await storage.createAccessCode({
        code: code.trim(),
        label,
        maxRedemptions: maxRedemptions ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      res.json(created);
    } catch (err: any) {
      console.error("[Admin] create code error:", err.message);
      res.status(500).json({ message: "create_code_failed" });
    }
  });
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 erreur.
```bash
git add server/routes.ts
git commit -m "feat(billing): endpoint owner de création de codes d'accès"
```

---

## Task 11: Frontend — accès, paywall, retour checkout

**Files:**
- Modify: `client/src/hooks/useAuth.ts`
- Modify: `client/src/App.tsx`
- Create: `client/src/pages/paywall.tsx`
- Create: `client/src/pages/welcome.tsx`
- Modify: `client/src/pages/settings.tsx`
- Modify: `client/src/pages/landing.tsx`

- [ ] **Step 1: Étendre `useAuth` pour exposer `access`**

Remplacer le contenu de `client/src/hooks/useAuth.ts` par :
```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

type AuthUser = User & {
  access?: { allowed: boolean; status: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean };
};

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  async function logout() {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (_) {}
    queryClient.clear();
    window.location.href = "/";
  }

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    hasAccess: !!user?.access?.allowed,
    logout,
  };
}
```

- [ ] **Step 2: Créer la page paywall**

```tsx
// client/src/pages/paywall.tsx
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

export default function Paywall() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function subscribe() {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/checkout");
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setError("Impossible de démarrer l'abonnement.");
      setLoading(false);
    }
  }

  async function redeem() {
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/billing/redeem-code", { code });
      if (!res.ok) { setError("Code invalide ou déjà utilisé."); return; }
      await qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
    } catch {
      setError("Code invalide ou déjà utilisé.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center naya-paper px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="font-display uppercase text-naya-olive mb-3" style={{ fontSize: "1.8rem", letterSpacing: "0.06em" }}>
          Accède à Naya
        </h1>
        <p className="text-naya-olive-70 mb-8">29 €/mois · 7 jours d'essai gratuit, sans engagement.</p>
        <button onClick={subscribe} disabled={loading}
          className="w-full rounded-lg bg-naya-olive text-naya-cream py-3 font-medium mb-6">
          {loading ? "…" : "Commencer l'essai gratuit"}
        </button>
        <div className="flex items-center gap-2">
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code d'accès (testeurs)"
            className="flex-1 rounded-md border border-naya-olive-18 bg-background px-3 py-2 text-sm" />
          <button onClick={redeem} className="rounded-md border border-naya-olive-18 px-3 py-2 text-sm">Valider</button>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Créer la page de retour Checkout (poll d'activation)**

```tsx
// client/src/pages/welcome.tsx
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

export default function Welcome() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("Activation de ton abonnement…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await apiRequest("GET", "/api/billing/sync"); } catch {}
      for (let i = 0; i < 10 && !cancelled; i++) {
        const res = await apiRequest("GET", "/api/auth/user");
        const user = await res.json();
        if (user?.access?.allowed) {
          await qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
          window.location.href = "/";
          return;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      if (!cancelled) setMsg("Ça prend un peu plus longtemps que prévu. Recharge la page dans un instant.");
    })();
    return () => { cancelled = true; };
  }, [qc]);

  return (
    <div className="min-h-screen flex items-center justify-center naya-paper px-6">
      <p className="text-naya-olive-70">{msg}</p>
    </div>
  );
}
```

- [ ] **Step 4: Câbler le gating dans `App.tsx`**

Ajouter les imports :
```tsx
import Paywall from "@/pages/paywall";
import Welcome from "@/pages/welcome";
```
Récupérer `hasAccess` : `const { isAuthenticated, isLoading, hasAccess } = useAuth();`

Dans le `<Switch>`, le bloc authentifié devient conditionné par l'accès. Remplacer la structure existante par :
```tsx
            {isLoading || !isAuthenticated ? (
              <Route path="/" component={Landing} />
            ) : !hasAccess ? (
              <>
                <Route path="/welcome" component={Welcome} />
                <Route component={Paywall} />
              </>
            ) : (
              <>
                {/* ... routes existantes du dashboard inchangées ... */}
              </>
            )}
            <Route path="/privacy" component={Privacy} />
            <Route path="/data-deletion" component={DataDeletion} />
            <Route component={NotFound} />
```
(Conserver à l'identique les routes existantes dans la branche « accès OK ». La route `/welcome` est aussi disponible sans accès pour gérer le retour de Checkout.)

- [ ] **Step 5: Bouton « Gérer mon abonnement » dans Réglages**

Dans `client/src/pages/settings.tsx`, ajouter une section avec ce bouton :
```tsx
<button
  onClick={async () => {
    const res = await fetch("/api/billing/portal", { method: "POST", credentials: "include" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }}
  className="rounded-md border border-naya-olive-18 px-4 py-2 text-sm"
>
  Gérer mon abonnement
</button>
```

- [ ] **Step 6: CTA abonnement sur la landing**

Dans `client/src/pages/landing.tsx`, remplacer (ou doubler) le CTA waitlist par un bouton qui mène à l'inscription puis au checkout. Le plus simple : un lien vers la page d'inscription existante (ou un bouton « Commencer l'essai gratuit » → `/register` si la route existe, sinon vers le formulaire d'inscription). Texte : « Commencer — 7 jours gratuits, puis 29 €/mois ».

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 erreur.
```bash
git add client/src/hooks/useAuth.ts client/src/App.tsx client/src/pages/paywall.tsx client/src/pages/welcome.tsx client/src/pages/settings.tsx client/src/pages/landing.tsx
git commit -m "feat(billing): gating front, paywall, retour checkout, portail, CTA landing"
```

---

## Task 12: Sortie waitlist + migration owner

**Files:**
- Create: `server/scripts/set-owner-role.ts`
- Modify: `.env` (dev), variables Railway (prod, étape guidée)

- [ ] **Step 1: Script de passage en owner**

```ts
// server/scripts/set-owner-role.ts
import "dotenv/config";
import { storage } from "../storage";

const email = process.argv[2];
if (!email) { console.error("Usage: tsx server/scripts/set-owner-role.ts <email>"); process.exit(1); }

(async () => {
  const ok = await storage.setUserRoleByEmail(email, "owner");
  console.log(ok ? `✓ ${email} est maintenant owner` : `✗ aucun user avec l'email ${email}`);
  process.exit(0);
})();
```

- [ ] **Step 2: Exécuter sur la branche dev (remplacer par l'email réel du compte Naya de Jeanne)**

Run: `NODE_ENV=development npx tsx server/scripts/set-owner-role.ts <EMAIL_JEANNE>`
Expected: `✓ <EMAIL_JEANNE> est maintenant owner`

- [ ] **Step 3: Désactiver le waitlist en dev**

Dans `.env` : passer `WAITLIST_MODE=false` et `VITE_WAITLIST_MODE=false`.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/set-owner-role.ts
git commit -m "feat(billing): script set-owner-role + sortie waitlist (dev)"
```

---

## Task 13: Vérification d'intégration (Stripe test mode + dev branch)

**Files:** aucun (vérification manuelle)

> Prérequis : produit/prix 29 €/mois créés en **mode test** Stripe ; Customer Portal activé en test ; `STRIPE_PRICE_ID` test dans `.env`.

- [ ] **Step 1: Lancer le serveur + le forward webhook**

```bash
npm run dev
# autre terminal :
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copier le whsec_… affiché dans .env -> STRIPE_WEBHOOK_SECRET, puis relancer npm run dev
```

- [ ] **Step 2: Parcours d'abonnement complet**

S'inscrire avec un nouveau compte → cliquer « Commencer l'essai gratuit » → payer avec la carte test `4242 4242 4242 4242` (date future, CVC quelconque) → retour `/welcome` → accès au dashboard.
Vérifier en DB (via tsx ou Neon) : `subscriptions.status = 'trialing'`.

- [ ] **Step 3: Échec de paiement / fin d'essai (Test Clock)**

Créer un Test Clock dans Stripe, avancer de 7 jours, observer `customer.subscription.updated`/`invoice.payment_failed` ; vérifier le passage `past_due` puis la coupure d'accès après `currentPeriodEnd`.

- [ ] **Step 4: Annulation via portail**

Réglages → « Gérer mon abonnement » → annuler → vérifier `cancelAtPeriodEnd = true`, accès maintenu jusqu'à `currentPeriodEnd`.

- [ ] **Step 5: Code d'accès testeur**

Créer un code (endpoint owner) → nouveau compte → paywall → saisir le code → `role='comped'` → accès. Re-saisir le même code → refus `already_redeemed`.

- [ ] **Step 6: Idempotence webhook**

`stripe events resend <evt_id>` → vérifier qu'aucune double écriture n'a lieu (ligne `processed_stripe_events` présente).

- [ ] **Step 7: Owner bypass**

Le compte owner accède au dashboard sans abonnement.

---

## Rollout prod (étape guidée, hors plan automatique)

Après validation complète en dev :
1. Stripe **mode live** : créer produit/prix 29 €/mois, activer Stripe Tax + factures, activer Customer Portal, créer l'endpoint webhook `https://www.hellonaya.app/api/stripe/webhook`.
2. Variables Railway : `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live), `STRIPE_PRICE_ID` (live), `STRIPE_PORTAL_RETURN_URL=https://www.hellonaya.app/settings`.
3. `db:push` prod (ou ALTER ciblés) pour les nouvelles tables + colonne `role`.
4. Merge la PR → déploiement.
5. `railway run npx tsx server/scripts/set-owner-role.ts <EMAIL_JEANNE>` (passe ton compte en owner).
6. Passer `WAITLIST_MODE`/`VITE_WAITLIST_MODE` à `false` sur Railway.
7. Smoke test live (1 abonnement réel ou code test) puis communication.
