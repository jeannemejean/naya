/**
 * Génération bespoke du message d'une étape de séquence (lead × step) + cache.
 * Le prompt (buildStepPrompt) est pur et testé isolément (TDD). generateStepMessage
 * orchestre l'appel IA et réutilise/alimente le cache lead_step_messages (Task 1)
 * pour que l'aperçu ET l'envoi consomment exactement le même texte généré.
 *
 * Messages DISTINCTS : chaque étape LinkedIn reçoit un rôle (invitation, message après
 * acceptation, relance — voir sequence-distinct.ts) avec ses propres règles ; le prompt
 * voit les textes déjà rédigés/envoyés à ce prospect ; un texte trop proche d'un texte
 * antérieur est régénéré UNE fois, puis signalé `tropProche: true` (jamais mis en cache,
 * jamais envoyé par le moteur).
 */
import { storage } from "../storage";
import { callClaude, CLAUDE_MODELS } from "./claude";
import { sanitizeMessage, enforceLinkedInLimit, parseJsonObject } from "./prospection-pipeline";
import { roleEtapeLinkedin, premierConflit, normaliserTexte, type RoleEtapeLinkedin } from "./sequence-distinct";

/** Limite LinkedIn d'une note d'invitation (caractères). */
export const LIMITE_NOTE_INVITATION = 300;
/** Limite des autres messages LinkedIn (inchangée). */
export const LIMITE_MESSAGE_LINKEDIN = 200;

/** Ouvertures génériques interdites : elles rendent tous les messages identiques d'un prospect à l'autre. */
export const CLICHES_INTERDITS = [
  "Je me permets",
  "J'espère que vous allez bien",
  "J'espère que tu vas bien",
  "Votre parcours est inspirant",
  "J'ai vu votre profil",
  "Je suis tombé(e) sur votre profil",
  "Je serais ravi(e) d'échanger",
];

