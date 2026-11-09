/**
 * Enrôlement groupé d'une campagne (`/enroll` ; `/launch` répond 410, le lancement passe par une salve).
 *
 * La barrière de `/api/leads/:id/enroll` (prospection-validation.ts) doit valoir AUSSI
 * pour l'enrôlement en masse : sans elle, « Lancer la séquence » faisait entrer en
 * séquence des prospects dont personne n'avait lu le message. Un contact part parce
 * qu'une personne l'a voulu — jamais parce qu'un bouton groupé l'a emporté.
 *
 * Les accès au stockage sont injectés pour que la règle se teste sans base.
 */
import { peutEtreContacte, peutReprendreSequence } from "./prospection-validation";

export interface ProspectEnrolable {
  id: number;
  stage: string | null | undefined;
  validatedAt: Date | null | undefined;
  company?: string | null;
  email?: string | null;
}

export interface ResultatEnrolement {
  enrolled: number;
  /** Total des prospects non enrôlés, toutes raisons confondues. */
  skipped: number;
  /** Dont : prospects ignorés parce que leurs messages n'ont pas été validés. */
  skippedNotValidated: number;
  total: number;
}

/** États de séquence qu'on ne ré-enrôle jamais. */
const ETATS_DEFINITIFS = ["active", "awaiting_linkedin", "stopped_replied", "completed", "unsubscribed", "excluded_audience"];

export async function enrolerEnMasse(deps: {
  leads: ProspectEnrolable[];
  getState: (leadId: number) => Promise<{ status: string } | null | undefined>;
  enroll: (leadId: number) => Promise<unknown>;
  /** Prospect à laisser de côté, par exemple le collègue de quelqu'un qui a répondu. */
  exclure?: (lead: ProspectEnrolable) => boolean;
}): Promise<ResultatEnrolement> {
  let enrolled = 0;
  let skipped = 0;
  let skippedNotValidated = 0;

  for (const lead of deps.leads) {
    const existing = await deps.getState(lead.id);
    if (!peutEtreContacte({ stage: lead.stage, validatedAt: lead.validatedAt }) && !peutReprendreSequence(lead, existing)) {
      skipped++;
      skippedNotValidated++;
      continue;
    }
    if (deps.exclure?.(lead) || (existing && (ETATS_DEFINITIFS.includes(existing.status)))) {
      skipped++;
      continue;
    }
    const st = await deps.enroll(lead.id);
    if (st) enrolled++;
    else skipped++;
  }

  return { enrolled, skipped, skippedNotValidated, total: deps.leads.length };
}

/** Raison visible dans l'aperçu après un déplacement de prospect. */
export const RAISON_PROSPECT_DEPLACE =
  "Ce prospect a changé de campagne : son ancienne séquence est en pause, rien n'est envoyé. Ajoute-le à la séquence de sa nouvelle campagne pour repartir.";

/** Raison visible dans l'aperçu quand un collègue a répondu à sa place. */
export const RAISON_ENTREPRISE_A_REPONDU =
  "Quelqu'un de cette entreprise a répondu : séquence en pause, rien n'est envoyé. Ajoute ce prospect à la séquence pour reprendre.";

/**
 * Une réponse suspend les autres contacts de l'entreprise, une fois, au moment où elle arrive.
 * Remettre un collègue en séquence reste possible : c'est alors une décision, pas un oubli.
 * Renvoie le nombre de collègues suspendus.
 */
export async function suspendreCollegues(deps: {
  collegues: () => Promise<number[]>;
  suspendre: (leadId: number, raison: string) => Promise<unknown>;
}): Promise<number> {
  let suspendus = 0;
  for (const id of await deps.collegues()) {
    try {
      await deps.suspendre(id, RAISON_ENTREPRISE_A_REPONDU);
      suspendus++;
    } catch (e: any) {
      console.error(`[prospection] pause du collègue ${id} échouée : ${String(e?.message ?? e)}`);
    }
  }
  return suspendus;
}

/** États où le robot peut encore envoyer un message ou attend de le faire. */
const ETATS_EN_COURS = ["active", "awaiting_linkedin"];

/**
 * Déplace des prospects vers une campagne. Une séquence en cours appartient à l'ancienne
 * campagne : ses étapes et son expéditeur ne sont pas ceux de la nouvelle. Elle est mise en
 * pause AVANT le déplacement : si l'écriture échoue ensuite, rien n'est parti pour autant.
 */
export async function deplacerProspects(deps: {
  ids: number[];
  userId: string;
  campaignId: number;
  getState: (leadId: number) => Promise<{ userId: string; campaignId: number; status: string } | null | undefined>;
  deplacer: (ids: number[]) => Promise<number>;
  suspendre: (leadId: number) => Promise<unknown>;
}): Promise<{ moved: number; suspendus: number }> {
  let suspendus = 0;
  for (const id of deps.ids) {
    const etat = await deps.getState(id);
    if (etat?.userId === deps.userId && etat.campaignId !== deps.campaignId && ETATS_EN_COURS.includes(etat.status)) {
      await deps.suspendre(id);
      suspendus++;
    }
  }
  return { moved: await deps.deplacer(deps.ids), suspendus };
}
