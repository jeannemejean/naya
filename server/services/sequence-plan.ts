import { storage } from "../storage";
import { callClaudeDetailed, CLAUDE_MODELS, assertNotTruncated } from "./claude";
import type { StepCondition } from "./sequence-engine";

export type PlanStep = { channel: "email" | "linkedin"; delayDays: number; intention: string; condition: StepCondition };
export type SequencePlan = { rationale: string; steps: PlanStep[] };

const CHANNELS = new Set(["email", "linkedin"]);
const CONDITIONS = new Set(["always", "if_opened", "if_not_opened", "if_clicked", "if_invite_accepted", "if_invite_not_accepted"]);

export function parseSequencePlan(raw: string): SequencePlan {
  let obj: any;
  try { obj = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); }
  catch { return { rationale: "", steps: [] }; }
  const steps: PlanStep[] = Array.isArray(obj?.steps) ? obj.steps.slice(0, 6).map((s: any) => ({
    channel: CHANNELS.has(s?.channel) ? s.channel : "email",
    delayDays: Math.max(0, Number.isFinite(Number(s?.delayDays)) ? Number(s.delayDays) : 0),
    intention: typeof s?.intention === "string" ? s.intention.trim() : "",
    condition: (CONDITIONS.has(s?.condition) ? s.condition : "always") as StepCondition,
  })).filter((s: PlanStep) => s.intention) : [];
  return { rationale: typeof obj?.rationale === "string" ? obj.rationale.trim() : "", steps };
}

// ─── Génération du plan de séquence multicanal (canal intelligent) par IA ────
export async function generateSequencePlan(userId: string, campaignId: number): Promise<SequencePlan> {
  const [brandDna, campaign] = await Promise.all([
    storage.getBrandDna(userId),
    storage.getProspectionCampaign(campaignId),
  ]);
  const ctx = [
    (brandDna as any)?.businessName ? `Entreprise: ${(brandDna as any).businessName}` : "",
    (brandDna as any)?.uniquePositioning ? `Positionnement: ${(brandDna as any).uniquePositioning}` : "",
    campaign?.targetSector ? `Cible: ${campaign.targetSector}` : "",
    (campaign as any)?.channel ? `Canal préféré déclaré: ${(campaign as any).channel}` : "",
    (campaign as any)?.messageAngle ? `Angle: ${(campaign as any).messageAngle}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Tu conçois le PLAN d'une séquence de prospection multicanale (email + LinkedIn), pas les messages.
Contexte :
${ctx || "(contexte minimal)"}

Décide le meilleur enchaînement de 3 à 5 étapes. Best practices 2026 :
- Le multicanal (email + LinkedIn) surpasse un seul canal ; commence souvent par le canal où la cible est la plus active.
- Utilise des BRANCHES conditionnelles : conditions possibles = "always", "if_opened", "if_not_opened", "if_clicked", "if_invite_accepted", "if_invite_not_accepted".
- Exemple : invitation LinkedIn (always) → si NON acceptée, email de valeur (if_invite_not_accepted) → si acceptée, message LinkedIn (if_invite_accepted).
- delayDays = jours après l'étape précédente. intention = objectif court de l'étape (PAS le texte).

Réponds UNIQUEMENT avec ce JSON :
{"rationale":"1-2 phrases expliquant le choix de canaux","steps":[{"channel":"linkedin|email","delayDays":0,"intention":"...","condition":"always"}]}`;

  const { text, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart, userId,
    messages: [{ role: "user", content: prompt }], max_tokens: 1500, temperature: 0.6,
  });
  assertNotTruncated(stopReason, "génération du plan de séquence");
  return parseSequencePlan(text);
}
