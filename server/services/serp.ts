/**
 * Sourcing de prospects via Bright Data SERP API.
 * On exécute des requêtes Google X-ray (site:linkedin.com/in …) générées par l'IA,
 * et on parse les résultats organiques en prospects (nom + URL LinkedIn + rôle/société).
 *
 * Env : BRIGHT_DATA_API_KEY, BRIGHT_DATA_SERP_ZONE (def. "naya").
 */

import { recordSpend, SERP_COST_EUR } from "./usage";

const SERP_ENDPOINT = "https://api.brightdata.com/request";

export interface SerpResult { link: string; title: string; description?: string; source?: string; publishedAtRaw?: string }
export interface ExtractedLead { name: string; role: string | null; company: string | null; linkedinUrl: string }

/**
 * Verticale, fenêtre de fraîcheur, localisation et page. Générique : la lecture s'en sert
 * (verticale actualités, France), la prospection aussi (gl/hl du marché + pagination).
 */
export interface SerpOptions {
  vertical?: "web" | "news";
  freshness?: "week";
  pays?: string;
  langue?: string;
  /** Page de résultats, 0 = première. Google pagine par 10 (`start=`). */
  page?: number;
}

export function serpConfigured(): boolean {
  return !!process.env.BRIGHT_DATA_API_KEY;
}

/**
 * Construit l'URL Google interrogée via la SERP API. Pur — testé isolément.
 * Encodage manuel via encodeURIComponent (et non URLSearchParams, qui encode
 * l'espace en "+" au lieu de "%20" — incompatible avec les opérateurs Google
 * de type `site:` ou les guillemets d'une requête exacte).
 */
export function buildSerpUrl(query: string, opts: SerpOptions = {}): string {
  const params = [`q=${encodeURIComponent(query)}`];
  if (opts.vertical === "news") params.push("tbm=nws");
  if (opts.freshness === "week") params.push(`tbs=${encodeURIComponent("qdr:w")}`);
  // Sans gl/hl, Bright Data sort de Google depuis un pays de sortie aléatoire
  // (constaté : Germany, Croatia, Peru, Brasil, parfois aucun) — résultats non
  // déterministes (jusqu'à 0 sur 3 appels identiques) et dates en anglais.
  // Épingler pays + langue corrige ce bug, ce n'est pas une préférence.
  if (opts.pays) params.push(`gl=${encodeURIComponent(opts.pays)}`);
  if (opts.langue) params.push(`hl=${encodeURIComponent(opts.langue)}`);
  if (opts.page && opts.page > 0) params.push(`start=${Math.floor(opts.page) * 10}`);
  return `https://www.google.com/search?${params.join("&")}`;
}

/**
 * Extrait les résultats du corps SERP. Deux formes possibles :
 * `organic` (recherche web, ce que lit la prospection) et `news` (verticale actualités,
 * qui porte en plus une date brute — c'est elle qui rend la fraîcheur fiable).
 * Pur, tolérant : toute forme inattendue rend une liste vide plutôt que de jeter.
 */
export function parseSerpBody(body: any): SerpResult[] {
  const raw: any[] = Array.isArray(body?.news) ? body.news : Array.isArray(body?.organic) ? body.organic : [];
  return raw
    .map((o) => ({
      link: o?.link || o?.url || "",
      title: o?.title || "",
      description: o?.description || o?.snippet || undefined,
      source: o?.source || o?.publisher || undefined,
      publishedAtRaw: o?.date || o?.published || undefined,
    }))
    .filter((r) => r.link);
}

/** Exécute une requête Google via la SERP API et renvoie les résultats organiques (ou actualités). */
export async function serpSearch(query: string, userId?: string, opts: SerpOptions = {}): Promise<SerpResult[]> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return [];
  const zone = process.env.BRIGHT_DATA_SERP_ZONE || "naya";
  const url = buildSerpUrl(query, opts);
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
    return parseSerpBody(body);
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

// Le sourcing de prospects (pagination, cible, plafond d'appels, gl/hl) vit dans
// prospection-sourcing.ts → sourcerJusquaCible, appelé par prospection-pipeline.ts.
