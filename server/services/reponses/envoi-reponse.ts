/**
 * Envoi d'une réponse écrite (ou relue) par l'utilisatrice depuis la boîte « Réponses »
 * (spec §6.8). Rien ne part sans son clic « Envoyer » : cette fonction n'est appelée que par
 * POST /api/reponses/:id/envoyer.
 *
 * Canal du prospect :
 *  - LinkedIn → message dans le même chat Unipile (`providerChatId`) ;
 *  - email → réponse dans le même fil Gmail (`reply_to` = dernier message entrant, objet « Re: … »).
 *
 * Raisons de refus :
 *  - `envoi_coupe`      : kill-switch global PROSPECTION_SENDING_ENABLED coupé ;
 *  - `compte_restreint` : compte LinkedIn en pause (restriction connue, ou signal au retour —
 *                         la pause est alors persistée comme le fait le worker) ;
 *  - `compte_deconnecte`: compte Unipile du canal en erreur (`comptesDeconnectes`) ;
 *  - `compte_absent`    : aucun compte du canal dans le périmètre, ou ce n'est plus le compte
 *                         qui porte la conversation (le chat / le fil lui appartient) ;
 *  - `envoi_en_cours`   : un envoi pour cette conversation est déjà en vol dans ce processus ;
 *  - `deja_envoye`      : le même texte est déjà parti (ou part) pour cette conversation il y a
 *                         moins de 2 minutes — garde VISIBLE EN BASE : une ligne sortante
 *                         « en_attente » à identifiant déterministe est réservée AVANT l'appel
 *                         au fournisseur ; une seconde requête simultanée (autre instance,
 *                         double clic) bute sur l'unicité de providerMessageId ;
 *  - `texte_vide`, `texte_trop_long` (> 8000 caractères), `introuvable` (conversation absente
 *                         ou d'un autre utilisateur) ;
 *  - `echec`            : le fournisseur a refusé, ou le prospect n'a pas d'adresse email.
 *
 * Une réponse humaine n'est JAMAIS refusée par les plafonds LinkedIn (montée en charge,
 * hebdomadaire) : elle est seulement COMPTÉE dans le journal des tentatives, pour que le
 * worker en tienne compte. On ne journalise jamais le texte.
 */
import type { InboxConversation, InboxMessage, InsertInboxMessage, Lead, Task } from "@shared/schema";
import type { IdentiteEnvoi, Portee } from "../connexions/portee";
import type { EmailSendResult } from "../unipile-mail";
import { subjectReponse } from "../unipile-mail";
import { isLinkedInRestrictionSignal } from "../prospection-linkedin-guard";
import { createHash } from "node:crypto";

/** Limite de longueur d'une réponse (LinkedIn ≈ 8000 caractères — à confirmer côté Unipile ; même borne pour l'email). */
export const LONGUEUR_MAX_REPONSE = 8000;
/** Fenêtre pendant laquelle un même texte n'est pas renvoyé dans la même conversation. */
export const FENETRE_DOUBLON_MS = 2 * 60_000;
/** Nature d'une ligne sortante réservée avant l'appel au fournisseur. */
export const NATURE_EN_ATTENTE = "en_attente";

/** Identifiant déterministe de la réservation : même conversation + même texte + même minute. */
export function cleEnAttente(conversationId: number, texte: string, now: Date): string {
  const h = createHash("sha256").update(texte).digest("hex");
  return `pending:${conversationId}:${h}:${Math.floor(now.getTime() / 60_000)}`;
}

/** Un message sortant au même texte, envoyé ou en vol, dans la fenêtre donnée. */
export function doublonRecent(messages: InboxMessage[], texte: string, now: Date, fenetreMs: number): boolean {
  return messages.some((m) => m.sens === "sortant" && (m.nature === "nous" || m.nature === NATURE_EN_ATTENTE)
    && (m.body ?? "").trim() === texte
    && Math.abs(now.getTime() - new Date(m.createdAt ?? m.sentAt).getTime()) <= fenetreMs);
}

export type RaisonRefus =
  | "envoi_coupe" | "compte_restreint" | "compte_deconnecte" | "compte_absent"
  | "envoi_en_cours" | "deja_envoye" | "texte_vide" | "texte_trop_long" | "introuvable" | "echec";
