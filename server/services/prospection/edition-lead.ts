/**
 * Éditions et validations faites depuis la fiche prospect (champs linkedinMessage et
 * emailMessage) : elles sont recopiées dans le cache de la première touche du canal (ce qui
 * est validé est ce qui part) et tracées comme matière d'apprentissage.
 * Ne fait jamais échouer la requête appelante : les erreurs sont journalisées.
 */
import { storage } from "../../storage";
import { roleDeTouche } from "../sequence-message";
import { extraireSiPret } from "./regles-apprises";

const CHAMPS = [
  { champ: "linkedinMessage", canal: "linkedin" },
  { champ: "emailMessage", canal: "email" },
] as const;

async function contexte(userId: string, lead: any) {
  if (!lead?.prospectionCampaignId) return null;
  const campaign: any = await storage.getProspectionCampaign(lead.prospectionCampaignId);
  if (!campaign || campaign.userId !== userId) return null;
  const steps: any[] = await storage.getSequenceSteps(campaign.id);
  return { campaign, steps, projectId: (campaign.projectId ?? null) as number | null };
}

export async function tracerEditionMessages(userId: string, avant: any, updates: Record<string, any>): Promise<void> {
  try {
    const modifs = CHAMPS.filter(({ champ }) =>
      typeof updates?.[champ] === "string" && updates[champ].trim() && updates[champ].trim() !== String(avant?.[champ] ?? "").trim());
    if (modifs.length === 0) return;
    const c = await contexte(userId, avant);
    if (!c) return;
    for (const { champ, canal } of modifs) {
      const index = c.steps.findIndex((s) => s.channel === canal);
      if (index < 0) continue;
      const step = c.steps[index];
      const cache: any = await storage.getLeadStepMessage(avant.id, step.id);
      const body = updates[champ].trim();
      await storage.upsertLeadStepMessage({ leadId: avant.id, stepId: step.id, subject: cache?.subject ?? null, body, edited: true, qualite: "ok" } as any);
      await storage.addMessageFeedback({
        userId, projectId: c.projectId, campaignId: c.campaign.id, leadId: avant.id, stepId: step.id,
        role: roleDeTouche(c.steps, index), action: "modifie", original: avant?.[champ] ?? cache?.body ?? null, final: body,
      });
    }
    void extraireSiPret(userId, c.projectId);
  } catch (e: any) {
    console.error("[prospection/edition] traçage échoué :", e?.message);
  }
}

export async function tracerValidation(userId: string, lead: any): Promise<void> {
  try {
    const c = await contexte(userId, lead);
    if (!c) return;
    for (const { canal } of CHAMPS) {
      const index = c.steps.findIndex((s) => s.channel === canal);
      if (index < 0) continue;
      const step = c.steps[index];
      const cache: any = await storage.getLeadStepMessage(lead.id, step.id);
      if (!cache?.body || cache.edited) continue; // une édition est déjà tracée comme « modifié »
      await storage.addMessageFeedback({
        userId, projectId: c.projectId, campaignId: c.campaign.id, leadId: lead.id, stepId: step.id,
        role: roleDeTouche(c.steps, index), action: "valide_tel_quel", original: cache.body, final: cache.body,
      });
    }
  } catch (e: any) {
    console.error("[prospection/validation] traçage échoué :", e?.message);
  }
}
