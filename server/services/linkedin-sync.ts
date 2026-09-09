/**
 * Poller Unipile — acceptation d'invitation LinkedIn.
 *
 * SÉCURITÉ : ce poller ne fait QUE lire l'état de connexion Unipile et écrire un timestamp
 * (`leads.linkedinConnectedAt`). Il n'envoie jamais rien. Ce timestamp est le signal utilisé
 * par le moteur de décision pour les branches `if_invite_accepted` / `if_invite_not_accepted`
 * (Task 7 du plan Outreach).
 *
 * GARDE DE RISQUE — DEUX RONDES DE REVUE :
 *  - post-commit 261835e (Important 1) : « arrêt total » sur restriction veut dire arrêt
 *    total, pas seulement à l'ENVOI — un compte restreint n'est plus interrogé NON PLUS en
 *    lecture.
 *  - post-commit f17af17 (Critique) : `getLeadsAwaitingInvite()` n'avait ni LIMIT ni plafond
 *    par compte, et aucun de ses appels (1 à 2 requêtes LinkedIn par lead, via
 *    `checkConnection`) n'entrait dans `linkedin_send_attempts`. Sur 100 leads en attente et
 *    une fenêtre de 9h, ça fait ~7200 consultations de profil par jour — deux ordres de
 *    grandeur au-dessus du plafond mature d'ENVOI (≤45 requêtes/jour), par un chemin que la
 *    garde ne voyait jamais.
 *
 * DÉCISION (justifiée en détail dans le rapport de tâche) : le poller tire dans le MÊME
 * budget que les envois — même table `linkedin_send_attempts`, même fonction pure
 * `decideLinkedInAction` (ramp-up, plafond hebdomadaire glissant, fenêtre ouvrée, délai
 * minimum, restriction), mêmes constantes de délai minimum
 * (`LINKEDIN_MIN_DELAY_BASE_MS`/`LINKEDIN_MIN_DELAY_JITTER_MS`, `prospection-sender.ts`).
 * Une seule surface de risque de restriction par compte LinkedIn ; un seul budget, pas deux
 * comptabilités indépendantes qui pourraient dériver l'une de l'autre — exactement le
 * défaut déjà corrigé côté envoi (compter les succès au lieu des tentatives). `LINKEDIN_SYNC_BATCH_LIMIT`
 * borne uniquement la taille du lot lu en base par passage (coût DB/boucle) : c'est la garde
 * partagée, pas cette limite, qui borne le nombre RÉEL de requêtes LinkedIn.
 *
 * Le poller respecte aussi le kill-switch global (`PROSPECTION_SENDING_ENABLED`, via
 * `masterSendingEnabled()`) : désactiver globalement la prospection arrête aussi la lecture,
 * pas seulement l'écriture.
 *
 * Résilience : toute erreur Unipile est avalée par lead (try/catch) — le lead sera retenté au
 * prochain tick (toutes les 15 min). La boucle ne doit jamais lever d'exception.
 */
import { storage } from "../storage";
import { linkedinConfigured, checkConnection } from "./linkedin";
import {
  decideLinkedInAction,
  isLinkedInRestrictionSignal,
  LINKEDIN_WEEKLY_WINDOW_MS,
} from "./prospection-linkedin-guard";
import {
  hhmmToMin,
  masterSendingEnabled,
  LINKEDIN_MIN_DELAY_BASE_MS,
  LINKEDIN_MIN_DELAY_JITTER_MS,
} from "./prospection-sender";

const SYNC_INTERVAL_MS = 15 * 60_000; // toutes les 15 minutes

// Borne la taille du LOT lu en base par passage (coût DB/boucle, pas le budget LinkedIn —
// voir la doc de tête). 200 est généreux : la garde partagée refusera bien avant ce volume
// dès qu'un compte a épuisé son budget du jour/de la semaine.
export const LINKEDIN_SYNC_BATCH_LIMIT = 200;

/**
 * Parcourt les leads en attente d'acceptation d'invitation (enrôlés actifs, sans
 * `linkedinConnectedAt`) et stampe ceux désormais en relation 1er degré côté Unipile.
 * Chaque vérification passe par la MÊME garde de risque que l'envoi, tirant dans le MÊME
 * budget (voir la doc de tête). Renvoie le nombre de leads passés « connectés ».
 */
