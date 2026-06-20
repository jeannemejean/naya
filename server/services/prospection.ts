/**
 * Service de prospection intelligente — Naya
 *
 * Implémente la logique du SKILL.md :
 * 1. Lit les campagnes de prospection actives
 * 2. Génère un audit structuré (6 sections) pour un prospect
 * 3. Rédige les 3 messages (LinkedIn ou Email) selon le canal de la campagne
 * 4. Respecte le Brand DNA de l'utilisateur (ton, offres, positionnement)
 */

import { callClaude } from "./claude";
import { storage } from "../storage";
import { CLAUDE_MODELS } from "./claude";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProspectInput {
  name: string;
  company: string;
  role?: string;
  sector?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  notes?: string; // infos brutes collectées manuellement
}

export interface ProspectEnrichment {
  strategicNotes: string;   // JSON.stringify() de AuditSections
  message1: string;         // connexion LinkedIn (≤200 cars) ou email court
  message2: string;         // suivi après connexion
  message3: string;         // clôture
}

export interface AuditSections {
  contexteMarque: string;
  audience: string;
  contenu: string;
  positionnement: string;
  enjeux: string;
  angle: string;
}

// ─── Constantes pipeline ──────────────────────────────────────────────────────

export const PROSPECTION_STAGES = [
  { key: "identified",       label: "Identifié",           color: "#94a3b8" },
  { key: "messages_ready",   label: "Messages prêts",       color: "#6366f1" },
  { key: "connection_sent",  label: "Connexion envoyée",    color: "#3b82f6" },
  { key: "connected",        label: "Connecté",             color: "#06b6d4" },
  { key: "followup1_sent",   label: "Suivi 1 envoyé",       color: "#f59e0b" },
  { key: "followup2_sent",   label: "Suivi 2 envoyé",       color: "#f97316" },
  { key: "in_discussion",    label: "En discussion",        color: "#8b5cf6" },
  { key: "proposal_sent",    label: "Proposition envoyée",  color: "#ec4899" },
  { key: "signed",           label: "Signé ✅",             color: "#10b981" },
  { key: "no_follow",        label: "Sans suite",           color: "#475569" },
] as const;

// ─── Génération IA principale ─────────────────────────────────────────────────

/**
 * Génère l'audit de marque (6 sections) + les 3 messages pour un prospect.
 * Utilise le Brand DNA de l'utilisateur et la campagne de prospection associée.
 */
