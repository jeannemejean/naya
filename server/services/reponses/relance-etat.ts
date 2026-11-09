/**
 * Où vivent les décisions de relance, sans migration : dans le jsonb existant
 * `inbox_conversations.etat_avant_reponse`, sous une clé à part `relances`, indexée par
 * l'identifiant du message entrant (inbox_messages.id).
 *
 *   etat_avant_reponse = {
 *     status, currentStep, nextRunAt, delayAnchorAt, …   ← l'état de séquence d'avant la réponse (inchangé)
 *     relances: { "<messageId>": { statut, le, taskId?, date? } }
 *   }
 *
 * Conséquence : la présence de ce jsonb ne veut plus dire « un état d'avant existe » — seul
 * un `status` le dit (estEtatAvant). Toute lecture de l'état d'avant passe par là, et toute
 * écriture de l'état d'avant garde la clé `relances` (avecRelances). Pure.
 */
import type { EtatAvantReponse } from "@shared/schema";

/**
 *  - `en_cours` : validation en vol (réservation contre le double clic) ;
 *  - `validee`  : tâche créée (`taskId`), brouillon rangé dans la tâche ;
 *  - `refusee`  : « Non merci » — la proposition ne revient jamais pour ce message ;
 *  - `annulee`  : le message a été requalifié (« ce n'était pas une vraie réponse »).
 */
export type StatutRelance = "en_cours" | "validee" | "refusee" | "annulee";
export interface DecisionRelance { statut: StatutRelance; le: string; taskId?: number; date?: string }

/** Source des tâches « Relancer X » (liée au prospect : supprimée avec lui). */
export const SOURCE_TACHE_RELANCE = "relance_prospect";
/** Une réservation `en_cours` plus vieille que ça est abandonnée (processus tombé en route). */
export const RESERVATION_RELANCE_MS = 5 * 60_000;

/** Vrai seulement si le jsonb porte un état de séquence d'avant la réponse. */
export function estEtatAvant(v: unknown): v is EtatAvantReponse {
  return !!v && typeof v === "object" && typeof (v as any).status === "string";
}

/** Décisions de relance d'une conversation (jamais null). */
export function relancesDe(v: unknown): Record<string, DecisionRelance> {
  const r = v && typeof v === "object" ? (v as any).relances : null;
  return r && typeof r === "object" && !Array.isArray(r) ? r : {};
}

/** `nouveau` (état d'avant) en gardant les décisions de relance déjà posées dans `ancien`. */
export function avecRelances<T extends object>(ancien: unknown, nouveau: T): T & { relances?: Record<string, DecisionRelance> } {
  const r = relancesDe(ancien);
  return Object.keys(r).length ? { ...nouveau, relances: r } : nouveau;
}
