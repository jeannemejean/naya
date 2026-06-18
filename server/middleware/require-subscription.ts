import { storage } from "../storage";
import { hasNayaAccess } from "../services/access";

/** Bloque l'accès aux routes métier si l'utilisateur n'a pas d'accès Naya actif. */
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
