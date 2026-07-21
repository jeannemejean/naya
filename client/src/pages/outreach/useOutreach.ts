// Hooks react-query pour le workspace Outreach — wrappers fins sur useQuery/useMutation,
// alignés sur les patterns réels du client (voir client/src/lib/queryClient.ts et
// client/src/pages/outreach.tsx) : queryKey[0] == URL fetchée (cookie auth), apiRequest(method,
// url, data?) pour les mutations.
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Lead } from "@shared/schema";
import type { SequenceStepDTO, PreviewResponse, StepAnalytics } from "./types";
import type { ProspectionStatusDTO } from "@/lib/prospection-widget";

// ─── Queries ────────────────────────────────────────────────────────────────

export const useCampaigns = () => useQuery<any[]>({ queryKey: ["/api/prospection/campaigns"] });

export const useLeads = () => useQuery<Lead[]>({ queryKey: ["/api/leads"] });

export const useProspectionStatus = () =>
  useQuery<ProspectionStatusDTO>({ queryKey: ["/api/prospection/status"] });

export const useCampaign = (id: number) =>
  useQuery<any[], Error, any>({
    queryKey: ["/api/prospection/campaigns"],
    select: (all) => all.find((c: any) => c.id === id),
  });

export const useSequence = (id: number) =>
  useQuery<SequenceStepDTO[]>({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] });

export const usePreview = (id: number, leadId: number | null) =>
  useQuery<PreviewResponse>({
    queryKey: [`/api/prospection/campaigns/${id}/preview?leadId=${leadId}`],
    enabled: leadId != null,
  });

export const useAnalytics = (id: number) =>
  useQuery<StepAnalytics>({ queryKey: [`/api/prospection/campaigns/${id}/analytics`] });

// Consignes de rédaction GLOBALES (toutes campagnes) — stockées sur userPreferences.
export const useWritingInstructions = () =>
  useQuery<{ global: string }>({ queryKey: ["/api/prospection/writing-instructions"] });

// ─── Mutations ──────────────────────────────────────────────────────────────

// Génère le plan de séquence par IA — le backend renvoie { rationale, steps } (steps déjà
// persistées côté serveur), PAS un tableau nu.
export const useGenerateSequence = (id: number) =>
  useMutation<{ rationale: string; steps: SequenceStepDTO[] }, Error, void>({
    mutationFn: () =>
      apiRequest("POST", `/api/prospection/campaigns/${id}/generate-sequence`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] });
    },
  });

// Remplace toute la séquence — le PUT serveur sanitize channel (email|linkedin) et
// re-numérote stepOrder à partir des steps envoyées (server/routes.ts ~L6996).
export const useSaveSequence = (id: number) =>
  useMutation<SequenceStepDTO[], Error, Partial<SequenceStepDTO>[]>({
    mutationFn: (steps) =>
      apiRequest("PUT", `/api/prospection/campaigns/${id}/sequence`, { steps }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] });
    },
  });

export const useLaunchCampaign = (id: number) =>
  useMutation<{ enrolled: number; skipped: number; total: number }, Error, void>({
    mutationFn: () => apiRequest("POST", `/api/prospection/campaigns/${id}/launch`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

export const useUpdateLead = () =>
  useMutation<Response, Error, { id: number; updates: Partial<Lead> }>({
    mutationFn: ({ id, updates }) => apiRequest("PATCH", `/api/leads/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

// Enrichissement IA d'un prospect (audit + messages) — voir ancien outreach.tsx (git show
// 80a5a90) enrichMutation. Invalide aussi le statut de prospection (compteur hebdo LinkedIn).
export const useEnrichLead = () =>
  useMutation<Lead, Error, number>({
    mutationFn: (id) => apiRequest("POST", `/api/leads/${id}/enrich`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prospection/status"] });
    },
  });

// Déplacement groupé de prospects vers une autre campagne (barre d'actions du Pipeline).
export const useBulkMoveLeads = () =>
  useMutation<{ moved: number }, Error, { ids: number[]; campaignId: number }>({
    mutationFn: ({ ids, campaignId }) =>
      apiRequest("POST", "/api/leads/bulk-move", { ids, campaignId }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

// Archivage groupé (soft-delete) de prospects (barre d'actions du Pipeline).
export const useBulkArchiveLeads = () =>
  useMutation<{ archived: number }, Error, number[]>({
    mutationFn: (ids) => apiRequest("POST", "/api/leads/bulk-archive", { ids }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

// Sauvegarde les consignes de rédaction GLOBALES (toutes campagnes).
export const useSaveWritingInstructions = () =>
  useMutation<Response, Error, { global: string }>({
    mutationFn: (payload) => apiRequest("PUT", "/api/prospection/writing-instructions", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospection/writing-instructions"] });
    },
  });

// Mise à jour partielle d'une campagne (ex: messageInstructions par campagne).
export const useUpdateCampaign = (id: number) =>
  useMutation<Response, Error, Record<string, any>>({
    mutationFn: (updates) => apiRequest("PATCH", `/api/prospection/campaigns/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospection/campaigns"] });
    },
  });
