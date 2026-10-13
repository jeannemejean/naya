// Les vraies dépendances des rapports client, et l'exécuteur de la routine pour l'ordonnanceur.
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import type { ExecuteurRoutine } from "../routines/types";
import { preparerRapport, type DepsRapport } from "./rediger";
import { executerRapport, KIND_RAPPORT } from "./routine";
import { moisDe, type EntreesRapport } from "./donnees";

/** Tout ce que le rapport du mois peut dire du projet, sans rien calculer ici. */
async function lireEntrees(userId: string, projectId: number, mois: string): Promise<EntreesRapport> {
  const [mesures, contenusTous, campagnes, constats] = await Promise.all([
    storage.getMesures(userId, projectId, 13),
    storage.getContent(userId, 500, projectId),
    storage.getProspectionCampaigns(userId),
    storage.getVeilleConstats(userId, projectId, { limite: 60, depuis: new Date(`${mois}-01T00:00:00Z`) }),
  ]);
  const contenus = contenusTous.filter((c: any) => c.publishedAt && moisDe(c.publishedAt) === mois);
  const scores = await storage.getScoresReception(contenus.map((c: any) => c.id));
  const leads: any[] = [];
  for (const c of campagnes.filter((x: any) => x.projectId === projectId)) leads.push(...await storage.getLeadsByCampaign(c.id, userId));
  const messages = await storage.getOutreachForLeads(leads.map((l) => l.id));
  return { mesures: mesures as any, contenus: contenus as any, scores, messages: messages as any, leads, constats: constats as any };
}

export const depsRapport: DepsRapport = {
  getProject: (id, userId) => storage.getProject(id, userId),
  getRapport: (userId, projectId, mois) => storage.getRapport(userId, projectId, mois),
  lireEntrees,
  nomAgence: async (userId) => {
    const dna: any = await storage.getBrandDna(userId);
    const u: any = await storage.getUser(userId);
    return dna?.businessName || [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "l'agence";
  },
  garde: gardeDepense,
  // Mode tiers : un texte destiné au client ne reçoit aucune note privée de l'utilisatrice.
  ia: (userId, projectId, prompt) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 1800, destinataire: "tiers",
  }),
  enregistrer: (userId, projectId, mois, v) => storage.enregistrerBrouillonRapport(userId, projectId, mois, v),
};

export const EXECUTEURS_RAPPORTS: Record<string, ExecuteurRoutine> = {
  [KIND_RAPPORT]: (r: Routine) => executerRapport(r, {
    getProject: (id, u) => storage.getProject(id, u),
    getRapport: (u, p, m) => storage.getRapport(u, p, m),
    preparer: (u, p, m) => preparerRapport(u, p, m, depsRapport),
    maintenant: () => new Date(),
  }),
};
