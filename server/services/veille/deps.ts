/** Les vraies dépendances des routines de veille, et les exécuteurs prêts pour l'ordonnanceur. */
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { isAiBlocked, recordSpend, SCRAPE_COST_EUR } from "../usage";
import { serpConfigured } from "../serp";
import { webScrapeConfigured, instagramEnrichConfigured, scrapeInstagramProfile } from "../brightdata-enrich";
import { callClaude, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import type { ExecuteurRoutine } from "../routines/types";
import { chercher, lirePage, interroger } from "./collecte";
import { moteursConfigures } from "./moteurs-ia";
import { executerConcurrents, executerVoixClient, executerSerp, executerGeo, type DepsVeille } from "./executeurs";
import { KIND_CONCURRENTS, KIND_VOIX_CLIENT, KIND_SERP, KIND_GEO } from "./types";

export const depsVeille: DepsVeille = {
  storage: storage as any,
  garde: gardeDepense,
  illimite: async (userId) => (await storage.getUser(userId))?.role === "owner",
  bloque: isAiBlocked,
  chercher,
  lirePage,
  interroger,
  moteurs: () => moteursConfigures(),
  ia: (userId, projectId, system, prompt) => callClaude({
    model: CLAUDE_MODELS.fast, system, messages: [{ role: "user", content: prompt }],
    max_tokens: 1500, temperature: 0.2, userId, projectId, taskKind: "fast_generation",
  }),
  instagram: async (userId, url) => {
    const r = await scrapeInstagramProfile(url);
    recordSpend(userId, SCRAPE_COST_EUR).catch(() => {});
    return r?.raw ?? null;
  },
  serpConfigure: serpConfigured,
  lectureConfiguree: webScrapeConfigured,
  instagramConfigure: instagramEnrichConfigured,
};

const lie = (f: (r: Routine, d: DepsVeille) => Promise<any>): ExecuteurRoutine => (r) => f(r, depsVeille);

export const EXECUTEURS_VEILLE: Record<string, ExecuteurRoutine> = {
  [KIND_CONCURRENTS]: lie(executerConcurrents),
  [KIND_VOIX_CLIENT]: lie(executerVoixClient),
  [KIND_SERP]: lie(executerSerp),
  [KIND_GEO]: lie(executerGeo),
};
