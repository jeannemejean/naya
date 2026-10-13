/** Les vraies dépendances des fondations, et l'exécuteur d'étiquetage prêt pour l'ordonnanceur. */
import { langueDuCompte } from "../garde-langue";
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { callClaude, callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import type { ExecuteurRoutine } from "../routines/types";
import { KIND_ETIQUETAGE } from "./catalogues";
import { executerEtiquetage, type DepsEtiquetage } from "./etiquetage";
import type { DepsProposer } from "./proposer";

export const depsProposer: DepsProposer = {
  storage: storage as any,
  garde: gardeDepense,
  ia: (userId, projectId, prompt) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 4000,
  }),
};

export const depsEtiquetage: DepsEtiquetage = {
  storage: storage as any,
  garde: gardeDepense,
  ia: (userId, projectId, prompt) => callClaude({
    model: CLAUDE_MODELS.fast,
    system: "Tu classes des contenus. Réponds uniquement en JSON strict.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1500, temperature: 0, userId, projectId, taskKind: "fast_generation",
  }),
  langue: (userId) => langueDuCompte(userId),
};

export const EXECUTEURS_FONDATIONS: Record<string, ExecuteurRoutine> = {
  [KIND_ETIQUETAGE]: (r: Routine) => executerEtiquetage(r, depsEtiquetage),
};
