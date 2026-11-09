/**
 * Suppression DÉFINITIVE d'un prospect (lead) et de tout ce qui s'y rattache.
 *
 * L'archivage (`archivedAt`) reste le geste courant et réversible ; ceci est l'autre geste :
 * la fiche et son historique disparaissent de la base. Une seule transaction par prospect :
 * rien n'est jamais à moitié supprimé.
 *
 * Ce que devient chaque table qui pointe vers `leads` (8 clés étrangères + 1 colonne libre) :
 *
 *   SUPPRIMÉ (l'historique du prospect)
 *     inbox_messages            — via ses conversations (pas de lead_id propre)
 *     inbox_conversations       — conversations de réponses (lead_id)
 *     lead_step_messages        — messages rédigés sur-mesure, par étape
 *     outreach_step_sends       — réservations d'envoi (garde d'idempotence)
 *     outreach_messages         — messages envoyés / brouillons LinkedIn
 *     lead_sequence_state       — état dans la séquence
 *     prospection_message_feedback — corrections de rédaction SUR CE prospect (elles nourrissent
 *                                 les exemples injectés dans les prompts : le texte cite la personne)
 *     tasks (source = 'reponse_prospect' | 'relance_prospect') — « Répondre à X », « Relancer X » :
 *                                 sans objet une fois X supprimé (la relance porte un brouillon qui le cite)
 *     leads                     — la fiche, en dernier
 *
 *   DÉTACHÉ (lead_id → NULL : la ligne sert à autre chose qu'à ce prospect)
 *     tasks.lead_id (autres sources) — la tâche est dans le planning de l'utilisatrice
 *     linkedin_send_attempts.lead_id  — source des plafonds LinkedIn glissants
 *     prospection_usage.prospect_id   — journal interne des coûts (admin)
 *
 *   GARDÉ, sans rien qui désigne la personne
 *     envois_plafond      — instant + canal des envois des 7 derniers jours : la suppression ne
 *                           rouvre pas de place dans le plafond d'emails du jour ni l'espacement
 *
 *   EXCEPTIONS LÉGALES
 *     prospects_bloques   — DÉSINSCRIT : son email et ses identifiants LinkedIn, une ligne par clé
 *     prospects_supprimes — CONTACTÉ (un message est parti) : pierre tombale de 90 jours, qui ne
 *                           bloque rien mais permet de transformer une désinscription arrivant
 *                           APRÈS la suppression (lien, un clic, webhook) en vrai blocage
 *
 * Course avec l'envoi : la fiche est verrouillée (`FOR UPDATE`) au début de la transaction.
 * Une réservation d'envoi (`claimStepSend`) a besoin d'un verrou de clé sur la fiche : elle
 * attend donc la fin de la suppression, puis échoue (clé étrangère) → rien ne part. Une
 * réservation déjà prise et récente (envoi en cours chez le fournisseur) fait REFUSER la
 * suppression (`envoi_en_cours`) : on ne supprime pas quelqu'un à qui on est en train d'écrire.
 */
import { and, eq, gt, gte, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  leads, leadSequenceState, inboxConversations, inboxMessages, leadStepMessages,
  outreachStepSends, outreachMessages, tasks, prospectionMessageFeedback,
  linkedinSendAttempts, prospectionUsage, prospectsBloques, prospectsSupprimes, envoisPlafond,
} from "@shared/schema";
import type { DbExecutor } from "../db";
import { clesPersonne } from "./reponses/rattachement";
import { SOURCE_TACHE_RELANCE } from "./reponses/relance-etat";

/** Une réservation `claimed` plus récente que ça = un envoi en cours chez le fournisseur. */
export const RESERVATION_EN_COURS_MS = 15 * 60 * 1000;
/** Durée de vie d'une pierre tombale (désinscription tardive possible jusque-là). */
export const DUREE_PIERRE_TOMBALE_MS = 90 * 86_400_000;
/** Fenêtre des envois gardés pour le plafond et l'espacement. */
export const FENETRE_ENVOIS_PLAFOND_MS = 7 * 86_400_000;
/** Source des tâches « Répondre à X » créées par la réception des réponses. */
export const SOURCE_TACHE_REPONSE = "reponse_prospect";
/** Sources des tâches liées au prospect, supprimées avec lui (« Répondre à X », « Relancer X »). */
export const SOURCES_TACHES_PROSPECT = [SOURCE_TACHE_REPONSE, SOURCE_TACHE_RELANCE] as const;

