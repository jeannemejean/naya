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
import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { sanitizeMessage, enforceLinkedInLimit } from "./prospection-audit";
import { parseJsonObject, enrichmentText } from "./prospection/textes";
import { roleEtapeLinkedin, premierConflit, normaliserTexte, branchesExclusives } from "./sequence-distinct";
import { blocDoctrine, limitePour, type RoleTouche, type Canal } from "./prospection/doctrine";
import { controlerMessage, type Defaut } from "./prospection/qualite";
import { relire } from "./prospection/relecture";
import { lireBrief, briefActionnable, angleDeTouche, genererBrief, appliquerEditionBrief, type BriefProspect } from "./prospection/brief";
import { texteDePreuve, liensDePreuve } from "./prospection/preuves";
import { choisirExemples } from "./prospection/exemples";

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

/**
 * Rôle d'une touche : porté par l'étape (structures, depuis le 12/10/2026), sinon déduit pour
 * les séquences anciennes (première touche LinkedIn = invitation, première touche email =
 * ouverture, après acceptation = premier message, le reste = relance).
 */
export function roleDeTouche(steps: Array<{ channel: string; condition?: string | null; intention?: string | null; role?: string | null }>, index: number): RoleTouche {
  const step = steps[index];
  if (step?.role && ROLES.has(step.role)) return step.role as RoleTouche;
  if (step?.channel === "linkedin") {
    const r = roleEtapeLinkedin(steps as any, index);
    if (r === "invitation") return "invitation";
    if (r === "message_apres_acceptation") {
      const dejaPremier = steps.slice(0, index).some((s, i) => s.channel === "linkedin" && roleEtapeLinkedin(steps as any, i) === "message_apres_acceptation");
      return dejaPremier ? "relance" : "premier_message";
    }
    return "relance";
  }
  const emailAvant = steps.slice(0, index).some((s) => s.channel === "email");
  return emailAvant ? "relance" : "email_ouverture";
}

const ROLES = new Set<string>(["invitation", "premier_message", "email_ouverture", "relance", "cloture"]);

export class BriefIncompletError extends Error {
  constructor(public leadId: number) {
    super(`brief_incomplet: prospect ${leadId} sans déclencheur réel, aucun message rédigé`);
  }
}

