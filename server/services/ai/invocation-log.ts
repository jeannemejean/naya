import { storage } from "../../storage";
import type { TaskKind } from "./types";

// Journalisation best-effort de chaque invocation IA. NE DOIT JAMAIS faire planter
// un appel IA (try/catch silencieux, comme recordSpend). C'est le socle du corpus
// propriétaire (Phase 5) + triangulation par marque (projectId).

// RGPD / volumétrie : si AI_LOG_PROMPTS=false, on journalise les métadonnées
// (modèle, tokens, latence, coût) SANS le texte des prompts/outputs.
const LOG_PROMPTS = process.env.AI_LOG_PROMPTS !== "false"; // défaut true

export interface InvocationLog {
  userId?: string | null;
  projectId?: number | null;
  taskKind?: TaskKind | null;
  provider: string;
  model: string;
  systemPrompt?: string | null;
  userMessage?: string | null;
  output?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  costEur?: number | null;
}

export function logInvocation(entry: InvocationLog): void {
  try {
    const row = {
      userId: entry.userId ?? null,
      projectId: entry.projectId ?? null,
      taskKind: entry.taskKind ?? null,
      provider: entry.provider,
      model: entry.model,
      systemPrompt: LOG_PROMPTS ? (entry.systemPrompt ?? null) : null,
      userMessage: LOG_PROMPTS ? (entry.userMessage ?? null) : null,
      output: LOG_PROMPTS ? (entry.output ?? null) : null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      latencyMs: entry.latencyMs ?? null,
      costEur: entry.costEur ?? null,
    };
    // Fire-and-forget : on n'attend pas, et on avale toute erreur.
    Promise.resolve(storage.createAiInvocation(row as any)).catch(() => {});
  } catch {
    /* best-effort : ne jamais bloquer un appel IA */
  }
}