export type ResultatEnvoi = { ok: true } | { ok: false; raison: RaisonRefus };

export interface DepsEnvoiReponse {
  now: () => Date;
  envoiActif: () => boolean;
  getConversation: (id: number, userId: string) => Promise<InboxConversation | undefined>;
  getLead: (leadId: number, userId: string) => Promise<Lead | undefined>;
  getMessages: (conversationId: number) => Promise<InboxMessage[]>;
  /** Qui envoie pour ce prospect (campagne → projet → périmètre). */
  identite: (userId: string, conv: InboxConversation, lead: Lead) => Promise<{ portee: Portee; identite: IdentiteEnvoi }>;
  envoyerLinkedIn: (o: { accountId: string; chatId: string; text: string }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  envoyerEmail: (o: { accountId: string; to: string; toName: string; subject: string; body: string; replyToProviderId?: string }) => Promise<EmailSendResult>;
  journaliserTentativeLinkedIn: (userId: string, leadId: number, ok: boolean, error: string | null, portee: Portee) => Promise<unknown>;
  persisterRestriction: (userId: string, portee: Portee, error: string | null) => Promise<unknown>;
  /** false si le providerMessageId existe déjà (unicité en base). */
  ajouterMessage: (row: InsertInboxMessage) => Promise<boolean>;
  /** Ligne « en_attente » → message envoyé (`nous`), avec l'identifiant réel du fournisseur s'il existe. */
  finaliserEnvoi: (cleAttente: string, providerId: string | null, sentAt: Date) => Promise<unknown>;
  /** Retire la ligne « en_attente » (envoi refusé par le fournisseur). */
  supprimerMessage: (providerMessageId: string) => Promise<unknown>;
  updateConversation: (id: number, patch: Partial<InboxConversation>) => Promise<unknown>;
  getTask: (id: number) => Promise<Task | undefined>;
  completeTask: (id: number) => Promise<unknown>;
}

const echapperHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const erreurSure = (e: any) => String(e?.message ?? e).split(/\bparams:/)[0].slice(0, 160);

/** Conversations dont un envoi est en vol, dans ce processus (anti double clic). */
const enVol = new Set<number>();

/** Dernier message entrant (le plus récent), ou undefined. */
export function dernierEntrant(messages: InboxMessage[]): InboxMessage | undefined {
  return messages
    .filter((m) => m.sens === "entrant")
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];
}

