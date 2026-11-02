/**
 * Réception des webhooks Unipile (spec §6.4–§6.7) : un prospect répond (LinkedIn ou Gmail),
 * accepte une invitation, ouvre/clique un email ; un compte se déconnecte.
 *
 * `normaliser` est le SEUL endroit qui connaît la forme des payloads Unipile.
 * `traiterEvenement` reçoit ses accès au stockage par injection (testable sans base).
 *
 * Invariants :
 *  - compte inconnu ou aucun prospect rattaché → rien n'est stocké (emails personnels) ;
 *  - idempotent : un `providerMessageId` déjà en base n'est jamais retraité (Unipile renvoie
 *    jusqu'à 5 fois) ;
 *  - une vraie réponse arrête la séquence sur TOUS les canaux ; une absence ou un accusé non ;
 *  - jamais coupée par PROSPECTION_SENDING_ENABLED (c'est de la lecture) ;
 *  - on ne journalise jamais le sujet ni le corps d'un message.
 */
import type {
  InboxConversation, InsertInboxConversation, InsertInboxMessage, InsertTask, Lead,
  LeadSequenceState, OutreachMessage, Task,
} from "@shared/schema";
import type { IStorage } from "../../storage";
import { publicIdFromUrl } from "../linkedin";
import { classerMessage } from "./tri";
import { rattacherLead, normaliserEmail } from "./rattachement";

export interface EvenementNormalise {
  kind: "message" | "mail" | "relation" | "suivi" | "compte";
  accountId: string;
  providerMessageId?: string;
  chatId?: string;
  threadId?: string;
  /** Identifiants du message auquel celui-ci répond (email). */
  inReplyTo?: string[];
  fromSelf: boolean;
  /** L'INTERLOCUTEUR (le prospect) : l'expéditeur si entrant, le destinataire si `fromSelf`. */
  senderProviderId?: string;
  senderPublicId?: string;
  senderEmail?: string;
  /** Destinataires directs (To) d'un email, normalisés. */
  destinataires?: string[];
  subject?: string;
  body?: string;
  headers?: Record<string, string>;
  sentAt: Date;
  suivi?: "ouvert" | "clic";
  label?: string;
  statutCompte?: string;
}

export type Canal = "email" | "linkedin";
export interface CompteUnipile { userId: string; projectId: number | null; canal: Canal }

export interface DepsIngestion {
  now: () => Date;
  compteParId: (accountId: string) => Promise<CompteUnipile | null>;
  leadParFil: (userId: string, ids: string[]) => Promise<number | null>;
  leadParProviderId: (userId: string, providerId: string) => Promise<number | null>;
  leadParPublicId: (userId: string, publicId: string) => Promise<number | null>;
  leadContacteParEmail: (userId: string, email: string) => Promise<number | null>;
  getLead: (leadId: number, userId: string) => Promise<Lead | undefined>;
  updateLead: (leadId: number, userId: string, patch: Partial<Lead>) => Promise<unknown>;
  messageExiste: (providerMessageId: string) => Promise<boolean>;
  getConversation: (leadId: number, channel: Canal) => Promise<InboxConversation | undefined>;
  /** Crée la conversation (lead, canal) si elle n'existe pas ; renvoie l'existante sinon (inchangée). */
  obtenirConversation: (row: InsertInboxConversation) => Promise<InboxConversation>;
  updateConversation: (id: number, patch: Partial<InboxConversation>) => Promise<unknown>;
  /** false si le message existait déjà (course entre deux livraisons du même webhook). */
  ajouterMessage: (row: InsertInboxMessage) => Promise<boolean>;
  dernierEntrantAt: (conversationId: number) => Promise<Date | null>;
  getState: (leadId: number) => Promise<LeadSequenceState | undefined>;
  updateState: (leadId: number, patch: Partial<LeadSequenceState>) => Promise<unknown>;
  supprimerBrouillonsLinkedIn: (leadId: number, userId: string) => Promise<unknown>;
  dernierMessageEnvoye: (leadId: number) => Promise<OutreachMessage | undefined>;
  updateOutreachMessage: (id: number, patch: Partial<OutreachMessage>) => Promise<unknown>;
  getTask: (id: number) => Promise<Task | undefined>;
  createTask: (t: InsertTask) => Promise<Task>;
  completeTask: (id: number) => Promise<unknown>;
  markFeedbackReplied: (userId: string, leadId: number) => Promise<void>;
  /** Point d'entrée UNIQUE de l'acceptation (garde la date la plus ancienne, réveille la séquence). */
  setLeadLinkedinConnected: (leadId: number, at: Date) => Promise<void>;
  marquerSuivi: (userId: string, leadId: number, step: number, champ: "openedAt" | "clickedAt", at: Date) => Promise<unknown>;
  /** Note la déconnexion (comptesDeconnectes) SANS retirer l'identifiant : l'envoi se met en pause, la réception continue. */
  deconnecterCompte: (compte: CompteUnipile, at: Date) => Promise<unknown>;
  /** Efface la marque de déconnexion de ce canal. */
  reconnecterCompte: (compte: CompteUnipile) => Promise<unknown>;
  fuseau: (userId: string) => Promise<string>;
}

