/**
 * Poller Unipile — acceptation d'invitation LinkedIn.
 *
 * SÉCURITÉ : ce poller ne fait QUE lire l'état de connexion Unipile et écrire un timestamp
 * (`leads.linkedinConnectedAt`). Il n'envoie jamais rien. Ce timestamp est le signal utilisé
 * par le moteur de décision pour les branches `if_invite_accepted` / `if_invite_not_accepted`
 * (Task 7 du plan Outreach).
 *
 * Résilience : toute erreur Unipile est avalée par lead (try/catch) — le lead sera retenté au
 * prochain tick (toutes les 15 min). La boucle ne doit jamais lever d'exception.
 */
import { storage } from "../storage";
import { linkedinConfigured, isConnected } from "./linkedin";

const SYNC_INTERVAL_MS = 15 * 60_000; // toutes les 15 minutes

/**
 * Parcourt les leads en attente d'acceptation d'invitation (enrôlés actifs, sans
 * `linkedinConnectedAt`) et stampe ceux désormais en relation 1er degré côté Unipile.
 * Renvoie le nombre de leads passés « connectés » lors de ce passage.
 */
export async function syncLinkedInConnections(): Promise<number> {
  if (!linkedinConfigured()) return 0;

  const waiting = await storage.getLeadsAwaitingInvite().catch(() => []);
  let updated = 0;

  for (const lead of waiting) {
    if (!lead.linkedinUrl) continue;
    try {
      const prefs = await storage.getUserPreferences(lead.userId);
      const accountId = (prefs as any)?.linkedinUnipileAccountId?.trim();
      if (!accountId) continue;

      if (await isConnected(accountId, lead.linkedinUrl)) {
        await storage.setLeadLinkedinConnected(lead.id, new Date());
        updated++;
      }
    } catch (e: any) {
      // On réessaiera au prochain tick — jamais throw hors de la boucle.
      console.error(`[LinkedInSync] lead ${lead.id}:`, e?.message || e);
    }
  }

  return updated;
}

/** Démarre le poller (toutes les 15 minutes). */
export function scheduleLinkedInSync(): void {
  console.log("[LinkedInSync] Worker démarré (chaque 15 min) — poll acceptation invitations LinkedIn");
  setInterval(() => {
    syncLinkedInConnections().catch((e) => console.error("[LinkedInSync]", e?.message || e));
  }, SYNC_INTERVAL_MS);
}
