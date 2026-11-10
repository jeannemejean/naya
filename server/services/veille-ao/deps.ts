// Veille AO : les vraies dépendances (réseau, base, IA, budget).
import { CLAUDE_MODELS } from "../claude";
import { genererStructure } from "../ai/structure";
import { isAiBlocked } from "../usage";
import { existantsPourVeille, rafraichirDepuisVeille, upsertDepuisVeille } from "../appels-offres-store";
import { SCHEMA_QUALIFICATION, SYSTEME_QUALIFICATION, promptQualification } from "./qualification";
import type { DepsVeilleAO } from "./pipeline";

export const depsVeilleAO: DepsVeilleAO = {
  fetch: (url, init) => fetch(url, init),
  existants: (userId) => existantsPourVeille(userId),
  inserer: (userId, lignes) => upsertDepuisVeille(userId, lignes),
  rafraichir: (userId, id, faits) => rafraichirDepuisVeille(userId, id, faits),
  estBloquee: (userId) => isAiBlocked(userId),
  // genererStructure → callClaudeDetailed : coût imputé (recordSpend) et appel journalisé
  // (logInvocation), comme tous les appels IA de Naya.
  qualifier: (userId, avis) => genererStructure({
    schema: SCHEMA_QUALIFICATION,
    system: SYSTEME_QUALIFICATION,
    prompt: promptQualification(avis, new Date()),
    model: CLAUDE_MODELS.smart,
    maxTokens: 1500,
    taskKind: "strategic_reasoning",
    etape: "qualification d'un appel d'offres",
    userId,
  }),
};