/** Ordre du pipeline (miroir serveur de client/src/pages/outreach/stages.ts). */
export const STAGES = [
  "identified", "messages_ready", "connection_sent", "connected", "followup1_sent",
  "followup2_sent", "in_discussion", "proposal_sent", "signed", "no_follow",
] as const;

/** Passe à « en discussion » seulement depuis une étape antérieure ; jamais depuis no_follow. */
export function stadeApresReponse(stage: string | null | undefined): string | null {
  const s = stage || "identified";
  if (s === "no_follow") return null;
  const i = STAGES.indexOf(s as any);
  return i !== -1 && i < STAGES.indexOf("in_discussion") ? "in_discussion" : null;
}

/** Statuts Unipile signifiant que le compte ne synchronise plus (doc « Account status updates »). */
const STATUTS_DECONNECTE = new Set(["ERROR", "STOPPED", "CREDENTIALS", "DELETED"]);
/** Statuts signifiant que le compte synchronise de nouveau. */
const STATUTS_RECONNECTE = new Set(["OK", "RECONNECTED"]);

// ─── Normalisation des payloads Unipile ─────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
function date(v: unknown, repli: Date): Date {
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return repli;
}

function texteDepuisHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<div[^>]*class="[^"]*gmail_quote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enTetes(h: unknown): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (Array.isArray(h)) {
    for (const x of h) {
      const k = str(x?.name ?? x?.key);
      if (k) out[k.toLowerCase()] = String(x?.value ?? "");
    }
  } else if (h && typeof h === "object") {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v ?? "");
  }
  return Object.keys(out).length ? out : undefined;
}

function publicId(url: unknown): string | undefined {
  return publicIdFromUrl(str(url))?.replace(/\/+$/, "") || undefined;
}

