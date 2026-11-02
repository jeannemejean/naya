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
 * pour que le moteur re-décide sans attendre la limite de 14 jours. Pure.
 */
export function planAcceptance(
  existing: Date | null, given: Date, stateStatus: string | null, now: Date,
): { linkedinConnectedAt: Date; wakeSequenceAt: Date | null } {
  const earliest = existing && existing.getTime() <= given.getTime() ? existing : given;
  return { linkedinConnectedAt: earliest, wakeSequenceAt: stateStatus === "active" ? now : null };
}