function tronquer(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

/**
 * Contexte SPÉCIFIQUE au prospect, tiré uniquement de ce qui existe sur la ligne lead et
 * dans son audit (aucune grille sectorielle codée en dur : Naya reste sur-mesure par
 * utilisatrice). Pure.
 */
export function contexteProspect(lead: any, audit: Record<string, any>): string {
  const lignes: string[] = [];
  const li = lead?.enrichedProfile?.linkedin;
  const ig = lead?.enrichedProfile?.instagram;
  const web = lead?.enrichedProfile?.web;
  if (lead?.sector) lignes.push(`Secteur : ${tronquer(lead.sector, 120)}`);
  if (li?.headline) lignes.push(`Titre LinkedIn : ${tronquer(li.headline, 200)}`);
  if (li?.location) lignes.push(`Localisation : ${tronquer(li.location, 120)}`);
  if (li?.about) lignes.push(`À propos : ${tronquer(li.about, 500)}`);
  const raw = li?.raw;
  const posts: any[] = [
    ...(Array.isArray(raw?.posts) ? raw.posts : []),
    ...(Array.isArray(raw?.activity) ? raw.activity : []),
  ];
  const titres = posts
    .map((p) => tronquer(typeof p === "string" ? p : p?.title || p?.text || p?.attribution, 160))
    .filter(Boolean)
    .slice(0, 3);
  if (titres.length) lignes.push(`Publications / activité récentes : ${titres.map((t) => `« ${t} »`).join(" ; ")}`);
  if (ig?.biography) lignes.push(`Bio Instagram : ${tronquer(ig.biography, 250)}`);
  if (web?.content) lignes.push(`Extrait du site : ${tronquer(web.content, 400)}`);
  if (lead?.notes) lignes.push(`Notes de l'utilisatrice sur ce prospect : ${tronquer(lead.notes, 300)}`);
  const auditObj = audit && typeof audit === "object" && !Array.isArray(audit) ? audit : {};
  for (const [k, v] of Object.entries(auditObj)) {
    // Déjà en tête du prompt (lignes ANGLE / ENJEUX).
    if (k === "angle" || k === "enjeux" || (k === "observations" && !auditObj.enjeux)) continue;
    const t = tronquer(v, 400);
    if (t) lignes.push(`Audit · ${k} : ${t}`);
  }
  return lignes.join("\n");
}

function reglesLinkedIn(role: RoleEtapeLinkedin | undefined, founderName: string): string {
  switch (role) {
    case "invitation":
      return `- NOTE D'INVITATION LINKEDIN : MAXIMUM ${LIMITE_NOTE_INVITATION} caractères strict (limite LinkedIn).
- Donne une raison sincère et personnelle de se connecter, ancrée dans un élément PRÉCIS et propre à ce prospect (une publication, un projet, un choix, un détail du contexte ci-dessus).
- AUCUN pitch, AUCUNE offre, AUCUN lien, AUCUNE question sur ses besoins ou ses difficultés.
- Signé : ${founderName}.`;
    case "message_apres_acceptation":
      return `- MESSAGE LINKEDIN APRÈS ACCEPTATION : MAXIMUM ${LIMITE_MESSAGE_LINKEDIN} caractères strict.
- Remercie d'avoir accepté de façon naturelle, jamais formulaire (pas de « Merci pour l'ajout » ou « Merci d'avoir accepté mon invitation » tel quel).
- Apporte UN point de valeur concret lié à ce prospect (une observation utile, une idée précise).
- NE RÉPÈTE NI NE PARAPHRASE la note d'invitation : autre accroche, autre observation.
- Termine par UNE seule question ouverte et sincère.
- Signé : ${founderName}.`;
    case "relance":
      return `- RELANCE LINKEDIN : MAXIMUM ${LIMITE_MESSAGE_LINKEDIN} caractères strict, court.
- Prends un angle NOUVEAU, jamais utilisé dans les messages précédents. Ne répète ni ne résume ce qui a déjà été dit.
- Signé : ${founderName}.`;
    default:
      return `- MESSAGE LINKEDIN : MAXIMUM ${LIMITE_MESSAGE_LINKEDIN} caractères strict. Une accroche personnelle liée à la marque/la personne + une question sincère. Signé : ${founderName}.`;
  }
}

function intentionParDefaut(role?: RoleEtapeLinkedin): string {
  if (role === "invitation") return "invitation à se connecter";
  if (role === "message_apres_acceptation") return "premier message après acceptation de l'invitation";
  if (role === "relance") return "relance";
  return "prise de contact";
}

export function buildStepPrompt(args: {
  founderName: string; projectName: string; channel: string; intention: string;
  lead: any; audit: Record<string, string>; instructions?: string;
  role?: RoleEtapeLinkedin | null; bodyTemplate?: string | null;
  previousTexts?: string[]; conflit?: string | null;
}): string {
  const isLi = args.channel === "linkedin";
  const role = isLi ? args.role ?? undefined : undefined;
  const instructionsBlock = args.instructions?.trim()
    ? `\nCONSIGNES DE RÉDACTION DE L'UTILISATEUR (impératives, à respecter absolument) :\n${args.instructions.trim()}\n`
    : "";
  const intention = args.intention?.trim() || intentionParDefaut(role);
  const trame = !args.intention?.trim() && args.bodyTemplate?.trim()
    ? `TRAME INDICATIVE DE L'ÉTAPE (guide l'intention, à réécrire entièrement sur-mesure, ne pas recopier) : ${tronquer(args.bodyTemplate, 600)}\n`
    : "";
  const contexte = contexteProspect(args.lead, args.audit);
  const precedents = (args.previousTexts || []).map((t) => t?.trim()).filter(Boolean) as string[];
  const precedentsBlock = precedents.length
    ? `\nMESSAGES DÉJÀ RÉDIGÉS OU ENVOYÉS À CE PROSPECT (ne répète ni ne paraphrase ces messages : ni la même accroche, ni la même observation, ni la même question) :\n${precedents.map((t, i) => `${i + 1}. « ${t} »`).join("\n")}\n`
    : "";
  const conflitBlock = args.conflit?.trim()
    ? `\nATTENTION : ta proposition précédente était beaucoup trop proche de ce message déjà rédigé pour ce prospect :\n« ${args.conflit.trim()} »\nÉcris un message RADICALEMENT différent : autre accroche, autre élément du contexte, autre formulation, autre question.\n`
    : "";
  const quoi = isLi
    ? role === "invitation" ? "une note d'invitation LinkedIn" : "un message LinkedIn"
    : "un email";
  return `Tu es Naya. Rédige ${quoi} de prospection sur-mesure.

PROSPECT : ${args.lead?.name || ""} — ${args.lead?.role || ""} @ ${args.lead?.company || ""}
INTENTION DE CETTE ÉTAPE : ${intention}
${trame}ANGLE (audit) : ${args.audit?.angle || ""}
ENJEUX : ${args.audit?.enjeux || args.audit?.observations || ""}
${contexte ? `CONTEXTE PROPRE À CE PROSPECT (appuie-toi sur un élément précis, différent d'un prospect à l'autre) :\n${contexte}\n` : ""}${instructionsBlock}${precedentsBlock}${conflitBlock}
RÈGLES ABSOLUES :
- Ton humain, curieux, jamais commercial. JAMAIS de tiret long.
- N'invente JAMAIS et ne promets JAMAIS un lien, un article, une étude, un contenu, une ressource ou une pièce jointe. Ne prétends pas que l'expéditeur a écrit/publié/créé quelque chose. Le message vaut par une observation sincère et une question ouverte, pas par une ressource promise.
- N'écris AUCUN placeholder entre crochets ([lien], [url], [prénom], [entreprise], ...). Tout doit être du texte final, prêt à envoyer.
- Aucun tiret en guise de ponctuation : ni —, ni –, ni --. Utilise des virgules ou des points.
- Aucune ouverture générique ou passe-partout. Interdits notamment : ${CLICHES_INTERDITS.map((c) => `« ${c} »`).join(", ")}. La première phrase doit être impossible à envoyer à quelqu'un d'autre.
${isLi
  ? reglesLinkedIn(role, args.founderName)
  : `- EMAIL : rédige un objet court et accrocheur, puis un corps de 5 à 8 phrases. Observation d'ouverture, angle, question ouverte. Signé : ${args.founderName} — ${args.projectName}.`}

Réponds UNIQUEMENT avec ce JSON :
{${isLi ? '"body":"..."' : '"subject":"...","body":"..."'}}`;
}

/**
 * Combine les consignes de rédaction GLOBALES (userPreferences.messageInstructions) et
 * PAR CAMPAGNE (prospectionCampaigns.messageInstructions) en un seul bloc de texte à
 * injecter dans le prompt. Pure, testée isolément.
 */
export function combineInstructions(global?: string | null, campaign?: string | null): string {
  return [global, campaign]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

export interface StepForMessage {
  id: number;
  channel: string;
  intention: string | null;
  condition?: string | null;
  bodyTemplate?: string | null;
}

export interface StepMessageResult {
  subject: string | null;
  body: string;
  /**
   * true = le texte reste trop proche d'un message antérieur à ce prospect, même après
   * une régénération. Il n'est PAS mis en cache ; le moteur d'envoi ne doit PAS l'envoyer ;
   * l'aperçu l'affiche avec ce drapeau.
   */
  tropProche?: boolean;
}

function dedoublonner(textes: string[]): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const t of textes) {
    const n = normaliserTexte(t || "");
    if (!n || vus.has(n)) continue;
    vus.add(n);
    out.push(t.trim());
  }
  return out;
}

/**
 * Textes déjà rédigés/envoyés à ce prospect AVANT l'étape courante :
 *  - lead_step_messages des étapes antérieures de la séquence (texte généré, celui que
 *    le moteur envoie) ;
 *  - outreach_messages réellement partis (sentAt non nul) de ce prospect, hors l'étape
 *    courante elle-même (messageType `step_N` / `step_N_…`).
 * Une lecture ratée n'empêche pas la génération : on fait au mieux avec ce qui existe.
 */
async function chargerTextesAnterieurs(
  userId: string, leadId: number, steps: StepForMessage[] | undefined, index: number,
): Promise<string[]> {
  const textes: string[] = [];
  if (steps && index > 0) {
    for (let i = 0; i < index; i++) {
      try {
        const row = await storage.getLeadStepMessage(leadId, steps[i].id);
        if (row?.body) textes.push(row.body);
      } catch { /* lecture ratée : on continue */ }
    }
  }
  try {
    const envoyes = await storage.getOutreachMessages(userId, leadId);
    if (Array.isArray(envoyes)) {
      const courant = index >= 0 ? new RegExp(`^step_${index + 1}(_|$)`) : null;
      for (const m of envoyes) {
        if (!m?.sentAt || !m?.body) continue;
        if (courant && courant.test(String(m.messageType || ""))) continue;
        textes.push(m.body);
      }
    }
  } catch { /* lecture ratée : on continue */ }
  return textes;
}

export async function generateStepMessage(
  userId: string,
  opts: {
    lead: any; campaign: any; step: StepForMessage; useCache?: boolean; instructions?: string;
    /** Toutes les étapes de la séquence, dans l'ordre (rôle LinkedIn + textes antérieurs). */
    steps?: StepForMessage[];
    /** Textes antérieurs déjà connus de l'appelant (ex. générés plus haut dans le même aperçu). */
    previousTexts?: string[];
  },
): Promise<StepMessageResult> {
  const steps = opts.steps;
  const index = steps ? steps.findIndex((s) => s.id === opts.step.id) : -1;
  const role = steps && index >= 0 ? roleEtapeLinkedin(steps as any, index) : null;
  const anterieurs = dedoublonner([
    ...(await chargerTextesAnterieurs(userId, opts.lead.id, steps, index)),
    ...(opts.previousTexts || []),
  ]);

  if (opts.useCache !== false) {
    const cached = await storage.getLeadStepMessage(opts.lead.id, opts.step.id);
    // Un texte édité à la main par l'utilisatrice est toujours respecté. Un texte généré
    // (y compris avant ce correctif) trop proche d'un message antérieur est régénéré.
    if (cached && (cached.edited || !premierConflit(cached.body, anterieurs))) {
      return { subject: cached.subject ?? null, body: cached.body };
    }
  }
  const founderName = opts.lead?.founderName || opts.campaign?.founderName || "";
  const projectName = opts.campaign?.name || "";
  const audit = safeAudit(opts.lead?.auditNotes);
  const isLi = opts.step.channel === "linkedin";
  const limite = role === "invitation" ? LIMITE_NOTE_INVITATION : LIMITE_MESSAGE_LINKEDIN;

  const generer = async (conflit: string | null) => {
    const prompt = buildStepPrompt({
      founderName, projectName, channel: opts.step.channel,
      intention: opts.step.intention || "", lead: opts.lead, audit, instructions: opts.instructions,
      role, bodyTemplate: opts.step.bodyTemplate ?? null, previousTexts: anterieurs, conflit,
    });
    const raw = await callClaude({ model: CLAUDE_MODELS.smart, userId, messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.6 });
    const p = parseJsonObject(raw);
    const body = isLi
      ? enforceLinkedInLimit(typeof p.body === "string" ? p.body : "", limite)
      : sanitizeMessage(typeof p.body === "string" ? p.body : "");
    if (!body.trim()) {
      throw new Error(`generateStepMessage: corps vide pour lead ${opts.lead.id}, étape ${opts.step.id} (réponse IA non parsable) — non mis en cache`);
    }
    const subjectRaw = opts.step.channel === "email" && typeof p.subject === "string" ? p.subject.trim() : "";
    return { subject: subjectRaw || null, body };
  };

  let res = await generer(null);
  let conflit = premierConflit(res.body, anterieurs);
  if (conflit) {
    res = await generer(conflit);
    conflit = premierConflit(res.body, anterieurs);
    if (conflit) {
      // Jamais en cache : le prochain passage régénérera au lieu de resservir un doublon.
      return { subject: res.subject, body: res.body, tropProche: true };
    }
  }
  await storage.upsertLeadStepMessage({ leadId: opts.lead.id, stepId: opts.step.id, subject: res.subject, body: res.body, edited: false });
  return { subject: res.subject, body: res.body };
}

function safeAudit(auditNotes: any): Record<string, string> {
  if (!auditNotes) return {};
  try { return typeof auditNotes === "string" ? JSON.parse(auditNotes) : auditNotes; } catch { return {}; }
}
