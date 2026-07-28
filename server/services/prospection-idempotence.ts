/**
 * Garde d'idempotence des envois de séquence.
 *
 * Règle unique : on n'appelle JAMAIS un fournisseur (SendGrid, Unipile) sans avoir
 * d'abord obtenu la réservation de l'étape. `sendOnce` encapsule ce protocole pour
 * qu'aucun chemin d'envoi ne puisse l'oublier.
 *
 * Distinction volontaire entre les deux façons d'échouer :
 *  - le fournisseur répond en erreur → on SAIT que rien n'est parti → on libère, retry.
 *  - une exception est levée (réseau coupé, DB indisponible) → on ne sait PAS si le
 *    message est parti → on GARDE la réservation → il ne repartira jamais.
 *    C'est la décision produit « dans le doute, ne jamais renvoyer ».
 */

export interface StepSendKey {
  leadId: number;
  campaignId: number;
  stepOrder: number; // rang de l'étape (1 = première)
  userId: string;
  channel: "email" | "linkedin";
}

export interface ClaimStore {
  /** Insère la réservation. `true` si elle est obtenue, `false` si elle existe déjà. */
  claim(key: StepSendKey): Promise<boolean>;
  markSent(key: StepSendKey, status: "sent" | "draft"): Promise<void>;
  release(key: StepSendKey): Promise<void>;
}

/** L'envoi réel. `ok: false` = le fournisseur a refusé, rien n'est parti. */
export type SendAttempt = () => Promise<{ ok: boolean; status?: "sent" | "draft" }>;

export type GuardResult =
  | { action: "sent"; status: "sent" | "draft" }
  | { action: "skipped" } // déjà réservée : la séquence doit avancer sans envoyer
  | { action: "failed" }; // échec franc : ne pas avancer, retry au prochain tick

export async function sendOnce(
  store: ClaimStore,
  key: StepSendKey,
  attempt: SendAttempt,
): Promise<GuardResult> {
  const claimed = await store.claim(key);
  if (!claimed) return { action: "skipped" };

  // À partir d'ici la réservation est détenue : toute sortie doit la marquer ou la libérer,
  // SAUF sur exception (issue inconnue → on la garde volontairement).
  const outcome = await attempt();
  if (!outcome.ok) {
    await store.release(key);
    return { action: "failed" };
  }
  const status = outcome.status || "sent";
  await store.markSent(key, status);
  return { action: "sent", status };
}
