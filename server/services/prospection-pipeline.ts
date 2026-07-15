/**
 * Orchestration du pipeline de prospection (5 phases) + helpers purs.
 * Les phases 3/4 sont gardées par assertEnrichmentAccess et loggent chaque coût
 * dans prospection_usage. Ce fichier contient d'abord les helpers PURS (dédup,
 * mapping d'erreur), puis l'orchestration (search / enrich).
 */

import { ProspectionAccessError, LinkedInWeeklyLimitError, assertEnrichmentAccess, logProspectionUsage } from "./prospection-access";
import { storage } from "../storage";
import { callClaude, CLAUDE_MODELS } from "./claude";
import { generateLeadCriteria } from "./prospection";
import { buildSearchStrategy } from "./prospection-strategy";
import {
  classifyProjectType,
  auditSectionsForProjectType,
  detectPriority,
  sanitizeMessage,
  enforceLinkedInLimit,
} from "./prospection-audit";
import { sourceLeadsFromQueries } from "./serp";
import {
  scrapeLinkedInProfile,
  scrapeInstagramProfile,
  scrapeAsMarkdown,
  linkedinEnrichConfigured,
  instagramEnrichConfigured,
  webScrapeConfigured,
} from "./brightdata-enrich";

// ─── Helpers purs ──────────────────────────────────────────────────────────────

export interface Identifiable {
  linkedinUrl?: string | null;
  email?: string | null;
}

/** Clés d'identité normalisées d'un prospect (URL LinkedIn sans query + email lowercase). */
export function leadIdentityKeys(x: Identifiable): string[] {
  const keys: string[] = [];
  const url = (x.linkedinUrl || "").toLowerCase().split("?")[0].replace(/\/+$/, "");
  if (url) keys.push(`li:${url}`);
  const email = (x.email || "").toLowerCase().trim();
  if (email) keys.push(`em:${email}`);
  return keys;
}

/**
 * Écarte les prospects déjà présents (même URL LinkedIn ou email) ET les doublons
 * internes au lot. Renvoie les prospects frais + le nombre écarté.
 */
export function dedupeAgainstExisting<T extends Identifiable>(
  found: T[],
  existing: Identifiable[],
): { fresh: T[]; skipped: number } {
  const seen = new Set<string>();
  for (const e of existing) for (const k of leadIdentityKeys(e)) seen.add(k);

  const fresh: T[] = [];
  let skipped = 0;
  for (const f of found) {
    const keys = leadIdentityKeys(f);
    if (keys.length > 0 && keys.some((k) => seen.has(k))) {
      skipped++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    fresh.push(f);
  }
  return { fresh, skipped };
}

/**
 * Traduit une erreur d'accès prospection en réponse HTTP 403 explicite.
 * Renvoie null pour toute autre erreur (le routeur renverra alors 500).
 */
export function prospectionErrorResponse(
  err: unknown,
): { status: number; body: { message: string; code: string } } | null {
  if (err instanceof ProspectionAccessError || err instanceof LinkedInWeeklyLimitError) {
    return { status: 403, body: { message: (err as Error).message, code: (err as any).code } };
  }
  return null;
}

// ─── Helpers de contexte ─────────────────────────────────────────────────────

async function projectDnaFor(userId: string, campaign: any): Promise<any> {
  const projectId = campaign?.projectId ?? null;
  const projectDna = projectId ? await storage.getBrandDnaForProject(userId, projectId) : undefined;
  return projectDna ?? (await storage.getBrandDna(userId));
}

function isWebsite(url?: string | null): boolean {
  if (!url) return false;
  return !/linkedin\.com|instagram\.com/i.test(url) && /^https?:\/\//i.test(url);
}

/** Aplati les données enrichies + notes existantes en un bloc de texte (audit / signal). */
export function enrichmentText(lead: any, data: any): string {
  const parts: string[] = [];
  if (lead?.role) parts.push(`Rôle: ${lead.role}`);
  if (lead?.company) parts.push(`Société: ${lead.company}`);
  if (lead?.sector) parts.push(`Secteur: ${lead.sector}`);
  if (lead?.notes) parts.push(`Notes: ${lead.notes}`);
  const li = data?.linkedin;
  if (li) parts.push(`LinkedIn — ${[li.headline, li.company, li.location, li.about].filter(Boolean).join(" | ")}`);
  const ig = data?.instagram;
  if (ig) parts.push(`Instagram — ${[ig.username, ig.biography, ig.followers ? `${ig.followers} abonnés` : ""].filter(Boolean).join(" | ")}`);
  if (data?.web?.content) parts.push(`Site web — ${data.web.content}`);
  return parts.join("\n") || "Données limitées : audit prudent à partir du nom/rôle/société.";
}

function parseJsonObject(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  } catch {
    return {};
  }
}

