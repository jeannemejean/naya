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
import { linkedinConfigured, sendLinkedInStep, LINKEDIN_DAILY_CAP } from "./linkedin";

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

// Plafond d'emails / utilisateur / jour (délivrabilité). Configurable via env.
const DAILY_CAP = Number(process.env.PROSPECTION_DAILY_CAP) || 80;

/** Vrai si on est dans la fenêtre d'envoi (jour ouvré + heures de travail). Pure & testable. */
export function withinSendingWindow(
  nowMin: number,
  dayAbbr: string,
  opts: { startMin: number; endMin: number; workDays: Set<string> },
): boolean {
  if (!opts.workDays.has(dayAbbr)) return false;
  return nowMin >= opts.startMin && nowMin < opts.endMin;
}

const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// "Maintenant" dans le fuseau de l'utilisateur → { nowMin, dayAbbr }.
function localNow(timezone: string): { nowMin: number; dayAbbr: string } {
  const tz = timezone || "UTC";
  try {
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const [h, m] = hm.split(":").map(Number);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date()).toLowerCase().slice(0, 3);
    return { nowMin: h * 60 + m, dayAbbr: wd };
  } catch {
    const d = new Date();
    return { nowMin: d.getUTCHours() * 60 + d.getUTCMinutes(), dayAbbr: DAY_ABBRS[d.getUTCDay()] };
  }
}

function hhmmToMin(hhmm: string | null | undefined, fallback: number): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Résout la config d'envoi PROPRE à l'utilisateur (adresse + clé) depuis ses préférences.
function resolveSenderConfig(prefs: any): { apiKey: string; fromEmail: string; fromName: string } | null {
  const fromEmail = prefs?.prospectionSenderEmail?.trim();
  if (!fromEmail) return null; // pas d'adresse expéditrice → on n'envoie jamais en son nom
  const userKey = prefs?.prospectionSendgridApiKey ? decryptToken(prefs.prospectionSendgridApiKey) : null;
  const apiKey = userKey || process.env.SENDGRID_API_KEY;
  if (!apiKey) return null; // ni clé perso ni clé partagée
  return { apiKey, fromEmail, fromName: prefs?.prospectionSenderName?.trim() || "" };
}

