// Adaptateur fin — l'intérieur du moteur IA vit désormais dans `./ai/` (providers,
// routeur, registre, journal). Les signatures publiques exportées ici sont
// STRICTEMENT inchangées : aucun site d'appel ne doit être modifié.

import type { Response } from "express";
import { NAYA_SYSTEM_VOICE } from "../naya-voice";
import { buildNayaContext } from "./naya-context";
import { recordSpend, estimateClaudeCostEur } from "./usage";
import { route } from "./ai/router";
import { registry } from "./ai/registry";
import { logInvocation } from "./ai/invocation-log";
import { anthropic } from "./ai/providers/anthropic";
import type { TaskKind } from "./ai/types";

// Client Anthropic ré-exporté (compat : certains modules historiques peuvent l'importer).
export { anthropic };

// Modèles dérivés du routeur (valeurs inchangées). Changer la politique dans
// router.ts change automatiquement ce que les sites d'appel utilisent.
export const CLAUDE_MODELS = {
  fast: route("fast_generation").model,        // "claude-haiku-4-5-20251001"
  smart: route("strategic_reasoning").model,   // "claude-sonnet-4-6"
};

export const NAYA_VOICE = NAYA_SYSTEM_VOICE;

/**
 * Call Claude with full Naya context automatically injected.
 * Garde-fou : injecte toujours NAYA_SYSTEM_VOICE + buildNayaContext() dans le system.
 */
export async function callClaudeWithContext(options: {
  userId: string;
  projectId?: number | null;
  userMessage: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  additionalSystemContext?: string;
}): Promise<string> {
  const {
    userId,
    projectId,
    userMessage,
    model = CLAUDE_MODELS.smart,
    max_tokens = 4096,
    temperature,
    additionalSystemContext = "",
  } = options;

  // Build complete Naya context
  const nayaContext = await buildNayaContext(userId, projectId);

  // Assemble system prompt with voice + context + optional additional context
  const systemPrompt = `${NAYA_SYSTEM_VOICE}

${nayaContext}${additionalSystemContext ? `\n\n${additionalSystemContext}` : ""}`;

  return callClaude({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    max_tokens,
    temperature,
    userId, // imputation du coût à l'utilisateur
    projectId, // pour la triangulation par marque dans le journal
    taskKind: model === CLAUDE_MODELS.fast ? "fast_generation" : "strategic_reasoning",
  });
}

export async function callClaude(options: {
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  userId?: string; // si fourni, le coût (tokens) est imputé à cet utilisateur
  // Champs internes optionnels (rétro-compatibles, défaut = comportement historique) :
  taskKind?: TaskKind;          // intention métier (sinon dérivée du modèle)
  projectId?: number | null;    // marque concernée (journalisation)
}): Promise<string> {
  const { model = CLAUDE_MODELS.fast, messages, max_tokens = 1024, system, temperature, userId, projectId } = options;

  const systemMsg = system ?? messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const taskKind: TaskKind = options.taskKind ?? (model === CLAUDE_MODELS.fast ? "fast_generation" : "strategic_reasoning");
  // Le routeur choisit le PROVIDER ; le modèle explicite passé par l'appelant est honoré.
  const provider = registry.get(route(taskKind).provider);

  const started = Date.now();
  const result = await provider.generate(
    { system: systemMsg, messages: chatMessages, maxTokens: max_tokens, temperature },
    model,
  );
  const latencyMs = Date.now() - started;

  // Imputation du coût IA (garde-fou plafond) — comportement IDENTIQUE à avant.
  let costEur: number | undefined;
  if (result.usage) {
    costEur = estimateClaudeCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens);
    if (userId) recordSpend(userId, costEur).catch(() => {});
  }

  // Journalisation best-effort (ne bloque jamais l'appel).
  logInvocation({
    userId,
    projectId,
    taskKind,
    provider: result.provider,
    model: result.model,
    systemPrompt: systemMsg,
    userMessage: [...chatMessages].reverse().find((m) => m.role === "user")?.content,
    output: result.text,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    latencyMs,
    costEur,
  });

  return result.text;
}

export async function streamClaude(options: {
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  max_tokens?: number;
  res: Response;
}): Promise<void> {
  const { model = CLAUDE_MODELS.smart, messages, max_tokens = 8192, system, res } = options;

  const systemMsg = system ?? messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const started = Date.now();

  return new Promise((resolve, reject) => {
    anthropic.messages
      .stream({
        model,
        max_tokens,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: chatMessages,
      })
      .on("text", (text) => {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      })
      .on("finalMessage", (msg) => {
        // Journalisation best-effort du message final (pas de userId dans cette signature).
        try {
          const output = (msg?.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          logInvocation({
            taskKind: model === CLAUDE_MODELS.fast ? "fast_generation" : "strategic_reasoning",
            provider: "anthropic",
            model,
            systemPrompt: systemMsg,
            userMessage: [...chatMessages].reverse().find((m) => m.role === "user")?.content,
            output,
            inputTokens: msg?.usage?.input_tokens,
            outputTokens: msg?.usage?.output_tokens,
            latencyMs: Date.now() - started,
          });
        } catch { /* best-effort */ }
        res.write("data: [DONE]\n\n");
        res.end();
        resolve();
      })
      .on("error", (err) => {
        console.error("Claude stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Stream error" });
        else res.end();
        reject(err);
      });
  });
}
