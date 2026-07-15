/**
 * PHASE 3 — Enrichissement par prospect via Bright Data.
 *  - linkedin_person_profile  : dataset v3 (trigger + poll snapshot)
 *  - instagram_profiles       : dataset v3
 *  - scrape_as_markdown       : Web Unlocker (/request) sur la page contact/about
 *
 * 100% env-driven + DÉGRADATION GRACIEUSE : si un dataset/clé n'est pas configuré,
 * la source est simplement ignorée (retourne null) — aucun coût n'est imputé pour
 * un appel non effectué. Config Railway : BRIGHT_DATA_API_KEY, BRIGHT_DATA_LINKEDIN_DATASET,
 * BRIGHT_DATA_INSTAGRAM_DATASET, BRIGHT_DATA_SCRAPE_ZONE (fallback BRIGHT_DATA_SERP_ZONE).
 */

const API = "https://api.brightdata.com";
const REQUEST_ENDPOINT = `${API}/request`;

function apiKey(): string | undefined {
  return process.env.BRIGHT_DATA_API_KEY;
}

export function linkedinEnrichConfigured(): boolean {
  return !!(apiKey() && process.env.BRIGHT_DATA_LINKEDIN_DATASET);
}
export function instagramEnrichConfigured(): boolean {
  return !!(apiKey() && process.env.BRIGHT_DATA_INSTAGRAM_DATASET);
}
export function webScrapeConfigured(): boolean {
  return !!apiKey();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Déclenche un dataset Bright Data "collect by URL" et attend le résultat (borné).
 * Renvoie le premier enregistrement, ou null (non configuré / timeout / erreur).
 */
async function triggerAndPoll(
  datasetId: string,
  url: string,
  { maxWaitMs = 90_000, intervalMs = 5_000 }: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<any | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const trig = await fetch(
      `${API}/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&include_errors=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify([{ url }]),
      },
    );
    if (!trig.ok) return null;
    const trigJson: any = await trig.json();
    const snapshotId: string | undefined = trigJson?.snapshot_id;
    if (!snapshotId) return null;

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const snap = await fetch(`${API}/datasets/v3/snapshot/${snapshotId}?format=json`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (snap.status === 202) continue; // encore en cours
      if (!snap.ok) return null;
      const data: any = await snap.json();
      const rows = Array.isArray(data) ? data : data?.data;
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
      if (Array.isArray(rows)) return null; // terminé mais vide
    }
    return null; // timeout → dégradation
  } catch (e: any) {
    console.error("[brightdata] triggerAndPoll:", e?.message || e);
    return null;
  }
}

export interface LinkedInProfileData {
  fullName?: string;
  headline?: string;
  about?: string;
  company?: string;
  location?: string;
  raw: any;
}

export async function scrapeLinkedInProfile(url: string): Promise<LinkedInProfileData | null> {
  const dataset = process.env.BRIGHT_DATA_LINKEDIN_DATASET;
  if (!dataset || !url) return null;
  const r = await triggerAndPoll(dataset, url);
  if (!r) return null;
  return {
    fullName: r.name || r.full_name || undefined,
    headline: r.position || r.headline || r.title || undefined,
    about: r.about || r.summary || undefined,
    company: r.current_company?.name || r.company || undefined,
    location: r.location || r.city || undefined,
    raw: r,
  };
}

export interface InstagramProfileData {
  username?: string;
  biography?: string;
  followers?: number;
  raw: any;
}

export async function scrapeInstagramProfile(url: string): Promise<InstagramProfileData | null> {
  const dataset = process.env.BRIGHT_DATA_INSTAGRAM_DATASET;
  if (!dataset || !url) return null;
  const r = await triggerAndPoll(dataset, url);
  if (!r) return null;
  return {
    username: r.account || r.username || undefined,
    biography: r.biography || r.bio || undefined,
    followers: typeof r.followers === "number" ? r.followers : undefined,
    raw: r,
  };
}

export interface WebPageData {
  url: string;
  content: string; // markdown/texte tronqué (page contact/about)
}

/** Scrape une seule page (contact/about) en markdown via Web Unlocker. Tronqué. */
export async function scrapeAsMarkdown(url: string, maxChars = 4000): Promise<WebPageData | null> {
  const key = apiKey();
  if (!key || !url) return null;
  const zone = process.env.BRIGHT_DATA_SCRAPE_ZONE || process.env.BRIGHT_DATA_SERP_ZONE || "naya";
  try {
    const res = await fetch(REQUEST_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "raw", data_format: "markdown" }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return { url, content: text.slice(0, maxChars) };
  } catch (e: any) {
    console.error("[brightdata] scrapeAsMarkdown:", e?.message || e);
    return null;
  }
}