export function buildStepPrompt(args: {
  founderName: string; projectName: string; channel: string; intention: string;
  lead: any; audit: Record<string, string>; instructions?: string;
  role: RoleTouche; brief: BriefProspect; angle: string;
  preuveTexte?: string | null; exemples?: string[];
  bodyTemplate?: string | null; previousTexts?: string[]; conflit?: string | null;
  defautsACorriger?: Defaut[];
}): string {
  const canal: Canal = args.channel === "linkedin" ? "linkedin" : "email";
  const b = args.brief;
  const contexte = contexteProspect(args.lead, args.audit);
  const instructionsBlock = args.instructions?.trim()
    ? `\nCONSIGNES DE RÉDACTION DE ${args.founderName.toUpperCase() || "L'UTILISATRICE"} (prioritaires sur la doctrine, sauf les règles de sécurité) :\n${args.instructions.trim()}\n`
    : "";
  const trame = !args.intention?.trim() && args.bodyTemplate?.trim()
    ? `TRAME INDICATIVE (à réécrire entièrement) : ${tronquer(args.bodyTemplate, 600)}\n`
    : "";
  const precedents = (args.previousTexts || []).map((t) => t?.trim()).filter(Boolean) as string[];
  const precedentsBlock = precedents.length
    ? `\nMESSAGES DÉJÀ RÉDIGÉS OU ENVOYÉS À CETTE PERSONNE (ne répète ni ne paraphrase : ni la même accroche, ni la même idée, ni la même tournure d'ouverture) :\n${precedents.map((t, i) => `${i + 1}. « ${t} »`).join("\n")}\n`
    : "";
  const conflitBlock = args.conflit?.trim()
    ? `\nATTENTION : ta proposition précédente était beaucoup trop proche de ce message déjà rédigé :\n« ${args.conflit.trim()} »\nÉcris un message RADICALEMENT différent : autre accroche, autre formulation.\n`
    : "";
  const exemplesBlock = args.exemples?.length
    ? `\nEXEMPLES DE LA FAÇON D'ÉCRIRE DE ${args.founderName.toUpperCase() || "L'UTILISATRICE"} (imite le ton, la longueur, la simplicité ; ne recopie jamais) :\n${args.exemples.map((e, i) => `${i + 1}. « ${tronquer(e, 700)} »`).join("\n")}\n`
    : "";
  const defautsBlock = args.defautsACorriger?.length
    ? `\nÀ CORRIGER : ta version précédente avait ces défauts. Réécris en les supprimant :\n${args.defautsACorriger.map((d) => `- ${d.raison}`).join("\n")}\n`
    : "";
  const preuveBlock = args.preuveTexte?.trim()
    ? `PREUVE À UTILISER (réelle, validée ; n'en change aucun fait) :\n${args.preuveTexte.trim()}\n`
    : "PREUVE : aucune preuve pour ce prospect. N'évoque aucun client, chiffre, cas ou lien.\n";
  const signature = canal === "linkedin" ? args.founderName : `${args.founderName}${args.projectName ? `, ${args.projectName}` : ""}`;

  return `Rédige ${canal === "linkedin" ? (args.role === "invitation" ? "la note d'invitation LinkedIn" : "le message LinkedIn") : "l'email"} de prospection de ${args.founderName || "l'expéditrice"} (${args.projectName}) pour cette touche.

DESTINATAIRE : ${args.lead?.name || ""}, ${args.lead?.role || ""} chez ${args.lead?.company || ""}
INTENTION DE LA TOUCHE : ${args.intention?.trim() || "voir la règle de la touche"}
${trame}
BRIEF
Déclencheur réel : ${b.declencheur?.fait ?? ""}${b.declencheur?.date ? ` (${b.declencheur.date})` : ""}
Raison de contacter : ${b.raison}
Proposition : ${b.proposition.type} : ${b.proposition.contenu}
ANGLE DE CETTE TOUCHE : ${args.angle}
Registre : ${b.registre === "tu" ? "tutoiement" : "vouvoiement"} · Langue : ${b.langue}
${preuveBlock}
${contexte ? `CE QU'ON SAIT DE LA PERSONNE :\n${contexte}\n` : ""}${instructionsBlock}${exemplesBlock}${precedentsBlock}${conflitBlock}${defautsBlock}
${blocDoctrine(args.role, canal)}

Signature : ${signature}.

Réponds UNIQUEMENT avec ce JSON :
{${canal === "linkedin" ? '"body":"..."' : '"subject":"...","body":"..."'}}`;
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
  role?: string | null;
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
  /** true = le contrôle qualité a encore trouvé des défauts après une réécriture : jamais envoyé sans édition. */
  aRevoir?: boolean;
  defauts?: Defaut[];
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
 * Les étapes de la branche conditionnelle opposée sont exclues (`branchesExclusives`).
 * Une lecture ratée n'empêche pas la génération : on fait au mieux avec ce qui existe.
 */
async function chargerTextesAnterieurs(
  userId: string, leadId: number, steps: StepForMessage[] | undefined, index: number,
): Promise<string[]> {
  const textes: string[] = [];
  if (steps && index > 0) {
    for (let i = 0; i < index; i++) {
      // Branche opposée (ex. if_invite_accepted vs if_invite_not_accepted) : son texte ne
      // partira jamais avec celui-ci, inutile de s'en distinguer (faux positifs évités).
      if (branchesExclusives(steps[i].condition, steps[index].condition)) continue;
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

/**
 * Noms propres communs à tous les messages pour ce prospect (nom, entreprise, ville,
 * expéditrice) : retirés avant la comparaison `tropProche`, sinon deux messages courts
 * différents se ressemblent par leurs seuls noms propres. Pure.
 */
export function neutresDuProspect(lead: any, expeditrice: Array<string | null | undefined> = []): string[] {
  const li = lead?.enrichedProfile?.linkedin;
  const ville = li?.raw?.city || li?.location;
  const out = [
    lead?.name, ...(String(lead?.name || "").split(/\s+/)),
    lead?.company, ville, ...(typeof ville === "string" ? ville.split(",") : []),
    ...expeditrice,
  ];
  return out.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length >= 2);
}

export async function generateStepMessage(
  userId: string,
  opts: {
    lead: any; campaign: any; step: StepForMessage; useCache?: boolean; instructions?: string;
    /** Toutes les étapes de la séquence, dans l'ordre (rôle + textes antérieurs). */
    steps?: StepForMessage[];
    /** Textes antérieurs déjà connus de l'appelant (ex. générés plus haut dans le même aperçu). */
    previousTexts?: string[];
    /** Nom de famille de l'expéditrice (le prénom vient de founderName) — neutralisé pour la comparaison. */
    senderLastName?: string | null;
  },
): Promise<StepMessageResult> {
  const steps = opts.steps && opts.steps.length ? opts.steps : [opts.step];
  const index = Math.max(0, steps.findIndex((s) => s.id === opts.step.id));
  const role = roleDeTouche(steps, index);
  const anterieurs = dedoublonner([
    ...(await chargerTextesAnterieurs(userId, opts.lead.id, opts.steps, opts.steps ? index : -1)),
    ...(opts.previousTexts || []),
  ]);

  const founderName = opts.lead?.founderName || opts.campaign?.founderName || "";
  const ctx = { neutres: neutresDuProspect(opts.lead, [founderName, opts.senderLastName]) };

  let cached: any = opts.useCache !== false ? await storage.getLeadStepMessage(opts.lead.id, opts.step.id) : undefined;
  // Un texte édité à la main est toujours respecté, brief ou pas : c'est l'utilisatrice qui l'a écrit.
  if (cached?.edited) return { subject: cached.subject ?? null, body: cached.body };

  // Aucun texte généré ne part sans brief actionnable (déclencheur réel). Un prospect antérieur
  // au brief en reçoit un ici ; ses textes en cache, écrits sans brief, sont alors réécrits.
  const { brief, cree } = await assurerBrief(userId, opts.lead, opts.campaign, steps.length);
  if (cree) cached = undefined;

  // Un texte généré trop proche d'un message antérieur est régénéré. Un texte « à revoir » est
  // resservi avec son drapeau (aucun nouvel appel tant que l'utilisatrice n'a pas tranché).
  if (cached && !premierConflit(cached.body, anterieurs, ctx)) {
    const aRevoir = cached.qualite === "a_revoir";
    return {
      subject: cached.subject ?? null, body: cached.body,
      ...(aRevoir ? { aRevoir: true, defauts: Array.isArray(cached.defauts) ? cached.defauts : [] } : {}),
    };
  }

  // Rang de la touche sur SA branche : sert l'angle prévu et la notion de premier contact.
  const rang = steps.slice(0, index).filter((s) => !branchesExclusives(s.condition, steps[index].condition)).length;
  const res = await redigerTouche(userId, {
    lead: opts.lead, campaign: opts.campaign, role, canal: opts.step.channel === "linkedin" ? "linkedin" : "email",
    brief, rang, intention: opts.step.intention || "", bodyTemplate: opts.step.bodyTemplate ?? null,
    previousTexts: anterieurs, instructions: opts.instructions ?? "", founderName, conflitCtx: ctx,
  });
  if (res.tropProche) {
    // Jamais en cache : le prochain passage régénérera au lieu de resservir un doublon.
    return { subject: res.subject, body: res.body, tropProche: true };
  }
  await storage.upsertLeadStepMessage({
    leadId: opts.lead.id, stepId: opts.step.id, subject: res.subject, body: res.body, edited: false,
    qualite: res.aRevoir ? "a_revoir" : "ok", defauts: res.defauts.length ? res.defauts : null,
  } as any);
  return {
    subject: res.subject, body: res.body,
    ...(res.aRevoir ? { aRevoir: true, defauts: res.defauts } : {}),
  };
}

/**
 * Brief actionnable du prospect, ou BriefIncompletError.
 *  - Prospect antérieur au brief (`prospectBrief` nul) : le brief est généré une fois et
 *    enregistré, et ses textes non édités sont purgés (ils ont été écrits sans déclencheur).
 *  - Brief sans déclencheur mais note de l'utilisatrice sur la fiche : la note devient le
 *    déclencheur (« vu au salon X »), sans appel IA.
 */
async function assurerBrief(userId: string, lead: any, campaign: any, nbTouches: number): Promise<{ brief: BriefProspect; cree: boolean }> {
  let brief = lireBrief(lead?.prospectBrief);
  let cree = false;
  let modifie = false;
  if (!brief) {
    const projectId: number | null = campaign?.projectId ?? null;
    const preuves = projectId != null ? await storage.getProjectProofs(userId, projectId, "validated").catch(() => []) : [];
    brief = await genererBrief(userId, {
      lead, campaign, projectId, enrichText: enrichmentText(lead, lead?.enrichedProfile || {}),
      audit: safeAudit(lead?.auditNotes), preuves: preuves as any, nbTouches: Math.max(3, nbTouches),
    }).catch((e: any) => {
      console.error("[prospection] brief à la volée", lead?.id, e?.message || e);
      return null;
    });
    cree = modifie = !!brief;
  }
  const note = typeof lead?.notes === "string" ? lead.notes.trim() : "";
  if (!briefActionnable(brief) && note) {
    const r = appliquerEditionBrief(brief, { declencheur: { fait: note.slice(0, 400), source: "note" } }, []);
    const etaitEdite = (brief as BriefProspect | null)?.edite ?? false;
    if (r.ok) { brief = { ...r.brief, edite: etaitEdite }; modifie = true; }
  }
  if (modifie && brief) {
    await storage.updateLead(lead.id, userId, { prospectBrief: brief } as any).catch((e: any) =>
      console.error("[prospection] enregistrement du brief", lead?.id, e?.message));
    if (lead) lead.prospectBrief = brief;
  }
  if (cree) await storage.purgeUneditedLeadStepMessages(lead.id).catch(() => {});
  if (!briefActionnable(brief)) throw new BriefIncompletError(lead?.id);
  return { brief, cree };
}

/**
 * Rédige UNE touche à partir du brief, sans cache : génération, anti-doublon (une réécriture),
 * contrôle qualité couches 1 et 2 (une réécriture avec les raisons). Utilisée par
 * generateStepMessage (séquence) et par l'enrichissement (premières touches à valider).
 */
export async function redigerTouche(userId: string, a: {
  lead: any; campaign: any; role: RoleTouche; canal: Canal; brief: BriefProspect; rang: number;
  intention: string; bodyTemplate?: string | null; previousTexts: string[]; instructions: string;
  founderName: string; conflitCtx?: { neutres: string[] };
}): Promise<{ subject: string | null; body: string; defauts: Defaut[]; aRevoir: boolean; tropProche: boolean }> {
  const projectId: number | null = a.campaign?.projectId ?? null;
  const projectName = a.campaign?.projectName || a.campaign?.name || "";
  const audit = safeAudit(a.lead?.auditNotes);

  // Preuve : uniquement une preuve VALIDÉE du même projet.
  let preuve: any = null;
  if (a.brief.preuveId != null) {
    const p: any = await storage.getProjectProof(a.brief.preuveId, userId).catch(() => undefined);
    if (p && p.status === "validated" && (projectId == null || p.projectId === projectId)) preuve = p;
  }
  // Apprentissage : exemples et règles acceptées du projet (jamais d'un autre).
  const [feedback, regles] = await Promise.all([
    storage.getMessageFeedback(userId, projectId, { role: a.role, limit: 60 }).catch(() => []),
    projectId != null ? storage.getLearnedRules(userId, projectId, "acceptee").catch(() => []) : Promise.resolve([]),
  ]);
  const exemples = choisirExemples(feedback as any, a.role);
  const instructions = [a.instructions, ...(regles as any[]).map((r) => `- ${r.texte}`)].filter((x) => x && x.trim()).join("\n");
  const liensAutorises = [...liensDePreuve(preuve), ...((instructions.match(/https?:\/\/\S+/g)) || [])];
  const premiereTouche = a.rang === 0;
  const limite = limitePour(a.role, a.canal).maxCaracteres ?? LIMITE_NOTE_INVITATION;

  const ecrire = async (conflit: string | null, defauts: Defaut[]) => {
    const prompt = buildStepPrompt({
      founderName: a.founderName, projectName, channel: a.canal, intention: a.intention,
      lead: a.lead, audit, instructions, role: a.role, brief: a.brief, angle: angleDeTouche(a.brief, a.rang),
      preuveTexte: preuve ? texteDePreuve(preuve) : null, exemples, bodyTemplate: a.bodyTemplate ?? null,
      previousTexts: a.previousTexts, conflit, defautsACorriger: defauts,
    });
    const raw = await callClaudeWithContext({
      userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 900, temperature: 0.6,
      destinataire: "tiers",
    });
    const p = parseJsonObject(raw);
    const body = a.canal === "linkedin"
      ? enforceLinkedInLimit(typeof p.body === "string" ? p.body : "", limite)
      : sanitizeMessage(typeof p.body === "string" ? p.body : "");
    if (!body.trim()) {
      throw new Error(`redigerTouche: corps vide pour lead ${a.lead?.id} (réponse IA non parsable) — non mis en cache`);
    }
    const subject = a.canal === "email" && typeof p.subject === "string" ? sanitizeMessage(p.subject.trim()) || null : null;
    return { subject, body };
  };
  const controler = async (m: { subject: string | null; body: string }): Promise<Defaut[]> => {
    const code = controlerMessage({ role: a.role, canal: a.canal, body: m.body, subject: m.subject }, {
      entreprise: a.lead?.company ?? null, liensAutorises, premiereTouche,
    });
    if (code.length) return code;
    return relire({ userId, projectId, role: a.role, body: m.body, subject: m.subject, brief: a.brief, premiereTouche });
  };

  const ctx = a.conflitCtx ?? { neutres: [] };
  let m = await ecrire(null, []);
  let conflit = premierConflit(m.body, a.previousTexts, ctx);
  if (conflit) {
    m = await ecrire(conflit, []);
    if (premierConflit(m.body, a.previousTexts, ctx)) return { ...m, defauts: [], aRevoir: false, tropProche: true };
  }
  let defauts = await controler(m);
  if (defauts.length) {
    m = await ecrire(null, defauts);
    if (premierConflit(m.body, a.previousTexts, ctx)) return { ...m, defauts: [], aRevoir: false, tropProche: true };
    defauts = await controler(m);
  }
  return { ...m, defauts, aRevoir: defauts.length > 0, tropProche: false };
}

function safeAudit(auditNotes: any): Record<string, string> {
  if (!auditNotes) return {};
  try { return typeof auditNotes === "string" ? JSON.parse(auditNotes) : auditNotes; } catch { return {}; }
}
