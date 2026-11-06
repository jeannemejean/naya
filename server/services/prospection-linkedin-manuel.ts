/**
 * LinkedIn envoyé À LA MAIN (pas d'Unipile) : la séquence attend l'utilisatrice.
 *
 * Quand Naya ne peut pas envoyer elle-même sur LinkedIn, elle rédige un brouillon et la
 * séquence du prospect passe en `awaiting_linkedin` — comme une tâche manuelle chez
 * lemlist. Rien n'avance tant que l'utilisatrice n'a pas dit ce qu'elle en a fait :
 *   - « Envoyé » : le message est parti maintenant, le délai de l'étape suivante court
 *     à partir de CE moment (jamais depuis la rédaction du brouillon).
 *   - « Passer » : l'étape n'est pas envoyée, le brouillon disparaît, la séquence
 *     continue sans consommer de délai (comme une condition fausse).
 *
 * Les brouillons créés AVANT ce mécanisme ne bloquaient rien (la séquence avait déjà
 * avancé) : les marquer envoyés ou les passer ne touche pas à leur séquence.
 *
 * Les accès au stockage sont injectés pour que la règle se teste sans base.
 */
import type { OutreachMessage, LeadSequenceState, CampaignSequenceStep } from "@shared/schema";
import type { LeadSignals } from "./sequence-signals";
import type { StepSendKey } from "./prospection-idempotence";
import { planAfterStep, stepOrderFromMessageType } from "./sequence-engine";

export interface DepsLinkedInManuel {
  getMessage: (id: number) => Promise<OutreachMessage | undefined>;
  updateMessage: (id: number, updates: Partial<OutreachMessage>) => Promise<unknown>;
  deleteMessage: (id: number) => Promise<void>;
  getState: (leadId: number) => Promise<LeadSequenceState | undefined>;
  updateState: (leadId: number, updates: Partial<LeadSequenceState>) => Promise<unknown>;
  getSteps: (campaignId: number) => Promise<CampaignSequenceStep[]>;
  getSignals: (leadId: number) => Promise<LeadSignals>;
  markClaimSent: (key: StepSendKey) => Promise<void>;
  marquerPremierContact: (leadId: number, userId: string) => Promise<unknown>;
}

export type ResultatLinkedInManuel =
  | { ok: true; sequenceReprise: boolean }
  | { ok: false; raison: "introuvable" | "deja_envoye" };

/** Le brouillon est-il celui que la séquence attend ? */
function etapeAttendue(msg: OutreachMessage, state: LeadSequenceState | undefined): number | null {
  if (!state || state.status !== "awaiting_linkedin") return null;
  const rang = stepOrderFromMessageType(msg.messageType);
  return rang != null && rang === state.currentStep + 1 ? rang : null;
}

async function brouillonDe(deps: DepsLinkedInManuel, userId: string, messageId: number) {
  const msg = await deps.getMessage(messageId);
  if (!msg || msg.userId !== userId || msg.platform !== "linkedin") return { erreur: "introuvable" as const };
  if (msg.sentAt) return { erreur: "deja_envoye" as const };
  return { msg };
}

export async function marquerLinkedInEnvoye(
  deps: DepsLinkedInManuel, userId: string, messageId: number, now: Date,
): Promise<ResultatLinkedInManuel> {
  const b = await brouillonDe(deps, userId, messageId);
  if (!b.msg) return { ok: false, raison: b.erreur };
  const msg = b.msg;
  await deps.updateMessage(msg.id, { sentAt: now });
  // Le message est parti : un suivi non mis à jour ne doit pas bloquer la séquence.
  await deps.marquerPremierContact(msg.leadId, userId)
    .catch((e: any) => console.error(`[LinkedIn manuel] suivi du lead ${msg.leadId} non mis à jour : ${String(e?.message ?? e)}`));

  const state = await deps.getState(msg.leadId);
  const rang = etapeAttendue(msg, state);
  if (rang == null || !state) return { ok: true, sequenceReprise: false };

  await deps.markClaimSent({ leadId: msg.leadId, campaignId: state.campaignId, stepOrder: rang, userId, channel: "linkedin" });
  const steps = await deps.getSteps(state.campaignId);
  const engineSteps = steps.map((s) => ({ delayDays: s.delayDays, condition: (s as any).condition || "always" }));
  const signals = await deps.getSignals(msg.leadId);
  await deps.updateState(msg.leadId, planAfterStep(rang - 1, engineSteps, signals, now));
  return { ok: true, sequenceReprise: true };
}

export async function passerLinkedIn(
  deps: DepsLinkedInManuel, userId: string, messageId: number, now: Date,
): Promise<ResultatLinkedInManuel> {
  const b = await brouillonDe(deps, userId, messageId);
  if (!b.msg) return { ok: false, raison: b.erreur };
  const msg = b.msg;
  const state = await deps.getState(msg.leadId);
  const rang = etapeAttendue(msg, state);
  await deps.deleteMessage(msg.id);
  if (rang == null) return { ok: true, sequenceReprise: false };

  // Étape passée : pas d'envoi, donc `lastStepSentAt` inchangé — le délai de l'étape
  // suivante continue de courir depuis le dernier envoi réel. Le worker décide du reste.
  await deps.updateState(msg.leadId, { currentStep: rang, status: "active", nextRunAt: now });
  return { ok: true, sequenceReprise: true };
}
