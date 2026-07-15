/**
 * PHASE 1 — Stratégie de recherche ADAPTIVE (plan base, pas de quota).
 * Détermine dynamiquement la méthode de recherche + l'ICP normalisé + le signal
 * d'exclusion des concurrents directs, à partir du secteur et du DNA du projet.
 * Logique 100% PURE et testable.
 */

import { projectOfferNature } from "./prospection";
import type { IdealCustomerProfile } from "./prospection";

export type SearchMethod = "linkedin_people_search" | "search_engine" | "serp_xray";
export type SectorClass = "creative_lifestyle" | "agriculture_terroir" | "default";

const CREATIVE_LIFESTYLE = /(mode|beaut|lifestyle|luxe|cosm[ée]t|fashion|pr[êe]t-[àa]-porter|joaillerie|d[ée]coration)/i;
const AGRICULTURE_TERROIR = /(vignoble|vin\b|oenotouris|oenolog|viticult|agricult|terroir|domaine|brasserie|fromag|olive|apicult)/i;

/** Classe le secteur de la campagne pour orienter la méthode de recherche. */
export function classifySector(sector?: string | null): SectorClass {
  const s = (sector || "").toLowerCase();
  if (CREATIVE_LIFESTYLE.test(s)) return "creative_lifestyle";
  if (AGRICULTURE_TERROIR.test(s)) return "agriculture_terroir";
  return "default";
}

/** Méthode de recherche principale déduite du secteur. */
export function searchMethodForSector(sector?: string | null): SearchMethod {
  switch (classifySector(sector)) {
    case "creative_lifestyle":
      return "linkedin_people_search";
    case "agriculture_terroir":
      return "search_engine";
    default:
      return "serp_xray";
  }
}

export interface NormalizedIcp {
  jobTitles: string[];
  seniority: string[];
  sectors: string[];
  companySize: string;
  geographies: string[];
  keywords: string[];
  exclusions: string[];
}

export interface SearchStrategy {
  method: SearchMethod;
  icp: NormalizedIcp;
  exclusionSignal: string; // nature de la prestation vendue par le projet (concurrents à exclure)
  queries: string[];
}

/**
 * Construit la stratégie de recherche complète. `projectDna` sert au signal d'exclusion,
 * `icp` provient de generateLeadCriteria (Claude). France par défaut si aucune géo fournie.
 */
export function buildSearchStrategy(
  campaign: { targetSector?: string | null },
  projectDna: { offers?: string | null; uniquePositioning?: string | null; businessType?: string | null } | null | undefined,
  icp: IdealCustomerProfile,
): SearchStrategy {
  const method = searchMethodForSector(campaign?.targetSector);
  const geographies = icp.geographies && icp.geographies.length > 0 ? icp.geographies : ["France"];
  const queries =
    method === "serp_xray" || method === "search_engine"
      ? icp.googleQueries
      : icp.linkedinQueries;
  return {
    method,
    icp: {
      jobTitles: icp.jobTitles ?? [],
      seniority: icp.seniority ?? [],
      sectors: icp.sectors ?? [],
      companySize: icp.companySize ?? "",
      geographies,
      keywords: icp.keywords ?? [],
      exclusions: icp.exclusions ?? [],
    },
    exclusionSignal: projectOfferNature(projectDna),
    queries: Array.isArray(queries) ? queries : [],
  };
}
