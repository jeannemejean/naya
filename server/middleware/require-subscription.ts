import { storage } from "../storage";
import { hasNayaAccess } from "../services/access";
import { verifyJWT } from "../auth";

/**
 * Gate par route (à composer après isAuthenticated si besoin d'un contrôle ponctuel).
 * 402 si l'utilisateur n'a pas d'accès Naya actif.
 */
export async function requireActiveSubscription(req: any, res: any, next: any) {
  try {
    const user = req.user ?? (await storage.getUser(req.userId));
    if (!user) return res.status(401).json({ message: "unauthenticated" });
    const sub = await storage.getSubscription(user.id);
    if (!hasNayaAccess(user, sub ?? null)) {
      return res.status(402).json({ message: "subscription_required" });
    }
    next();
  } catch {
    res.status(500).json({ message: "subscription_check_failed" });
  }
}

// Préfixes /api qui NE nécessitent PAS d'abonnement actif (auth, paiement, webhooks, OAuth, public).
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/billing",
  "/api/stripe",
  "/api/sendgrid",
  "/api/meta",
  "/api/waitlist",
  "/api/health",
  "/api/admin",
  "/api/social/oauth",
  "/api/calendar/oauth",
  "/api/notifications/register",
];

function resolveUserId(req: any): string | undefined {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const payload = verifyJWT(auth.slice(7));
    if (payload) return payload.userId;
  }
  return undefined;
}

/**
 * Gate global monté sur toutes les requêtes (après le middleware de session).
 * - Routes hors /api ou dans l'allowlist → laisser passer.
 * - Non authentifié → laisser passer (la route renverra 401 via isAuthenticated).
 * - Authentifié sans accès → 402 subscription_required.
 */
export async function gateNayaAccess(req: any, res: any, next: any) {
  try {
    const path = req.path;
    if (!path.startsWith("/api/")) return next();
    if (PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p))) {
      return next();
    }
    const userId = resolveUserId(req);
    if (!userId) return next(); // l'auth de la route gérera le 401
    const user = await storage.getUser(userId);
    if (!user) return next();
    const sub = await storage.getSubscription(userId);
    if (!hasNayaAccess(user, sub ?? null)) {
      return res.status(402).json({ message: "subscription_required" });
    }
    next();
  } catch {
    next(); // en cas d'erreur du gate, ne pas bloquer l'app (la route reste protégée par isAuthenticated)
  }
}