export type RaisonRefus = "introuvable" | "envoi_en_cours" | "erreur";
export type IssueSuppression =
  | { ok: true; bloque: boolean }
  | { ok: false; raison: RaisonRefus };

export interface FicheContact { email?: string | null; linkedinProviderId?: string | null; linkedinUrl?: string | null }
export interface ClesContact { email: string | null; publicId: string | null; providerId: string | null }

/** Clés normalisées d'une fiche (même normalisation que la détection des doublons). */
export function clesContact(f: FicheContact): ClesContact {
  const c = clesPersonne({ email: f.email ?? null, pid: f.linkedinProviderId ?? null, url: f.linkedinUrl ?? null });
  return { email: c.email, publicId: c.publicId, providerId: c.providerId };
}

/** Identifiants à confronter à la liste « ne plus contacter ». */
export function clesBlocage(f: FicheContact): { email: string | null; linkedinIds: string[] } {
  const c = clesContact(f);
  return { email: c.email, linkedinIds: [c.publicId, c.providerId].filter((x): x is string => !!x) };
}

/** Lignes « ne plus contacter » : UNE PAR CLÉ (email, identifiant public, identifiant Unipile). */
export function lignesBlocage(userId: string, c: ClesContact): { userId: string; emailNormalise: string | null; linkedinId: string | null; raison: string }[] {
  const out: { userId: string; emailNormalise: string | null; linkedinId: string | null; raison: string }[] = [];
  if (c.email) out.push({ userId, emailNormalise: c.email, linkedinId: null, raison: "desinscription" });
  for (const id of new Set([c.publicId, c.providerId].filter((x): x is string => !!x))) {
    out.push({ userId, emailNormalise: null, linkedinId: id, raison: "desinscription" });
  }
  return out;
}

/**
 * Inscrit ces clés sur « ne plus contacter ». Chaque ligne a son propre `ON CONFLICT DO
 * NOTHING` : une clé déjà connue n'empêche jamais les autres d'être écrites. Rend le nombre
 * de lignes tentées (0 = aucune clé, rien ne permet de reconnaître la personne).
 */
export async function bloquerContact(ex: DbExecutor, userId: string, c: ClesContact): Promise<number> {
  const lignes = lignesBlocage(userId, c);
  for (const l of lignes) await ex.insert(prospectsBloques).values(l).onConflictDoNothing();
  return lignes.length;
}

/** Condition SQL « cette fiche est dans la liste ne plus contacter de l'utilisatrice », ou null si elle n'a aucun identifiant. */
export function conditionBlocage(userId: string, f: FicheContact): SQL | null {
  const { email, linkedinIds } = clesBlocage(f);
  const parts: SQL[] = [];
  if (email) parts.push(eq(prospectsBloques.emailNormalise, email));
  if (linkedinIds.length) parts.push(inArray(prospectsBloques.linkedinId, linkedinIds));
  if (!parts.length) return null;
  return and(eq(prospectsBloques.userId, userId), or(...parts))!;
}

/**
 * Avant de supprimer des états de séquence en masse (campagne supprimée, compte remis à
 * zéro) : les désinscrits qu'ils portent passent sur « ne plus contacter », sinon la
 * garantie disparaîtrait avec la ligne `unsubscribed`.
 */
export async function bloquerDesinscritsAvantSuppression(ex: DbExecutor, condition: SQL): Promise<number> {
  const rows = await ex.select({
    userId: leadSequenceState.userId, email: leads.email,
    linkedinProviderId: leads.linkedinProviderId, linkedinUrl: leads.linkedinUrl,
  }).from(leadSequenceState)
    .innerJoin(leads, eq(leads.id, leadSequenceState.leadId))
    .where(and(eq(leadSequenceState.status, "unsubscribed"), condition));
  for (const r of rows) await bloquerContact(ex, r.userId, clesContact(r));
  return rows.length;
}

