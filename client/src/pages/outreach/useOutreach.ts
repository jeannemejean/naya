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
