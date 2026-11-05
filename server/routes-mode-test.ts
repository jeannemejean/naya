// Route du mode test de la prospection (« Envoyer un test » depuis une campagne).
// La logique vit dans services/prospection-mode-test.ts ; ici, seulement les vraies dépendances.
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { envoyerEmailTest, type DepsModeTest } from "./services/prospection-mode-test";
import {
  masterSendingEnabled, receptionReponsesEnLigne, resolveSenderConfig, envoyerEmailProspect,
  retirerSignatureFinale, claimStore, DAILY_CAP,
} from "./services/prospection-sender";
import { identitePourCampagne } from "./services/connexions/resolution";
import { adressesPropresDepuis } from "./services/reponses/ingestion";
import { lienDesinscription } from "./services/desinscription";
import { redigerTouche, roleDeTouche, combineInstructions } from "./services/sequence-message";
import { resolveFounderName } from "./services/prospection-audit";
import { isAiBlocked } from "./services/usage";

export const depsModeTest: DepsModeTest = {
  now: () => new Date(),
  getCampaign: (id) => storage.getProspectionCampaign(id),
  getSteps: (campaignId) => storage.getSequenceSteps(campaignId),
  envoiActif: masterSendingEnabled,
  receptionActive: () => receptionReponsesEnLigne(),
  identite: async (userId, campagne) =>
    identitePourCampagne(userId, campagne, await storage.getUserPreferences(userId)) as any,
  resolveSender: resolveSenderConfig,
  // Mêmes adresses que celles qui, à la réception, font classer un email « de chez nous ».
  adressesPropres: (userId, portee, sender) => sender.via === "unipile"
    ? adressesPropresDepuis(storage, { userId, projectId: portee, canal: "email" }, sender.accountId)
    : Promise.resolve([]),
  emailsEnvoyesDepuis: (userId, depuis) => storage.countOutreachSentSince(userId, depuis, "email"),
  adresseDeVraiProspect: (userId, email) => storage.adresseDeVraiProspect(userId, email),
  testsCreesDepuis: (userId, depuis) => storage.compterLeadsTestDepuis(userId, depuis),
  plafondQuotidien: DAILY_CAP,
  signature: async (userId, identite) => {
    if (identite.signature) return identite.signature;
    const [user, dna] = await Promise.all([storage.getUser(userId), storage.getBrandDna(userId)]);
    return resolveFounderName(user, dna as any);
  },
  createLead: (row) => storage.createLead(row),
  archiverLead: (leadId, userId) => storage.bulkArchiveLeads([leadId], userId),
  estDesinscrit: (leadId, userId) => storage.isLeadUnsubscribed(leadId, userId),
  lienDesinscription,
  iaBloquee: (userId) => isAiBlocked(userId),
  rediger: (userId, a) => redigerTouche(userId, a),
  consignes: async (userId, campagne) =>
    combineInstructions((await storage.getUserPreferences(userId) as any)?.messageInstructions, campagne?.messageInstructions),
  roleTouche: (steps, index) => roleDeTouche(steps, index),
  retirerSignature: retirerSignatureFinale,
  envoyer: envoyerEmailProspect,
  claimStore,
  journaliser: (row) => storage.createOutreachMessage(row),
  setProviderIds: (id, p, t) => storage.setOutreachProviderIds(id, p, t),
  terminerSequence: (leadId, campaignId, userId, at) => storage.terminerSequenceTest(leadId, campaignId, userId, at),
};

export function registerModeTestRoutes(app: Express, deps: DepsModeTest = depsModeTest) {
  // Envoie tout de suite l'email test d'une campagne (étape 1 seulement, prospect marqué test).
  app.post("/api/prospection/campaigns/:id/test-email", isAuthenticated, async (req: any, res) => {
    try {
      const r = await envoyerEmailTest(deps, req.userId, Number(req.params.id), req.body);
      if (!r.ok) return res.status(r.status).json({ message: r.code });
      res.json(r);
    } catch (e: any) {
      console.error("[mode-test]", String(e?.message ?? e).split(/\bparams:/)[0].slice(0, 200));
      res.status(500).json({ message: "echec_envoi" });
    }
  });
}
