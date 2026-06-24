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
