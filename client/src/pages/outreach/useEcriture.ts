// Hooks react-query de la rédaction de prospection : preuves du projet, brief du prospect,
// messages de séquence (édition, écart), règles apprises et messages collés. Même convention
// que useOutreach.ts : queryKey[0] == URL fetchée, apiRequest pour les mutations.
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ProjectProof, ProspectionLearnedRule, ProspectionMessageFeedback } from "@shared/schema";

export type RoleTouche = "invitation" | "premier_message" | "email_ouverture" | "relance" | "cloture";
export const ROLES_TOUCHE: RoleTouche[] = ["invitation", "premier_message", "email_ouverture", "relance", "cloture"];
export const RAISONS_ECART = ["trop_long", "pas_mon_ton", "faux", "hors_sujet", "autre"] as const;

export type Defaut = { code: string; raison: string };

export type StepMessageDTO = {
  stepId: number; stepOrder: number; channel: string; role: RoleTouche;
  subject: string | null; body: string | null; edited: boolean;
  qualite: "ok" | "a_revoir" | null; defauts: Defaut[];
};

export type BriefDTO = {
  declencheur: { fait: string; source: string; url?: string; date?: string } | null;
  preuveId: number | null;
  raison: string;
  proposition: { type: "preuve" | "idee" | "echange"; contenu: string };
  angles: string[];
  langue: string;
  registre: "vous" | "tu";
  edite: boolean;
};

// ─── Preuves ────────────────────────────────────────────────────────────────

const urlPreuves = (projectId: number) => `/api/projects/${projectId}/proofs`;

export const useProofs = (projectId: number | null | undefined) =>
  useQuery<ProjectProof[]>({ queryKey: [urlPreuves(projectId ?? 0)], enabled: !!projectId });

const invaliderPreuves = (projectId: number) =>
  queryClient.invalidateQueries({ queryKey: [urlPreuves(projectId)] });

export const useCreateProof = (projectId: number) =>
  useMutation<ProjectProof, Error, Partial<ProjectProof>>({
    mutationFn: (data) => apiRequest("POST", urlPreuves(projectId), data).then((r) => r.json()),
    onSuccess: () => invaliderPreuves(projectId),
  });

export const usePatchProof = (projectId: number) =>
  useMutation<ProjectProof, Error, { id: number } & Partial<ProjectProof>>({
    mutationFn: ({ id, ...data }) => apiRequest("PATCH", `${urlPreuves(projectId)}/${id}`, data).then((r) => r.json()),
    onSuccess: () => invaliderPreuves(projectId),
  });

export const useSuggestProofs = (projectId: number) =>
  useMutation<{ creees: number; sourcesEchouees: string[] }, Error, void>({
    mutationFn: () => apiRequest("POST", `${urlPreuves(projectId)}/suggest`).then((r) => r.json()),
    onSuccess: () => invaliderPreuves(projectId),
  });

// ─── Messages de séquence et brief d'un prospect ────────────────────────────

const urlMessages = (leadId: number) => `/api/leads/${leadId}/step-messages`;

export const useLeadStepMessages = (leadId: number) =>
  useQuery<StepMessageDTO[]>({ queryKey: [urlMessages(leadId)] });

const invaliderProspect = (leadId: number) => {
  queryClient.invalidateQueries({ queryKey: [urlMessages(leadId)] });
  queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
};

export const useEditStepMessage = (leadId: number) =>
  useMutation<unknown, Error, { stepId: number; body: string; subject?: string | null }>({
    mutationFn: ({ stepId, ...data }) => apiRequest("PUT", `${urlMessages(leadId)}/${stepId}`, data).then((r) => r.json()),
    onSuccess: () => invaliderProspect(leadId),
  });

export const useEcarterStepMessage = (leadId: number) =>
  useMutation<unknown, Error, { stepId: number; raison: string }>({
    mutationFn: ({ stepId, raison }) => apiRequest("POST", `${urlMessages(leadId)}/${stepId}/ecarter`, { raison }).then((r) => r.json()),
    onSuccess: () => invaliderProspect(leadId),
  });

export const usePatchBrief = (leadId: number) =>
  useMutation<unknown, Error, Partial<BriefDTO>>({
    mutationFn: (data) => apiRequest("PATCH", `/api/leads/${leadId}/brief`, data).then((r) => r.json()),
    onSuccess: () => invaliderProspect(leadId),
  });

// ─── Apprentissage ──────────────────────────────────────────────────────────

const urlRegles = (projectId: number) => `/api/projects/${projectId}/learned-rules`;
const urlExemples = (projectId: number) => `/api/projects/${projectId}/example-messages`;

export const useLearnedRules = (projectId: number | null | undefined) =>
  useQuery<ProspectionLearnedRule[]>({ queryKey: [urlRegles(projectId ?? 0)], enabled: !!projectId });

export const usePatchLearnedRule = (projectId: number) =>
  useMutation<unknown, Error, { id: number; statut?: string; texte?: string }>({
    mutationFn: ({ id, ...data }) => apiRequest("PATCH", `${urlRegles(projectId)}/${id}`, data).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [urlRegles(projectId)] }),
  });

export const useExampleMessages = (projectId: number | null | undefined) =>
  useQuery<ProspectionMessageFeedback[]>({ queryKey: [urlExemples(projectId ?? 0)], enabled: !!projectId });

export const useAddExampleMessage = (projectId: number) =>
  useMutation<unknown, Error, { role: RoleTouche; body: string }>({
    mutationFn: (data) => apiRequest("POST", urlExemples(projectId), data).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [urlExemples(projectId)] }),
  });
