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