export async function envoyerReponse(
  conversationId: number, userId: string, texteBrut: string, deps: DepsEnvoiReponse,
): Promise<ResultatEnvoi> {
  const texte = (texteBrut ?? "").trim();
  if (!texte) return { ok: false, raison: "texte_vide" };
  if (texte.length > LONGUEUR_MAX_REPONSE) return { ok: false, raison: "texte_trop_long" };
  if (!deps.envoiActif()) return { ok: false, raison: "envoi_coupe" };
  if (enVol.has(conversationId)) return { ok: false, raison: "envoi_en_cours" };
  enVol.add(conversationId);
  try {
    const conv = await deps.getConversation(conversationId, userId);
    if (!conv) return { ok: false, raison: "introuvable" };
    const lead = await deps.getLead(conv.leadId, userId);
    if (!lead) return { ok: false, raison: "introuvable" };
    const { portee, identite } = await deps.identite(userId, conv, lead);
    const now = deps.now();

    let providerId: string | undefined;
    let sujet: string | null = null;
    const messages = await deps.getMessages(conv.id);

    // Réservation visible en base, posée juste avant l'appel au fournisseur (après tous les refus).
    const cle = cleEnAttente(conv.id, texte, now);
    const reserver = async (): Promise<boolean> => {
      if (doublonRecent(messages, texte, now, FENETRE_DOUBLON_MS)) return false;
      return deps.ajouterMessage({
        conversationId: conv.id, providerMessageId: cle, sens: "sortant", nature: NATURE_EN_ATTENTE,
        subject: sujet, body: texte, sentAt: now,
      });
    };
    const liberer = () => deps.supprimerMessage(cle)
      .catch((e: any) => console.error(`[Reponses] réservation non retirée (conversation ${conv.id}) : ${erreurSure(e)}`));

    if (conv.channel === "linkedin") {
      const li = identite.linkedin;
      if (!li) return { ok: false, raison: "compte_absent" };
      if (li.restriction) return { ok: false, raison: "compte_restreint" };
      if (li.deconnecte) return { ok: false, raison: "compte_deconnecte" };
      if (li.accountId !== conv.unipileAccountId || !conv.providerChatId) return { ok: false, raison: "compte_absent" };
      if (!(await reserver())) return { ok: false, raison: "deja_envoye" };
      const r = await deps.envoyerLinkedIn({ accountId: li.accountId, chatId: conv.providerChatId, text: texte });
      // Toute requête vue par LinkedIn compte, réussie ou non (garde de risque du worker).
      await deps.journaliserTentativeLinkedIn(userId, lead.id, r.ok, r.ok ? null : (r.error ?? null), portee)
        .catch((e: any) => console.error(`[Reponses] tentative LinkedIn non journalisée (lead ${lead.id}) : ${erreurSure(e)}`));
      if (!r.ok) {
        await liberer();
        if (isLinkedInRestrictionSignal(r.error)) {
          await deps.persisterRestriction(userId, portee, r.error ?? null).catch((e: any) =>
            console.error(`[Reponses] ÉCHEC DE PERSISTANCE de la restriction LinkedIn (user ${userId}) : ${erreurSure(e)}`));
          console.error(`[Reponses] compte LinkedIn de l'utilisateur ${userId} mis EN PAUSE (signal de restriction Unipile).`);
          return { ok: false, raison: "compte_restreint" };
        }
        console.error(`[Reponses] envoi LinkedIn refusé (conversation ${conv.id}) : ${String(r.error ?? "").slice(0, 120)}`);
        return { ok: false, raison: "echec" };
      }
      providerId = r.messageId;
    } else {
      const em = identite.email;
      if (!em?.unipileAccountId) return { ok: false, raison: "compte_absent" };
      if (em.deconnecte) return { ok: false, raison: "compte_deconnecte" };
      if (em.unipileAccountId !== conv.unipileAccountId) return { ok: false, raison: "compte_absent" };
      // Destinataire : l'adresse du lead (inbox_messages ne stocke pas l'expéditeur d'un entrant).
      if (!lead.email) return { ok: false, raison: "echec" };
      const entrant = dernierEntrant(messages);
      const avecSujet = [...messages]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .find((m) => m.subject && m.subject.trim());
      sujet = subjectReponse(entrant?.subject?.trim() || avecSujet?.subject?.trim() || "");
      if (!(await reserver())) return { ok: false, raison: "deja_envoye" };
      const r = await deps.envoyerEmail({
        accountId: em.unipileAccountId, to: lead.email, toName: lead.name, subject: sujet,
        body: echapperHtml(texte).replace(/\r?\n/g, "<br>"),
        replyToProviderId: entrant?.providerMessageId,
      });
      if (!r.ok) {
        await liberer();
        console.error(`[Reponses] envoi email refusé (conversation ${conv.id}) : ${String(r.error ?? "").slice(0, 120)}`);
        return { ok: false, raison: "echec" };
      }
      providerId = r.providerId;
    }

    // ── Parti : les écritures suivantes sont au mieux. Un échec ici ne doit JAMAIS faire
    // croire à un échec d'envoi (l'utilisatrice renverrait le même message).
    const auMieux = async (quoi: string, f: () => Promise<unknown>) => {
      try { await f(); } catch (e: any) { console.error(`[Reponses] conversation ${conv.id} : ${quoi} échoué — ${erreurSure(e)}`); }
    };
    // La réservation devient le message envoyé, avec l'identifiant réel du fournisseur (celui
    // de l'écho du webhook) quand il est renvoyé.
    await auMieux("stockage du message envoyé", () => deps.finaliserEnvoi(cle, providerId ?? null, now));
    await auMieux("conversation traitée", () => deps.updateConversation(conv.id, {
      statut: "traitee", nonLu: false,
      lastMessageAt: !conv.lastMessageAt || now > conv.lastMessageAt ? now : conv.lastMessageAt,
    }));
    if (conv.taskId) {
      await auMieux("tâche cochée", async () => {
        const t = await deps.getTask(conv.taskId!);
        if (t && !t.completed) await deps.completeTask(t.id);
      });
    }
    return { ok: true };
  } finally {
    enVol.delete(conversationId);
  }
}
