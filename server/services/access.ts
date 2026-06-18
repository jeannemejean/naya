// Règle d'accès unique à Naya. Réutilisée côté serveur (middleware) et exposée au client.

export type AccessUser = { role: string | null };
export type AccessSubscription = {
  status: string | null;
  currentPeriodEnd: Date | null;
} | null;

const ACTIVE_STATUSES = new Set(["trialing", "active"]);

/**
 * owner/comped passent toujours ; sinon abonnement actif (trialing/active),
 * avec tolérance past_due jusqu'à la fin de la période courante.
 */
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
