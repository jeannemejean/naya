/**
 * PHASE 1 — Stratégie de recherche. Logique 100% PURE et testable.
 *
 * La méthode et les requêtes viennent des critères générés pour CETTE utilisatrice
 * (generateLeadCriteria, nourri de son Brand DNA et de sa campagne) — jamais d'une table
 * « secteur → méthode ». Une ancienne version classait la mode, la beauté ou le luxe en
 * « recherche LinkedIn » par expression régulière, et envoyait alors à Google des requêtes
 * booléennes Sales Navigator : ~0 résultat pour ces secteurs. Naya est sur mesure ; un
 * playbook d'agence codé en dur n'a rien à faire ici.
 *
 * Le seul fournisseur réellement branché est la SERP API (X-ray Google). Toute requête
 * passe donc par normaliserRequeteGoogle avant de partir.
 */

import { projectOfferNature } from "./prospection";
import type { IdealCustomerProfile } from "./prospection";
import { normaliserRequeteGoogle } from "./prospection-sourcing";

export type SearchMethod = "serp_xray";

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
 * Construit la stratégie de recherche. Les requêtes Google de l'ICP sont prioritaires ;
 * à défaut, les requêtes LinkedIn sont traduites en X-ray (jamais envoyées brutes).
 */
export function buildSearchStrategy(
  _campaign: { targetSector?: string | null },
  projectDna: { offers?: string | null; uniquePositioning?: string | null; businessType?: string | null } | null | undefined,
  icp: IdealCustomerProfile,
): SearchStrategy {
  const source =
    Array.isArray(icp.googleQueries) && icp.googleQueries.length > 0
      ? icp.googleQueries
      : Array.isArray(icp.linkedinQueries) ? icp.linkedinQueries : [];
  const queries = source
    .map((q) => normaliserRequeteGoogle(q))
    .filter((q): q is string => !!q);
  return {
    method: "serp_xray",
    icp: {
      jobTitles: icp.jobTitles ?? [],
      seniority: icp.seniority ?? [],
      sectors: icp.sectors ?? [],
      companySize: icp.companySize ?? "",
      geographies: icp.geographies ?? [],
      keywords: icp.keywords ?? [],
      exclusions: icp.exclusions ?? [],
    },
    exclusionSignal: projectOfferNature(projectDna),
    queries,
  };
}