export function normaliser(payload: any): EvenementNormalise | null {
  if (!payload || typeof payload !== "object") return null;
  const maintenant = new Date();

  // Statut de compte : { AccountStatus: { account_id, account_type, message } }.
  if (payload.AccountStatus && typeof payload.AccountStatus === "object") {
    const accountId = str(payload.AccountStatus.account_id);
    if (!accountId) return null;
    return { kind: "compte", accountId, fromSelf: false, statutCompte: str(payload.AccountStatus.message)?.toUpperCase(), sentAt: maintenant };
  }

  const accountId = str(payload.account_id);
  const event = str(payload.event);
  if (!accountId || !event) return null;

  if (event === "message_received") {
    const moi = str(payload.account_info?.user_id);
    const expediteur = payload.sender ?? {};
    const fromSelf = !!moi && str(expediteur.attendee_provider_id) === moi;
    // Interlocuteur : l'expéditeur, ou si c'est Jeanne, l'unique autre participant.
    let autre = expediteur;
    if (fromSelf) {
      const autres = (Array.isArray(payload.attendees) ? payload.attendees : [])
        .filter((a: any) => str(a?.attendee_provider_id) && str(a.attendee_provider_id) !== moi);
      autre = autres.length === 1 ? autres[0] : {};
    }
    const providerMessageId = str(payload.message_id);
    if (!providerMessageId) return null;
    return {
      kind: "message", accountId, providerMessageId, chatId: str(payload.chat_id), fromSelf,
      senderProviderId: str(autre?.attendee_provider_id), senderPublicId: publicId(autre?.attendee_profile_url),
      body: typeof payload.message === "string" ? payload.message : "",
      sentAt: date(payload.timestamp, maintenant),
    };
  }

  if (event === "mail_received" || event === "mail_sent") {
    const dossiers: string[] = Array.isArray(payload.folders) ? payload.folders.map(String) : [];
    const fromSelf = event === "mail_sent" || /^sent$/i.test(String(payload.role ?? ""))
      || dossiers.some((f) => /(^|\/|\b)sent\b|envoy/i.test(f));
    const destinataires: string[] = (Array.isArray(payload.to_attendees) ? payload.to_attendees : [])
      .map((a: any) => str(a?.identifier)).filter((x: string | undefined): x is string => !!x).map(normaliserEmail);
    const interlocuteur = fromSelf ? destinataires[0] : str(payload.from_attendee?.identifier);
    const providerMessageId = str(payload.email_id) ?? str(payload.provider_id) ?? str(payload.message_id);
    if (!providerMessageId) return null;
    const inReplyTo = [str(payload.in_reply_to?.id), str(payload.in_reply_to?.message_id)].filter((x): x is string => !!x);
    const body = str(payload.body_plain) ?? (typeof payload.body === "string" ? texteDepuisHtml(payload.body) : "");
    return {
      kind: "mail", accountId, providerMessageId, threadId: str(payload.thread_id),
      inReplyTo: inReplyTo.length ? inReplyTo : undefined, fromSelf,
      senderEmail: interlocuteur ? normaliserEmail(interlocuteur) : undefined,
      destinataires: destinataires.length ? destinataires : undefined,
      subject: str(payload.subject), body, headers: enTetes(payload.headers),
      sentAt: date(payload.date, maintenant),
    };
  }

  if (event === "new_relation") {
    return {
      kind: "relation", accountId, fromSelf: false,
      senderProviderId: str(payload.user_provider_id),
      senderPublicId: str(payload.user_public_identifier) ?? publicId(payload.user_profile_url),
      // Le payload ne porte pas de date : l'instant de réception (setLeadLinkedinConnected garde la plus ancienne).
      sentAt: maintenant,
    };
  }

  if (event === "mail_opened" || event === "mail_link_clicked") {
    return {
      kind: "suivi", accountId, fromSelf: false, suivi: event === "mail_opened" ? "ouvert" : "clic",
      label: str(payload.label), sentAt: date(payload.date, maintenant),
    };
  }

  return null;
}

// ─── Traitement ─────────────────────────────────────────────────────────────────