// ─── PHASE 4 : audit (Claude Sonnet, sections adaptées au type de projet) ──────

async function generateAudit(
  userId: string,
  ctx: { projectType: any; project: any; campaign: any; enrichText: string },
): Promise<Record<string, string>> {
  const sections = auditSectionsForProjectType(ctx.projectType);
  const schema = sections.map((s) => `  "${s.key}": "${s.guide}"`).join(",\n");
  const prompt = `Tu es Naya. Produis un audit factuel pour préparer une prise de contact personnalisée.

PROJET : ${ctx.project?.name || "—"}
CAMPAGNE : ${ctx.campaign?.name || "—"} | Secteur : ${ctx.campaign?.targetSector || "—"}
Angle de la campagne : ${ctx.campaign?.messageAngle || "—"}
Objectif : ${ctx.campaign?.campaignBrief || "—"}

DONNÉES OBSERVÉES SUR LE PROSPECT :
${ctx.enrichText}

Génère un audit en JSON avec EXACTEMENT ces clés (2-3 phrases factuelles chacune ; "à vérifier" si inconnu) :
{
${schema}
}

Le bloc "angle" (Angle projet) doit être SPÉCIFIQUE à cette campagne (${ctx.campaign?.name || "campagne en cours"}), ancré dans les données.
Pas d'invention. Réponds UNIQUEMENT avec le JSON.`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.smart,
    userId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1400,
    temperature: 0.3,
  });
  return parseJsonObject(raw);
}

// ─── PHASE 4 : message personnalisé (Claude Sonnet, selon le canal) ───────────

async function generateChannelMessage(
  userId: string,
  ctx: { channel: string; founderName: string; projectName: string; campaign: any; lead: any; audit: Record<string, string> },
): Promise<{ linkedinMessage?: string; emailMessage?: string }> {
  const wantLinkedIn = ctx.channel !== "email";
  const wantEmail = ctx.channel === "email" || ctx.channel === "both";

  const prompt = `Tu es Naya. Rédige ${wantLinkedIn && wantEmail ? "un message LinkedIn ET un email" : wantEmail ? "un email" : "un message LinkedIn"} de prospection pour ce prospect.

PROSPECT : ${ctx.lead?.name || ""} — ${ctx.lead?.role || ""} @ ${ctx.lead?.company || ""}
ANGLE PROJET (audit) : ${ctx.audit?.angle || ctx.campaign?.messageAngle || ""}
ENJEUX : ${ctx.audit?.enjeux || ctx.audit?.observations || ""}

RÈGLES ABSOLUES (tous canaux) :
- Ton humain, curieux, jamais commercial. Pas de "j'ai vu votre profil". Pas de pitch direct.
- JAMAIS de tiret long (—).
${wantLinkedIn ? `\nMESSAGE LINKEDIN (note de connexion) :
- MAXIMUM 200 caractères, strict.
- Un lien personnel avec la marque/la personne + une question de curiosité sincère en fin.
- Signé du prénom : ${ctx.founderName}.` : ""}
${wantEmail ? `\nEMAIL :
- 5 à 8 phrases.
- Observation factuelle d'ouverture, gap identifié, angle projet, question ouverte.
- Signé : ${ctx.founderName} — ${ctx.projectName}.` : ""}

Réponds UNIQUEMENT avec ce JSON :
{${wantLinkedIn ? '"linkedinMessage":"..."' : ""}${wantLinkedIn && wantEmail ? "," : ""}${wantEmail ? '"emailMessage":"..."' : ""}}`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.smart,
    userId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 900,
    temperature: 0.6,
  });
  const p = parseJsonObject(raw);
  const out: { linkedinMessage?: string; emailMessage?: string } = {};
  if (wantLinkedIn && typeof p.linkedinMessage === "string") {
    out.linkedinMessage = enforceLinkedInLimit(p.linkedinMessage); // ≤200, sans tiret long
  }
  if (wantEmail && typeof p.emailMessage === "string") {
    out.emailMessage = sanitizeMessage(p.emailMessage); // sans tiret long
  }
  return out;
}

// ─── PHASES 1+2 : recherche + pré-filtrage + import (plan base) ───────────────

export interface SearchResult { found: number; imported: number; skipped_duplicates: number; method: string }

