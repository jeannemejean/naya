// Conversion séquence serveur ↔ brouillon d'édition. Le RÔLE de chaque touche (invitation,
// relance, clôture…) est posé par les structures de séquence : il doit survivre à un
// enregistrement manuel, sinon une clôture redevient une simple relance.
import type { DraftSequenceStep, SequenceStepDTO } from "./types";

export function toDraft(step: SequenceStepDTO): DraftSequenceStep {
  return {
    id: step.id,
    stepOrder: step.stepOrder,
    channel: step.channel,
    delayDays: step.delayDays,
    intention: step.intention ?? "",
    condition: step.condition,
    role: step.role ?? null,
  };
}

export function payloadSequence(draft: DraftSequenceStep[]) {
  return draft.map((s, i) => ({
    id: s.id,
    stepOrder: i + 1,
    channel: s.channel,
    delayDays: s.delayDays,
    intention: s.intention,
    condition: s.condition,
    role: s.role ?? null,
  }));
}