/** Contrainte de clé étrangère qui désigne un prospect (`*_lead_id_*`, `*_prospect_id_*`). */
export function estContrainteLead(e: any): boolean {
  return e?.code === "23503" && typeof e?.constraint === "string" && /(^|_)(lead|prospect)_id(_|$)/.test(e.constraint);
}

export interface OptionsSuppression {
  now?: Date;
  /** Nettoyage des références d'une tâche avant sa suppression (storage.clearTaskReferences). */
  clearTaskReferences: (tx: DbExecutor, taskIds: number[]) => Promise<void>;
}

/**
 * Supprime UN prospect dans la transaction `tx`. Ne lève pas pour un refus (introuvable,
 * envoi en cours) ; lève sur une erreur SQL — l'appelant laisse alors la transaction s'annuler.
 */
export async function supprimerLeadDansTransaction(
  tx: DbExecutor, leadId: number, userId: string, opts: OptionsSuppression,
): Promise<IssueSuppression> {
  const now = opts.now ?? new Date();
  // 1. La fiche, à elle, verrouillée jusqu'à la fin (bloque toute nouvelle réservation d'envoi).
  const [fiche] = await tx.select({
    id: leads.id, email: leads.email, linkedinProviderId: leads.linkedinProviderId, linkedinUrl: leads.linkedinUrl,
  }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
    .for("update");
  if (!fiche) return { ok: false, raison: "introuvable" };
  const cles = clesContact(fiche);

  // 2. Envoi en cours (réservation prise, issue pas encore écrite) : on ne touche à rien.
  const enCours = await tx.select({ id: outreachStepSends.id }).from(outreachStepSends)
    .where(and(
      eq(outreachStepSends.leadId, leadId),
      eq(outreachStepSends.status, "claimed"),
      gt(outreachStepSends.claimedAt, new Date(now.getTime() - RESERVATION_EN_COURS_MS)),
    ))
    .limit(1);
  if (enCours.length) return { ok: false, raison: "envoi_en_cours" };

  // 3. Désinscrit → ses seules clés de contact, une ligne par clé, avant que la trace disparaisse.
  const desinscrit = await tx.select({ id: leadSequenceState.id }).from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.status, "unsubscribed")))
    .limit(1);
  const bloque = desinscrit.length > 0 && (await bloquerContact(tx, userId, cles)) > 0;

  // 4. Envois réels : pierre tombale (désinscription tardive) + instants pour le plafond.
  const envois = await tx.select({ canal: outreachMessages.platform, sentAt: outreachMessages.sentAt })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.leadId, leadId), isNotNull(outreachMessages.sentAt)));
  if (envois.length && !bloque) {
    await tx.insert(prospectsSupprimes).values({
      userId, leadIdSupprime: leadId, emailNormalise: cles.email,
      linkedinPublicId: cles.publicId, linkedinProviderId: cles.providerId,
      expireA: new Date(now.getTime() + DUREE_PIERRE_TOMBALE_MS),
    }).onConflictDoNothing();
  }
  const depuis = now.getTime() - FENETRE_ENVOIS_PLAFOND_MS;
  const recents = envois.filter((e) => e.sentAt && new Date(e.sentAt).getTime() >= depuis);
  if (recents.length) {
    await tx.insert(envoisPlafond).values(recents.map((e) => ({ userId, canal: e.canal, sentAt: e.sentAt! })));
  }

  // 5. L'historique du prospect.
  await tx.delete(inboxMessages).where(
    sql`${inboxMessages.conversationId} in (select ${inboxConversations.id} from ${inboxConversations} where ${inboxConversations.leadId} = ${leadId})`,
  );
  await tx.delete(inboxConversations).where(eq(inboxConversations.leadId, leadId));
  await tx.delete(leadStepMessages).where(eq(leadStepMessages.leadId, leadId));
  await tx.delete(outreachStepSends).where(eq(outreachStepSends.leadId, leadId));
  await tx.delete(outreachMessages).where(eq(outreachMessages.leadId, leadId));
  await tx.delete(leadSequenceState).where(eq(leadSequenceState.leadId, leadId));
  await tx.delete(prospectionMessageFeedback).where(eq(prospectionMessageFeedback.leadId, leadId));
  const tachesReponse = (await tx.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.leadId, leadId), inArray(tasks.source, [...SOURCES_TACHES_PROSPECT])))).map((t) => t.id);
  if (tachesReponse.length) {
    await opts.clearTaskReferences(tx, tachesReponse);
    await tx.delete(tasks).where(inArray(tasks.id, tachesReponse));
  }

  // 6. Ce qui survit, détaché du prospect.
  await tx.update(tasks).set({ leadId: null }).where(eq(tasks.leadId, leadId));
  await tx.update(linkedinSendAttempts).set({ leadId: null }).where(eq(linkedinSendAttempts.leadId, leadId));
  await tx.update(prospectionUsage).set({ prospectId: null }).where(eq(prospectionUsage.prospectId, leadId));

  // 7. La fiche, en dernier (une clé étrangère oubliée ferait échouer ici, donc tout annuler).
  await tx.delete(leads).where(and(eq(leads.id, leadId), eq(leads.userId, userId)));
  return { ok: true, bloque };
}

