/** Prévient l'utilisatrice d'un passage de routine notable, via les messages du compagnon. */
import { storage } from "../../storage";

export async function notifierRoutine(userId: string, message: string): Promise<void> {
  await (storage as any).createPendingMessage({ userId, message, triggerType: "routine" });
}