export async function syncLinkedInConnections(): Promise<number> {
  if (!linkedinConfigured()) return 0;
  if (!masterSendingEnabled()) {
    console.log(
      "[LinkedInSync] DRY-RUN : prospection globalement désactivée (PROSPECTION_SENDING_ENABLED) — aucune consultation LinkedIn.",
    );
    return 0;
  }

  const waiting = await storage.getLeadsAwaitingInvite(LINKEDIN_SYNC_BATCH_LIMIT).catch(() => []);
  let updated = 0;

  const prefsCache = new Map<string, any>();
  const getPrefs = async (uid: string) => {
    if (!prefsCache.has(uid)) prefsCache.set(uid, await storage.getUserPreferences(uid));
    return prefsCache.get(uid);
  };
  // Historique PARTAGÉ avec l'envoi (même table, même fenêtre) — voir la doc de tête.
  const historyCache = new Map<string, Date[] | null>();
  // Même mécanisme que `prospection-sender.ts` (défaut Critique 1, post-commit f17af17) :
  // `prefsCache` fige le même objet pour tout le passage, donc persister une restriction
  // détectée par CE poller ne serait pas visible des leads suivants du même user sans ce Set.
  const restrictedThisPass = new Set<string>();

  for (const lead of waiting) {
    if (!lead.linkedinUrl) continue;
    try {
      const prefs = await getPrefs(lead.userId);
      const accountId = (prefs as any)?.linkedinUnipileAccountId?.trim();
      if (!accountId) continue;
      if (restrictedThisPass.has(lead.userId)) continue;

      const now = new Date();
      if (!historyCache.has(lead.userId)) {
        const since = new Date(now.getTime() - LINKEDIN_WEEKLY_WINDOW_MS);
        const ts = await storage.getLinkedInAttemptTimestampsSince(lead.userId, since).catch(() => null);
        historyCache.set(lead.userId, ts);
      }
      const accountConnectedAt = (prefs as any)?.linkedinAccountConnectedAt ? new Date((prefs as any).linkedinAccountConnectedAt) : null;
      const restriction = (prefs as any)?.linkedinRestrictedAt
        ? { restrictedAt: new Date((prefs as any).linkedinRestrictedAt), reason: (prefs as any)?.linkedinRestrictedReason ?? undefined }
        : null;
      const workDayStartMin = hhmmToMin((prefs as any)?.workDayStart, 9 * 60);
      const workDayEndMin = hhmmToMin((prefs as any)?.workDayEnd, 18 * 60);
      const workDays = new Set<string>(
        ((prefs as any)?.workDays || "mon,tue,wed,thu,fri").split(",").map((d: string) => d.trim().toLowerCase()),
      );

      const guardDecision = decideLinkedInAction({
        now,
        timezone: (prefs as any)?.timezone || "UTC",
        workDayStartMin, workDayEndMin, workDays,
        accountConnectedAt,
        recentSendTimestamps: historyCache.get(lead.userId)!,
        restriction,
        minDelayMs: LINKEDIN_MIN_DELAY_BASE_MS + Math.random() * LINKEDIN_MIN_DELAY_JITTER_MS,
      });
      if (!guardDecision.allowed) {
        console.log(
          `[LinkedInSync] lead ${lead.id} refusé par la garde de risque (${guardDecision.reason}) : ${guardDecision.detail}`,
        );
        continue;
      }

      const result = await checkConnection(accountId, lead.linkedinUrl);
      const attemptAt = new Date();
      try {
        await storage.recordLinkedInSendAttempt(lead.userId, lead.id, result.ok, result.ok ? null : result.error);
      } catch (e: any) {
        console.error(`[LinkedInSync] échec d'enregistrement de la tentative (lead ${lead.id}) : ${String(e?.message ?? e)}`);
      }
      const hist = historyCache.get(lead.userId);
      if (hist) hist.push(attemptAt);

      if (!result.ok) {
        if (isLinkedInRestrictionSignal(result.error)) {
          restrictedThisPass.add(lead.userId);
          try {
            await storage.updateUserPreferences(lead.userId, {
              linkedinRestrictedAt: new Date(),
              linkedinRestrictedReason: result.error,
            } as any);
            console.error(
              `[LinkedInSync] compte LinkedIn de l'utilisateur ${lead.userId} mis EN PAUSE (signal de restriction détecté au poll) — reprise manuelle requise.`,
            );
          } catch (e: any) {
            console.error(
              `[LinkedInSync] ÉCHEC DE PERSISTANCE de la restriction (user ${lead.userId}) — arrêt en mémoire actif pour ce passage : ${String(e?.message ?? e)}`,
            );
          }
        }
        continue;
      }

      if (result.connected) {
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