export async function runCampaignSearch(userId: string, campaign: any): Promise<SearchResult> {
  const dna = await projectDnaFor(userId, campaign);
  const icp = await generateLeadCriteria(userId, campaign.id);
  const strategy = buildSearchStrategy(campaign, dna, icp);
  const queries = strategy.queries.length > 0 ? strategy.queries : icp.googleQueries;

  // Le provider réel disponible est la SERP API (X-ray). Les autres méthodes s'y ramènent.
  const executed = Math.min(queries.length, 4);
  const found = await sourceLeadsFromQueries(queries, userId);
  // PHASE 1 : chaque lot de recherche est loggé (operation 'search').
  for (let i = 0; i < executed; i++) {
    await logProspectionUsage(userId, "bright_data_search", { campaignId: campaign.id });
  }

  const existing = await storage.getLeads(userId);
  const { fresh, skipped } = dedupeAgainstExisting(
    found.map((f) => ({ ...f, linkedinUrl: f.linkedinUrl })),
    existing.map((l: any) => ({ linkedinUrl: l.linkedinUrl, email: l.email })),
  );

  const projectId = campaign.projectId ?? undefined;
  let imported = 0;
  for (const f of fresh) {
    await storage.createLead({
      userId,
      projectId,
      prospectionCampaignId: campaign.id,
      name: f.name,
      role: f.role ?? undefined,
      company: f.company ?? undefined,
      linkedinUrl: f.linkedinUrl,
      stage: "identified",
      status: "discovered",
      enriched: false,
    } as any);
    imported++;
  }
  return { found: found.length, imported, skipped_duplicates: skipped, method: strategy.method };
}

// ─── PHASES 3+4+5 : enrichissement + audit + message + CRM (plan enrichissement)

export interface EnrichResult { enriched: number; failed: number; linkedin_requests_used: number }

export async function enrichProspects(
  userId: string,
  campaign: any,
  prospectIds: number[],
): Promise<EnrichResult> {
  // PHASE 3 — garde d'accès en entrée (plan + limite LinkedIn). Throw → 403.
  await assertEnrichmentAccess(userId);

  const project = campaign.projectId ? await storage.getProject(campaign.projectId, userId) : null;
  const dna = await projectDnaFor(userId, campaign);
  const projectType = classifyProjectType(project, dna);
  const founderName =
    (dna as any)?.founderName || (dna as any)?.contactName || (dna as any)?.businessName || "Naya";
  const projectName = project?.name || (dna as any)?.businessName || campaign?.name || "";
  const channel = campaign?.channel || "linkedin";

  let enriched = 0, failed = 0, linkedinUsed = 0;

  for (const id of prospectIds) {
    const lead = await storage.getLead(id, userId);
    if (!lead) { failed++; continue; }
    try {
      const data: any = {};

      // 1. LinkedIn
      if (lead.linkedinUrl && linkedinEnrichConfigured()) {
        const li = await scrapeLinkedInProfile(lead.linkedinUrl);
        await logProspectionUsage(userId, "bright_data_linkedin_enrich", { prospectId: lead.id, campaignId: campaign.id });
        linkedinUsed++;
        if (li) data.linkedin = li;
      }
      // 2. Instagram
      if (lead.instagramUrl && instagramEnrichConfigured()) {
        const ig = await scrapeInstagramProfile(lead.instagramUrl);
        await logProspectionUsage(userId, "bright_data_instagram", { prospectId: lead.id, campaignId: campaign.id });
        if (ig) data.instagram = ig;
      }
      // 3. Site web (page contact/about uniquement)
      const website = isWebsite(lead.profileUrl) ? lead.profileUrl : null;
      if (website && webScrapeConfigured()) {
        const web = await scrapeAsMarkdown(website);
        await logProspectionUsage(userId, "bright_data_web_scrape", { prospectId: lead.id, campaignId: campaign.id });
        if (web) data.web = web;
      }

      const text = enrichmentText(lead, data);
      const priority = detectPriority(text, campaign.buyingSignals);

      // PHASE 4 — audit (Sonnet)
      const audit = await generateAudit(userId, { projectType, project, campaign, enrichText: text });
      await logProspectionUsage(userId, "claude_audit", { prospectId: lead.id, campaignId: campaign.id });

      // PHASE 4 — message (Sonnet)
      const msg = await generateChannelMessage(userId, { channel, founderName, projectName, campaign, lead, audit });
      await logProspectionUsage(userId, "claude_message", { prospectId: lead.id, campaignId: campaign.id });

      // PHASE 5 — mise à jour CRM
      const hasMessage = !!(msg.linkedinMessage || msg.emailMessage);
      await storage.updateLead(lead.id, userId, {
        enriched: true,
        enrichedAt: new Date(),
        priority,
        auditNotes: JSON.stringify(audit),
        linkedinMessage: msg.linkedinMessage,
        emailMessage: msg.emailMessage,
        enrichedProfile: data,
        stage: hasMessage ? "messages_ready" : "identified",
      } as any);
      enriched++;
    } catch (e: any) {
      console.error("[prospection] enrich prospect", id, e?.message || e);
      failed++;
    }
  }
  return { enriched, failed, linkedin_requests_used: linkedinUsed };
}
