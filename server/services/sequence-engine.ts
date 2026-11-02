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

export const INVITE_ACCEPT_WAIT_DAYS = 14;
export const EVENT_MIN_GAP_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;

export type Decision =
  | { action: "send"; index: number; done: boolean }
  | { action: "skip"; index: number; newAnchorAt?: Date }
  | { action: "wait"; until: Date | null }
  | { action: "done" };

/**
 * Décide quoi faire de l'enrôlement, au moment où il est "dû".
 * `currentStep` = nb d'étapes déjà TRAITÉES (envoyées ou sautées) ; l'étape candidate est steps[currentStep].
 * `timing.anchorAt` = instant de référence des délais (dernier envoi réel, ou fin d'attente d'une
 * acceptation d'invitation expirée). Un skip ne consomme pas de délai.
 * Les étapes conditionnées à l'invitation comptent leur délai depuis l'ACCEPTATION (jamais avant
 * acceptation + 2 h), et l'attente d'acceptation est bornée à 14 jours.
 */
export function decideNextStep(
  currentStep: number, steps: EngineStep[], signals: LeadSignals, timing: { anchorAt: Date; now: Date },
): Decision {
  if (currentStep >= steps.length) return { action: "done" };
  const step = steps[currentStep];
  const { anchorAt, now } = timing;
  const delayMs = (step.delayDays || 0) * DAY_MS;
  const timeout = new Date(anchorAt.getTime() + INVITE_ACCEPT_WAIT_DAYS * DAY_MS);
  const waitOrSend = (ready: Date): Decision =>
    now.getTime() < ready.getTime()
      ? { action: "wait", until: ready }
      : { action: "send", index: currentStep, done: currentStep + 1 >= steps.length };

  if (step.condition === "if_invite_accepted") {
    if (!signals.inviteAccepted) {
      return now.getTime() < timeout.getTime()
        ? { action: "wait", until: timeout }
        : { action: "skip", index: currentStep, newAnchorAt: timeout };
    }
    const acc = signals.inviteAcceptedAt;
    const ready = new Date(Math.max(
      anchorAt.getTime() + delayMs,
      acc ? acc.getTime() + delayMs : 0,
      acc ? acc.getTime() + EVENT_MIN_GAP_MS : 0,
    ));
    return waitOrSend(ready);
  }

  if (step.condition === "if_invite_not_accepted") {
    if (signals.inviteAccepted) return { action: "skip", index: currentStep };
    const prevWaitedForAccept = steps[currentStep - 1]?.condition === "if_invite_accepted";
    const ready = new Date(anchorAt.getTime() + (prevWaitedForAccept ? 0 : INVITE_ACCEPT_WAIT_DAYS * DAY_MS) + delayMs);
    return waitOrSend(ready);
  }

  const ready = new Date(anchorAt.getTime() + delayMs);
  if (now.getTime() < ready.getTime()) return { action: "wait", until: ready };
  if (!evaluateCondition(step.condition, signals)) return { action: "skip", index: currentStep };
  return { action: "send", index: currentStep, done: currentStep + 1 >= steps.length };
}

/**
 * Suite de la séquence une fois l'étape `index` traitée (envoyée, ou cochée « Envoyé » à
 * la main pour LinkedIn). Le délai de l'étape suivante court à partir de `now`. Pure.
 */
export function planAfterStep(
  index: number, steps: EngineStep[], signals: LeadSignals, now: Date,
): { currentStep: number; lastStepSentAt: Date; delayAnchorAt: Date; status: "active" | "completed"; nextRunAt: Date | null } {
  const done = index + 1 >= steps.length;
  const after = decideNextStep(index + 1, steps, signals, { anchorAt: now, now });
  let nextRunAt: Date | null;
  if (done) nextRunAt = null;
  else if (after.action === "wait" && after.until) nextRunAt = after.until;
  else if (after.action === "wait") nextRunAt = new Date(now.getTime() + (steps[index + 1]?.delayDays || 1) * DAY_MS);
  else nextRunAt = new Date(now.getTime());
  return { currentStep: index + 1, lastStepSentAt: now, delayAnchorAt: now, status: done ? "completed" : "active", nextRunAt };
}

/** Rang de l'étape (1 = première) depuis le `messageType` d'un message (`step_2`, `step_2_invite`). */
export function stepOrderFromMessageType(messageType: string): number | null {
  const m = /^step_(\d+)/.exec(messageType || "");
  return m ? Number(m[1]) : null;
}
