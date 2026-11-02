// Mise en pause persistante d'un compte LinkedIn après un signal de restriction Unipile.
// Seul chemin d'écriture : le worker d'envoi (prospection-sender.ts) et l'envoi d'une
// réponse depuis la boîte « Réponses » (reponses/envoi-reponse.ts). La pause vit là où vit
// le compte : chez l'utilisatrice (portee null) ou dans la connexion du projet client.
// Lève en cas d'échec : l'appelant décide quoi journaliser.
import { storage } from "../storage";

export async function persisterRestrictionLinkedIn(
  userId: string, portee: number | null, error: string | null | undefined, at: Date = new Date(),
): Promise<void> {
  const pause = { linkedinRestrictedAt: at, linkedinRestrictedReason: error ?? null };
  if (portee == null) await storage.updateUserPreferences(userId, pause as any);
  else await storage.upsertConnexionProjet(userId, portee, pause);
}
