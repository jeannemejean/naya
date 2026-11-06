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
 *     leads                     — la fiche, en dernier
 *
 *   DÉTACHÉ (lead_id → NULL : la ligne sert à autre chose qu'à ce prospect)
 *     tasks.lead_id                          — la tâche est dans le planning de l'utilisatrice ;
 *                                              la faire disparaître sans le dire bouleverserait sa journée
 *     prospection_message_feedback.lead_id   — matière de l'apprentissage de rédaction (ses
 *                                              corrections), indépendante du prospect
 *     linkedin_send_attempts.lead_id         — source des plafonds LinkedIn glissants : supprimer
 *                                              les tentatives rouvrirait du budget LinkedIn
 *     prospection_usage.prospect_id          — journal interne des coûts (admin)
 *
 * Exception légale : un prospect DÉSINSCRIT laisse son identifiant de contact (email normalisé,
 * identifiant LinkedIn) dans `prospects_bloques` — rien d'autre — pour ne jamais être recontacté.
 *
 * Course avec l'envoi : la fiche est verrouillée (`FOR UPDATE`) au début de la transaction.
 * Une réservation d'envoi (`claimStepSend`) a besoin d'un verrou de clé sur la fiche : elle
 * attend donc la fin de la suppression, puis échoue (clé étrangère) → rien ne part. Une
 * réservation déjà prise et récente (envoi en cours chez le fournisseur) fait REFUSER la
 * suppression (`envoi_en_cours`) : on ne supprime pas quelqu'un à qui on est en train d'écrire.
 */
import { and, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  leads, leadSequenceState, inboxConversations, inboxMessages, leadStepMessages,
  outreachStepSends, outreachMessages, tasks, prospectionMessageFeedback,
  linkedinSendAttempts, prospectionUsage, prospectsBloques,
} from "@shared/schema";
import type { DbExecutor } from "../db";
import { clesPersonne } from "./reponses/rattachement";

/** Une réservation `claimed` plus récente que ça = un envoi en cours chez le fournisseur. */
export const RESERVATION_EN_COURS_MS = 15 * 60 * 1000;

export type RaisonRefus = "introuvable" | "envoi_en_cours" | "erreur";
export type IssueSuppression =
  | { ok: true; bloque: boolean }
  | { ok: false; raison: RaisonRefus };

interface FicheContact { email?: string | null; linkedinProviderId?: string | null; linkedinUrl?: string | null }

/** Identifiants à confronter à la liste « ne plus contacter » (même normalisation que les doublons). */
export function clesBlocage(f: FicheContact): { email: string | null; linkedinIds: string[] } {
  const c = clesPersonne({ email: f.email ?? null, pid: f.linkedinProviderId ?? null, url: f.linkedinUrl ?? null });
  const linkedinIds = [c.publicId, c.providerId].filter((x): x is string => !!x);
  return { email: c.email, linkedinIds };
}

/** Ce qu'on garde d'un désinscrit : l'email normalisé, et UN identifiant LinkedIn (public d'abord). */
export function ligneBlocage(userId: string, f: FicheContact): { userId: string; emailNormalise: string | null; linkedinId: string | null; raison: string } | null {
  const c = clesPersonne({ email: f.email ?? null, pid: f.linkedinProviderId ?? null, url: f.linkedinUrl ?? null });
  const linkedinId = c.publicId ?? c.providerId;
  if (!c.email && !linkedinId) return null;
  return { userId, emailNormalise: c.email, linkedinId, raison: "desinscription" };
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
 * Supprime UN prospect dans la transaction `tx`. Ne lève pas pour un refus (introuvable,
 * envoi en cours) ; lève sur une erreur SQL — l'appelant laisse alors la transaction s'annuler.
 */
export async function supprimerLeadDansTransaction(
  tx: DbExecutor, leadId: number, userId: string, now: Date = new Date(),
): Promise<IssueSuppression> {
  // 1. La fiche, à elle, verrouillée jusqu'à la fin (bloque toute nouvelle réservation d'envoi).
  const [fiche] = await tx.select({
    id: leads.id, email: leads.email, linkedinProviderId: leads.linkedinProviderId, linkedinUrl: leads.linkedinUrl,
  }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
    .for("update");
  if (!fiche) return { ok: false, raison: "introuvable" };

  // 2. Envoi en cours (réservation prise, issue pas encore écrite) : on ne touche à rien.
  const enCours = await tx.select({ id: outreachStepSends.id }).from(outreachStepSends)
    .where(and(
      eq(outreachStepSends.leadId, leadId),
      eq(outreachStepSends.status, "claimed"),
      gt(outreachStepSends.claimedAt, new Date(now.getTime() - RESERVATION_EN_COURS_MS)),
    ))
    .limit(1);
  if (enCours.length) return { ok: false, raison: "envoi_en_cours" };

  // 3. Désinscrit → on garde son seul identifiant de contact, avant que la trace disparaisse.
  const desinscrit = await tx.select({ id: leadSequenceState.id }).from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.status, "unsubscribed")))
    .limit(1);
  let bloque = false;
  if (desinscrit.length) {
    const ligne = ligneBlocage(userId, fiche);
    if (ligne) {
      await tx.insert(prospectsBloques).values(ligne).onConflictDoNothing();
      bloque = true;
    }
  }

  // 4. L'historique du prospect.
  await tx.delete(inboxMessages).where(
    sql`${inboxMessages.conversationId} in (select ${inboxConversations.id} from ${inboxConversations} where ${inboxConversations.leadId} = ${leadId})`,
  );
  await tx.delete(inboxConversations).where(eq(inboxConversations.leadId, leadId));
  await tx.delete(leadStepMessages).where(eq(leadStepMessages.leadId, leadId));
  await tx.delete(outreachStepSends).where(eq(outreachStepSends.leadId, leadId));
  await tx.delete(outreachMessages).where(eq(outreachMessages.leadId, leadId));
  await tx.delete(leadSequenceState).where(eq(leadSequenceState.leadId, leadId));

  // 5. Ce qui survit, détaché du prospect.
  await tx.update(tasks).set({ leadId: null }).where(eq(tasks.leadId, leadId));
  await tx.update(prospectionMessageFeedback).set({ leadId: null }).where(eq(prospectionMessageFeedback.leadId, leadId));
  await tx.update(linkedinSendAttempts).set({ leadId: null }).where(eq(linkedinSendAttempts.leadId, leadId));
  await tx.update(prospectionUsage).set({ prospectId: null }).where(eq(prospectionUsage.prospectId, leadId));

  // 6. La fiche, en dernier (une clé étrangère oubliée ferait échouer ici, donc tout annuler).
  await tx.delete(leads).where(and(eq(leads.id, leadId), eq(leads.userId, userId)));
  return { ok: true, bloque };
}

/** Tables que la suppression vide ou détache — la liste fait foi pour les tests. */
export const TABLES_SUPPRIMEES = [
  "inbox_messages", "inbox_conversations", "lead_step_messages", "outreach_step_sends",
  "outreach_messages", "lead_sequence_state", "leads",
] as const;
export const TABLES_DETACHEES = [
  "tasks", "prospection_message_feedback", "linkedin_send_attempts", "prospection_usage",
] as const;
