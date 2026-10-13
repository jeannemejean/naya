/** Prévient l'utilisatrice d'un passage de routine notable, via les messages du compagnon. */
import { storage } from "../../storage";

export async function notifierRoutine(userId: string, message: string, lien?: string): Promise<void> {
  await (storage as any).createPendingMessage({ userId, message, triggerType: "routine", lien: lien ?? null });
}