function aujourdhuiDans(fuseau: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

export async function traiterEvenement(evt: EvenementNormalise, deps: DepsIngestion): Promise<void> {
  const compte = await deps.compteParId(evt.accountId);
  if (!compte) return;
  const userId = compte.userId;

  if (evt.kind === "compte") {
    if (evt.statutCompte && STATUTS_DECONNECTE.has(evt.statutCompte)) {
      console.warn(`[Reponses] compte ${compte.canal} déconnecté (${evt.statutCompte}) — utilisatrice ${userId}${compte.projectId != null ? `, projet ${compte.projectId}` : ""} : envoi en pause sur ce canal`);
      await deps.deconnecterCompte(compte, deps.now());
    } else if (evt.statutCompte && STATUTS_RECONNECTE.has(evt.statutCompte)) {
      await deps.reconnecterCompte(compte);
    }
    return;
  }

  if (evt.kind === "suivi") {
    const m = /^lead:(\d+):step:(\d+)$/.exec(evt.label ?? "");
    if (!m) return;
    await deps.marquerSuivi(userId, Number(m[1]), Number(m[2]), evt.suivi === "clic" ? "clickedAt" : "openedAt", evt.sentAt);
    return;
  }

  const trouve = await rattacherLead(evt, {
    leadParFil: (ids) => deps.leadParFil(userId, ids),
    leadParProviderId: (p) => deps.leadParProviderId(userId, p),
    leadParPublicId: (p) => deps.leadParPublicId(userId, p),
    leadContacteParEmail: (e) => deps.leadContacteParEmail(userId, e),
  });
  if (!trouve) return;
  const lead = await deps.getLead(trouve.leadId, userId);
  if (!lead) return;

  if (evt.kind === "relation") {
    await deps.setLeadLinkedinConnected(lead.id, evt.sentAt);
    if (!lead.linkedinProviderId && evt.senderProviderId) {
      await deps.updateLead(lead.id, userId, { linkedinProviderId: evt.senderProviderId });
    }
    return;
  }

  // message / mail
  if (!evt.providerMessageId) return;
  if (await deps.messageExiste(evt.providerMessageId)) return;
  const channel: Canal = evt.kind === "message" ? "linkedin" : "email";
  const fil = evt.chatId ?? evt.threadId ?? null;
  const message = (conversationId: number, sens: "entrant" | "sortant", nature: string): InsertInboxMessage => ({
    conversationId, providerMessageId: evt.providerMessageId!, sens, nature,
    subject: evt.subject ?? null, body: evt.body ?? "", sentAt: evt.sentAt,
  });
  const plusRecent = (a: Date | null | undefined) => (!a || evt.sentAt > a ? evt.sentAt : a);

  // Un email ADRESSÉ au prospect et qui ne vient pas de lui part de chez nous (envoi Naya ou
  // Gmail de Jeanne que le fournisseur n'aurait pas marqué « envoyé ») : jamais une réponse.
  const emailLead = lead.email ? normaliserEmail(lead.email) : null;
  const deChezNous = evt.fromSelf || (evt.kind === "mail" && !!emailLead
    && !!evt.destinataires?.includes(emailLead) && evt.senderEmail !== emailLead);

  if (deChezNous) {
    // Jeanne écrit (depuis Naya ou son téléphone) : ajouté au fil existant, jamais une réponse.
    const conv = await deps.getConversation(lead.id, channel);
    if (!conv) return;
    const dernierEntrant = await deps.dernierEntrantAt(conv.id);
    if (!(await deps.ajouterMessage(message(conv.id, "sortant", "nous")))) return;
    const patch: Partial<InboxConversation> = { lastMessageAt: plusRecent(conv.lastMessageAt) };
    if (dernierEntrant && evt.sentAt > dernierEntrant) {
      patch.statut = "traitee";
      patch.nonLu = false;
      if (conv.taskId) {
        const t = await deps.getTask(conv.taskId);
        if (t && !t.completed) await deps.completeTask(t.id);
      }
    }
    await deps.updateConversation(conv.id, patch);
    return;
  }

  const tri = classerMessage({ subject: evt.subject, body: evt.body ?? "", headers: evt.headers }, evt.sentAt);
  const estReponse = tri.nature === "reponse";
  const conv = await deps.obtenirConversation({
    userId, projectId: lead.projectId ?? compte.projectId, leadId: lead.id, channel,
    unipileAccountId: evt.accountId, providerChatId: fil,
    // Une absence ou un accusé reste visible dans la fiche, sans rien demander à Jeanne.
    statut: estReponse ? "a_traiter" : "traitee", nonLu: estReponse,
    lastMessageAt: evt.sentAt,
  });
  if (!(await deps.ajouterMessage(message(conv.id, "entrant", tri.nature)))) return;

  const patchConv: Partial<InboxConversation> = { lastMessageAt: plusRecent(conv.lastMessageAt) };
  if (!conv.providerChatId && fil) patchConv.providerChatId = fil;
  if (conv.unipileAccountId !== evt.accountId) patchConv.unipileAccountId = evt.accountId;

  if (tri.nature === "absence") {
    const state = await deps.getState(lead.id);
    if (state?.status === "active" && tri.retourLe) {
      const actuel = state.nextRunAt;
      if (!actuel || actuel < tri.retourLe) await deps.updateState(lead.id, { nextRunAt: tri.retourLe });
    }
    await deps.updateConversation(conv.id, patchConv);
    return;
  }
  if (tri.nature === "accuse") {
    await deps.updateConversation(conv.id, patchConv);
    return;
  }

  // ── Vraie réponse ──
  const state = await deps.getState(lead.id);
  if (state && state.status !== "stopped_replied" && state.status !== "unsubscribed") {
    if (!conv.etatAvantReponse) {
      patchConv.etatAvantReponse = {
        status: state.status, currentStep: state.currentStep,
        nextRunAt: state.nextRunAt ? state.nextRunAt.toISOString() : null,
        delayAnchorAt: state.delayAnchorAt ? state.delayAnchorAt.toISOString() : null,
      };
    }
    await deps.updateState(lead.id, { status: tri.desinscription ? "unsubscribed" : "stopped_replied", repliedAt: evt.sentAt, nextRunAt: null });
  } else if (state && state.status === "stopped_replied" && tri.desinscription) {
    await deps.updateState(lead.id, { status: "unsubscribed", nextRunAt: null });
  }
  await deps.supprimerBrouillonsLinkedIn(lead.id, userId);

  const dernier = await deps.dernierMessageEnvoye(lead.id);
  if (dernier && !dernier.responseReceived) {
    await deps.updateOutreachMessage(dernier.id, { responseReceived: true, responseDate: evt.sentAt });
  }

  const stade = stadeApresReponse(lead.stage);
  if (stade) await deps.updateLead(lead.id, userId, { stage: stade });

  patchConv.statut = "a_traiter";
  patchConv.nonLu = true;

  const tacheOuverte = conv.taskId ? await deps.getTask(conv.taskId) : undefined;
  if (!tacheOuverte || tacheOuverte.completed || tacheOuverte.archivedAt) {
    const fuseau = await deps.fuseau(userId);
    const projectId = lead.projectId ?? compte.projectId;
    const tache = await deps.createTask({
      userId,
      projectId,
      title: `Répondre à ${lead.name}${lead.company ? ` (${lead.company})` : ""} — ${channel === "linkedin" ? "LinkedIn" : "email"}`,
      type: "outreach",
      category: "conversion",
      leadId: lead.id,
      scheduledDate: aujourdhuiDans(fuseau, deps.now()),
      estimatedDuration: 10,
      source: "reponse_prospect",
    });
    patchConv.taskId = tache.id;
  }
  await deps.updateConversation(conv.id, patchConv);
  await deps.markFeedbackReplied(userId, lead.id);
}

/** Dépendances réelles (le stockage est passé par l'appelant pour garder ce module testable sans base). */
export function depsDepuisStorage(s: IStorage): DepsIngestion {
  return {
    now: () => new Date(),
    compteParId: (id) => s.trouverCompteUnipile(id),
    leadParFil: (u, ids) => s.leadParFilReponse(u, ids),
    leadParProviderId: (u, p) => s.leadContacteParLinkedinProviderId(u, p),
    leadParPublicId: (u, p) => s.leadContacteParLinkedinPublicId(u, p),
    leadContacteParEmail: (u, e) => s.leadContacteParEmail(u, e),
    getLead: (id, u) => s.getLead(id, u),
    updateLead: (id, u, p) => s.updateLead(id, u, p),
    messageExiste: (pm) => s.inboxMessageExiste(pm),
    getConversation: (l, c) => s.getInboxConversation(l, c),
    obtenirConversation: (row) => s.obtenirInboxConversation(row),
    updateConversation: (id, p) => s.updateInboxConversation(id, p),
    ajouterMessage: (row) => s.ajouterInboxMessage(row),
    dernierEntrantAt: (cid) => s.dernierEntrantInboxAt(cid),
    getState: (l) => s.getLeadSequenceState(l),
    updateState: (l, p) => s.updateLeadSequenceState(l, p),
    supprimerBrouillonsLinkedIn: (l, u) => s.deleteLinkedInDraftsForLead(l, u),
    dernierMessageEnvoye: (l) => s.getLatestOutreachByLead(l),
    updateOutreachMessage: (id, p) => s.updateOutreachMessage(id, p),
    getTask: (id) => s.getTask(id),
    createTask: (t) => s.createTask(t),
    completeTask: (id) => s.completeTask(id),
    markFeedbackReplied: (u, l) => s.markFeedbackReplied(u, l),
    setLeadLinkedinConnected: (l, at) => s.setLeadLinkedinConnected(l, at),
    marquerSuivi: (u, l, step, champ, at) => s.marquerSuiviEmail(u, l, step, champ, at),
    deconnecterCompte: (c, at) => s.deconnecterCompteUnipile(c.userId, c.projectId, c.canal, at),
    reconnecterCompte: (c) => s.reconnecterCompteUnipile(c.userId, c.projectId, c.canal),
    fuseau: async (u) => (await s.getUserPreferences(u))?.timezone || "UTC",
  };
}
