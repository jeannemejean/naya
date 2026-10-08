/**
 * Enrôlement groupé d'une campagne (`/enroll` et `/launch`).
 *
 * La barrière de `/api/leads/:id/enroll` (prospection-validation.ts) doit valoir AUSSI
 * pour l'enrôlement en masse : sans elle, « Lancer la séquence » faisait entrer en
 * séquence des prospects dont personne n'avait lu le message. Un contact part parce
 * qu'une personne l'a voulu — jamais parce qu'un bouton groupé l'a emporté.
 *
 * Les accès au stockage sont injectés pour que la règle se teste sans base.
 */
import { peutEtreContacte } from "./prospection-validation";

export interface ProspectEnrolable {
  id: number;
  stage: string | null | undefined;
  validatedAt: Date | null | undefined;
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
const ETATS_DEFINITIFS = ["active", "stopped_replied", "completed"];

export async function enrolerEnMasse(deps: {
  leads: ProspectEnrolable[];
  getState: (leadId: number) => Promise<{ status: string } | null | undefined>;
  enroll: (leadId: number) => Promise<unknown>;
}): Promise<ResultatEnrolement> {
  let enrolled = 0;
  let skipped = 0;
  let skippedNotValidated = 0;

  for (const lead of deps.leads) {
    if (!peutEtreContacte({ stage: lead.stage, validatedAt: lead.validatedAt })) {
      skipped++;
      skippedNotValidated++;
      continue;
    }
    const existing = await deps.getState(lead.id);
    if (existing && ETATS_DEFINITIFS.includes(existing.status)) {
      skipped++;
      continue;
    }
    const st = await deps.enroll(lead.id);
    if (st) enrolled++;
    else skipped++;
  }

  return { enrolled, skipped, skippedNotValidated, total: deps.leads.length };
}
