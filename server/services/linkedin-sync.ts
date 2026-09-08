/**
 * Poller Unipile — acceptation d'invitation LinkedIn.
 *
 * SÉCURITÉ : ce poller ne fait QUE lire l'état de connexion Unipile et écrire un timestamp
 * (`leads.linkedinConnectedAt`). Il n'envoie jamais rien. Ce timestamp est le signal utilisé
 * par le moteur de décision pour les branches `if_invite_accepted` / `if_invite_not_accepted`
 * (Task 7 du plan Outreach).
 *
 * GARDE DE RISQUE (revue post-commit 261835e, Important 1) : « arrêt total » sur restriction
 * veut dire arrêt total, pas seulement à l'ENVOI — un compte restreint n'est plus interrogé
 * NON PLUS en lecture, et la fenêtre ouvrée (jours ouvrés + heures de bureau, fuseau de
 * l'utilisatrice) s'applique ici aussi : un compte humain ne consulte pas LinkedIn à 3h du
 * matin ou le week-end, pas plus en lecture qu'en écriture. Voir `shouldPollLinkedIn`.
 *
 * Résilience : toute erreur Unipile est avalée par lead (try/catch) — le lead sera retenté au
 * prochain tick (toutes les 15 min). La boucle ne doit jamais lever d'exception.
 */
import { storage } from "../storage";
import { linkedinConfigured, isConnected } from "./linkedin";
import { withinSendingWindow, hhmmToMin } from "./prospection-sender";
import { localWallClock } from "../utils/timezone";

const SYNC_INTERVAL_MS = 15 * 60_000; // toutes les 15 minutes

/**
 * Vrai si ce compte LinkedIn doit être interrogé MAINTENANT : compte connecté, non
 * restreint, dans sa fenêtre ouvrée (fuseau de l'utilisatrice). Pure & testable : `now`
 * entre par la signature, aucune horloge implicite. `prefs` absent (lecture échouée en
 * amont) → `false`, refus par prudence — même convention que le reste de ce chantier.
 */
export function shouldPollLinkedIn(prefs: any, now: Date): boolean {
  if (!prefs) return false;
  const accountId = prefs?.linkedinUnipileAccountId?.trim();
  if (!accountId) return false;
  if (prefs?.linkedinRestrictedAt) return false;

  const { minuteOfDay, dayAbbr } = localWallClock(prefs?.timezone || "UTC", now);
  const workDayStartMin = hhmmToMin(prefs?.workDayStart, 9 * 60);
  const workDayEndMin = hhmmToMin(prefs?.workDayEnd, 18 * 60);
  const workDays = new Set<string>(
    (prefs?.workDays || "mon,tue,wed,thu,fri").split(",").map((d: string) => d.trim().toLowerCase()),
  );
  return withinSendingWindow(minuteOfDay, dayAbbr, { startMin: workDayStartMin, endMin: workDayEndMin, workDays });
}

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
      if (!shouldPollLinkedIn(prefs, new Date())) continue;
      const accountId = (prefs as any).linkedinUnipileAccountId.trim();

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
