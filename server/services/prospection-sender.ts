/**
 * Worker d'envoi des séquences de prospection (style lemlist).
 *
 * SÉCURITÉ (cf. incident des 14 posts) : le worker est TOTALEMENT INERTE tant que
 * `PROSPECTION_SENDING_ENABLED=true` (kill-switch global).
 *
 * MULTI-UTILISATEUR : chaque email part de l'adresse expéditrice PROPRE À L'UTILISATEUR
 * (`userPreferences.prospectionSenderEmail`) — jamais l'adresse de l'app. La clé SendGrid
 * utilisée est celle de l'utilisateur si elle est configurée (`prospectionSendgridApiKey`,
 * chiffrée), sinon la clé partagée `SENDGRID_API_KEY`. Si un utilisateur n'a pas d'adresse
 * expéditrice configurée, ses étapes restent EN ATTENTE (rien n'est envoyé en son nom).
 *
 * Stop-on-reply : le worker ne traite que les enrôlements `status='active'` ;
 * une réponse fait passer le statut à `stopped_replied`.
 */

import { storage } from "../storage";
import { renderTemplate, leadVars } from "./personalization";
import { decryptToken } from "./token-crypto";

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

// Kill-switch global. L'envoi effectif dépend AUSSI de la config expéditeur de chaque user.
function masterSendingEnabled(): boolean {
  return process.env.PROSPECTION_SENDING_ENABLED === "true";
}

// Résout la config d'envoi PROPRE à l'utilisateur (adresse + clé). Renvoie null si incomplète.
async function resolveSenderConfig(userId: string): Promise<{ apiKey: string; fromEmail: string; fromName: string } | null> {
  const prefs = await storage.getUserPreferences(userId);
  const fromEmail = prefs?.prospectionSenderEmail?.trim();
  if (!fromEmail) return null; // pas d'adresse expéditrice → on n'envoie jamais en son nom
  const userKey = (prefs as any)?.prospectionSendgridApiKey
    ? decryptToken((prefs as any).prospectionSendgridApiKey)
    : null;
  const apiKey = userKey || process.env.SENDGRID_API_KEY;
  if (!apiKey) return null; // ni clé perso ni clé partagée
  return { apiKey, fromEmail, fromName: prefs?.prospectionSenderName?.trim() || "" };
}

async function sendEmail(opts: {
  apiKey: string; fromEmail: string; fromName: string;
  to: string; toName: string; subject: string; body: string; leadId: number;
}): Promise<boolean> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to, name: opts.toName || undefined }], subject: opts.subject }],
      from: { email: opts.fromEmail, name: opts.fromName || undefined },
      content: [{ type: "text/plain", value: opts.body }],
      tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true } },
      custom_args: { leadId: String(opts.leadId) }, // corrélation webhook tracking
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

    if (!masterSendingEnabled()) {
      console.log(
        `[ProspectionSender] DRY-RUN : ${due.length} étape(s) due(s) — envoi GLOBALEMENT DÉSACTIVÉ, aucune action. ` +
          `(Activer : PROSPECTION_SENDING_ENABLED=true)`,
      );
      return; // aucune écriture, aucun envoi
    }

    const senderCache = new Map<string, Awaited<ReturnType<typeof resolveSenderConfig>>>();
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
          // Config expéditeur PROPRE à l'utilisateur (adresse + clé). Jamais l'adresse de l'app.
          if (!senderCache.has(state.userId)) senderCache.set(state.userId, await resolveSenderConfig(state.userId));
          const sender = senderCache.get(state.userId);
          if (!sender) {
            console.log(`[ProspectionSender] user ${state.userId} sans adresse expéditrice configurée — étape EN ATTENTE (rien envoyé)`);
            continue; // on n'avance pas : l'utilisateur doit configurer son email d'envoi
          }
          const ok = await sendEmail({
            apiKey: sender.apiKey, fromEmail: sender.fromEmail, fromName: sender.fromName,
            to: lead.email, toName: lead.name || "", subject, body, leadId: lead.id,
          });
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
    `[ProspectionSender] Worker démarré (chaque minute) — envoi global ${masterSendingEnabled() ? "ACTIVÉ" : "DÉSACTIVÉ (dry-run)"} ; chaque user envoie depuis SA propre adresse`,
  );
  setInterval(() => {
    runProspectionSender().catch((e) => console.error("[ProspectionSender]", e.message));
  }, POLL_MS);
}
