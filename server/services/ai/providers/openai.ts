import OpenAI from "openai";
import type {
  NayaModelProvider, GenerateInput, GenerateResult,
  EmbedInput, EmbedResult, TaskKind,
} from "../types";

// Provider de secours + embeddings. La clé est lue depuis l'env uniquement.
export class OpenAIProvider implements NayaModelProvider {
  readonly name = "openai";
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  supports(task: TaskKind): boolean {
    return true; // génération de secours + embeddings
  }

  async generate(input: GenerateInput, model: string): Promise<GenerateResult> {
    const { system, messages, maxTokens = 1024, temperature } = input;

    const resp = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model,
      provider: this.name,
      usage: resp.usage
        ? { inputTokens: resp.usage.prompt_tokens || 0, outputTokens: resp.usage.completion_tokens || 0 }
        : undefined,
    };
  }

  // Embeddings — text-embedding-3-small → vecteurs 1536 dim (figé pour pgvector, Phase 2).
  async embed(input: EmbedInput, model: string): Promise<EmbedResult> {
    const resp = await this.client.embeddings.create({ model, input: input.texts });
    return {
      vectors: resp.data.map((d) => d.embedding),
      model,
      provider: this.name,
    };
  }
}
