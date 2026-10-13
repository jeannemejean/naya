/** Les vraies dépendances de la mesure, et l'exécuteur du bilan prêt pour l'ordonnanceur. */
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { callClaude, callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import { langueDuCompte } from "../garde-langue";
import type { ExecuteurRoutine } from "../routines/types";
import { CANAUX, KIND_BILAN } from "./catalogues";
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

/**
 * « septembre : 12 000 €, 20 nouveaux clients, 2 000 € de pub Meta » → JSON de champs. Garde
 * de dépense d'abord ; un appel rapide ; la sortie est relue par `lirePhrase` (rien d'inventé).
 */
export async function comprendrePhrase(userId: string, projectId: number, texte: string, maintenant = new Date()): Promise<{ refus: string } | { brut: string }> {
  const refus = await gardeDepense(userId);
  if (refus) return { refus: refus.resume };
  const brut = await callClaude({
    model: CLAUDE_MODELS.fast,
    system: "Tu extrais des chiffres d'activité mensuelle d'une phrase. Réponds uniquement en JSON strict.",
    messages: [{ role: "user", content: consignePhrase(texte, maintenant) }],
    max_tokens: 400, temperature: 0, userId, projectId, taskKind: "fast_generation",
  });
  return { brut };
}

function consignePhrase(texte: string, maintenant: Date): string {
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  return `Aujourd'hui : ${aujourdhui}. Phrase de l'utilisatrice :
« ${texte.slice(0, 1000)} »

Extrais UNIQUEMENT les chiffres qu'elle donne, pour UN mois :
- mois : "YYYY-MM" (« septembre » = le dernier septembre passé ; « le mois dernier » = le mois précédent ; absent si non dit)
- ca : chiffre d'affaires total du mois, en euros
- caNouveaux : part du CA venant des nouveaux clients
- nouveauxClients : nombre de nouveaux clients
- commandes : nombre de ventes ou commandes
- coutsVariables : produits, livraison, commissions
- depenses : dépenses marketing par canal, clés possibles : ${CANAUX.map((c) => `${c.cle} (${c.alias.slice(0, 3).join(", ")})`).join("; ")}

N'invente rien : un chiffre qu'elle ne donne pas est ABSENT du JSON. « 12k » = 12000. Montants en nombres, sans symbole.
Exemple : {"mois":"2026-09","ca":12000,"nouveauxClients":20,"depenses":{"paid_social":2000}}`;
}