/** Purge paresseuse (à chaque suppression) : pierres tombales expirées, envois de plus de 7 jours. */
export async function purgerSuppressionsExpirees(ex: DbExecutor, now: Date = new Date()): Promise<void> {
  await ex.delete(prospectsSupprimes).where(lt(prospectsSupprimes.expireA, now));
  await ex.delete(envoisPlafond).where(lt(envoisPlafond.sentAt, new Date(now.getTime() - FENETRE_ENVOIS_PLAFOND_MS)));
}

export type IssueDesinscription = "lead" | "supprime" | "email" | "inconnu";

/**
 * Désinscription reçue pour un prospect (lien Naya, un clic, webhook SendGrid). Ordre :
 *   1. la fiche existe → séquence `unsubscribed` (définitif) ; sans séquence, ses clés vont
 *      directement sur « ne plus contacter » (rien ne doit se perdre) ;
 *   2. la fiche a été SUPPRIMÉE → sa pierre tombale (non expirée) devient « ne plus contacter » ;
 *   3. sinon, si l'appelant connaît l'utilisatrice et l'adresse (webhook SendGrid) → l'adresse
 *      est bloquée ;
 *   4. sinon `inconnu` : l'appelant doit le dire honnêtement, et le journaliser.
 */
export async function desinscrireProspect(
  ex: DbExecutor, leadId: number | null, opts: { userId?: string | null; email?: string | null; now?: Date } = {},
): Promise<IssueDesinscription> {
  const now = opts.now ?? new Date();
  if (leadId) {
    const [fiche] = await ex.select({
      userId: leads.userId, email: leads.email, linkedinProviderId: leads.linkedinProviderId, linkedinUrl: leads.linkedinUrl,
    }).from(leads).where(eq(leads.id, leadId));
    if (fiche) {
      const maj = await ex.update(leadSequenceState).set({ status: "unsubscribed", nextRunAt: null, updatedAt: now })
        .where(eq(leadSequenceState.leadId, leadId))
        .returning({ id: leadSequenceState.id });
      if (!maj.length) await bloquerContact(ex, fiche.userId, clesContact(fiche));
      return "lead";
    }
    const [tombe] = await ex.select().from(prospectsSupprimes)
      .where(and(eq(prospectsSupprimes.leadIdSupprime, leadId), gte(prospectsSupprimes.expireA, now)));
    if (tombe) {
      const n = await bloquerContact(ex, tombe.userId, {
        email: tombe.emailNormalise, publicId: tombe.linkedinPublicId, providerId: tombe.linkedinProviderId,
      });
      if (n > 0) return "supprime";
    }
  }
  const email = opts.email ? clesContact({ email: opts.email }).email : null;
  if (opts.userId && email) {
    await bloquerContact(ex, opts.userId, { email, publicId: null, providerId: null });
    return "email";
  }
  return "inconnu";
}

/** Tables que la suppression vide ou détache — la liste fait foi pour les tests. */
export const TABLES_SUPPRIMEES = [
  "inbox_messages", "inbox_conversations", "lead_step_messages", "outreach_step_sends",
  "outreach_messages", "lead_sequence_state", "prospection_message_feedback", "tasks", "leads",
] as const;
export const TABLES_DETACHEES = [
  "tasks", "linkedin_send_attempts", "prospection_usage",
] as const;
