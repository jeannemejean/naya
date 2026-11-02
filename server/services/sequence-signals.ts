export type LeadSignals = {
  opened: boolean; clicked: boolean; bounced: boolean; replied: boolean; inviteAccepted: boolean;
  /** Instant d'acceptation de l'invitation LinkedIn (lead.linkedinConnectedAt), sinon null. */
  inviteAcceptedAt: Date | null;
};

type MsgRow = { platform: string; openedAt: Date | null; clickedAt: Date | null; bouncedAt: Date | null };

export function deriveSignals(
  messages: MsgRow[],
  lead: { linkedinConnectedAt: Date | null },
  state: { repliedAt: Date | null; status: string },
): LeadSignals {
  const clicked = messages.some((m) => m.clickedAt != null);
  const opened = clicked || messages.some((m) => m.openedAt != null); // un clic implique une ouverture
  const bounced = messages.some((m) => m.bouncedAt != null);
  const replied = state.repliedAt != null || state.status === "stopped_replied";
  const inviteAcceptedAt = lead.linkedinConnectedAt ?? null;
  const inviteAccepted = inviteAcceptedAt != null;
  return { opened, clicked, bounced, replied, inviteAccepted, inviteAcceptedAt };
}

/**
 * Enregistrement d'une acceptation d'invitation : garde la date la PLUS ANCIENNE (jamais
 * d'écrasement par une date plus tardive) et réveille la séquence active (nextRunAt = now)
 * pour que le moteur re-décide sans attendre la limite de 14 jours.
 *
 * Exception : une séquence REPORTÉE par une absence (réponse automatique reçue depuis le
 * dernier envoi) n'est jamais avancée — nextRunAt = max(existant, now). Le moteur re-décide
 * à cette date de toute façon, avec l'acceptation en main. Hors absence, le réveil reste
 * immédiat : un nextRunAt futur est alors la borne d'attente d'acceptation (14 j), qu'il
 * faut justement court-circuiter. Pure.
 */
export function planAcceptance(
  existing: Date | null, given: Date, stateStatus: string | null, now: Date,
  sequence: { nextRunAt?: Date | null; reportAbsence?: boolean } = {},
): { linkedinConnectedAt: Date; wakeSequenceAt: Date | null } {
  const earliest = existing && existing.getTime() <= given.getTime() ? existing : given;
  if (stateStatus !== "active") return { linkedinConnectedAt: earliest, wakeSequenceAt: null };
  const prevu = sequence.nextRunAt ?? null;
  const garde = !!sequence.reportAbsence && !!prevu && prevu.getTime() > now.getTime();
  return { linkedinConnectedAt: earliest, wakeSequenceAt: garde ? prevu : now };
}

/** Statuts qu'une réponse ne laisse jamais redevenir « en cours ». */
const RESSUSCITE = new Set(["active", "awaiting_linkedin", "paused", "completed"]);

/**
 * Statuts actuels qu'une écriture vers `nouveau` ne doit PAS écraser :
 *  - `unsubscribed` est définitif ;
 *  - `stopped_replied` ne repasse jamais à active / awaiting_linkedin / paused / completed par
 *    une écriture ordinaire (course worker ↔ webhook de réponse). Seule la restauration
 *    explicite « ce n'était pas une vraie réponse » (`restaurerEtatSequence`) le peut. Pure.
 */
export function statutsNonEcrasables(nouveau: string | undefined | null): string[] {
  return nouveau && RESSUSCITE.has(nouveau) ? ["unsubscribed", "stopped_replied"] : ["unsubscribed"];
}
