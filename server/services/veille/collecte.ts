/** Collecte de la veille : recherche Google, lecture de page, question à une IA, coûts imputés. */
import { serpSearchStrict, type SerpOptions, type SerpResult } from "../serp";
import { scrapeAsMarkdown, webScrapeConfigured } from "../brightdata-enrich";
import { recordSpend, SCRAPE_COST_EUR, GEO_COST_EUR } from "../usage";
import { interrogerMoteur, type Moteur, type ReponseMoteur } from "./moteurs-ia";

/** Recherche Google (coût imputé par serpSearchStrict). Lève en cas d'échec. */
export function chercher(userId: string, requete: string, opts: SerpOptions): Promise<SerpResult[]> {
  return serpSearchStrict(requete, userId, opts);
}

/**
 * Lit une page (texte tronqué). Le coût est imputé dès que l'appel a pu partir : la lecture
 * de pages n'était jusqu'ici comptée nulle part dans le budget.
 */
export async function lirePage(userId: string, url: string, maxChars = 4000): Promise<string | null> {
  if (!webScrapeConfigured()) return null;
  const page = await scrapeAsMarkdown(url, maxChars);
  recordSpend(userId, SCRAPE_COST_EUR).catch(() => {});
  return page?.content ?? null;
}

/** Pose une question à une IA (GEO). Coût imputé même si la réponse est ensuite illisible. */
export async function interroger(userId: string, moteur: Moteur, prompt: string): Promise<ReponseMoteur> {
  try {
    return await interrogerMoteur(moteur, prompt);
  } finally {
    recordSpend(userId, GEO_COST_EUR).catch(() => {});
  }
}
