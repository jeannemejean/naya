import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { NAYA_SYSTEM_VOICE } from "../naya-voice";
import { buildNayaContext } from "./naya-context";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const CLAUDE_MODELS = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-4-6",
};

export const NAYA_VOICE = NAYA_SYSTEM_VOICE;

/**
 * Call Claude with full Naya context automatically injected
 * This ensures every AI response is personalized and context-aware
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
  });
}

export async function callClaude(options: {
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  max_tokens?: number;
  temperature?: number;
}): Promise<string> {
  const { model = CLAUDE_MODELS.fast, messages, max_tokens = 1024, system, temperature } = options;

  const systemMsg = system ?? messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const response = await anthropic.messages.create({
    model,
    max_tokens,
    ...(systemMsg ? { system: systemMsg } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    messages: chatMessages,
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
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
      .on("finalMessage", () => {
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