export async function enrichProspect(
  userId: string,
  prospect: ProspectInput,
  campaignId?: number | null
): Promise<ProspectEnrichment> {

  // 1. Récupérer le Brand DNA
  const brandDna = await storage.getBrandDna(userId);
  const founderName = (brandDna as any)?.founderName || (brandDna as any)?.contactName || "Fondateur";
  const businessName = brandDna?.businessName || "L'agence";
  const voiceTone = brandDna?.communicationStyle || "naturel, direct, humain";
  const offers = (brandDna as any)?.offers || brandDna?.uniquePositioning || "";
  const positioning = brandDna?.uniquePositioning || "";

  // 2. Récupérer la campagne de prospection (si fournie)
  let campaign: any = null;
  if (campaignId) {
    campaign = await storage.getProspectionCampaign(campaignId);
  }

  const campaignContext = campaign
    ? `
CAMPAGNE ACTIVE : ${campaign.name}
Secteur cible : ${campaign.targetSector || "Non spécifié"}
Canal : ${campaign.channel || "linkedin"}
Offre proposée : ${campaign.offer || offers}
Brief campagne : ${campaign.campaignBrief || ""}
Angle de message : ${campaign.messageAngle || ""}
Signaux d'achat recherchés : ${campaign.buyingSignals || ""}
`
    : `Canal par défaut : LinkedIn`;

  const prospectContext = `
PROSPECT :
Nom : ${prospect.name}
Entreprise : ${prospect.company}
Rôle : ${prospect.role || "Fondateur / Dirigeant"}
Secteur : ${prospect.sector || "Non précisé"}
LinkedIn : ${prospect.linkedinUrl || "Non fourni"}
Instagram : ${prospect.instagramUrl || "Non fourni"}
Notes brutes : ${prospect.notes || "Aucune"}
`;

  const brandContext = `
BRAND DNA DE L'UTILISATEUR :
Agence / Entreprise : ${businessName}
Prénom fondateur (signature) : ${founderName}
Ton de communication : ${voiceTone}
Offres : ${offers}
Positionnement : ${positioning}
`;

  // 3. Générer l'audit 6 sections
  const auditPrompt = `Tu es Naya, un OS IA pour entrepreneurs. Tu dois produire un audit de marque structuré pour un prospect, en vue d'une prise de contact personnalisée.

${brandContext}
${campaignContext}
${prospectContext}

Génère un audit en JSON avec exactement ces 6 clés :
{
  "contexteMarque": "Histoire, positionnement, produits/services, stade, ancienneté, géographie. 3-4 phrases factuelles.",
  "audience": "Qui la marque touche. Canaux utilisés. Volume estimé. Profil type client. 2-3 phrases.",
  "contenu": "Ce qu'elle publie. Fréquence. Formats. Ton. Sujets récurrents. Performance. 2-3 phrases.",
  "positionnement": "Ce qui la différencie. Son angle distinctif. Ce que ses concurrents ne font pas. 2-3 phrases.",
  "enjeux": "2-3 défis communication identifiables et documentables. Observations factuelles uniquement — pas d'opinions.",
  "angle": "L'accroche ou le concept spécifique que ${businessName} pourrait utiliser. Ancré dans les données. Lié à la campagne active. 2-3 phrases."
}

Règles :
- Tout ce qui est inconnu doit être formulé comme "à vérifier / à confirmer"
- Pas d'inventions. Observer et formuler ce qui est vérifiable.
- Langage factuel, professionnel, concis.
- Réponds UNIQUEMENT avec le JSON, aucun texte avant ou après.`;

  const auditRaw = await callClaude({
    model: CLAUDE_MODELS.fast,
    userId,
    messages: [{ role: "user", content: auditPrompt }],
    max_tokens: 1200,
    temperature: 0.3,
  });

  let audit: AuditSections;
  try {
    const json = auditRaw.match(/\{[\s\S]*\}/)?.[0] || auditRaw;
    audit = JSON.parse(json);
  } catch {
    audit = {
      contexteMarque: auditRaw.slice(0, 300),
      audience: "",
      contenu: "",
      positionnement: "",
      enjeux: "",
      angle: "",
    };
  }

  // 4. Générer les 3 messages
  const channel = campaign?.channel || "linkedin";
  const isLinkedIn = channel !== "email";

  const messagesPrompt = `Tu es Naya. Tu dois rédiger 3 messages de prospection personnalisés pour le prospect suivant.

${brandContext}
${campaignContext}
${prospectContext}

AUDIT DE LA MARQUE (déjà réalisé) :
- Contexte : ${audit.contexteMarque}
- Enjeux : ${audit.enjeux}
- Angle : ${audit.angle}

Canal : ${isLinkedIn ? "LinkedIn" : "Email"}

${isLinkedIn ? `
SÉQUENCE LINKEDIN en 3 messages :

Message 1 — Note de connexion (MAXIMUM 200 caractères, compté strictement)
Objectif : créer un lien humain, déclencher une connexion acceptée.
- Une observation spécifique à leur marque (pas générique)
- Une question de curiosité sincère
- Ne pas mentionner d'offre commerciale
- Signé : ${founderName}

Message 2 — Suivi après connexion acceptée (5-8 phrases, pas de liste, pas de gras)
Objectif : montrer la profondeur de l'analyse, proposer un angle de valeur concret.
- Observation factuelle précise (donnée de l'audit)
- Ce que cette observation révèle (la tension, le paradoxe, l'opportunité)
- Ce que ${businessName} propose concrètement pour ce prospect
- Signé : ${founderName}

Message 3 — Clôture (2-3 phrases max)
Ton : "Peut-être que ce n'est pas le bon moment. Pas de souci. Je reste disponible."
- Jamais de lien, jamais de deadline, jamais d'offre
- Signé : ${founderName}
` : `
EMAIL UNIQUE (6-8 phrases)
Objet : factuel, pas accrocheur
1. Observation factuelle sur leur activité
2. Le gap identifié (question ou constat neutre)
3. Ce que ${businessName} propose — en une phrase concrète
4. Question ouverte simple pour déclencher la réponse
Signé : ${founderName} / ${businessName}
`}

RÈGLES ABSOLUES :
- Ton naturel, humain, curieux. Jamais commercial.
- Ancré dans des données observables sur le prospect.
- Pas de tirets longs (—). Phrases courtes.
- Pas de "Je me permets de vous contacter". Pas d'"En tant qu'expert".
- La valeur est dans l'observation, pas dans l'autoproclamation.
- Langue : français

Réponds en JSON avec exactement ces clés :
{
  "message1": "...",
  "message2": "...",
  "message3": "..."
}

Réponds UNIQUEMENT avec le JSON.`;

  const messagesRaw = await callClaude({
    model: CLAUDE_MODELS.fast,
    userId,
    messages: [{ role: "user", content: messagesPrompt }],
    max_tokens: 1500,
    temperature: 0.6,
  });

  let messages: { message1: string; message2: string; message3: string };
  try {
    const json = messagesRaw.match(/\{[\s\S]*\}/)?.[0] || messagesRaw;
    messages = JSON.parse(json);
  } catch {
    messages = { message1: messagesRaw.slice(0, 200), message2: "", message3: "" };
  }

  return {
    strategicNotes: JSON.stringify(audit),
    message1: messages.message1 || "",
    message2: messages.message2 || "",
    message3: messages.message3 || "",
  };
}

/**
 * Génère un brief de recherche pour aider l'utilisateur à trouver des prospects.
 * Retourne des requêtes de recherche LinkedIn / web à utiliser manuellement.
 */
export async function generateSearchBrief(
  userId: string,
  campaignId: number
): Promise<{ linkedinQueries: string[]; webQueries: string[]; criteria: string }> {
  const brandDna = await storage.getBrandDna(userId);
  const campaign = await storage.getProspectionCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const prompt = `Tu es Naya. Génère un brief de recherche de prospects pour cette campagne de prospection.

CAMPAGNE : ${campaign.name}
Secteur cible : ${campaign.targetSector}
Niveau digital : ${campaign.digitalLevel}
Canal : ${campaign.channel}
Signaux d'achat : ${campaign.buyingSignals}

BRAND DNA :
Audience cible : ${brandDna?.targetAudience || "entrepreneurs indépendants"}
Marché : ${(brandDna as any)?.targetMarket || "France"}

Génère des requêtes de recherche concrètes en JSON :
{
  "linkedinQueries": ["requête 1", "requête 2", "requête 3"],
  "webQueries": ["requête web 1", "requête web 2"],
  "criteria": "Description des critères de qualification en 2-3 phrases"
}

Réponds UNIQUEMENT avec le JSON.`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.fast,
    userId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 600,
  });

  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    return JSON.parse(json);
  } catch {
    return { linkedinQueries: [], webQueries: [], criteria: raw };
  }
}

