/** Les vraies dépendances de la mesure, et l'exécuteur du bilan prêt pour l'ordonnanceur. */
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import { langueDuCompte } from "../garde-langue";
import type { ExecuteurRoutine } from "../routines/types";
import { KIND_BILAN } from "./catalogues";
import { executerBilan, type DepsBilan } from "./bilan";

export const depsBilan: DepsBilan = {
  storage: storage as any,
  garde: gardeDepense,
  ia: (userId, projectId, prompt) => callClaudeWithContext({
    userId, projectId, userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: 900,
  }),
  maintenant: () => new Date(),
  langue: (userId) => langueDuCompte(userId),
};

export const EXECUTEURS_MESURE: Record<string, ExecuteurRoutine> = {
  [KIND_BILAN]: (r: Routine) => executerBilan(r, depsBilan),
};
