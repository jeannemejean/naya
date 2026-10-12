import { storage } from "../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { structurePour, emplacements, ajusterDelais, type NomStructure } from "./prospection/sequence-structures";
import type { RoleTouche } from "./prospection/doctrine";
import type { StepCondition } from "./sequence-engine";

export type PlanStep = { channel: "email" | "linkedin"; delayDays: number; intention: string; condition: StepCondition };
export type SequencePlan = { rationale: string; steps: PlanStep[] };

const CHANNELS = new Set(["email", "linkedin"]);
export const CONDITIONS = new Set(["always", "if_opened", "if_not_opened", "if_clicked", "if_invite_accepted", "if_invite_not_accepted"]);

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

// ─── Plan de séquence : structure éprouvée + intentions écrites par l'IA ─────
//
// Réécrit le 12 octobre 2026. L'ancien générateur composait librement canaux et conditions
// sans voir l'objectif ni l'offre : il pouvait programmer un message LinkedIn à une personne
// non connectée. La FORME vient désormais de prospection/sequence-structures.ts ; l'IA n'écrit
// que l'intention de chaque touche et peut ajuster les délais dans des bornes.

export type PlanStepAvecRole = PlanStep & { role: RoleTouche };
export type PlanStructure = { rationale: string; structure: NomStructure; steps: PlanStepAvecRole[] };

const INTENTION_PAR_DEFAUT: Record<RoleTouche, string> = {
  invitation: "Se connecter en s'appuyant sur le déclencheur réel du prospect",
  premier_message: "Se présenter en une ligne et apporter la proposition du brief",
  email_ouverture: "Ouvrir par le déclencheur, se présenter, proposer quelque chose de concret",
  relance: "Relancer avec un angle nouveau ou une autre preuve",
  cloture: "Fermer la porte proprement en laissant un sujet de retour",
};

/** PURE : applique la réponse de l'IA (intentions, délais) à une structure, sans pouvoir la déformer. */
export function planDepuisStructure(nom: NomStructure, raw: string): PlanStructure {
  let obj: any = {};
  try { obj = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { obj = {}; }
  const intentions: unknown[] = Array.isArray(obj?.intentions) ? obj.intentions : [];
  const delais: unknown[] = Array.isArray(obj?.delais) ? obj.delais : [];
  const base = ajusterDelais(emplacements(nom), delais.map((d) => (typeof d === "number" ? d : Number(d))).map((d) => (Number.isFinite(d) ? d : undefined)));
  const steps = base.map((e, i) => {
    const brute = intentions[i];
    const intention = typeof brute === "string" && brute.trim() ? brute.trim().slice(0, 300) : INTENTION_PAR_DEFAUT[e.role];
    return { channel: e.channel, delayDays: e.delayDays, condition: e.condition, role: e.role, intention };
  });
  return { rationale: typeof obj?.rationale === "string" ? obj.rationale.trim() : "", structure: nom, steps };
}

export async function generateSequencePlan(userId: string, campaignId: number): Promise<PlanStructure> {
  const campaign: any = await storage.getProspectionCampaign(campaignId);
  const projectId: number | null = campaign?.projectId ?? null;
  const dna: any = projectId
    ? (await storage.getBrandDnaForProject(userId, projectId).catch(() => null)) ?? (await storage.getBrandDna(userId))
    : await storage.getBrandDna(userId);
  const nom = structurePour(campaign?.channel);
  const slots = emplacements(nom);

  const ctx = [
    dna?.businessName ? `Entreprise : ${dna.businessName}` : "",
    dna?.uniquePositioning ? `Positionnement : ${dna.uniquePositioning}` : "",
    dna?.offers ? `Offre : ${dna.offers}` : "",
    campaign?.campaignBrief ? `Objectif de la campagne : ${campaign.campaignBrief}` : "",
    campaign?.offer ? `Offre mise en avant : ${campaign.offer}` : "",
    campaign?.targetSector ? `Cible : ${campaign.targetSector}` : "",
    campaign?.messageAngle ? `Angle : ${campaign.messageAngle}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Tu prépares le PLAN d'une séquence de prospection. Sa forme est déjà fixée (canaux, conditions, rôles) : tu écris seulement l'INTENTION de chaque touche, c'est-à-dire ce qu'elle doit accomplir pour cette campagne précise (pas le texte du message).

CONTEXTE
${ctx || "(contexte minimal)"}

TOUCHES (dans l'ordre)
${slots.map((e, i) => `${i + 1}. ${e.channel} · rôle ${e.role} · condition ${e.condition} · délai proposé ${e.delayDays} j`).join("\n")}

Règles : chaque intention tient en une phrase, sert l'objectif de la campagne, et les relances prévoient chacune un angle différent. Tu peux proposer d'autres délais (en jours après la touche précédente) si l'objectif le justifie.

Réponds UNIQUEMENT avec ce JSON :
{"rationale":"une phrase","intentions":["...", "..."],"delais":[0, ...]}`;

  const raw = await callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1200, temperature: 0.5, destinataire: "tiers",
  });
  return planDepuisStructure(nom, raw);
}
