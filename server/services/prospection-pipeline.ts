/**
 * Orchestration du pipeline de prospection (5 phases) + helpers purs.
 * Les phases 3/4 sont gardées par assertEnrichmentAccess et loggent chaque coût
 * dans prospection_usage. Ce fichier contient d'abord les helpers PURS (dédup,
 * mapping d'erreur), puis l'orchestration (search / enrich).
 */

import { callClaudeWithContext } from "./claude";
import { qualifierProspect } from "./prospection-qualify-call";
import { decisionCampagne, champsMiseAJourQualification } from "./prospection-qualification";
import { genererBrief, briefActionnable, lireBrief, appliquerEditionBrief } from "./prospection/brief";
import { redigerTouche, roleDeTouche, combineInstructions } from "./sequence-message";
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
import { serpSearchStrict } from "./serp";
import { sourcerJusquaCible, marcheDeRecherche, normaliserRequeteGoogle } from "./prospection-sourcing";
import { calculerCibleProspects, panierMoyenDepuis, tauxConversionObserve } from "./prospection-volume";
import { resolveLanguage } from "@shared/language";
import { synchroniserValidationsProspection } from "./prospection-verification";
import type { IdealCustomerProfile } from "./prospection";
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

// enrichmentText et parseJsonObject vivent dans prospection/textes.ts (module feuille, sans
// import circulaire avec sequence-message.ts) ; réexportés ici pour les appelants existants.
export { enrichmentText, parseJsonObject } from "./prospection/textes";
import { enrichmentText, parseJsonObject } from "./prospection/textes";

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

  // Mode « tiers » : l'audit connaît la marque qui écrit (offre, positionnement) sans
  // recevoir les consignes de tâches ni l'état du jour de l'utilisatrice.
  const raw = await callClaudeWithContext({
    userId,
    projectId: ctx.project?.id ?? null,
    userMessage: prompt,
    model: CLAUDE_MODELS.smart,
    max_tokens: 1400,
    temperature: 0.3,
    destinataire: "tiers",
  });
  return parseJsonObject(raw);
}

// ─── PHASE 4 : messages ─────────────────────────────────────────────────────
// Depuis le 12 octobre 2026, un SEUL rédacteur : redigerTouche (sequence-message.ts), piloté
// par le brief du prospect, la doctrine et le contrôle qualité. L'ancien generateChannelMessage
// avait des règles contraires à celles de la séquence (l'un interdisait la question ouverte
// finale, l'autre l'exigeait).

// ─── PHASES 1+2 : recherche + pré-filtrage + import (plan base) ───────────────

export interface SearchResult { found: number; imported: number; skipped_duplicates: number; method: string }

/** Étapes où un prospect de la campagne attend encore d'être contacté : la « réserve ». */
const ETAPES_RESERVE = new Set(["identified", "messages_ready"]);

export interface ResultatSourcingCampagne {
  /** Profils LinkedIn distincts vus pendant ce passage (nouveaux + déjà connus). */
  found: number;
  imported: number;
  /** Profils écartés car déjà présents chez l'utilisatrice. */
  skipped: number;
  /** Cible de la campagne sur les deux prochaines semaines (prospection-volume.ts). */
  cible: number;
  /** D'où vient la cible, en français. */
  raisonCible: string;
  /** Prospects de la campagne encore en réserve (pas encore contactés) au départ. */
  reserve: number;
  /** La réserve couvrait déjà la cible : rien n'a été recherché. */
  reserveSuffisante: boolean;
  appels: number;
  /** Recherches Bright Data en échec pendant ce passage (0 si tout a répondu). */
  erreursRecherche?: number;
  /** Raison lisible du dernier échec (ex. « HTTP 401 »). */
  derniereErreurRecherche?: string | null;
  requetes: string[];
  cibleAtteinte: boolean;
  method: string;
}

/**
 * Cible d'une campagne et ce qu'il reste à trouver, à partir du contexte de l'utilisatrice
 * (objectifs du projet, panier moyen du Brand DNA, historique de conversion, jours de
 * travail, rythme de la campagne). Voir la formule dans prospection-volume.ts.
 */
export async function cibleDeCampagne(userId: string, campaign: any) {
  const projectId = campaign.projectId ?? null;
  const [existing, objectifs, prefs, dna] = await Promise.all([
    storage.getLeads(userId),
    projectId ? storage.getActiveGoalsForProject(projectId) : Promise.resolve([]),
    storage.getUserPreferences(userId),
    projectDnaFor(userId, campaign),
  ]);
  const cible = calculerCibleProspects({
    prospectsParJour: campaign.prospectsPerDay ?? null,
    objectifs: (objectifs || []) as any[],
    panierMoyen: panierMoyenDepuis((dna as any)?.priceRange),
    tauxConversion: tauxConversionObserve(existing as any[]),
    workDays: (prefs as any)?.workDays ?? null,
    aujourdHui: new Date(),
  });
  const reserve = (existing as any[]).filter(
    (l) => l.prospectionCampaignId === campaign.id && ETAPES_RESERVE.has(l.stage),
  ).length;
  return { cible, reserve, besoin: Math.max(0, cible.cible - reserve), existing, prefs, dna };
}

