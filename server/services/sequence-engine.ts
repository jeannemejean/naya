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

/**
 * Suite de la séquence une fois l'étape `index` traitée (envoyée, ou cochée « Envoyé » à
 * la main pour LinkedIn). Le délai de l'étape suivante court à partir de `now`. Pure.
 */
export function planAfterStep(
  index: number, steps: EngineStep[], signals: LeadSignals, now: Date,
): { currentStep: number; lastStepSentAt: Date; status: "active" | "completed"; nextRunAt: Date | null } {
  const done = index + 1 >= steps.length;
  const after = decideNextStep(index + 1, steps, signals, 0);
  const nextDelay = after.action === "send" ? 0 : after.action === "wait" ? (steps[index + 1]?.delayDays || 1) : null;
  return {
    currentStep: index + 1,
    lastStepSentAt: now,
    status: done ? "completed" : "active",
    nextRunAt: done ? null : new Date(now.getTime() + (nextDelay || 0) * 86_400_000),
  };
}

/** Rang de l'étape (1 = première) depuis le `messageType` d'un message (`step_2`, `step_2_invite`). */
export function stepOrderFromMessageType(messageType: string): number | null {
  const m = /^step_(\d+)/.exec(messageType || "");
  return m ? Number(m[1]) : null;
}
