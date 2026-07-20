// Types partagés pour le workspace Outreach (campagnes de prospection, séquences, analytics).
// Ces formes correspondent exactement aux réponses du backend (Plan 1 — voir server/routes.ts,
// section /api/prospection/campaigns/:id/*).

export type SequenceStepDTO = {
  id: number;
  stepOrder: number;
  channel: string;
  delayDays: number;
  intention: string | null;
  condition: string;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
};

export type PreviewStep = {
  stepOrder: number;
  channel: string;
  delayDays: number;
  intention: string | null;
  condition: string;
  subject: string | null;
  body: string | null;
  error: boolean;
};

export type PreviewResponse = {
  lead: { id: number; name: string; company: string };
  steps: PreviewStep[];
};

export type StepAnalytics = {
  byStep: { stepOrder: number; channel: string; sent: number; opened: number; clicked: number; bounced: number }[];
  byChannel: { channel: string; sent: number; replied: number }[];
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
};

// Libellés FR des conditions d'exécution d'une étape de séquence (gate évaluée par le moteur).
export const CONDITION_LABELS: Record<string, string> = {
  always: "toujours",
  if_opened: "si email ouvert",
  if_not_opened: "si email non ouvert",
  if_clicked: "si lien cliqué",
  if_invite_accepted: "si invitation acceptée",
  if_invite_not_accepted: "si invitation non acceptée",
};
