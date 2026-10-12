/**
 * Routine `sourcing_prospects` : chaque jour, pour une campagne active, Naya cherche des
 * prospects (Bright Data, requêtes dérivées de l'objectif de la campagne) jusqu'à la cible,
 * puis prépare quelques prospects neufs (audit, brief, premiers messages) à valider.
 *
 * Rien ne part sans la validation de l'utilisatrice : cette routine n'enrôle jamais.
 * Coûts bornés : un passage par jour, plafond d'appels SERP de sourcerCampagne, préparation
 * limitée à `prospectsPerDay` et à la limite LinkedIn hebdomadaire.
 */
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { sourcerCampagne, enrichProspects } from "../prospection-pipeline";
import { hasProspectionEnrichment, LinkedInWeeklyLimitError, ProspectionAccessError } from "../prospection-access";
import { serpConfigured } from "../serp";
import { resumeSourcing, rechercheEnPanne, type EtatEnrichissement } from "./sourcing-resume";
import type { ResultatPassage } from "./types";

export const KIND_SOURCING = "sourcing_prospects";
export const cleSourcing = (campaignId: number) => `campaign:${campaignId}`;

export async function executerSourcing(routine: Routine): Promise<ResultatPassage> {
  const campaignId = Number((routine.cible as any)?.campaignId);
  const campaign: any = Number.isInteger(campaignId) ? await storage.getProspectionCampaign(campaignId) : null;
  if (!campaign || campaign.userId !== routine.userId) {
    return { statut: "rien_a_faire", resume: "Cette campagne n'existe plus : routine arrêtée.", desactiver: true };
  }
  if (campaign.status !== "active") {
    return { statut: "rien_a_faire", resume: "Campagne en pause : aucune recherche aujourd'hui." };
  }
  if (!serpConfigured()) {
    return { statut: "erreur", resume: "Bright Data n'est pas configuré (clé absente) : aucune recherche lancée." };
  }

  const s = await sourcerCampagne(routine.userId, campaign);
  if (rechercheEnPanne(s.appels, s.erreursRecherche ?? 0)) {
    return {
      statut: "erreur",
      resume: `Bright Data a refusé toutes les recherches (${s.derniereErreurRecherche ?? "raison inconnue"}) : vérifie la clé ou la zone SERP.`,
      details: { appels: s.appels, erreurs: s.erreursRecherche },
      notifier: true,
    };
  }

  // Préparation : les prospects neufs de la campagne (y compris ceux importés les jours
  // précédents et pas encore préparés), au plus `prospectsPerDay` par passage.
  let prepares = 0;
  let enrichissement: EtatEnrichissement = "ok";
  const quota = Math.max(1, Number(campaign.prospectsPerDay) || 3);
  if (await hasProspectionEnrichment(routine.userId)) {
    const leads = await storage.getLeadsByCampaign(campaign.id, routine.userId);
    const ids = leads
      .filter((l: any) => l.stage === "identified" && !l.enriched && !l.archivedAt)
      .slice(0, quota)
      .map((l: any) => l.id);
    if (ids.length > 0) {
      try {
        prepares = (await enrichProspects(routine.userId, campaign, ids)).enriched;
      } catch (e: any) {
        if (e instanceof LinkedInWeeklyLimitError) enrichissement = "limite";
        else if (e instanceof ProspectionAccessError) enrichissement = "plan";
        else {
          enrichissement = "erreur";
          console.error(`[routines/sourcing] préparation échouée (campagne ${campaign.id}) :`, e?.message);
        }
      }
    }
  } else {
    enrichissement = "plan";
  }

  const details = {
    importes: s.imported, prepares, cible: s.cible, reserve: s.reserve, appels: s.appels,
    erreursRecherche: s.erreursRecherche ?? 0,
  };
  if (s.imported === 0 && prepares === 0) {
    const resume = s.reserveSuffisante
      ? `Réserve suffisante : ${s.reserve} prospects attendent déjà d'être contactés.`
      : resumeSourcing({ importes: 0, prepares: 0, enrichissement });
    return { statut: "rien_a_faire", resume, details };
  }
  return { statut: "ok", resume: resumeSourcing({ importes: s.imported, prepares, enrichissement }), details, notifier: true };
}
