// server/routes-prospection-apprentissage.ts — ce que l'utilisatrice fait des messages
// proposés (édition, écart), le brief du prospect, les règles apprises et les messages collés.
// Chaque correction est tracée (prospection_message_feedback) : c'est la matière dont Naya
// apprend la façon d'écrire de l'utilisatrice, projet par projet.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { roleDeTouche } from "./services/sequence-message";
import { controlerMessage } from "./services/prospection/qualite";
import { appliquerEditionBrief, lireBrief } from "./services/prospection/brief";
import { extraireSiPret, validerRaisonEcart } from "./services/prospection/regles-apprises";

const ROLES = new Set(["invitation", "premier_message", "email_ouverture", "relance", "cloture"]);
const STATUTS_REGLE = new Set(["proposee", "acceptee", "refusee"]);

function idPositif(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Prospect + campagne + étapes, tous à l'utilisatrice ; null sinon (→ 404). */
async function contexteLead(userId: string, leadIdBrut: unknown) {
  const leadId = idPositif(leadIdBrut);
  if (!leadId) return null;
  const lead: any = await storage.getLead(leadId, userId);
  if (!lead?.prospectionCampaignId) return null;
  const campaign: any = await storage.getProspectionCampaign(lead.prospectionCampaignId);
  if (!campaign || campaign.userId !== userId) return null;
  const steps: any[] = await storage.getSequenceSteps(campaign.id);
  return { lead, campaign, steps, projectId: (campaign.projectId ?? null) as number | null };
}

function etapeDe(steps: any[], stepIdBrut: unknown) {
  const stepId = idPositif(stepIdBrut);
  const index = steps.findIndex((s) => s.id === stepId);
  return index >= 0 ? { step: steps[index], index } : null;
}

export function registerApprentissageRoutes(app: Express) {
  // Messages de séquence en cache pour ce prospect (texte, qualité, défauts).
  app.get("/api/leads/:id/step-messages", isAuthenticated, async (req: any, res) => {
    try {
      const c = await contexteLead(req.userId, req.params.id);
      if (!c) return res.status(404).json({ message: "not_found" });
      const out = [];
      for (const [i, s] of c.steps.entries()) {
        const m: any = await storage.getLeadStepMessage(c.lead.id, s.id);
        out.push({
          stepId: s.id, stepOrder: s.stepOrder, channel: s.channel, role: roleDeTouche(c.steps, i),
          subject: m?.subject ?? null, body: m?.body ?? null, edited: !!m?.edited,
          qualite: m?.qualite ?? null, defauts: m?.defauts ?? [],
        });
      }
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Édition à la main : souveraine. Le texte part tel quel ; les défauts détectés restent
  // affichés en simple avertissement.
  app.put("/api/leads/:id/step-messages/:stepId", isAuthenticated, async (req: any, res) => {
    try {
      const c = await contexteLead(req.userId, req.params.id);
      const e = c && etapeDe(c.steps, req.params.stepId);
      if (!c || !e) return res.status(404).json({ message: "not_found" });
      const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 5000) : "";
      if (!body) return res.status(400).json({ message: "corps_requis" });
      const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 200) || null : null;
      const role = roleDeTouche(c.steps, e.index);
      const avant: any = await storage.getLeadStepMessage(c.lead.id, e.step.id);
      const defauts = controlerMessage(
        { role, canal: e.step.channel === "linkedin" ? "linkedin" : "email", body, subject },
        { entreprise: c.lead.company ?? null, liensAutorises: (body.match(/https?:\/\/\S+/g) || []), premiereTouche: false },
      );
      await storage.upsertLeadStepMessage({
        leadId: c.lead.id, stepId: e.step.id, subject, body, edited: true, qualite: "ok", defauts: defauts.length ? defauts : null,
      } as any);
      await storage.addMessageFeedback({
        userId: req.userId, projectId: c.projectId, campaignId: c.campaign.id, leadId: c.lead.id, stepId: e.step.id,
        role, action: "modifie", original: avant?.body ?? null, final: body,
      });
      // Première touche du canal : le message montré à la validation suit.
      const premiere = c.steps.findIndex((s) => s.channel === e.step.channel) === e.index;
      if (premiere) {
        await storage.updateLead(c.lead.id, req.userId, (e.step.channel === "linkedin" ? { linkedinMessage: body } : { emailMessage: body }) as any);
      }
      void extraireSiPret(req.userId, c.projectId);
      res.json({ stepId: e.step.id, subject, body, edited: true, defauts });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Écarter : la raison est tracée, le texte est supprimé et sera réécrit au prochain passage.
  app.post("/api/leads/:id/step-messages/:stepId/ecarter", isAuthenticated, async (req: any, res) => {
    try {
      const c = await contexteLead(req.userId, req.params.id);
      const e = c && etapeDe(c.steps, req.params.stepId);
      if (!c || !e) return res.status(404).json({ message: "not_found" });
      if (!validerRaisonEcart(req.body?.raison)) return res.status(400).json({ message: "raison_invalide" });
      const texte = typeof req.body?.texte === "string" ? req.body.texte.trim().slice(0, 500) : "";
      const avant: any = await storage.getLeadStepMessage(c.lead.id, e.step.id);
      await storage.addMessageFeedback({
        userId: req.userId, projectId: c.projectId, campaignId: c.campaign.id, leadId: c.lead.id, stepId: e.step.id,
        role: roleDeTouche(c.steps, e.index), action: "ecarte", original: avant?.body ?? null, final: null,
        raison: texte ? `${req.body.raison} : ${texte}` : req.body.raison,
      });
      await storage.deleteLeadStepMessage(c.lead.id, e.step.id);
      void extraireSiPret(req.userId, c.projectId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Brief modifié par l'utilisatrice : toute la séquence suit (messages non édités purgés).
  app.patch("/api/leads/:id/brief", isAuthenticated, async (req: any, res) => {
    try {
      const c = await contexteLead(req.userId, req.params.id);
      if (!c) return res.status(404).json({ message: "not_found" });
      const preuves = c.projectId != null ? await storage.getProjectProofs(req.userId, c.projectId, "validated") : [];
      const r = appliquerEditionBrief(lireBrief(c.lead.prospectBrief), req.body ?? {}, preuves.map((p: any) => p.id));
      if (!r.ok) return res.status(400).json({ message: r.erreur });
      const updated = await storage.updateLead(c.lead.id, req.userId, { prospectBrief: r.brief } as any);
      await storage.purgeUneditedLeadStepMessages(c.lead.id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function projetDe(req: any): Promise<number | null> {
    const id = idPositif(req.params.id);
    if (!id) return null;
    return (await storage.getProject(id, req.userId)) ? id : null;
  }

  app.get("/api/projects/:id/learned-rules", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      res.json(await storage.getLearnedRules(req.userId, projectId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/projects/:id/learned-rules/:ruleId", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      const ruleId = idPositif(req.params.ruleId);
      const regle = projectId ? (await storage.getLearnedRules(req.userId, projectId)).find((r) => r.id === ruleId) : undefined;
      if (!projectId || !regle) return res.status(404).json({ message: "not_found" });
      const patch: any = {};
      if (req.body?.statut !== undefined) {
        if (!STATUTS_REGLE.has(req.body.statut)) return res.status(400).json({ message: "statut_invalide" });
        patch.statut = req.body.statut;
      }
      if (req.body?.texte !== undefined) {
        const t = typeof req.body.texte === "string" ? req.body.texte.trim().slice(0, 300) : "";
        if (!t) return res.status(400).json({ message: "texte_requis" });
        patch.texte = t;
      }
      res.json(await storage.updateLearnedRule(regle.id, req.userId, patch));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Message collé par l'utilisatrice (« un message à moi qui a marché ») : exemple validé.
  app.post("/api/projects/:id/example-messages", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      const role = req.body?.role;
      const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 5000) : "";
      if (!ROLES.has(role) || !body) return res.status(400).json({ message: "role_ou_texte_invalide" });
      const cree = await storage.addMessageFeedback({
        userId: req.userId, projectId, role, action: "modifie", original: null, final: body,
      });
      res.status(201).json(cree);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id/example-messages", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = await projetDe(req);
      if (!projectId) return res.status(404).json({ message: "not_found" });
      const fb = await storage.getMessageFeedback(req.userId, projectId, { limit: 200 });
      res.json(fb.filter((f) => f.action === "modifie" && f.original == null));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
