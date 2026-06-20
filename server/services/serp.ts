/**
 * Sourcing de prospects via Bright Data SERP API.
 * On exécute des requêtes Google X-ray (site:linkedin.com/in …) générées par l'IA,
 * et on parse les résultats organiques en prospects (nom + URL LinkedIn + rôle/société).
 *
 * Env : BRIGHT_DATA_API_KEY, BRIGHT_DATA_SERP_ZONE (def. "naya").
 */

import { recordSpend, SERP_COST_EUR } from "./usage";

const SERP_ENDPOINT = "https://api.brightdata.com/request";

export interface SerpResult { link: string; title: string; description?: string }
export interface ExtractedLead { name: string; role: string | null; company: string | null; linkedinUrl: string }

export function serpConfigured(): boolean {
  return !!process.env.BRIGHT_DATA_API_KEY;
}

/** Exécute une requête Google via la SERP API et renvoie les résultats organiques. */
export async function serpSearch(query: string, userId?: string): Promise<SerpResult[]> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return [];
  const zone = process.env.BRIGHT_DATA_SERP_ZONE || "naya";
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(SERP_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "json", data_format: "parsed_light" }),
    });
    // Imputation du coût Bright Data (1 requête facturée), même si le parsing échoue ensuite.
    if (userId) recordSpend(userId, SERP_COST_EUR).catch(() => {});
    if (!res.ok) return [];
    const wrapper: any = await res.json();
    // La réponse SERP API : { status_code, headers, body } où body est une STRING JSON.
    let body: any = wrapper?.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { return []; } }
    const organic: any[] = body?.organic || [];
    if (!Array.isArray(organic)) return [];
    return organic
      .map((o) => ({ link: o.link || o.url || "", title: o.title || "", description: o.description || o.snippet || "" }))
      .filter((r) => r.link);
  } catch {
    return [];
  }
}

/** Transforme un résultat Google en prospect, uniquement si c'est un profil LinkedIn /in/. */
export function extractLinkedInLead(result: SerpResult): ExtractedLead | null {
  const link = result.link || "";
  if (!/linkedin\.com\/in\//i.test(link)) return null;

  // Nettoie le titre : retire " | LinkedIn", " - LinkedIn", etc.
  const cleanedTitle = (result.title || "").replace(/\s*[|\-–]\s*LinkedIn.*$/i, "").trim();
  const parts = cleanedTitle.split(/\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0] || "";
  if (!name) return null;

  let role: string | null = null;
  let company: string | null = null;
  if (parts.length >= 3) { role = parts[1]; company = parts[2]; }
  else if (parts.length === 2) { company = parts[1]; }

  const linkedinUrl = link.split("?")[0];
  return { name, role, company, linkedinUrl };
}

/** Lance plusieurs requêtes X-ray, agrège et déduplique les profils trouvés (par URL). */
export async function sourceLeadsFromQueries(queries: string[], userId?: string, maxQueries = 4): Promise<ExtractedLead[]> {
  const seen = new Set<string>();
  const out: ExtractedLead[] = [];
  for (const q of queries.slice(0, maxQueries)) {
    const results = await serpSearch(q, userId);
    for (const r of results) {
      const lead = extractLinkedInLead(r);
      if (!lead) continue;
      const key = lead.linkedinUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lead);
    }
  }
  return out;
}
