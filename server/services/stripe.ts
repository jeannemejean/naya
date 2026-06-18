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
  // Stripe Tax n'est activé que si le compte l'a configuré (sinon Checkout échoue).
  // Mettre STRIPE_TAX_ENABLED=true une fois la TVA configurée dans le dashboard.
  const taxEnabled = process.env.STRIPE_TAX_ENABLED === "true";
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: params.customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { nayaUserId: params.userId },
      },
      automatic_tax: { enabled: taxEnabled },
      ...(taxEnabled ? { customer_update: { address: "auto" as const } } : {}),
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
