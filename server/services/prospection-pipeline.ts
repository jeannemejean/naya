/**
 * Orchestration du pipeline de prospection (5 phases) + helpers purs.
 * Les phases 3/4 sont gardées par assertEnrichmentAccess et loggent chaque coût
 * dans prospection_usage. Ce fichier contient d'abord les helpers PURS (dédup,
 * mapping d'erreur), puis l'orchestration (search / enrich).
 */

import { callClaudeWithContext } from "./claude";
import { qualifierProspect } from "./prospection-qualify-call";
import { decisionCampagne, champsMiseAJourQualification } from "./prospection-qualification";
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
  resolveFounderName,
} from "./prospection-audit";

// Ré-export : ces helpers vivent dans prospection-audit.ts mais Task 5 (génération
// bespoke du message d'étape) les consomme depuis ce module d'orchestration —
// comportement strictement inchangé (simple forward des mêmes fonctions).
export { sanitizeMessage, enforceLinkedInLimit, resolveFounderName };
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

export function parseJsonObject(raw: string): Record<string, any> {
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

/**
 * Rédige les messages de prospection.
 *
 * Réécrit le 18 septembre 2026 après lecture des 41 messages réellement produits. Trois
 * défauts venaient du prompt lui-même, pas du modèle :
 *
 * 1. Il appelait `callClaude`, donc SANS Brand DNA, sans voix, sans langue. Le générateur ne
 *    savait pas qui écrit ni ce qu'elle propose — d'où des messages qui ne disent jamais
 *    rien de l'offre. Il passe désormais par `callClaudeWithContext`.
 * 2. Il ne recevait que DEUX sections d'audit sur six. Tout ce que l'audit savait de CHANEL
 *    — maison fondée en 1910, actionnariat privé, communication délibérément en retrait —
 *    n'atteignait jamais le message.
 * 3. Il exigeait « une question de curiosité sincère EN FIN ». 31 messages sur 41
 *    finissaient donc par une question : le modèle obéissait.
 */
async function generateChannelMessage(
  userId: string,
  ctx: {
    channel: string;
    founderName: string;
    projectName: string;
    campaign: any;
    lead: any;
    audit: Record<string, string>;
    projectId?: number | null;
    qualification?: { verdict: string; raison: string } | null;
  },
): Promise<{ linkedinMessage?: string; emailMessage?: string }> {
  const wantLinkedIn = ctx.channel !== "email";
  const wantEmail = ctx.channel === "email" || ctx.channel === "both";

  const attentionParticuliere = ctx.qualification?.verdict === "attention_particuliere";

  const prompt = `Rédige ${wantLinkedIn && wantEmail ? "un message LinkedIn ET un email" : wantEmail ? "un email" : "un message LinkedIn"} de prospection pour ce prospect.

PROSPECT : ${ctx.lead?.name || ""} — ${ctx.lead?.role || ""} @ ${ctx.lead?.company || ""}

CE QUE L'AUDIT A TROUVÉ
Contexte : ${ctx.audit?.contexteMarque || ctx.audit?.contexte || ""}
Audience : ${ctx.audit?.audience || ""}
Contenu : ${ctx.audit?.contenu || ""}
Positionnement : ${ctx.audit?.positionnement || ""}
Enjeux : ${ctx.audit?.enjeux || ctx.audit?.observations || ""}
Angle : ${ctx.audit?.angle || ctx.campaign?.messageAngle || ""}
${ctx.qualification ? `\nPOURQUOI CE PROSPECT : ${ctx.qualification.raison}` : ""}
${attentionParticuliere ? `\nATTENTION : ce prospect a été classé « attention particulière ». L'approche standard le desservirait. Écris quelque chose qui ne ressemble pas à une prospection ordinaire : montre par la forme même du message ce que tu sais faire.` : ""}

CE QUI REND UN MESSAGE LU

Le prospect reçoit dix sollicitations par jour. La question n'est pas « comment être poli »
mais « pourquoi lirait-il celui-ci jusqu'au bout ».

- Appuie-toi sur quelque chose de PRÉCIS trouvé dans l'audit. Pas « votre marque a une vraie
  voix » : une observation qu'on ne pourrait pas écrire à quelqu'un d'autre.
- Dis ce que cette observation te fait penser, en tant que personne qui fait ce métier.
  Une lecture, un point de vue, quelque chose qui a une valeur en soi.
- Le prospect doit pouvoir répondre en une phrase, ou ne pas répondre. Jamais lui demander
  d'expliquer son métier : c'est du travail gratuit demandé à un inconnu.

CE QUI EST INTERDIT

- Terminer sur une question ouverte du type « comment gérez-vous... », « quelle est votre
  plus grande frustration... ». C'est la formule qui fait fermer le message.
- Le compliment retourné : « vous avez les bons codes, mais rarement un point de vue ».
  Dire à quelqu'un que son travail est médiocre puis lui demander de se justifier.
- Tout adjectif qui s'accorde en genre pour te décrire (« curieux », « ravi », « intéressé »).
  Tourne la phrase autrement : l'expéditrice ne doit pas changer de genre d'un message à
  l'autre.
- Les tirets longs (—).
- « J'ai vu votre profil », « je me permets de vous contacter », « en tant qu'expert ».
${wantLinkedIn ? `\nMESSAGE LINKEDIN (note de connexion) :
- MAXIMUM 200 caractères, strict. C'est très court : une observation précise et une raison
  d'accepter, rien de plus.
- Signé du prénom : ${ctx.founderName}.` : ""}
${wantEmail ? `\nEMAIL :
- 5 à 8 phrases.
- L'observation précise, ce qu'elle révèle, ce que ${ctx.projectName} sait en faire
  concrètement. Une ouverture à la fin, pas un interrogatoire.
- Signé : ${ctx.founderName} — ${ctx.projectName}.` : ""}

Réponds UNIQUEMENT avec ce JSON :
{${wantLinkedIn ? '"linkedinMessage":"..."' : ""}${wantLinkedIn && wantEmail ? "," : ""}${wantEmail ? '"emailMessage":"..."' : ""}}`;

  // callClaudeWithContext, et non callClaude : le Brand DNA, la voix et la langue du compte
  // sont injectés. Sans eux, le modèle ignore ce que propose l'utilisatrice — d'où des
  // messages qui n'en parlent jamais.
  const raw = await callClaudeWithContext({
    userId,
    projectId: ctx.projectId ?? null,
    userMessage: prompt,
    model: CLAUDE_MODELS.smart,
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

  const [project, dna, user] = await Promise.all([
    campaign.projectId ? storage.getProject(campaign.projectId, userId) : Promise.resolve(null),
    projectDnaFor(userId, campaign),
    storage.getUser(userId),
  ]);
  const projectType = classifyProjectType(project, dna);
  // Signature = PRÉNOM du créateur (jamais le nom d'agence ni "Naya").
  const founderName = resolveFounderName(user, dna);
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

      // PHASE 4bis — QUALIFICATION. L'audit etait jusqu'ici ecrit, stocke, utilise pour
      // rediger — jamais juge. Les 120 prospects de la production etaient tous `discovered`.
      //
      // Enveloppe : un verdict indisponible vaut « pas qualifie », jamais « ecarte ». Perdre
      // un prospect parce qu'un appel reseau a rate serait le defaut que ce dispositif
      // existe pour eviter.
      const qualification = await qualifierProspect({
        userId,
        projectId: (project as any)?.id ?? null,
        audit,
        contexteProspect: text,
      }).catch(() => null);

      const decision = decisionCampagne(qualification);

      // PHASE 4 — message (Sonnet)
      const msg = await generateChannelMessage(userId, {
        channel, founderName, projectName, campaign, lead, audit,
        projectId: (project as any)?.id ?? null,
        qualification,
      });
      await logProspectionUsage(userId, "claude_message", { prospectId: lead.id, campaignId: campaign.id });

      // PHASE 5 — mise à jour CRM.
      // On écrit AUSSI les champs "legacy" (strategicNotes, message1/2) pour que l'affichage
      // historique (détail prospect, badges LeadCard) reste cohérent après unification.
      const hasMessage = !!(msg.linkedinMessage || msg.emailMessage);
      const auditJson = JSON.stringify(audit);
      await storage.updateLead(lead.id, userId, {
        enriched: true,
        enrichedAt: new Date(),
        priority,
        auditNotes: auditJson,
        linkedinMessage: msg.linkedinMessage,
        emailMessage: msg.emailMessage,
        enrichedProfile: data,
        stage: hasMessage ? "messages_ready" : "identified",
        // Compat affichage
        strategicNotes: auditJson,
        message1: msg.linkedinMessage ?? (msg.emailMessage ? undefined : undefined),
        message2: msg.emailMessage,
        // Champs de qualification, calcules par une fonction PURE et testee : le
        // branchement lui-meme n'etait couvert par aucun test, et une mutation elargissant
        // le retrait passait les 1278 tests du depot.
        ...champsMiseAJourQualification(qualification, new Date()),
      } as any);

      if (decision === "retirer") {
        console.log(`[Qualification] prospect ${lead.id} retire de la campagne ${campaign.id} : ${qualification?.raison}`);
      } else if (decision === "signaler") {
        console.log(`[Qualification] prospect ${lead.id} signale (${qualification?.verdict}/${qualification?.confiance}) : ${qualification?.raison}`);
      }
      enriched++;
    } catch (e: any) {
      console.error("[prospection] enrich prospect", id, e?.message || e);
      failed++;
    }
  }
  return { enriched, failed, linkedin_requests_used: linkedinUsed };
}