async function sendEmail(opts: {
  apiKey: string; fromEmail: string; fromName: string; footerAddress: string;
  to: string; toName: string; subject: string; body: string; leadId: number;
}): Promise<boolean> {
  // Conformité anti-spam (CAN-SPAM / RGPD) : adresse postale + lien de désinscription.
  // SendGrid remplace <%unsubscribe%> par l'URL de désinscription et supprime automatiquement
  // les désinscrits des envois suivants (subscription_tracking).
  const footer =
    `\n\n—\n${opts.fromName || ""}` +
    (opts.footerAddress ? `\n${opts.footerAddress}` : "") +
    `\nSe désinscrire : <%unsubscribe%>`;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to, name: opts.toName || undefined }], subject: opts.subject }],
      from: { email: opts.fromEmail, name: opts.fromName || undefined },
      content: [{ type: "text/plain", value: opts.body + footer }],
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
        subscription_tracking: { enable: true, substitution_tag: "<%unsubscribe%>" },
      },
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

    const prefsCache = new Map<string, any>();
    const sentCount = new Map<string, number>(); // emails envoyés sur 24h glissantes, par user
    const liSentCount = new Map<string, number>(); // messages LinkedIn envoyés sur 24h glissantes, par user
    const getPrefs = async (uid: string) => {
      if (!prefsCache.has(uid)) prefsCache.set(uid, await storage.getUserPreferences(uid));
      return prefsCache.get(uid);
    };
    for (const state of due) {
      try {
        const prefs = await getPrefs(state.userId);

        // Fenêtre d'envoi : uniquement pendant les heures ouvrées de l'utilisateur (fuseau inclus).
        const { nowMin, dayAbbr } = localNow(prefs?.timezone || "UTC");
        const inWindow = withinSendingWindow(nowMin, dayAbbr, {
          startMin: hhmmToMin(prefs?.workDayStart, 9 * 60),
          endMin: hhmmToMin(prefs?.workDayEnd, 18 * 60),
          workDays: new Set((prefs?.workDays || "mon,tue,wed,thu,fri").split(",").map((d: string) => d.trim().toLowerCase())),
        });
        if (!inWindow) continue; // hors fenêtre → on réessaiera (nextRunAt inchangé)

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
        const body = renderTemplate(step.bodyTemplate || "", vars);

        if (!body.trim()) {
          console.warn(`[ProspectionSender] lead ${lead.id} : corps de message vide (étape ${plan.sendIndex + 1}) — étape SAUTÉE, rien envoyé`);
          continue; // sécurité : ne jamais envoyer un message vide à un prospect réel
        }

        if (step.channel === "email") {
          if (!lead.email) {
            await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
            continue;
          }
          // Config expéditeur PROPRE à l'utilisateur (adresse + clé). Jamais l'adresse de l'app.
          const sender = resolveSenderConfig(prefs);
          if (!sender) {
            console.log(`[ProspectionSender] user ${state.userId} sans adresse expéditrice configurée — étape EN ATTENTE (rien envoyé)`);
            continue; // on n'avance pas : l'utilisateur doit configurer son email d'envoi
          }
          // Plafond d'envoi / jour (24h glissantes) pour préserver la délivrabilité.
          if (!sentCount.has(state.userId)) {
            sentCount.set(state.userId, await storage.countOutreachSentSince(state.userId, new Date(Date.now() - 86400000)).catch(() => 0));
          }
          if ((sentCount.get(state.userId) || 0) >= DAILY_CAP) {
            continue; // plafond atteint → on réessaiera plus tard (nextRunAt inchangé)
          }
          const footerAddress = [prefs?.prospectionSenderAddress, prefs?.prospectionSenderCity, prefs?.prospectionSenderCountry]
            .filter(Boolean).join(", ");
          const ok = await sendEmail({
            apiKey: sender.apiKey, fromEmail: sender.fromEmail, fromName: sender.fromName, footerAddress,
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
          sentCount.set(state.userId, (sentCount.get(state.userId) || 0) + 1);
        } else {
          // LinkedIn : auto-envoi via Unipile depuis le compte de l'utilisateur, SI configuré.
          const liAccountId = prefs?.linkedinUnipileAccountId?.trim();
          if (linkedinConfigured() && liAccountId && lead.linkedinUrl) {
            // Plafond quotidien BAS (limites LinkedIn → éviter toute restriction du compte).
            if (!liSentCount.has(state.userId)) {
              liSentCount.set(
                state.userId,
                await storage.countOutreachSentSince(state.userId, new Date(Date.now() - 86400000), "linkedin").catch(() => 0),
              );
            }
            if ((liSentCount.get(state.userId) || 0) >= LINKEDIN_DAILY_CAP) {
              continue; // plafond LinkedIn atteint → retry plus tard (nextRunAt inchangé)
            }
            const result = await sendLinkedInStep({ accountId: liAccountId, linkedinUrl: lead.linkedinUrl, text: body });
            if (!result.ok) {
              console.error(`[ProspectionSender] LinkedIn lead ${lead.id} échec (${result.error}) — retry au prochain tick`);
              continue; // on n'avance pas → retry
            }
            await storage.createOutreachMessage({
              userId: state.userId, leadId: lead.id, platform: "linkedin",
              messageType: `step_${plan.sendIndex + 1}_${result.action}`, subject: null, body, sentAt: new Date(),
            } as any);
            liSentCount.set(state.userId, (liSentCount.get(state.userId) || 0) + 1);
          } else {
            // Non configuré (ou lead sans URL LinkedIn) → brouillon à envoyer manuellement.
            await storage.createOutreachMessage({
              userId: state.userId, leadId: lead.id, platform: "linkedin",
              messageType: `step_${plan.sendIndex + 1}`, subject: null, body, sentAt: null,
            } as any);
          }
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
