// Analytics de séquence par étape et par canal (Task 9).
// Pur : ne touche pas la DB — reçoit des lignes déjà chargées par storage.ts.

export type OutreachMessageRow = {
  leadId: number;
  platform: string;
  messageType: string;
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
};

export type StepAnalyticsRow = { stepOrder: number; channel: string; sent: number; opened: number; clicked: number; bounced: number };
export type ChannelAnalyticsRow = { channel: string; sent: number; replied: number };

// Le worker écrit messageType comme `step_${N}` (email) ou `step_${N}` / `step_${N}_${action}`
// (LinkedIn, ex: "step_2_invitation"). On extrait l'entier juste après "step_" et avant tout
// underscore suivant. Retourne null si le format ne correspond pas.
export function parseStepNumber(messageType: string): number | null {
  const match = /^step_(\d+)(?:_.*)?$/.exec(messageType);
  if (!match) return null;
  return Number(match[1]);
}

// Agrège les messages outreach d'une campagne en compteurs par (étape, canal) et par canal.
// - sent = messages avec sentAt non nul (les brouillons LinkedIn non envoyés ont sentAt null).
// - opened/clicked/bounced = compteurs des timestamps non nuls correspondants.
// - replied par canal = pour chaque lead dans `repliedLeadIds` (status leadSequenceState =
//   'stopped_replied'), on attribue la réponse au canal de son DERNIER message réellement envoyé.
//   Un lead répondu sans aucun message envoyé n'est attribué à aucun canal (ne peut pas arriver
//   en pratique, mais on l'ignore plutôt que de fausser un canal arbitraire).
// - Les trois sorties (byStep, byChannel, attribution de réponse) ne considèrent QUE les
//   messages de séquence (messageType = `step_N` / `step_N_action`). Un message issu de
//   l'ancien flux libre POST /api/outreach (messageType "initial", "follow_up", ...) est
//   ignoré partout, pour que byChannel[].sent reste égal à la somme de byStep[].sent par canal.
export function aggregateStepAnalytics(
  messages: OutreachMessageRow[],
  repliedLeadIds: Set<number>,
): { byStep: StepAnalyticsRow[]; byChannel: ChannelAnalyticsRow[] } {
  const stepMap = new Map<string, StepAnalyticsRow>();
  const channelMap = new Map<string, ChannelAnalyticsRow>();
  const lastSentByLead = new Map<number, OutreachMessageRow>();

  for (const m of messages) {
    const stepOrder = parseStepNumber(m.messageType);
    if (stepOrder === null) continue; // pas un message de séquence → ignoré partout

    const key = `${stepOrder}::${m.platform}`;
    let row = stepMap.get(key);
    if (!row) {
      row = { stepOrder, channel: m.platform, sent: 0, opened: 0, clicked: 0, bounced: 0 };
      stepMap.set(key, row);
    }
    if (m.sentAt) row.sent++;
    if (m.openedAt) row.opened++;
    if (m.clickedAt) row.clicked++;
    if (m.bouncedAt) row.bounced++;

    let channelRow = channelMap.get(m.platform);
    if (!channelRow) {
      channelRow = { channel: m.platform, sent: 0, replied: 0 };
      channelMap.set(m.platform, channelRow);
    }
    if (m.sentAt) channelRow.sent++;

    if (m.sentAt) {
      const current = lastSentByLead.get(m.leadId);
      if (!current || m.sentAt > current.sentAt!) lastSentByLead.set(m.leadId, m);
    }
  }

  for (const leadId of Array.from(repliedLeadIds)) {
    const last = lastSentByLead.get(leadId);
    if (!last) continue; // aucun envoi réel connu pour ce lead → pas d'attribution de canal
    let channelRow = channelMap.get(last.platform);
    if (!channelRow) {
      channelRow = { channel: last.platform, sent: 0, replied: 0 };
      channelMap.set(last.platform, channelRow);
    }
    channelRow.replied++;
  }

  const byStep = Array.from(stepMap.values()).sort(
    (a, b) => a.stepOrder - b.stepOrder || a.channel.localeCompare(b.channel),
  );
  const byChannel = Array.from(channelMap.values()).sort((a, b) => a.channel.localeCompare(b.channel));

  return { byStep, byChannel };
}
