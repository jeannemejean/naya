// Pipeline prospection (10 étapes) — extrait tel quel de l'ancien outreach.tsx:37-51 (git show
// 80a5a90) pour être partagé entre PipelineBoard (colonnes) et LeadCard (hint étape). Couleurs et
// libellés inchangés (comportement de migration, pas de refonte de la logique de stage).
export const STAGES = [
  { key: 'identified', label: 'Identifié', color: '#94a3b8', bg: 'bg-naya-olive-10 ' },
  { key: 'messages_ready', label: 'Messages prêts', color: '#6366f1', bg: 'bg-[rgba(158,126,135,0.12)] ' },
  { key: 'connection_sent', label: 'Connexion envoyée', color: '#3b82f6', bg: 'bg-[rgba(125,143,168,0.12)] ' },
  { key: 'connected', label: 'Connecté', color: '#06b6d4', bg: 'bg-[rgba(125,143,168,0.12)] ' },
  { key: 'followup1_sent', label: 'Suivi 1 envoyé', color: '#f59e0b', bg: 'bg-[rgba(212,201,122,0.12)] ' },
  { key: 'followup2_sent', label: 'Suivi 2 envoyé', color: '#f97316', bg: 'bg-[rgba(212,201,122,0.12)] ' },
  { key: 'in_discussion', label: 'En discussion', color: '#8b5cf6', bg: 'bg-[rgba(158,126,135,0.12)] ' },
  { key: 'proposal_sent', label: 'Proposition', color: '#ec4899', bg: 'bg-[rgba(158,126,135,0.12)] ' },
  { key: 'signed', label: 'Signé ✓', color: '#10b981', bg: 'bg-naya-olive-06 ' },
  { key: 'no_follow', label: 'Sans suite', color: '#475569', bg: 'bg-naya-olive-10 ' },
] as const;

export type StageKey = typeof STAGES[number]['key'];

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  StageKey,
  typeof STAGES[number]
>;
