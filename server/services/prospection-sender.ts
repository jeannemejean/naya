/**
 * Worker d'envoi des séquences de prospection (style lemlist).
 *
 * SÉCURITÉ (cf. incident des 14 posts) : le worker est TOTALEMENT INERTE tant que
 * l'envoi n'est pas explicitement activé. Pour envoyer réellement, il faut les TROIS :
 *   PROSPECTION_SENDING_ENABLED=true
 *   SENDGRID_API_KEY=...
 *   PROSPECTION_FROM_EMAIL=...   (domaine expéditeur vérifié dans SendGrid)
 * Sinon → dry-run : log uniquement, aucune écriture, aucun envoi.
 *
 * Stop-on-reply : le worker ne traite que les enrôlements `status='active'` ;
 * une réponse fait passer le statut à `stopped_replied` (via le webhook, Phase 3).
 */

import { storage } from "../storage";
import { renderTemplate, leadVars } from "./personalization";

const POLL_MS = 60_000;
let running = false;

export interface PlanResult {
  sendIndex: number | null;
  done: boolean;
  nextDelayDays: number | null;
}

/**
 * Décide l'étape à envoyer maintenant et la suite. Pure & testable.
 * `currentStep` = nombre d'étapes déjà envoyées (0 = aucune). L'étape à envoyer
 * est donc `steps[currentStep]`.
 */
export function planNextStep(currentStep: number, steps: { delayDays: number }[]): PlanResult {
  if (currentStep >= steps.length) {
    return { sendIndex: null, done: true, nextDelayDays: null };
  }
  const after = currentStep + 1;
  const willComplete = after >= steps.length;
  return {
    sendIndex: currentStep,
    done: willComplete,
    nextDelayDays: willComplete ? null : steps[after].delayDays || 0,
  };
}

function sendingEnabled(): boolean {
  return (
    process.env.PROSPECTION_SENDING_ENABLED === "true" &&
    !!process.env.SENDGRID_API_KEY &&
    !!process.env.PROSPECTION_FROM_EMAIL
  );
}

async function sendEmail(to: string, toName: string, subject: string, body: string, leadId: number): Promise<boolean> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name: toName || undefined }], subject }],
      from: { email: process.env.PROSPECTION_FROM_EMAIL, name: process.env.PROSPECTION_FROM_NAME || "Naya" },
      content: [{ type: "text/plain", value: body }],
      tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true } },
      // Corrélation pour le webhook de tracking (Phase 3).
      custom_args: { leadId: String(leadId) },
    }),
  });
  return res.ok;
}

export async function runProspectionSender(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await storage.getDueEnrollments(new Date(), 100).catch(() => []);
    if (due.length === 0) return;

    if (!sendingEnabled()) {
      console.log(
        `[ProspectionSender] DRY-RUN : ${due.length} étape(s) due(s) — envoi DÉSACTIVÉ, aucune action. ` +
          `(Activer : PROSPECTION_SENDING_ENABLED=true + SENDGRID_API_KEY + PROSPECTION_FROM_EMAIL)`,
      );
      return; // aucune écriture, aucun envoi
    }

    for (const state of due) {
      try {
        const steps = await storage.getSequenceSteps(state.campaignId);
        const plan = planNextStep(state.currentStep, steps);

        if (plan.sendIndex === null) {
          await storage.updateLeadSequenceState(state.leadId, { status: "completed", nextRunAt: null });
          continue;
        }

        const lead = (await storage.getLeads(state.userId)).find((l) => l.id === state.leadId);
        if (!lead) {
          await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
          continue;
        }

        const step = steps[plan.sendIndex];
        const vars = leadVars(lead);
        const subject = renderTemplate(step.subjectTemplate || "", vars);
        const body = renderTemplate(step.bodyTemplate, vars);

        if (step.channel === "email") {
          if (!lead.email) {
            await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
            continue;
          }
          const ok = await sendEmail(lead.email, lead.name || "", subject, body, lead.id);
          if (!ok) {
            console.error(`[ProspectionSender] échec envoi lead ${lead.id} — retry au prochain tick`);
            continue; // on n'avance pas → retry
          }
          await storage.createOutreachMessage({
            userId: state.userId, leadId: lead.id, platform: "email",
            messageType: `step_${plan.sendIndex + 1}`, subject, body, sentAt: new Date(),
          } as any);
        } else {
          // LinkedIn : pas d'auto-envoi (API/ToS) → brouillon à envoyer manuellement.
          await storage.createOutreachMessage({
            userId: state.userId, leadId: lead.id, platform: "linkedin",
            messageType: `step_${plan.sendIndex + 1}`, subject: null, body, sentAt: null,
          } as any);
        }

        await storage.updateLeadSequenceState(state.leadId, {
          currentStep: plan.sendIndex + 1,
          lastStepSentAt: new Date(),
          status: plan.done ? "completed" : "active",
          nextRunAt: plan.done ? null : new Date(Date.now() + (plan.nextDelayDays || 0) * 86400000),
        });
      } catch (e: any) {
        console.error(`[ProspectionSender] lead ${state.leadId}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

export function scheduleProspectionSender(): void {
  console.log(
    `[ProspectionSender] Worker démarré (chaque minute) — envoi ${sendingEnabled() ? "ACTIVÉ" : "DÉSACTIVÉ (dry-run)"}`,
  );
  setInterval(() => {
    runProspectionSender().catch((e) => console.error("[ProspectionSender]", e.message));
  }, POLL_MS);
}
