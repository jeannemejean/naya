// Hooks react-query pour la page projet — wrappers fins sur useQuery/useMutation, alignés sur
// les patterns réels du client (voir client/src/lib/queryClient.ts et
// client/src/pages/outreach/useOutreach.ts) : queryKey[0] == URL fetchée (cookie auth),
// apiRequest(method, url, data?) pour les mutations.
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, ProjectGoal, ProjectMilestone, ProjectStrategyProfile } from "@shared/schema";

export type ProjectDetail = Project & {
  goals: ProjectGoal[];
  strategyProfile: ProjectStrategyProfile | null;
};

// ─── Queries ────────────────────────────────────────────────────────────────

export const useProjectDetail = (id: number) =>
  useQuery<ProjectDetail>({ queryKey: [`/api/projects/${id}`] });

export const useProjectMilestones = (id: number) =>
  useQuery<ProjectMilestone[]>({ queryKey: [`/api/projects/${id}/milestones`] });

// ─── Mutations ──────────────────────────────────────────────────────────────

export const useSaveStatusNote = (id: number) =>
  useMutation<Response, Error, string>({
    mutationFn: (statusNote: string) => apiRequest("PATCH", `/api/projects/${id}`, { statusNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

export const useSaveStage = (id: number) =>
  useMutation<Response, Error, string>({
    mutationFn: (currentStage: string) =>
      apiRequest("PATCH", `/api/projects/${id}/strategy-profile`, { currentStage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

export const useSituation = (id: number) =>
  useMutation<{ text: string }, Error, void>({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/situation`, {}).then((r) => r.json()),
  });
