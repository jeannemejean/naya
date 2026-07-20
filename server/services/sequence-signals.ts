export type LeadSignals = {
  opened: boolean; clicked: boolean; bounced: boolean; replied: boolean; inviteAccepted: boolean;
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
  const inviteAccepted = lead.linkedinConnectedAt != null;
  return { opened, clicked, bounced, replied, inviteAccepted };
}