// ─── Génération d'une séquence d'emails par IA (Brand DNA + campagne) ────────
export interface GeneratedStep { channel: string; delayDays: number; subjectTemplate: string; bodyTemplate: string }

export async function generateSequence(userId: string, campaignId: number): Promise<GeneratedStep[]> {
  const [brandDna, campaign] = await Promise.all([
    storage.getBrandDna(userId),
    storage.getProspectionCampaign(campaignId),
  ]);

  const ctx = [
    brandDna?.businessName ? `Entreprise: ${brandDna.businessName}` : "",
    (brandDna as any)?.businessDescription ? `Activité: ${(brandDna as any).businessDescription}` : "",
    (brandDna as any)?.uniquePositioning ? `Positionnement: ${(brandDna as any).uniquePositioning}` : "",
    (brandDna as any)?.communicationStyle ? `Ton de com: ${(brandDna as any).communicationStyle}` : "",
    (brandDna as any)?.offers ? `Offres: ${(brandDna as any).offers}` : "",
    campaign?.targetSector ? `Cible: ${campaign.targetSector}` : "",
    (campaign as any)?.offer ? `Offre de cette campagne: ${(campaign as any).offer}` : "",
    (campaign as any)?.messageAngle ? `Angle d'approche: ${(campaign as any).messageAngle}` : "",
    (campaign as any)?.campaignBrief ? `Proposition: ${(campaign as any).campaignBrief}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Tu es un expert en cold email B2B. Rédige une séquence de prospection de 3 emails, en français, pour ce contexte :
${ctx || "(contexte minimal — reste générique mais crédible)"}

Règles :
- Emails COURTS (4-6 phrases max), humains, sans jargon ni ton corporate. Pas de "j'espère que vous allez bien".
- Personnalise avec les variables : {{firstName}}, {{company}}, {{role}}, {{sector}}. Utilise un fallback pour le prénom : {{firstName|bonjour}}.
- Email 1 (J+0) : accroche contextualisée, pas de pitch lourd, une question ouverte.
- Email 2 (J+3) : relance avec un angle de valeur différent.
- Email 3 (J+6) : relance courte de clôture ("dois-je laisser tomber ?").
- Objets courts et curieux (pas de majuscules criardes, pas d'emoji).

Réponds UNIQUEMENT avec un tableau JSON, sans texte autour :
[{"delayDays":0,"subject":"...","body":"..."},{"delayDays":3,"subject":"...","body":"..."},{"delayDays":6,"subject":"...","body":"..."}]`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.fast,
    userId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1400,
    temperature: 0.7,
  });

  let parsed: any[];
  try {
    const json = raw.match(/\[[\s\S]*\]/)?.[0] || raw;
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 5).map((s: any, i: number) => ({
    channel: "email",
    delayDays: Math.max(0, Number(s?.delayDays) ?? (i === 0 ? 0 : i * 3)),
    subjectTemplate: typeof s?.subject === "string" ? s.subject : "",
    bodyTemplate: typeof s?.body === "string" ? s.body : "",
  })).filter((s) => s.bodyTemplate);
}