/**
 * Rythme quotidien d'une NOUVELLE campagne, dérivé des objectifs du projet (même formule
 * que la cible, sans rythme imposé). Remplace l'ancien « 3 » codé en dur.
 */
export async function prospectsParJourDerive(userId: string, projectId: number | null | undefined): Promise<number> {
  const { cible } = await cibleDeCampagne(userId, { id: -1, projectId: projectId ?? null, prospectsPerDay: null });
  return cible.prospectsParJour;
}

/**
 * Sourcing d'une campagne jusqu'à sa cible. Point d'entrée commun de
 * `/source-leads` (écran « Trouver des prospects ») et `/search` (runCampaignSearch).
 *
 *   besoin = cible (dérivée des objectifs / du rythme) − réserve déjà importée
 *   → requêtes générées pour CE besoin (ou fournies par l'écran), gl/hl épinglés,
 *     pagination, renouvellement des requêtes, plafond dur d'appels SERP, chaque appel
 *     journalisé dans prospection_usage.
 */
export async function sourcerCampagne(
  userId: string,
  campaign: any,
  opts: { queries?: string[]; icp?: Partial<IdealCustomerProfile> | null } = {},
): Promise<ResultatSourcingCampagne> {
  const projectId = campaign.projectId ?? null;
  const { cible, reserve, besoin, existing, prefs, dna } = await cibleDeCampagne(userId, campaign);

  const base = {
    cible: cible.cible,
    raisonCible: cible.detail,
    reserve,
    method: "serp_xray",
  };
  if (besoin === 0) {
    return { ...base, found: 0, imported: 0, skipped: 0, reserveSuffisante: true, appels: 0, requetes: [], cibleAtteinte: true };
  }

  // Requêtes : celles de l'écran (déjà relues par l'utilisatrice) ou générées pour ce besoin.
  let icp: Partial<IdealCustomerProfile> = opts.icp ?? {};
  let requetes: string[];
  const fournies = (opts.queries || []).map((q) => normaliserRequeteGoogle(q)).filter((q): q is string => !!q);
  if (fournies.length > 0) {
    requetes = fournies;
  } else {
    const genere = await generateLeadCriteria(userId, campaign.id, { cible: besoin, raisonCible: cible.detail });
    icp = genere;
    requetes = buildSearchStrategy(campaign, dna, genere).queries;
  }

  const marche = marcheDeRecherche({
    searchCountry: icp.searchCountry,
    searchLanguage: icp.searchLanguage,
    geographies: icp.geographies,
    langueCompte: resolveLanguage({ account: (prefs as any)?.language }),
  });

  const connus = new Set(
    (existing as any[])
      .map((l) => String(l.linkedinUrl || "").toLowerCase().split("?")[0].replace(/\/+$/, ""))
      .filter(Boolean),
  );

  let erreursRecherche = 0;
  let derniereErreurRecherche: string | null = null;
  const r = await sourcerJusquaCible({
    requetes,
    cible: besoin,
    // Chaque échec est compté et sa raison gardée : sans ça, une clé ou une zone erronée
    // ressemblait à « aucun prospect trouvé ».
    search: async (q, page) => {
      try {
        return await serpSearchStrict(q, userId, { pays: marche.pays, langue: marche.langue, page });
      } catch (e: any) {
        erreursRecherche++;
        derniereErreurRecherche = e?.message || String(e);
        console.warn(`[prospection] recherche en échec (campagne ${campaign.id}) : ${derniereErreurRecherche}`);
        return [];
      }
    },
    estConnu: (url) => connus.has(url),
    nouvellesRequetes: async (deja) => {
      const neuf = await generateLeadCriteria(userId, campaign.id, {
        cible: besoin,
        raisonCible: cible.detail,
        requetesDejaUtilisees: deja,
      });
      return buildSearchStrategy(campaign, dna, neuf).queries;
    },
    surAppel: () => logProspectionUsage(userId, "bright_data_search", { campaignId: campaign.id }),
  });

  let imported = 0;
  for (const f of r.leads) {
    await storage.createLead({
      userId,
      projectId: projectId ?? undefined,
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

  return {
    ...base,
    found: r.leads.length + r.dejaConnus,
    imported,
    skipped: r.dejaConnus,
    reserveSuffisante: false,
    appels: r.appels,
    requetes: r.requetesUtilisees,
    cibleAtteinte: r.cibleAtteinte,
    erreursRecherche,
    derniereErreurRecherche,
  };
}

export async function runCampaignSearch(userId: string, campaign: any): Promise<SearchResult & ResultatSourcingCampagne> {
  const r = await sourcerCampagne(userId, campaign);
  return { ...r, skipped_duplicates: r.skipped };
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
  const prefs = await storage.getUserPreferences(userId).catch(() => null);
  const instructions = combineInstructions((prefs as any)?.messageInstructions, campaign?.messageInstructions);
  // Preuves VALIDÉES du projet : le brief en choisit au plus une par prospect.
  const preuves = campaign.projectId
    ? await storage.getProjectProofs(userId, campaign.projectId, "validated").catch(() => [])
    : [];

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

      // PHASE 4ter — BRIEF : déclencheur réel, preuve, raison, angles par touche. Il pilote
      // toute la rédaction (sequence-message.ts). Un échec vaut « pas de brief » : le
      // prospect reste à compléter, jamais un message creux.
      const nbTouches = Math.max(3, (await storage.getSequenceSteps(campaign.id).catch(() => [])).length || 4);
      // Un brief modifié par l'utilisatrice n'est jamais remplacé par un ré-enrichissement.
      const briefExistant = lireBrief((lead as any).prospectBrief);
      let brief = briefExistant?.edite ? briefExistant : await genererBrief(userId, {
        lead, campaign, projectId: (project as any)?.id ?? null, enrichText: text, audit, preuves, nbTouches,
      }).catch((e: any) => {
        console.error("[prospection] brief", lead.id, e?.message || e);
        return null;
      });
      if (!briefExistant?.edite) await logProspectionUsage(userId, "claude_audit", { prospectId: lead.id, campaignId: campaign.id });
      // Filet : une note de l'utilisatrice est un déclencheur réel, même si le brief a échoué.
      const note = typeof (lead as any).notes === "string" ? (lead as any).notes.trim() : "";
      if (!briefActionnable(brief) && note) {
        const r = appliquerEditionBrief(brief, { declencheur: { fait: note.slice(0, 400), source: "note" } }, []);
        if (r.ok) brief = { ...r.brief, edite: (brief as any)?.edite ?? false };
      }

      // PHASE 4 — premières touches (une par canal), écrites par le rédacteur de la séquence
      // à partir du brief. Elles sont aussi mises en cache sur la première étape de chaque
      // canal : ce que l'utilisatrice valide est exactement ce qui partira.
      const msg: { linkedinMessage?: string; emailMessage?: string } = {};
      if (briefActionnable(brief)) {
        const steps = await storage.getSequenceSteps(campaign.id).catch(() => [] as any[]);
        const canaux: Array<"linkedin" | "email"> = [];
        if (channel !== "email") canaux.push("linkedin");
        if (channel === "email" || channel === "both") canaux.push("email");
        for (const canal of canaux) {
          const iStep = steps.findIndex((st: any) => st.channel === canal);
          const role = iStep >= 0 ? roleDeTouche(steps as any, iStep) : canal === "linkedin" ? "invitation" : "email_ouverture";
          // Un message édité à la main est gardé tel quel : un ré-enrichissement ne l'écrase pas.
          const edite: any = iStep >= 0 ? await storage.getLeadStepMessage(lead.id, (steps[iStep] as any).id).catch(() => undefined) : undefined;
          if (edite?.edited) {
            if (canal === "linkedin") msg.linkedinMessage = edite.body;
            else msg.emailMessage = edite.body;
            continue;
          }
          try {
            const t = await redigerTouche(userId, {
              lead: { ...lead, prospectBrief: brief, auditNotes: JSON.stringify(audit), enrichedProfile: data },
              campaign: { ...campaign, projectName }, role, canal, brief, rang: 0,
              intention: iStep >= 0 ? (steps[iStep] as any).intention || "" : "",
              previousTexts: [], instructions, founderName,
            });
            await logProspectionUsage(userId, "claude_message", { prospectId: lead.id, campaignId: campaign.id });
            if (canal === "linkedin") msg.linkedinMessage = t.body;
            else msg.emailMessage = t.body; // l'objet vit dans le cache de l'étape
            if (iStep >= 0 && !t.tropProche) {
              await storage.upsertLeadStepMessage({
                leadId: lead.id, stepId: (steps[iStep] as any).id, subject: t.subject, body: t.body, edited: false,
                qualite: t.aRevoir ? "a_revoir" : "ok", defauts: t.defauts.length ? t.defauts : null,
              } as any);
            }
          } catch (e: any) {
            console.error("[prospection] rédaction", lead.id, canal, e?.message || e);
          }
        }
      }

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
        prospectBrief: brief,
        stage: hasMessage ? "messages_ready" : "identified",
        // Des messages neufs n'ont été lus par personne : une validation donnée aux
        // précédents ne vaut pas pour eux.
        validatedAt: null,
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
  // Des messages viennent d'être préparés : la tâche « Valider les messages » de la campagne
  // est créée ou mise à jour dans le planning. Ne fait jamais échouer l'enrichissement.
  await synchroniserValidationsProspection(userId, undefined, { campaignId: campaign.id }).catch((e: any) =>
    console.error("[prospection] synchro tâche de validation:", e?.message || e),
  );
  return { enriched, failed, linkedin_requests_used: linkedinUsed };
}
