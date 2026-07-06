import Anthropic from "@anthropic-ai/sdk";
import type { NayaModelProvider, GenerateInput, GenerateResult, TaskKind } from "../types";

// Client Anthropic partagé (clé lue depuis l'env uniquement).
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export class AnthropicProvider implements NayaModelProvider {
  readonly name = "anthropic";

  supports(task: TaskKind): boolean {
    // Anthropic gère toutes les tâches de génération/raisonnement, pas l'embedding.
    return task !== "embedding";
  }

  async generate(input: GenerateInput, model: string): Promise<GenerateResult> {
    const { system, messages, maxTokens = 1024, temperature } = input;

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model,
      provider: this.name,
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens || 0, outputTokens: response.usage.output_tokens || 0 }
        : undefined,
      stopReason: response.stop_reason ?? undefined, // "max_tokens" = tronqué
    };
  }
}
