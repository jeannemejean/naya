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

// État d'enrôlement d'un prospect dans la séquence de sa campagne (GET .../enrollments).
export type EnrollmentDTO = {
  leadId: number;
  status: string; // active | paused | completed | stopped_replied | bounced | failed
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

// Forme locale (éditable) d'une étape de séquence dans l'onglet Séquence — mêmes champs que
// SequenceStepDTO, mais `intention`/`condition` ne sont jamais null (normalisés à la lecture),
// et `id`/`stepOrder` restent optionnels tant que l'étape n'a pas été persistée / re-numérotée
// (au save, voir SequenceTab.tsx).
export type DraftSequenceStep = {
  id?: number;
  stepOrder?: number;
  channel: string;
  delayDays: number;
  intention: string;
  condition: string;
  // Clé stable UI-only pour les étapes pas encore persistées (pas d'`id` serveur) — évite que
  // React ne remonte les cartes (et perde le focus des inputs) lors d'un réordonnancement.
  // Générée côté client au moment de l'ajout (SequenceTab.handleAdd), jamais envoyée au save.
  _key?: string;
};
