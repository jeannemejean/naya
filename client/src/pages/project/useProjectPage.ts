// Hooks react-query pour la page projet — wrappers fins sur useQuery/useMutation, alignés sur
// les patterns réels du client (voir client/src/lib/queryClient.ts et
// client/src/pages/outreach/useOutreach.ts) : queryKey[0] == URL fetchée (cookie auth),
// apiRequest(method, url, data?) pour les mutations.
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  BrandConversion,
  ConversionAttribution,
  Project,
  ProjectGoal,
  ProjectMilestone,
  ProjectStrategyProfile,
  RecurringRitual,
} from "@shared/schema";

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

// ─── Rituels récurrents ─────────────────────────────────────────────────────

export interface RitualProposal {
  kind: "create_ritual";
  title: string;
  days: string;
  startTime: string;
  durationMinutes: number;
}

export interface NoteAnalysis {
  understood: string;
  proposals: RitualProposal[];
}

/** Enregistre la note ET demande à Naya ce qu'elle en comprend. */
export const useAnalyzeNote = (id: number) =>
  useMutation<NoteAnalysis, Error, string>({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/projects/${id}/status-note/analyze`, { note }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}`] });
    },
  });

export const useRituals = (id: number) =>
  useQuery<RecurringRitual[]>({ queryKey: [`/api/projects/${id}/rituals`] });

export const useCreateRitual = (id: number) =>
  useMutation<Response, Error, RitualProposal>({
    mutationFn: (p: RitualProposal) =>
      apiRequest("POST", `/api/rituals`, {
        projectId: id,
        title: p.title,
        days: p.days,
        startTime: p.startTime,
        durationMinutes: p.durationMinutes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}/rituals`] });
      // Le planning vient de changer : tâches et aperçus deviennent obsolètes.
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/range"] });
    },
  });

export const useDeactivateRitual = (id: number) =>
  useMutation<Response, Error, number>({
    mutationFn: (ritualId: number) => apiRequest("POST", `/api/rituals/${ritualId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}/rituals`] });
    },
  });

// ─── Conversions (Fil 3, LOT 3B) ────────────────────────────────────────────
// La marque déclare une conversion ; le serveur fige la fenêtre d'attribution de la marque au
// moment même de l'écriture et calcule les crédits (server/routes.ts, POST /api/conversions).
// Ce fichier n'ajoute rien à cette logique — deux wrappers fins, mêmes conventions que ci-dessus.

export type ConversionWithCredits = BrandConversion & { attributions: ConversionAttribution[] };

export const useConversions = (id: number) =>
  useQuery<ConversionWithCredits[]>({ queryKey: [`/api/conversions?projectId=${id}`] });

export interface DeclareConversionInput {
  /** yyyy-MM-dd, tel que rendu par un <input type="date">. */
  convertedAt: string;
  /** Chaîne libre, trim côté appelant ; vide → non envoyé (le serveur stocke `null`). */
  conversionType: string;
  /** Chaîne numérique ou vide ; vide → non envoyé (le serveur stocke `null`), jamais un 0 fabriqué. */
  value: string;
}

export const useDeclareConversion = (id: number) =>
  useMutation<ConversionWithCredits, Error, DeclareConversionInput>({
    mutationFn: (input: DeclareConversionInput) =>
      apiRequest("POST", `/api/conversions`, {
        projectId: id,
        convertedAt: input.convertedAt,
        conversionType: input.conversionType.trim() || undefined,
        value: input.value.trim() === "" ? undefined : input.value,
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/conversions?projectId=${id}`] });
    },
  });
