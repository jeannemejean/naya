/**
 * Génération bespoke du message d'une étape de séquence (lead × step) + cache.
 * Le prompt (buildStepPrompt) est pur et testé isolément (TDD). generateStepMessage
 * orchestre l'appel IA et réutilise/alimente le cache lead_step_messages (Task 1)
 * pour que l'aperçu ET l'envoi consomment exactement le même texte généré.
 */
import { storage } from "../storage";
import { callClaude, CLAUDE_MODELS } from "./claude";
import { sanitizeMessage, enforceLinkedInLimit, parseJsonObject } from "./prospection-pipeline";

export function buildStepPrompt(args: {
  founderName: string; projectName: string; channel: string; intention: string;
  lead: any; audit: Record<string, string>;
}): string {
  const isLi = args.channel === "linkedin";
  return `Tu es Naya. Rédige ${isLi ? "un message LinkedIn" : "un email"} de prospection sur-mesure.

PROSPECT : ${args.lead?.name || ""} — ${args.lead?.role || ""} @ ${args.lead?.company || ""}
INTENTION DE CETTE ÉTAPE : ${args.intention || "prise de contact"}
ANGLE (audit) : ${args.audit?.angle || ""}
ENJEUX : ${args.audit?.enjeux || args.audit?.observations || ""}

RÈGLES ABSOLUES :
- Ton humain, curieux, jamais commercial. JAMAIS de tiret long.
${isLi
  ? `- MESSAGE LINKEDIN : MAXIMUM 200 caractères strict. Un lien personnel + une question sincère. Signé : ${args.founderName}.`
  : `- EMAIL : rédige un objet court et accrocheur, puis un corps de 5 à 8 phrases. Observation d'ouverture, angle, question ouverte. Signé : ${args.founderName} — ${args.projectName}.`}

Réponds UNIQUEMENT avec ce JSON :
{${isLi ? '"body":"..."' : '"subject":"...","body":"..."'}}`;
}

export async function generateStepMessage(
  userId: string,
  opts: { lead: any; campaign: any; step: { id: number; channel: string; intention: string | null }; useCache?: boolean },
): Promise<{ subject: string | null; body: string }> {
  if (opts.useCache !== false) {
    const cached = await storage.getLeadStepMessage(opts.lead.id, opts.step.id);
    if (cached) return { subject: cached.subject ?? null, body: cached.body };
  }
  const founderName = opts.lead?.founderName || opts.campaign?.founderName || "";
  const projectName = opts.campaign?.name || "";
  const audit = safeAudit(opts.lead?.auditNotes);
  const prompt = buildStepPrompt({
    founderName, projectName, channel: opts.step.channel,
    intention: opts.step.intention || "", lead: opts.lead, audit,
  });
  const raw = await callClaude({ model: CLAUDE_MODELS.smart, userId, messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.6 });
  const p = parseJsonObject(raw);
  const body = opts.step.channel === "linkedin"
    ? enforceLinkedInLimit(typeof p.body === "string" ? p.body : "")
    : sanitizeMessage(typeof p.body === "string" ? p.body : "");
  const subject = opts.step.channel === "email" && typeof p.subject === "string" ? p.subject.trim() : null;
  await storage.upsertLeadStepMessage({ leadId: opts.lead.id, stepId: opts.step.id, subject, body, edited: false });
  return { subject, body };
}

function safeAudit(auditNotes: any): Record<string, string> {
  if (!auditNotes) return {};
  try { return typeof auditNotes === "string" ? JSON.parse(auditNotes) : auditNotes; } catch { return {}; }
}