// ─── Lead Finder : l'IA définit le profil de prospect idéal (ICP) ────────────
export interface IdealCustomerProfile {
  rationale: string;
  jobTitles: string[];
  seniority: string[];
  sectors: string[];
  companySize: string;
  geographies: string[];
  keywords: string[];
  exclusions: string[];
  linkedinQueries: string[]; // recherches booléennes (Sales Navigator / LinkedIn)
  googleQueries: string[];   // recherches X-ray Google
}

export async function generateLeadCriteria(userId: string, campaignId: number): Promise<IdealCustomerProfile | null> {
  const [brandDna, campaign] = await Promise.all([
    storage.getBrandDna(userId),
    storage.getProspectionCampaign(campaignId),
  ]);

  const ctx = [
    brandDna?.businessName ? `Entreprise: ${brandDna.businessName}` : "",
    (brandDna as any)?.businessDescription ? `Activité: ${(brandDna as any).businessDescription}` : "",
    (brandDna as any)?.uniquePositioning ? `Positionnement: ${(brandDna as any).uniquePositioning}` : "",
    (brandDna as any)?.primaryAudience ? `Audience principale: ${(brandDna as any).primaryAudience}` : "",
    (brandDna as any)?.coreAudiencePain ? `Douleur de l'audience: ${(brandDna as any).coreAudiencePain}` : "",
    (brandDna as any)?.offers ? `Offres: ${(brandDna as any).offers}` : "",
    campaign?.targetSector ? `Secteur visé (campagne): ${campaign.targetSector}` : "",
    (campaign as any)?.offer ? `Offre de la campagne: ${(campaign as any).offer}` : "",
    (campaign as any)?.messageAngle ? `Angle: ${(campaign as any).messageAngle}` : "",
    (campaign as any)?.buyingSignals ? `Signaux d'achat: ${(campaign as any).buyingSignals}` : "",
    (campaign as any)?.campaignBrief ? `Objectif: ${(campaign as any).campaignBrief}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Tu es un expert en ciblage B2B (ICP - Ideal Customer Profile). À partir de la marque et de l'objectif de campagne ci-dessous, définis le PROFIL DE PROSPECT IDÉAL à contacter, puis génère des requêtes de recherche concrètes.

CONTEXTE :
${ctx || "(contexte minimal — propose un ICP plausible et généraliste)"}

Donne :
- Les intitulés de poste à cibler (décideurs pertinents pour cette offre).
- La séniorité, les secteurs, la taille d'entreprise typique, les zones géographiques.
- Des mots-clés / signaux qui indiquent un bon prospect, et des exclusions (qui éviter).
- Des requêtes LinkedIn booléennes (style Sales Navigator) ET des requêtes Google X-ray (site:linkedin.com/in …) prêtes à copier-coller.
- Une courte justification du ciblage.

Réponds UNIQUEMENT avec ce JSON :
{"rationale":"...","jobTitles":["..."],"seniority":["..."],"sectors":["..."],"companySize":"...","geographies":["..."],"keywords":["..."],"exclusions":["..."],"linkedinQueries":["..."],"googleQueries":["..."]}`;

  const raw = await callClaude({
    model: CLAUDE_MODELS.fast,
    userId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1400,
    temperature: 0.5,
  });

  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const p = JSON.parse(json);
    const arr = (v: any): string[] => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    return {
      rationale: typeof p.rationale === "string" ? p.rationale : "",
      jobTitles: arr(p.jobTitles),
      seniority: arr(p.seniority),
      sectors: arr(p.sectors),
      companySize: typeof p.companySize === "string" ? p.companySize : "",
      geographies: arr(p.geographies),
      keywords: arr(p.keywords),
      exclusions: arr(p.exclusions),
      linkedinQueries: arr(p.linkedinQueries),
      googleQueries: arr(p.googleQueries),
    };
  } catch {
    return null;
  }
}
