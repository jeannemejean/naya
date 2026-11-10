// Veille AO : les vraies dépendances (réseau, base, IA, budget).
import { CLAUDE_MODELS } from "../claude";
import { genererStructure } from "../ai/structure";
import { isAiBlocked } from "../usage";
import { existantsPourVeille, rafraichirDepuisVeille, upsertDepuisVeille } from "../appels-offres-store";
import { storage } from "../../storage";
import { SCHEMA_QUALIFICATION, SYSTEME_QUALIFICATION, extraitContexte, promptQualification } from "./qualification";
import type { DepsVeilleAO } from "./pipeline";

export const depsVeilleAO: DepsVeilleAO = {
  fetch: (url, init) => fetch(url, init),
  existants: (userId) => existantsPourVeille(userId),
  inserer: (userId, lignes) => upsertDepuisVeille(userId, lignes),
  rafraichir: (userId, id, faits) => rafraichirDepuisVeille(userId, id, faits),
  estBloquee: (userId) => isAiBlocked(userId),
  // ADN de marque plutôt que buildNayaContext complet (~6 000 caractères, mémoire et persona) :
  // seules les offres et le positionnement servent à juger un avis. Plafonné à 2 500 caractères.
  contexte: async (userId) => extraitContexte((await storage.getBrandDna(userId)) as any),
  // genererStructure → callClaudeDetailed : coût imputé (recordSpend) et appel journalisé
  // (logInvocation), comme tous les appels IA de Naya.
  qualifier: (userId, avis, contexte) => genererStructure({
    schema: SCHEMA_QUALIFICATION,
    system: SYSTEME_QUALIFICATION,
    prompt: promptQualification(avis, new Date(), contexte),
    model: CLAUDE_MODELS.smart,
    maxTokens: 1500,
    taskKind: "strategic_reasoning",
    etape: "qualification d'un appel d'offres",
    userId,
  }),
};
