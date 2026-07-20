import type { LeadSignals } from "./sequence-signals";

export type StepCondition =
  | "always" | "if_opened" | "if_not_opened" | "if_clicked"
  | "if_invite_accepted" | "if_invite_not_accepted";

export function evaluateCondition(condition: string, s: LeadSignals): boolean {
  switch (condition) {
    case "if_opened": return s.opened;
    case "if_not_opened": return !s.opened;
    case "if_clicked": return s.clicked;
    case "if_invite_accepted": return s.inviteAccepted;
    case "if_invite_not_accepted": return !s.inviteAccepted;
    case "always":
    default: return true;
  }
}

export type EngineStep = { delayDays: number; condition: string };

export type Decision =
  | { action: "send"; index: number; done: boolean }
  | { action: "skip"; index: number }
  | { action: "wait" }
  | { action: "done" };

/**
 * Décide quoi faire de l'enrôlement, au moment où il est "dû".
 * `currentStep` = nb d'étapes déjà TRAITÉES (envoyées ou sautées) ; l'étape candidate est steps[currentStep].
 * `daysSinceLastSend` = jours écoulés depuis le dernier ENVOI réel (0 pour l'étape 0).
 * Le délai d'une étape court depuis le dernier envoi réel : un skip ne consomme pas de délai.
 */
export function decideNextStep(
  currentStep: number, steps: EngineStep[], signals: LeadSignals, daysSinceLastSend: number,
): Decision {
  if (currentStep >= steps.length) return { action: "done" };
  const step = steps[currentStep];
  if (daysSinceLastSend < (step.delayDays || 0)) return { action: "wait" };
  if (!evaluateCondition(step.condition, signals)) return { action: "skip", index: currentStep };
  return { action: "send", index: currentStep, done: currentStep + 1 >= steps.length };
}
